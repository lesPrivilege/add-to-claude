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

    convenience init?(app: NSRunningApplication, window: AXUIElement) {
        guard let launchDate = app.launchDate else { return nil }
        self.init(app: app, launchDate: launchDate, window: window, title: axString(window, kAXTitleAttribute) ?? "Untitled window")
    }

    init(app: NSRunningApplication, launchDate: Date, window: AXUIElement, title: String) {
        self.app = app
        self.launchDate = launchDate
        self.window = window
        self.title = title
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

/// The window's message box when the app reports no focused element: the text area marked focused,
/// or else the only writable text area in the window. Ambiguity returns nil. Bounded walk.
func windowTextArea(in window: AXUIElement) -> AXUIElement? {
    var queue: [(AXUIElement, Int)] = [(window, 0)], visited = 0
    var focused: [AXUIElement] = [], writable: [AXUIElement] = []
    while !queue.isEmpty && visited < 4000 {
        let (element, depth) = queue.removeFirst()
        visited += 1
        if axString(element, kAXRoleAttribute) == kAXTextAreaRole, axSettable(element, kAXSelectedTextAttribute) {
            writable.append(element)
            if attribute(element, kAXFocusedAttribute) as? Bool == true { focused.append(element) }
        }
        if depth < 60, let children = attribute(element, kAXChildrenAttribute) as? [AXUIElement] {
            queue.append(contentsOf: children.map { ($0, depth + 1) })
        }
    }
    if focused.count == 1 { return focused[0] }
    return focused.isEmpty && writable.count == 1 ? writable[0] : nil
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
    // and drop the text area's own focus mark once another app is used; look inside the chosen window.
    guard let field = axElement(app, kAXFocusedUIElementAttribute) ?? windowTextArea(in: choice.window) else {
        return (nil, "it has no single writable message box")
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


/// What an append ended with. Only `inserted` means the text was read back from the draft; `unconfirmed`
/// means the draft changed but the text could not be confirmed; `failed` means nothing was added.
enum AddOutcome { case inserted, unconfirmed, failed }

/// A stable conversation id read from a target page's URL, or nil. Only exact, known shapes count:
/// a Claude chat (https://claude.ai/chat/<uuid>) and a Claude Code session in Claude for Mac
/// (https://claude.ai/epitaxy/local_<uuid>, seen on the owner's Mac on 2026-10-16).
/// Window titles, app names and paste history never do.
func targetConversationId(_ text: String) -> String? {
    let uuid = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
    guard text.utf8.count <= 4096, let url = URL(string: text), url.scheme == "https", url.host == "claude.ai",
          url.user == nil, url.password == nil, url.port == nil,
          url.path.range(of: "^/(chat/\(uuid)|epitaxy/(local_)?\(uuid))/?$", options: .regularExpression) != nil
    else { return nil }
    let path = url.path.hasSuffix("/") ? String(url.path.dropLast()) : url.path
    return "claude.ai" + path.lowercased()
}

/// The target's own conversation id, when the window shows a web page that names one in its URL
/// (Claude for Mac is a web app: its inner AXWebArea carries `AXURL`, e.g. https://claude.ai/epitaxy/local_<uuid>).
/// Several web areas naming different conversations is ambiguous: no id. Bounded walk, no activation.
func conversationIdentity(in window: AXUIElement) -> String? {
    var found = Set<String>()
    var queue: [(AXUIElement, Int)] = [(window, 0)], visited = 0
    let deadline = Date().addingTimeInterval(1) // A slow app reads as unidentified, never as the same conversation.
    if let document = axString(window, kAXDocumentAttribute), let id = targetConversationId(document) { found.insert(id) }
    while !queue.isEmpty && visited < 2000 && Date() < deadline {
        let (element, depth) = queue.removeFirst()
        visited += 1
        if axString(element, kAXRoleAttribute) == "AXWebArea" {
            let value = attribute(element, kAXURLAttribute)
            let text = (value as? URL)?.absoluteString ?? value as? String
            if let text, let id = targetConversationId(text) { found.insert(id) }
            continue // A web area's page is not searched further; its URL is what names it.
        }
        if depth < 12, let children = attribute(element, kAXChildrenAttribute) as? [AXUIElement] {
            queue.append(contentsOf: children.map { ($0, depth + 1) })
        }
    }
    return found.count == 1 ? found.first : nil
}

/// Appends at the end of the chosen composer while its app stays in the background.
/// Never activates, raises, pastes, types or sends; success means the exact text was read back.
func appendToComposer(_ selected: Composer, text: String, operationValid: @escaping () -> Bool,
                      revalidateSource: @escaping (@escaping (Bool) -> Void) -> Void,
                      completion: @escaping (String, AddOutcome) -> Void) {
    guard operationValid(), !text.isEmpty, text.utf8.count <= maximumTextBytes else {
        completion("The context changed or exceeds the native text limit. Use a context file.", .failed); return
    }
    guard AXIsProcessTrusted(), validWindow(selected.choice) else {
        completion("The target or its permission changed. Choose the composer again.", .failed); return
    }
    revalidateSource { valid in
        DispatchQueue.main.async {
            guard valid, operationValid() else { completion("The source changed. Nothing was added.", .failed); return }
            guard let current = focusedComposer(selected.choice), CFEqual(current, selected.editor),
                  let old = axString(current, kAXValueAttribute) else {
                completion("The composer is no longer ready. Nothing was added; choose it again.", .failed); return
            }
            // A blank draft (rich editors report an empty paragraph as "\n") has nothing to keep.
            let blank = old.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            let suffix = blank ? text : "\n\n" + text
            guard old.utf8.count + suffix.utf8.count <= maximumTextBytes else {
                completion("The combined draft exceeds the native text limit. Use a context file.", .failed); return
            }
            let combined = blank ? text : old + suffix
            // Never replace AXValue: doing so discards existing rich spans and attachment objects.
            // AX text ranges use UTF-16 offsets, not Swift Character or UTF-8 counts.
            // A blank draft is replaced as a selection; otherwise the caret goes to the end.
            var end = CFRange(location: blank ? 0 : old.utf16.count, length: blank ? old.utf16.count : 0)
            guard operationValid() else { completion("The handoff expired or changed. Nothing was added.", .failed); return }
            if ignoresInsertion(selected.choice.app) {
                return fallBack(selected, field: current, old: old, blank: blank, text: text, suffix: suffix, completion: completion)
            }
            let setRange = AXValueCreate(.cfRange, &end).map {
                AXUIElementSetAttributeValue(current, kAXSelectedTextRangeAttribute as CFString, $0)
            }
            let stillFocused = focusedComposer(selected.choice).map { CFEqual($0, current) } ?? false
            let after = axString(current, kAXValueAttribute)
            let range = selectedRange(current)
            // Rich editors (ProseMirror in Claude, for one) end the draft with a paragraph marker the caret
            // cannot pass. Inserting just before that final newline is the same end-of-draft position.
            let units = Array(old.utf16)
            let beforeFinalBreak = units.last == 10 && range.map { $0.location == units.count - 1 && $0.length == 0 } == true
            guard setRange == .success, stillFocused, sameTextUnits(after, old), let range,
                  (range.location == end.location && range.length == end.length) || beforeFinalBreak,
                  operationValid() else {
                completion("The insertion point or draft changed. Nothing was added; choose the composer again.", .failed); return
            }
            let head = String(utf16CodeUnits: Array(units[..<range.location]), count: range.location)
            let tail = String(utf16CodeUnits: Array(units[(range.location + range.length)...]), count: units.count - range.location - range.length)
            let expected = beforeFinalBreak ? (blank ? text : head + suffix) + tail : combined
            let result = AXUIElementSetAttributeValue(current, kAXSelectedTextAttribute as CFString, suffix as CFString)
            guard result == .success else {
                completion("The app refused the text. Nothing was added.", .failed); return
            }
            // Web-based editors (Chromium, Electron) apply the write asynchronously; wait for the draft to
            // change before reading it back, for up to two seconds.
            confirmWrite(current, old: old, expected: expected, attempts: 20, rich: beforeFinalBreak) { message, success in
                guard success == .failed, message == ignoredMessage, operationValid() else { return completion(message, success) }
                rememberIgnoresInsertion(selected.choice.app)
                // Some web editors (Claude's ProseMirror prompt) take no AX text writes at all.
                fallBack(selected, field: current, old: old, blank: blank, text: text, suffix: suffix, completion: completion)
            }
        }
    }
}

private let ignoredMessage = "The app did not take the text. Nothing was added."

/// Apps seen to accept AX text insertion calls without applying them; later Adds skip that wait.
let ignoringKey = "AppsIgnoringTextInsertion"
private func ignoresInsertion(_ app: NSRunningApplication) -> Bool {
    app.bundleIdentifier.map { (UserDefaults.standard.stringArray(forKey: ignoringKey) ?? []).contains($0) } ?? false
}
private func rememberIgnoresInsertion(_ app: NSRunningApplication) {
    guard let id = app.bundleIdentifier, !ignoresInsertion(app) else { return }
    UserDefaults.standard.set((UserDefaults.standard.stringArray(forKey: ignoringKey) ?? []) + [id], forKey: ignoringKey)
}

/// Line breaks and blank lines as a rich editor keeps them: runs of newlines become one, ends trimmed.
private func normalized(_ text: String) -> String {
    text.replacingOccurrences(of: #"\n[\n\s]*"#, with: "\n", options: .regularExpression)
        .trimmingCharacters(in: .whitespacesAndNewlines)
}

/// After an ignored AX write: set the whole value of an empty box, then paste with ⌘V sent to that app
/// alone. The app is never activated and nothing is sent. Unconfirmed, the text stays on the clipboard.
private func fallBack(_ selected: Composer, field: AXUIElement, old: String, blank: Bool, text: String, suffix: String,
                      completion: @escaping (String, AddOutcome) -> Void) {
    let landed: (String?) -> Bool = { written in
        guard let written, !sameTextUnits(written, old) else { return false }
        return normalized(written) == normalized(blank ? text : old + suffix)
    }
    func paste() {
        let board = NSPasteboard.general
        let saved = board.pasteboardItems?.map { item in item.types.compactMap { type in item.data(forType: type).map { (type, $0) } } } ?? []
        board.clearContents()
        board.setString(blank ? text : suffix, forType: .string)
        let source = CGEventSource(stateID: .hidSystemState)
        for down in [true, false] {
            let event = CGEvent(keyboardEventSource: source, virtualKey: 9, keyDown: down) // V
            event?.flags = .maskCommand
            event?.postToPid(selected.choice.app.processIdentifier)
        }
        waitForChange(field, old: old, attempts: 20) { written in
            guard let written, !sameTextUnits(written, old) else {
                return completion("This app takes text only by pasting. The conversation is on the clipboard: click its message box and press ⌘V.", .failed)
            }
            board.clearContents()
            board.writeObjects(saved.map { pairs in
                let item = NSPasteboardItem()
                for (type, data) in pairs { item.setData(data, forType: type) }
                return item
            })
            // Editors that turn pasted Markdown into formatting (Claude's does) cannot read back exactly,
            // so the draft changed but whether all of it landed is not known.
            if landed(written) { return completion("Added by pasting into the app. Review the draft there; nothing was sent.", .inserted) }
            completion("Pasted, but the app reformatted the Markdown, so it could not be confirmed. Check the draft there; nothing was sent.", .unconfirmed)
        }
    }
    guard blank, axSettable(field, kAXValueAttribute) else { return paste() }
    // An empty box has no rich content to lose, so replacing its whole value is safe here.
    AXUIElementSetAttributeValue(field, kAXValueAttribute as CFString, text as CFString)
    waitForChange(field, old: old, attempts: 10) { written in
        if landed(written) { return completion("Added. Review the draft there; nothing was sent.", .inserted) }
        if let written, !sameTextUnits(written, old) {
            return completion("Text was added but reads back differently. Check the draft before retrying.", .unconfirmed)
        }
        paste()
    }
}

private func waitForChange(_ field: AXUIElement, old: String, attempts: Int, then: @escaping (String?) -> Void) {
    let written = axString(field, kAXValueAttribute)
    if sameTextUnits(written, old) && attempts > 0 {
        return DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { waitForChange(field, old: old, attempts: attempts - 1, then: then) }
    }
    then(written)
}

private func confirmWrite(_ field: AXUIElement, old: String, expected: String, attempts: Int, rich: Bool,
                          completion: @escaping (String, AddOutcome) -> Void) {
    let written = axString(field, kAXValueAttribute)
    if sameTextUnits(written, old) && attempts > 0 {
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
            confirmWrite(field, old: old, expected: expected, attempts: attempts - 1, rich: rich, completion: completion)
        }
        return
    }
    if sameTextUnits(written, expected) { return completion("Added. Review the draft there; nothing was sent.", .inserted) }
    if sameTextUnits(written, old) { return completion(ignoredMessage, .failed) }
    completion("Text was added but reads back differently. Check the draft before retrying.", .unconfirmed)
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
