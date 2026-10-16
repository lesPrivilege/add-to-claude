import AppKit
import Carbon.HIToolbox
import ServiceManagement
import SwiftUI

/// What the user can change, kept in UserDefaults. The files folder lives with `FilesFolder`.
enum Preferences {
    static let keepPanelOpen = "KeepPanelOpen"
    static let showAtLaunch = "ShowAtLaunch"
    static let shortcut = "ToggleShortcut"
    static let restoreLastWindow = "RestoreLastWindow"
    static let downloadOnAdd = "DownloadOnAdd"
    /// Apps seen to ignore AX text insertion; Add pastes into them without waiting first.
    static let appsUsingPaste = ignoringKey

    static func register() {
        UserDefaults.standard.register(defaults: [keepPanelOpen: false, showAtLaunch: true,
                                                  shortcut: Shortcut.none.rawValue, restoreLastWindow: true,
                                                  downloadOnAdd: true])
    }

    static var pinned: Bool {
        get { UserDefaults.standard.bool(forKey: keepPanelOpen) }
        set { UserDefaults.standard.set(newValue, forKey: keepPanelOpen) }
    }
}

/// A few fixed global shortcuts for showing the panel; no recorder, no conflicts to manage.
enum Shortcut: String, CaseIterable, Identifiable {
    case none, optionSpace, controlOptionSpace, shiftCommandSpace
    var id: String { rawValue }
    var title: String {
        switch self {
        case .none: "None"
        case .optionSpace: "⌥ Space"
        case .controlOptionSpace: "⌃⌥ Space"
        case .shiftCommandSpace: "⇧⌘ Space"
        }
    }
    fileprivate var modifiers: Int? {
        switch self {
        case .none: nil
        case .optionSpace: optionKey
        case .controlOptionSpace: controlKey | optionKey
        case .shiftCommandSpace: shiftKey | cmdKey
        }
    }
    static var current: Shortcut { Shortcut(rawValue: UserDefaults.standard.string(forKey: Preferences.shortcut) ?? "") ?? .none }
}

/// One system-wide hot key through Carbon, which needs no Accessibility or input-monitoring grant.
final class Hotkey {
    private var key: EventHotKeyRef?
    private var registered = Shortcut.none
    private let action: () -> Void

    init(action: @escaping () -> Void) {
        self.action = action
        var type = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
        InstallEventHandler(GetApplicationEventTarget(), { _, _, context in
            guard let context else { return OSStatus(eventNotHandledErr) }
            let hotkey = Unmanaged<Hotkey>.fromOpaque(context).takeUnretainedValue()
            DispatchQueue.main.async { hotkey.action() }
            return noErr
        }, 1, &type, Unmanaged.passUnretained(self).toOpaque(), nil)
    }

    /// Returns false when another app already holds the combination.
    @discardableResult
    func use(_ shortcut: Shortcut) -> Bool {
        guard shortcut != registered else { return true }
        if let key { UnregisterEventHotKey(key) }
        key = nil
        registered = .none
        guard let modifiers = shortcut.modifiers else { return true }
        let id = EventHotKeyID(signature: OSType(0x6768_6F66), id: 1) // "ghof"
        guard RegisterEventHotKey(UInt32(kVK_Space), UInt32(modifiers), id, GetApplicationEventTarget(), 0, &key) == noErr
        else { key = nil; return false }
        registered = shortcut
        return true
    }
}

/// The separate Settings window. It floats above the chat panel and keeps it shown while open.
final class SettingsWindow: NSObject, NSWindowDelegate {
    var reload: () -> Void = {}
    var signOut: () -> Void = {}
    var shortcutTaken: () -> Bool = { false }
    private var window: NSWindow?

    var isKey: Bool { window?.isKeyWindow == true }

    func show() {
        if window == nil {
            let view = SettingsView(reload: { [weak self] in self?.reload() }, signOut: { [weak self] in self?.signOut() },
                                    shortcutTaken: { [weak self] in self?.shortcutTaken() ?? false })
            let window = NSWindow(contentViewController: NSHostingController(rootView: view))
            window.title = "Add to Claude Settings"
            window.styleMask = [.titled, .closable]
            window.level = aboveChatPanel
            window.isReleasedWhenClosed = false
            window.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
            window.delegate = self
            window.center()
            self.window = window
        }
        NSApp.activate()
        window?.makeKeyAndOrderFront(nil)
    }
}

private struct SettingsView: View {
    let reload: () -> Void
    let signOut: () -> Void
    let shortcutTaken: () -> Bool

    @AppStorage(Preferences.keepPanelOpen) private var pinned = false
    @AppStorage(Preferences.showAtLaunch) private var showAtLaunch = true
    @AppStorage(Preferences.shortcut) private var shortcut = Shortcut.none
    @AppStorage(Preferences.restoreLastWindow) private var restoreLast = true
    @AppStorage(Preferences.downloadOnAdd) private var downloadOnAdd = true
    @State private var pasteApps = SettingsView.pastedApps()
    @State private var login = SMAppService.mainApp.status
    @State private var loginProblem = false
    @State private var folder = FilesFolder.root
    @State private var trusted = AXIsProcessTrusted()
    @State private var confirmSignOut = false
    @State private var taken = false
    private let tick = Timer.publish(every: 1, on: .main, in: .common).autoconnect()

