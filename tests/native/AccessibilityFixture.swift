import AppKit

final class FixtureTextView: NSTextView {
    var armSelectionRace = false
    var selectDuringValueRead = false
    var selectionRaceTriggered = false
    var normalizeInsertedText = false
    override func setAccessibilitySelectedText(_ text: String?) {
        super.setAccessibilitySelectedText(text)
        if normalizeInsertedText { string = string.precomposedStringWithCanonicalMapping }
    }
    override func setAccessibilitySelectedTextRange(_ range: NSRange) {
        super.setAccessibilitySelectedTextRange(range)
        if armSelectionRace && range.length == 0 {
            armSelectionRace = false
            selectDuringValueRead = true
        }
    }
    override func accessibilityValue() -> String? {
        if selectDuringValueRead {
            selectDuringValueRead = false
            selectionRaceTriggered = true
            super.setAccessibilitySelectedTextRange(NSRange(location: 0, length: 9))
        }
        return super.accessibilityValue()
    }
}

// An isolated app controlled only through its private temporary FIFOs. No submit action or network code.
final class AccessibilityFixture: NSObject, NSApplicationDelegate {
    var windows: [String: NSWindow] = [:]
    var editors: [String: FixtureTextView] = [:]
    func editor(_ key: String) {
        let view = FixtureTextView(frame: NSRect(x: 0, y: 0, width: 460, height: 240))
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
                while let packet = try Frames.read(from: input) {
                    DispatchQueue.main.sync {
                        let response = self.receive(packet)
                        try? Frames.write(response, to: output)
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
        case "selection-race": current.armSelectionRace = true
        case "normalize-insertion": current.normalizeInsertedText = true
        case "rich":
            current.isRichText = true
            current.textStorage?.addAttributes([.link: URL(string: "https://example.invalid/synthetic")!,
                                               .font: NSFont.boldSystemFont(ofSize: 18)], range: NSRange(location: 0, length: 9))
            let attachment = NSTextAttachment()
            attachment.image = NSImage(size: NSSize(width: 12, height: 12))
            current.textStorage?.append(NSAttributedString(attachment: attachment))
        case "code": current.setAccessibilityLabel("Source code editor")
        case "deactivate":
            // NSApp.deactivate() is a no-op under cooperative activation; hand focus to Finder instead.
            if let finder = NSRunningApplication.runningApplications(withBundleIdentifier: "com.apple.finder").first {
                NSApp.yieldActivation(to: finder)
                finder.activate()
            }
        default: break
        }
        if packet["focus"] as? Bool == true, let view = editors[key] {
            window.makeKeyAndOrderFront(nil)
            window.makeFirstResponder(view)
            NSApp.activate()
        }
        var drafts = editors.mapValues { $0.string }
        for (key, view) in editors {
            drafts["selectionRace" + key] = String(view.selectionRaceTriggered)
            var details: [String] = []
            if let storage = view.textStorage {
                storage.enumerateAttributes(in: NSRange(location: 0, length: storage.length)) { attributes, range, _ in
                    if let link = attributes[.link] { details.append("link:\(range):\(link)") }
                    if attributes[.attachment] != nil { details.append("attachment:\(range)") }
                    if let font = attributes[.font] as? NSFont, NSFontManager.shared.traits(of: font).contains(.boldFontMask) {
                        details.append("bold:\(range)")
                    }
                }
            }
            drafts["rich" + key] = details.joined(separator: ";")
        }
        return ["ok": true, "drafts": drafts]
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
