import AppKit

// An isolated app controlled only through its private temporary FIFOs. No submit action or network code.
final class AccessibilityFixture: NSObject, NSApplicationDelegate {
    var windows: [String: NSWindow] = [:]
    var editors: [String: NSTextView] = [:]
    func editor(_ key: String) {
        let view = NSTextView(frame: NSRect(x: 0, y: 0, width: 460, height: 240))
        view.isRichText = false
        view.setAccessibilityLabel("Synthetic composer " + key)
        view.string = "Synthetic draft " + key + "."
        editors[key] = view
        let container = NSView(frame: view.frame)
        container.addSubview(view)
        windows[key]?.contentView = container
    }
    func applicationDidFinishLaunching(_ notification: Notification) {
        for (index, key) in ["A", "B"].enumerated() {
            let window = NSWindow(contentRect: NSRect(x: 100 + index * 490, y: 180, width: 460, height: 240),
                                  styleMask: [.titled, .closable], backing: .buffered, defer: false)
            window.isReleasedWhenClosed = false
            window.title = "Synthetic acceptance composer"
            windows[key] = window
            editor(key)
            window.makeKeyAndOrderFront(nil)
        }
        DispatchQueue.global().async {
            let directory = URL(fileURLWithPath: CommandLine.arguments[1])
            guard let input = FileHandle(forReadingAtPath: directory.appendingPathComponent("requests").path),
                  let output = FileHandle(forWritingAtPath: directory.appendingPathComponent("responses").path) else {
                DispatchQueue.main.async { NSApp.terminate(nil) }; return
            }
            defer { try? input.close(); try? output.close() }
            do {
                while let packet = try NativeFrames.read(from: input) {
                    DispatchQueue.main.sync {
                        let response = self.receive(packet)
                        try? NativeFrames.write(response, to: output)
                    }
                }
            } catch {}
            DispatchQueue.main.async { NSApp.terminate(nil) }
        }
    }
    func receive(_ packet: [String: Any]) -> [String: Any] {
        let key = packet["window"] as? String ?? "A"
        guard let window = windows[key], let current = editors[key] else { return ["ok": false] }
        switch packet["command"] as? String {
        case "reset":
            for key in ["A", "B"] {
                windows[key]?.title = "Synthetic acceptance composer"
                editor(key)
                windows[key]?.makeKeyAndOrderFront(nil)
            }
        case "replace": editor(key)
        case "readonly": current.isEditable = false
        case "rename": window.title = "Changed synthetic window"
        case "close": window.close()
        case "draft": current.string = packet["text"] as? String ?? ""
        case "code": current.setAccessibilityLabel("Source code editor")
        default: break
        }
        if packet["focus"] as? Bool == true, let view = editors[key] {
            window.makeKeyAndOrderFront(nil)
            window.makeFirstResponder(view)
            NSApp.activate(ignoringOtherApps: true)
        }
        return ["ok": true, "drafts": editors.mapValues { $0.string }]
    }
}

@main enum FixtureMain {
    static func main() {
        guard CommandLine.arguments.count == 2 else { exit(2) }
        let app = NSApplication.shared
        let delegate = AccessibilityFixture()
        app.delegate = delegate
        app.setActivationPolicy(.regular)
        app.run()
    }
}