    var body: some View {
        Form {
            Section {
                Toggle("Open at login", isOn: Binding(get: { login == .enabled || login == .requiresApproval },
                                                      set: setLogin))
                if login == .requiresApproval {
                    note("Approve Add to Claude in System Settings → General → Login Items.")
                } else if loginProblem {
                    note("macOS did not accept the login item. Move Add to Claude to Applications and try again.")
                }
                Toggle("Show the panel when Add to Claude opens", isOn: $showAtLaunch)
                Toggle("Keep the panel open when switching apps", isOn: $pinned)
                Picker("Shortcut to show the panel", selection: $shortcut) {
                    ForEach(Shortcut.allCases) { Text($0.title).tag($0) }
                }
                if taken { note("Another app uses \(shortcut.title). Choose another.") }
            } header: { sectionHeader("General", glyph: "settings") }

            Section {
                Toggle("Start with the last window used", isOn: $restoreLast)
                Toggle("Download the conversation's files when adding", isOn: $downloadOnAdd)
                LabeledContent("Files folder") {
                    HStack(spacing: 6) {
                        Text(folder.path.replacingOccurrences(of: NSHomeDirectory(), with: "~"))
                            .lineLimit(1).truncationMode(.middle).foregroundStyle(.secondary).help(folder.path)
                        Button("Choose…") { FilesFolder.choose(); folder = FilesFolder.root }
                        Button { reveal(folder) } label: { glyphImage("folder") }
                            .buttonStyle(.borderless).help("Show in Finder")
                    }
                }
                if !pasteApps.isEmpty {
                    LabeledContent("Pasted with ⌘V") {
                        HStack(spacing: 6) {
                            Text(pasteApps.joined(separator: ", ")).lineLimit(1).foregroundStyle(.secondary)
                            Button("Reset") {
                                UserDefaults.standard.removeObject(forKey: Preferences.appsUsingPaste)
                                pasteApps = []
                            }
                                .help("Try typing into these apps again before pasting")
                        }
                    }
                }
            } header: { sectionHeader("Hand-off", glyph: "brand") }

            Section {
                LabeledContent("Accessibility") {
                    HStack(spacing: 6) {
                        Label { Text(trusted ? "Allowed" : "Not allowed") } icon: { glyphImage(trusted ? "done" : "lock") }
                            .foregroundStyle(trusted ? Color.secondary : Color.orange)
                        if !trusted {
                            Button("Open System Settings…") {
                                NSWorkspace.shared.open(URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility")!)
                            }
                        }
                    }
                }
                LabeledContent("ChatGPT") {
                    HStack(spacing: 6) {
                        Button("Reload") { reload() }
                        Button("Sign Out…", role: .destructive) { confirmSignOut = true }
                    }
                }
            } header: { sectionHeader("Access", glyph: "lock") } footer: {
                Text((["Add to Claude", Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String]
                    .compactMap { $0 }.joined(separator: " ")) + " · reads only the page you are on, never sends for you")
                    .font(.caption).foregroundStyle(.tertiary).frame(maxWidth: .infinity)
            }
        }
        .formStyle(.grouped)
        .frame(width: 480)
        .fixedSize(horizontal: false, vertical: true)
        .onChange(of: shortcut) { taken = shortcut != .none && shortcutTaken() }
        .onReceive(tick) { _ in
            trusted = AXIsProcessTrusted()
            login = SMAppService.mainApp.status
            pasteApps = SettingsView.pastedApps()
        }
        .confirmationDialog("Sign out of ChatGPT in Add to Claude?", isPresented: $confirmSignOut) {
            Button("Sign Out", role: .destructive) { signOut() }
        } message: {
            Text("This clears the panel's cookies and site data. Your conversations stay on ChatGPT.")
        }
    }

    private static func pastedApps() -> [String] {
        (UserDefaults.standard.stringArray(forKey: Preferences.appsUsingPaste) ?? []).map { id in
            NSWorkspace.shared.urlForApplication(withBundleIdentifier: id)
                .map { FileManager.default.displayName(atPath: $0.path).replacingOccurrences(of: ".app", with: "") } ?? id
        }
    }

    private func setLogin(_ on: Bool) {
        do {
            if on { try SMAppService.mainApp.register() } else { try SMAppService.mainApp.unregister() }
            loginProblem = false
        } catch { loginProblem = on }
        login = SMAppService.mainApp.status
    }

    private func reveal(_ url: URL) {
        try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        NSWorkspace.shared.activateFileViewerSelecting([url])
    }

    private func sectionHeader(_ title: String, glyph name: String) -> some View {
        Label { Text(title) } icon: { glyphImage(name) }
    }

    private func note(_ text: String) -> some View {
        Text(text).font(.caption).foregroundStyle(.secondary)
    }

    private func glyphImage(_ name: String) -> Image {
        glyph(name, size: 14).map { Image(nsImage: $0) } ?? Image(nsImage: NSImage())
    }
}
