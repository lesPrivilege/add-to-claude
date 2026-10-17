import AppKit
import ApplicationServices

// What the window picker offers: composer windows (Composer.swift) and terminal windows (Terminal.swift).

struct Target {
    let id: String
    let app: String
    let window: String
    let icon: NSImage?
    var terminal = false
}

/// One scan of open windows. Built off the main thread, then handed to the registry on main.
struct Discovery {
    let targets: [Target]
    var choices: [String: WindowChoice] = [:]
    var terminals: [String: WindowChoice] = [:]
}

/// Live windows of regular apps, composers and terminals apart, re-read each time the panel opens. Ids
/// are valid until the next discovery.
final class ComposerRegistry {
    private var choices: [String: WindowChoice] = [:]
    private var terminals: [String: WindowChoice] = [:]

    func apply(_ discovery: Discovery) {
        choices = discovery.choices
        terminals = discovery.terminals
    }

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
            let app = safeLabel(choice.app.localizedName ?? "App", limit: 48)
            // An app that titles every window with its own name (Claude for Mac) says which
            // conversation it shows only inside its page; use that title to tell windows apart.
            let page = choice.title == choice.app.localizedName ? conversationPage(in: choice.window)?.title : nil
            let label = page.map { $0.replacingOccurrences(of: #" - Claude( Code)?$"#, with: "", options: .regularExpression) }
                ?? (choice.title == choice.app.localizedName && !choice.needsIdentityCue ? nil : choice.displayLabel(limit: 60))
            return Target(id: id, app: app, window: label ?? "", icon: choice.app.icon)
        }
        // Terminal windows: any terminal app's windows, whatever it is. Each gets the line on the clipboard.
        var terminals: [String: WindowChoice] = [:]
        let terminalApps = NSWorkspace.shared.runningApplications.filter { $0.activationPolicy == .regular && !$0.isTerminated && isTerminal($0) }
            .sorted { ($0.localizedName ?? "").localizedCaseInsensitiveCompare($1.localizedName ?? "") == .orderedAscending }
        var terminalTargets: [Target] = []
        for app in terminalApps.prefix(20) {
            guard let windows = attribute(AXUIElementCreateApplication(app.processIdentifier), kAXWindowsAttribute) as? [AXUIElement] else { continue }
            let listed = windows.prefix(30).compactMap { WindowChoice(app: app, window: $0) }
            for (index, choice) in listed.enumerated() {
                let id = UUID().uuidString
                terminals[id] = choice
                // Window titles repeat across terminal windows ("zsh"); the position keeps rows apart.
                choice.identityOrdinal = index + 1
                choice.needsIdentityCue = listed.filter { $0.title == choice.title }.count > 1
                terminalTargets.append(Target(id: id, app: safeLabel(app.localizedName ?? "Terminal", limit: 48),
                                              window: choice.displayLabel(limit: 60), icon: app.icon, terminal: true))
            }
        }
        return Discovery(targets: targets + terminalTargets, choices: choices, terminals: terminals)
    }

    /// The current row for an already chosen terminal window, if it is still listed.
    func id(ofTerminal choice: WindowChoice) -> String? {
        terminals.first { $0.value.app.processIdentifier == choice.app.processIdentifier && CFEqual($0.value.window, choice.window) }?.key
    }

    func terminal(_ id: String) -> WindowChoice? { terminals[id] }

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
