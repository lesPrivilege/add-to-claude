import AppKit

/// A panel that can take keyboard focus for the chat without being a document window.
final class ChatPanel: NSPanel {
    var onEscape: () -> Void = {}
    override var canBecomeKey: Bool { true }
    override func cancelOperation(_ sender: Any?) { onEscape() }
}

final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate {
    private var item: NSStatusItem!
    private var panel: ChatPanel!
    private let chat = ChatController()

    func applicationDidFinishLaunching(_ notification: Notification) {
        panel = ChatPanel(contentRect: NSRect(x: 0, y: 0, width: 480, height: 760),
                          styleMask: [.titled, .resizable, .nonactivatingPanel], backing: .buffered, defer: false)
        panel.titleVisibility = .hidden
        panel.titlebarAppearsTransparent = true
        for button in [NSWindow.ButtonType.closeButton, .miniaturizeButton, .zoomButton] {
            panel.standardWindowButton(button)?.isHidden = true
        }
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
        NotificationCenter.default.addObserver(forName: NSApplication.didResignActiveNotification, object: nil, queue: .main) {
            [weak self] _ in
            // The user went to another app, even if one of our own popovers or panels had focus last.
            guard let self, self.panel.isVisible, !self.chat.keepsPanelOpen else { return }
            self.panel.orderOut(nil)
        }

        item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        item.button?.image = glyph("add", size: 18)
        item.button?.setAccessibilityLabel("gpt-handoff")
        item.button?.toolTip = "gpt-handoff"
        item.button?.target = self
        item.button?.action = #selector(click)
        item.button?.sendAction(on: [.leftMouseUp, .rightMouseUp])
        showWhenPlaced(attempts: 40)
    }

    @objc private func click() {
        if NSApp.currentEvent?.type == .rightMouseUp {
            let menu = NSMenu()
            menu.addItem(withTitle: "Quit gpt-handoff", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
            item.menu = menu
            item.button?.performClick(nil)
            item.menu = nil
            return
        }
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
        NSApp.activate()
        panel.makeKeyAndOrderFront(nil)
    }

    /// Hiding never destroys the page: a reply keeps streaming and the conversation stays prepared.
    func hide() {
        panel.orderOut(nil)
        NSApp.hide(nil)
    }

    func windowDidResignKey(_ notification: Notification) {
        // Let menus, sheets and our own panels take focus; hide only when the user went elsewhere.
        DispatchQueue.main.async {
            guard self.panel.isVisible, !self.panel.isKeyWindow, !self.chat.keepsPanelOpen,
                  NSApp.keyWindow == nil || NSApp.keyWindow === self.panel else { return }
            self.hide()
        }
    }
}
