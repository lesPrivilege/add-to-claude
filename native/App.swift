import AppKit

/// A panel that can take keyboard focus for the chat without being a document window.
final class ChatPanel: NSPanel {
    var onEscape: () -> Void = {}
    override var canBecomeKey: Bool { true }
    override func cancelOperation(_ sender: Any?) { onEscape() }
    /// ⌘W on the panel hides it, like Escape; it never closes.
    override func performClose(_ sender: Any?) { onEscape() }
}

final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate {
    private var item: NSStatusItem!
    private var panel: ChatPanel!
    private let chat = ChatController()
    private let settings = SettingsWindow()
    private lazy var hotkey = Hotkey { [weak self] in self?.toggle() }
    private var clickMonitor: Any?

    func applicationDidFinishLaunching(_ notification: Notification) {
        Preferences.register()
        DeliveryLog.shared.load() // Also drops what is past the retention period.
        SavedFiles.shared.load()
        HandoffFiles.shared.remove(olderThan: 24 * 3600) // A hand-off is for the next message, not an archive.
        NSApp.mainMenu = mainMenu()
        panel = ChatPanel(contentRect: NSRect(x: 0, y: 0, width: 480, height: 760),
                          styleMask: [.titled, .resizable, .nonactivatingPanel, .fullSizeContentView],
                          backing: .buffered, defer: false)
        panel.titleVisibility = .hidden
        panel.titlebarAppearsTransparent = true
        for button in [NSWindow.ButtonType.closeButton, .miniaturizeButton, .zoomButton] {
            panel.standardWindowButton(button)?.isHidden = true
        }
        panel.isMovable = false // It belongs under the menu-bar icon.
        panel.isFloatingPanel = true
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        panel.onEscape = { [weak self] in self?.hide() }
        panel.hidesOnDeactivate = false
        panel.isReleasedWhenClosed = false
        panel.contentMinSize = NSSize(width: 380, height: 480)
        panel.contentViewController = chat
        panel.setFrameAutosaveName("ChatPanel") // Only the size persists; show() always places it under the icon.
        if panel.frame.width < 380 || panel.frame.height < 480 { panel.setContentSize(NSSize(width: 480, height: 760)) }
        panel.delegate = self

        chat.openSettings = { [weak self] in self?.openSettings() }
        settings.reload = { [weak self] in self?.chat.reload() }
        settings.signOut = { [weak self] in self?.chat.signOut() }
        settings.clearWebCache = { [weak self] in self?.chat.clearWebCache() }
        settings.shortcutTaken = { [weak self] in !(self?.hotkey.use(.current) ?? true) }
        settings.closed = { [weak self] in
            guard let self, self.returnToPanel else { return }
            self.returnToPanel = false
            self.show()
        }
        hotkey.use(.current)
        NotificationCenter.default.addObserver(forName: UserDefaults.didChangeNotification, object: nil, queue: .main) {
            [weak self] _ in
            self?.hotkey.use(.current)
            self?.chat.preferencesChanged()
        }
        watchForElsewhere()

        item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        item.button?.image = glyph("brand", size: 18)
        item.button?.setAccessibilityLabel("Add to Claude")
        item.button?.toolTip = "Add to Claude: hand this chat to an agent harness"
        item.button?.target = self
        item.button?.action = #selector(click)
        item.button?.sendAction(on: [.leftMouseUp, .rightMouseUp])
        if UserDefaults.standard.bool(forKey: Preferences.showAtLaunch) { showWhenPlaced(attempts: 40) }
    }

    /// Never shown for an accessory app, but its key equivalents reach the chat: editing, Settings, reload.
    private func mainMenu() -> NSMenu {
        let menu = NSMenu()
        let app = NSMenu()
        app.addItem(withTitle: "Settings…", action: #selector(openSettings), keyEquivalent: ",").target = self
        app.addItem(withTitle: "Close", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        app.addItem(withTitle: "Quit Add to Claude", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        let edit = NSMenu(title: "Edit")
        edit.addItem(withTitle: "Undo", action: Selector(("undo:")), keyEquivalent: "z")
        edit.addItem(withTitle: "Redo", action: Selector(("redo:")), keyEquivalent: "Z")
        edit.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        edit.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        edit.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        edit.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        let view = NSMenu(title: "View")
        view.addItem(withTitle: "Reload Page", action: #selector(reloadPage), keyEquivalent: "r").target = self
        view.addItem(withTitle: "Back", action: #selector(goBack), keyEquivalent: "[").target = self
        for submenu in [app, edit, view] { menu.addItem(withTitle: submenu.title, action: nil, keyEquivalent: "").submenu = submenu }
        return menu
    }

    /// One window at a time, as one popover: Settings takes the panel's place under the icon (the page keeps
    /// running) and closing it brings the panel back, like going back. Opened with the panel hidden, it
    /// opens centred and closing it leaves the panel hidden.
    @objc private func openSettings() {
        returnToPanel = panel.isVisible
        guard returnToPanel else { return settings.show() }
        let corner = NSPoint(x: panel.frame.minX, y: panel.frame.maxY)
        panel.orderOut(nil)
        settings.show(at: corner)
    }
    private var returnToPanel = false
    @objc private func reloadPage() { chat.reload() }
    @objc private func goBack() { chat.goBack() }

    @objc private func click() {
        if NSApp.currentEvent?.type == .rightMouseUp {
            let menu = NSMenu()
            menu.addItem(withTitle: "Settings…", action: #selector(openSettings), keyEquivalent: ",").target = self
            menu.addItem(.separator())
            menu.addItem(withTitle: "Quit Add to Claude", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
            item.menu = menu
            item.button?.performClick(nil)
            item.menu = nil
            return
        }
        toggle()
    }

    private func toggle() {
        // Settings standing in for the panel: the icon goes back, as closing Settings does.
        if returnToPanel && settings.isVisible { return settings.close() }
        panel.isVisible ? hide() : show()
    }

    /// At launch the menu bar has not placed the icon yet; wait for it (up to 2 s) so the panel opens under it.
    private func showWhenPlaced(attempts: Int) {
        if iconAnchor() != nil || attempts == 0 { return show() }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) { self.showWhenPlaced(attempts: attempts - 1) }
    }

    private func iconAnchor() -> NSPoint? {
        guard let button = item.button, let window = button.window,
              let screen = (window.screen ?? NSScreen.main)?.visibleFrame else { return nil }
        let frame = window.convertToScreen(button.convert(button.bounds, to: nil))
        // Before layout the icon's window sits at the origin; trust it only inside the menu bar.
        return frame.minY >= screen.maxY - 4 ? NSPoint(x: frame.midX, y: screen.maxY) : nil
    }

    private func show() {
        // Under the icon once it is on screen; at launch, before the menu bar lays it out, top centre.
        let screen = (item.button?.window?.screen ?? NSScreen.main ?? NSScreen.screens[0]).visibleFrame
        let anchor = iconAnchor() ?? NSPoint(x: screen.midX, y: screen.maxY)
        // Keep the handoff bar on screen when a size saved on a taller display is restored here.
        let height = min(panel.frame.height, anchor.y - 4 - screen.minY - 4)
        if height < panel.frame.height { panel.setFrame(NSRect(x: 0, y: 0, width: panel.frame.width, height: height), display: false) }
        let x = min(max(anchor.x - panel.frame.width / 2, screen.minX + 8), screen.maxX - panel.frame.width - 8)
        panel.setFrameTopLeftPoint(NSPoint(x: x, y: anchor.y - 4))
        chat.bar.willShow()
        item.button?.highlight(true)
        NSApp.activate()
        panel.makeKeyAndOrderFront(nil)
    }

    /// Hiding never destroys the page: a reply keeps streaming and the conversation stays prepared.
    func hide() {
        panel.orderOut(nil)
        item.button?.highlight(false)
        NSApp.hide(nil)
    }

    /// Whether something of ours needs the panel to stay, or the user pinned it.
    private var staysOpen: Bool { Preferences.pinned || chat.keepsPanelOpen || settings.isKey }

    /// A popover's dismissal: a click in another app, or another app coming forward, hides the panel unless it
    /// is pinned. A nonactivating panel may never make this app active, so resign notifications alone miss it.
    private func watchForElsewhere() {
        let elsewhere = { [weak self] in
            guard let self, self.panel.isVisible, !self.staysOpen else { return }
            self.panel.orderOut(nil)
            self.item.button?.highlight(false)
        }
        clickMonitor = NSEvent.addGlobalMonitorForEvents(matching: [.leftMouseDown, .rightMouseDown]) { _ in elsewhere() }
        NSWorkspace.shared.notificationCenter.addObserver(forName: NSWorkspace.didActivateApplicationNotification,
                                                          object: nil, queue: .main) { note in
            let app = note.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication
            if app?.processIdentifier != ProcessInfo.processInfo.processIdentifier { elsewhere() }
        }
    }
}
