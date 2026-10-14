import AppKit

/// A panel that can take keyboard focus for the chat without being a document window.
final class ChatPanel: NSPanel {
    override var canBecomeKey: Bool { true }
    override func cancelOperation(_ sender: Any?) { orderOut(nil) }
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
        panel.hidesOnDeactivate = false
        panel.isReleasedWhenClosed = false
        panel.minSize = NSSize(width: 380, height: 480)
        panel.contentViewController = chat
        panel.setContentSize(NSSize(width: 480, height: 760))
        panel.setFrameAutosaveName("ChatPanel")
        panel.delegate = self

        item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        item.button?.image = glyph("add", size: 18)
        item.button?.setAccessibilityLabel("gpt-handoff")
        item.button?.toolTip = "gpt-handoff"
        item.button?.target = self
        item.button?.action = #selector(click)
        item.button?.sendAction(on: [.leftMouseUp, .rightMouseUp])
        show()
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

    private func show() {
        if let button = item.button, let frame = button.window?.convertToScreen(button.frame),
           let screen = button.window?.screen?.visibleFrame {
            let x = min(max(frame.midX - panel.frame.width / 2, screen.minX + 8), screen.maxX - panel.frame.width - 8)
            panel.setFrameTopLeftPoint(NSPoint(x: x, y: frame.minY - 4))
        }
        chat.bar.willShow()
        NSApp.activate()
        panel.makeKeyAndOrderFront(nil)
    }

    /// Hiding never destroys the page: a reply keeps streaming and the conversation stays prepared.
    private func hide() {
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
