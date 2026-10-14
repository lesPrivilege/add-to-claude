import AppKit
import ApplicationServices

let maximumTextBytes = 2 * 1024 * 1024
let accessibilityTimeout: Float = 0.15

func attribute(_ element: AXUIElement, _ name: String) -> CFTypeRef? {
    guard AXUIElementSetMessagingTimeout(element, accessibilityTimeout) == .success else { return nil }
    var value: CFTypeRef?
    return AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success ? value : nil
}

func axElement(_ element: AXUIElement, _ name: String) -> AXUIElement? {
    guard let value = attribute(element, name), CFGetTypeID(value) == AXUIElementGetTypeID() else { return nil }
    let result = value as! AXUIElement
    guard AXUIElementSetMessagingTimeout(result, accessibilityTimeout) == .success else { return nil }
    return result
}

func axString(_ element: AXUIElement, _ name: String) -> String? {
    attribute(element, name) as? String
}

func sameTextUnits(_ actual: String?, _ expected: String) -> Bool {
    guard let actual else { return false }
    // Swift String equality accepts canonical normalization; AX offsets and exact receipts cannot.
    return actual.utf16.elementsEqual(expected.utf16)
}

func axSettable(_ element: AXUIElement, _ name: String) -> Bool {
    var settable: DarwinBoolean = false
    return AXUIElementIsAttributeSettable(element, name as CFString, &settable) == .success && settable.boolValue
}

func selectedRange(_ element: AXUIElement) -> CFRange? {
    guard let value = attribute(element, kAXSelectedTextRangeAttribute),
          CFGetTypeID(value) == AXValueGetTypeID() else { return nil }
    var range = CFRange()
    guard AXValueGetValue(value as! AXValue, .cfRange, &range) else { return nil }
    return range
}

func same(_ lhs: AXUIElement?, _ rhs: AXUIElement) -> Bool {
    guard let lhs else { return false }
    return CFEqual(lhs, rhs)
}

func safeLabel(_ text: String, limit: Int = 90) -> String {
    let visible = text.unicodeScalars.filter { !CharacterSet.controlCharacters.contains($0) }
    return String(String.UnicodeScalarView(visible)).prefix(limit).description
}

func isTerminal(_ app: NSRunningApplication) -> Bool {
    let identity = ((app.bundleIdentifier ?? "") + " " + (app.localizedName ?? "")).lowercased()
    return ["terminal", "iterm", "warp", "alacritty", "kitty", "wezterm", "ghostty", "hyper", "tabby", "rio-terminal", "termius"].contains { identity.contains($0) }
}

final class WindowChoice: NSObject {
    let app: NSRunningApplication
    let launchDate: Date
    let window: AXUIElement
    let title: String
    var identityOrdinal = 0
    var needsIdentityCue = false

    init?(app: NSRunningApplication, window: AXUIElement) {
        guard let launchDate = app.launchDate else { return nil }
        self.app = app
        self.launchDate = launchDate
        self.window = window
        self.title = axString(window, kAXTitleAttribute) ?? "Untitled window"
    }

    func displayLabel(limit: Int = 90) -> String {
        let label = safeLabel(title, limit: limit)
        return needsIdentityCue ? "\(label) · #\(identityOrdinal)" : label
    }
}

struct Composer {
    let choice: WindowChoice
    let editor: AXUIElement
}


func validWindow(_ choice: WindowChoice) -> Bool {
    guard !choice.app.isTerminated, choice.app.launchDate == choice.launchDate, !isTerminal(choice.app) else { return false }
    let app = AXUIElementCreateApplication(choice.app.processIdentifier)
    guard let windows = attribute(app, kAXWindowsAttribute) as? [AXUIElement], windows.contains(where: { CFEqual($0, choice.window) }) else { return false }
    return (axString(choice.window, kAXTitleAttribute) ?? "Untitled window") == choice.title
}

/// The text area that has focus inside the chosen window, read without activating its app.
func focusedComposer(_ choice: WindowChoice) -> AXUIElement? {
    guard AXIsProcessTrusted(), validWindow(choice) else { return nil }
    let app = AXUIElementCreateApplication(choice.app.processIdentifier)
    guard same(axElement(app, kAXFocusedWindowAttribute), choice.window),
          let field = axElement(app, kAXFocusedUIElementAttribute),
          same(axElement(field, kAXWindowAttribute), choice.window),
          axString(field, kAXRoleAttribute) == kAXTextAreaRole else { return nil }
    guard axSettable(field, kAXSelectedTextRangeAttribute), axSettable(field, kAXSelectedTextAttribute) else { return nil }
    let semantics = [kAXTitleAttribute, kAXDescriptionAttribute, kAXHelpAttribute, "AXIdentifier"].compactMap { axString(field, $0) }.joined(separator: " ").lowercased()
    // Fail closed for accessible names that explicitly identify a shell or code pane.
    guard !["terminal", "shell", "source editor", "code editor", "source code", "editor contents", "monaco"].contains(where: { semantics.contains($0) }) else { return nil }
    return field
}


