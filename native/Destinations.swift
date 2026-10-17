import AppKit
import ApplicationServices

// What the window picker offers: composer windows (Composer.swift) and terminal tabs (Terminal.swift).

struct Target {
    let id: String
    let app: String
    let window: String
    let icon: NSImage?
    var terminal = false
}

/// One scan of open windows and terminal tabs. Built off the main thread, then handed to the registry on main.
struct Discovery {
    let targets: [Target]
    var choices: [String: WindowChoice] = [:]
    var tabs: [String: TerminalTab] = [:]
    /// Terminals that are running but whose tabs Add may not list yet.
    var blocked: [(TerminalApp, TerminalAccess)] = []
}

/// Live windows of regular apps and tabs of the terminals, re-read each time the panel opens. Ids are
/// valid until the next discovery.
final class ComposerRegistry {
    private var choices: [String: WindowChoice] = [:]
    private var tabs: [String: TerminalTab] = [:]

    func apply(_ discovery: Discovery) {
        choices = discovery.choices
        tabs = discovery.tabs
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
        let terminals = discoverTerminalTabs()
        var tabs: [String: TerminalTab] = [:]
        let tabTargets = terminals.tabs.map { tab in
            let id = UUID().uuidString
            tabs[id] = tab
            return Target(id: id, app: tab.app.name, window: tab.label,
                          icon: NSRunningApplication(processIdentifier: tab.pid)?.icon, terminal: true)
        }
        return Discovery(targets: targets + tabTargets, choices: choices, tabs: tabs, blocked: terminals.blocked)
    }

    /// The current row for an already chosen tab, by its session, if it is still listed.
    func id(of tab: TerminalTab) -> String? { tabs.first { $0.value.key == tab.key }?.key }

    func tab(_ id: String) -> TerminalTab? { tabs[id] }

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
