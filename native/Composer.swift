import AppKit
import ApplicationServices
import OSLog

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

/// The one text area in a window that reports keyboard focus. Bounded walk of the window's tree.
func focusedTextArea(in window: AXUIElement) -> AXUIElement? {
    var queue: [(AXUIElement, Int)] = [(window, 0)], visited = 0, found: [AXUIElement] = []
    while !queue.isEmpty && visited < 4000 {
        let (element, depth) = queue.removeFirst()
        visited += 1
        if axString(element, kAXRoleAttribute) == kAXTextAreaRole, attribute(element, kAXFocusedAttribute) as? Bool == true {
            found.append(element)
        }
        if depth < 60, let children = attribute(element, kAXChildrenAttribute) as? [AXUIElement] {
            queue.append(contentsOf: children.map { ($0, depth + 1) })
        }
    }
    return found.count == 1 ? found[0] : nil
}

/// The text area that has focus inside the chosen window, read without activating its app.
func focusedComposer(_ choice: WindowChoice) -> AXUIElement? { inspectComposer(choice).field }

/// The focused text area, or why there is none, in words the bar can show.
func inspectComposer(_ choice: WindowChoice) -> (field: AXUIElement?, problem: String) {
    guard AXIsProcessTrusted() else { return (nil, "Accessibility is off") }
    guard validWindow(choice) else { return (nil, "the window closed or changed") }
    let app = AXUIElementCreateApplication(choice.app.processIdentifier)
    guard same(axElement(app, kAXFocusedWindowAttribute), choice.window) else { return (nil, "another window of that app has focus") }
    // Electron apps (Claude, for one) report no focused element for the app while in the background,
    // although the text area itself still says it has focus; look for it inside the window.
    guard let field = axElement(app, kAXFocusedUIElementAttribute) ?? focusedTextArea(in: choice.window) else {
        return (nil, "nothing in it has focus")
    }
    guard same(axElement(field, kAXWindowAttribute), choice.window) else { return (nil, "the focused element is in another window") }
    let role = axString(field, kAXRoleAttribute) ?? "no role"
    guard role == kAXTextAreaRole else { return (nil, "the focused element is \(role), not a text area") }
    guard axSettable(field, kAXSelectedTextRangeAttribute), axSettable(field, kAXSelectedTextAttribute) else {
        return (nil, "its text area does not accept inserted text")
    }
    let semantics = [kAXTitleAttribute, kAXDescriptionAttribute, kAXHelpAttribute, "AXIdentifier"].compactMap { axString(field, $0) }.joined(separator: " ").lowercased()
    // Fail closed for accessible names that explicitly identify a shell or code pane.
    guard !["terminal", "shell", "source editor", "code editor", "source code", "editor contents", "monaco"].contains(where: { semantics.contains($0) }) else {
        return (nil, "it looks like a terminal or code editor")
    }
    return (field, "")
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
            // A blank draft (rich editors report an empty paragraph as "\n") has nothing to keep.
            let blank = old.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            let suffix = blank ? text : "\n\n" + text
            guard old.utf8.count + suffix.utf8.count <= maximumTextBytes else {
                completion("The combined draft exceeds the native text limit. Use a context file.", false); return
            }
            let combined = blank ? text : old + suffix
            // Never replace AXValue: doing so discards existing rich spans and attachment objects.
            // AX text ranges use UTF-16 offsets, not Swift Character or UTF-8 counts.
            // A blank draft is replaced as a selection; otherwise the caret goes to the end.
            var end = CFRange(location: blank ? 0 : old.utf16.count, length: blank ? old.utf16.count : 0)
            guard operationValid() else { completion("The handoff expired or changed. Nothing was added.", false); return }
            let setRange = AXValueCreate(.cfRange, &end).map {
                AXUIElementSetAttributeValue(current, kAXSelectedTextRangeAttribute as CFString, $0)
            }
            let stillFocused = focusedComposer(selected.choice).map { CFEqual($0, current) } ?? false
            let after = axString(current, kAXValueAttribute)
            let range = selectedRange(current)
            appendLog.info("append check: old=\(old.utf16.count) blank=\(blank) setRange=\(setRange?.rawValue ?? -1) focused=\(stillFocused) valueAfter=\(after?.utf16.count ?? -1) unchanged=\(sameTextUnits(after, old)) range=\(range?.location ?? -1),\(range?.length ?? -1) wanted=\(end.location),\(end.length)")
            guard setRange == .success, stillFocused, sameTextUnits(after, old),
                  let range, range.location == end.location, range.length == end.length,
                  operationValid() else {
                completion("The insertion point or draft changed. Nothing was added; choose the composer again.", false); return
            }
            let result = AXUIElementSetAttributeValue(current, kAXSelectedTextAttribute as CFString, suffix as CFString)
            let written = axString(current, kAXValueAttribute)
            appendLog.info("append write: result=\(result.rawValue) expected=\(combined.utf16.count) got=\(written?.utf16.count ?? -1) exact=\(sameTextUnits(written, combined))")
            guard result == .success, sameTextUnits(written, combined) else {
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

/// Live windows of regular apps, re-read each time the panel opens. Ids are valid until the next discovery.
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
            // Electron and Chromium apps expose their web text fields only when a client asks for it.
            AXUIElementSetAttributeValue(axApp, "AXManualAccessibility" as CFString, kCFBooleanTrue)
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

    func choice(_ id: String) -> WindowChoice? { choices[id] }

    /// The window's focused text area, or why it cannot be used.
    func composer(_ id: String) -> (composer: Composer?, problem: String) {
        guard let choice = choices[id] else { return (nil, "the window list changed") }
        let (field, problem) = inspectComposer(choice)
        return (field.map { Composer(choice: choice, editor: $0) }, problem)
    }
}

// TEMPORARY diagnostic: append checks by length and position only, never text.
private let appendLog = Logger(subsystem: "io.lesprivilege.gpt-handoff", category: "ax")

// TEMPORARY diagnostic: the editable text elements a rejected window exposes (labels and capabilities,
// never their text), written to the local system log.
func logTextElements(_ choice: WindowChoice) {
    let log = Logger(subsystem: "io.lesprivilege.gpt-handoff", category: "ax")
    let app = AXUIElementCreateApplication(choice.app.processIdentifier)
    let focused = axElement(app, kAXFocusedUIElementAttribute)
    log.info("window \(safeLabel(choice.app.localizedName ?? "?"), privacy: .public): app focused element role=\(focused.flatMap { axString($0, kAXRoleAttribute) } ?? "none", privacy: .public)")
    var queue: [(AXUIElement, Int)] = [(choice.window, 0)], visited = 0
    while !queue.isEmpty && visited < 4000 {
        let (element, depth) = queue.removeFirst()
        visited += 1
        let role = axString(element, kAXRoleAttribute) ?? ""
        if ["AXTextArea", "AXTextField", "AXComboBox"].contains(role) || attribute(element, "AXEditableAncestor") != nil && role == "AXGroup" {
            let label = [kAXDescriptionAttribute, kAXTitleAttribute, kAXPlaceholderValueAttribute, kAXSubroleAttribute, "AXDOMClassList"]
                .compactMap { name in attribute(element, name).map { "\(name)=\(safeLabel(String(describing: $0), limit: 60))" } }.joined(separator: " ")
            log.info("depth \(depth) \(role, privacy: .public) \(label, privacy: .public) focused=\(attribute(element, kAXFocusedAttribute) as? Bool ?? false) setText=\(axSettable(element, kAXSelectedTextAttribute)) setRange=\(axSettable(element, kAXSelectedTextRangeAttribute)) setValue=\(axSettable(element, kAXValueAttribute)) same=\(focused.map { CFEqual($0, element) } ?? false)")
        }
        if depth < 40, let children = attribute(element, kAXChildrenAttribute) as? [AXUIElement] {
            queue.append(contentsOf: children.map { ($0, depth + 1) })
        }
    }
    log.info("scanned \(visited) elements")
}