/// Appends at the end of the chosen composer while its app stays in the background.
/// Never activates, raises, pastes, types or sends; success means the exact text was read back.
func appendToComposer(_ selected: Composer, text: String, operationValid: @escaping () -> Bool,
                      revalidateSource: @escaping (@escaping (Bool) -> Void) -> Void,
                      completion: @escaping (String, Bool) -> Void) {
    guard operationValid(), !text.isEmpty, text.utf8.count <= maximumTextBytes else {
        completion("The context changed or exceeds the native text limit. Use a context file.", false); return
    }
    guard AXIsProcessTrusted(), validWindow(selected.choice) else {
        completion("The target or its permission changed. Choose the composer again.", false); return
    }
    revalidateSource { valid in
        DispatchQueue.main.async {
            guard valid, operationValid() else { completion("The source changed. Nothing was added.", false); return }
            guard let current = focusedComposer(selected.choice), CFEqual(current, selected.editor),
                  let old = axString(current, kAXValueAttribute) else {
                completion("The composer is no longer ready. Nothing was added; choose it again.", false); return
            }
            let suffix = old.isEmpty ? text : "\n\n" + text
            guard old.utf8.count + suffix.utf8.count <= maximumTextBytes else {
                completion("The combined draft exceeds the native text limit. Use a context file.", false); return
            }
            let combined = old + suffix
            // Never replace AXValue: doing so discards existing rich spans and attachment objects.
            // AX text ranges use UTF-16 offsets, not Swift Character or UTF-8 counts.
            var end = CFRange(location: old.utf16.count, length: 0)
            guard operationValid() else { completion("The handoff expired or changed. Nothing was added.", false); return }
            guard let position = AXValueCreate(.cfRange, &end),
                  AXUIElementSetAttributeValue(current, kAXSelectedTextRangeAttribute as CFString, position) == .success,
                  let focused = focusedComposer(selected.choice), CFEqual(focused, current),
                  sameTextUnits(axString(current, kAXValueAttribute), old),
                  let range = selectedRange(current), range.location == end.location, range.length == 0,
                  operationValid() else {
                completion("The insertion point or draft changed. Nothing was added; choose the composer again.", false); return
            }
            let result = AXUIElementSetAttributeValue(current, kAXSelectedTextAttribute as CFString, suffix as CFString)
            guard result == .success, sameTextUnits(axString(current, kAXValueAttribute), combined) else {
                completion("Text may have been added but did not read back exactly. Check the draft before retrying.", false); return
            }
            completion("Added. Review the draft there; nothing was sent.", true)
        }
    }
}

struct Target {
    let id: String
    let app: String
    let window: String
    let icon: NSImage?
}

/// One scan of open windows. Built off the main thread, then handed to the registry on main.
struct Discovery {
    let targets: [Target]
    fileprivate let choices: [String: WindowChoice]
}

/// Live windows of regular apps, re-read each time the popover opens. Ids are valid until the next discovery.
final class ComposerRegistry {
    private var choices: [String: WindowChoice] = [:]

    func apply(_ discovery: Discovery) { choices = discovery.choices }

    static func discover() -> Discovery {
        var choices: [String: WindowChoice] = [:]
        guard AXIsProcessTrusted() else { return Discovery(targets: [], choices: [:]) }
        let apps = NSWorkspace.shared.runningApplications.filter {
            $0.activationPolicy == .regular && !$0.isTerminated && $0.processIdentifier != ProcessInfo.processInfo.processIdentifier && !isTerminal($0)
        }.sorted { ($0.localizedName ?? "").localizedCaseInsensitiveCompare($1.localizedName ?? "") == .orderedAscending }
        var found: [(String, WindowChoice)] = []
        for app in apps.prefix(80) {
            let axApp = AXUIElementCreateApplication(app.processIdentifier)
            guard let windows = attribute(axApp, kAXWindowsAttribute) as? [AXUIElement] else { continue }
            for window in windows.prefix(30) where found.count < 128 {
                if let choice = WindowChoice(app: app, window: window) { found.append((UUID().uuidString, choice)) }
            }
        }
        // Same-title windows of one app get a short handle cue so they stay distinguishable.
        let counts = Dictionary(grouping: found) { "\($0.1.app.processIdentifier):\($0.1.title)" }.mapValues(\.count)
        var ordinals: [String: Int] = [:]
        let targets = found.map { id, choice in
            let key = "\(choice.app.processIdentifier):\(choice.title)"
            ordinals[key, default: 0] += 1
            choice.identityOrdinal = ordinals[key]!
            choice.needsIdentityCue = counts[key]! > 1
            choices[id] = choice
            return Target(id: id, app: safeLabel(choice.app.localizedName ?? "App", limit: 48),
                          window: choice.displayLabel(limit: 60), icon: choice.app.icon)
        }
        return Discovery(targets: targets, choices: choices)
    }

    /// The id of the current row for an already chosen composer, if its window is still listed.
    func id(of composer: Composer) -> String? {
        choices.first { $0.value.app.processIdentifier == composer.choice.app.processIdentifier && CFEqual($0.value.window, composer.choice.window) }?.key
    }

    /// The window's focused text area, or nil when the user has not focused a writable composer there.
    func composer(_ id: String) -> Composer? {
        guard let choice = choices[id], let editor = focusedComposer(choice) else { return nil }
        return Composer(choice: choice, editor: editor)
    }
}
