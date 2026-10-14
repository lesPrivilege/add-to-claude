import AppKit

// Renders the real popover view for given extension states to PNG files for visual review.
@main enum Snapshot {
    static func main() {
        _ = NSApplication.shared
        NSApp.appearance = NSAppearance(named: .aqua)
        let output = URL(fileURLWithPath: CommandLine.arguments[1])
        let states: [(String, [String: Any]?)] = [
            ("disconnected", nil),
            ("waiting", ["status": "waiting", "title": "ChatGPT", "page": "https://chatgpt.com/"]),
            ("ready", ["status": "ready", "title": "Agent harness handoff design", "page": "https://chatgpt.com/c/x",
                       "revision": "r", "turns": 128, "files": 3, "verification": "verified", "bytes": 120_000]),
            ("partial", ["status": "ready", "title": "Research notes with a very long conversation title that truncates",
                         "page": "https://chatgpt.com/c/y", "revision": "s", "turns": 14, "files": 1,
                         "verification": "partial", "issues": ["report.pdf is a reference only."], "bytes": 40_000]),
        ]
        for (name, state) in states {
            let controller = HandoffViewController(link: ChromeLink(path: "/dev/null", allowedPeer: nil))
            let view = controller.view
            view.appearance = NSApp.appearance
            controller.chromeChanged(state)
            view.layoutSubtreeIfNeeded()
            view.setFrameSize(view.fittingSize)
            view.layoutSubtreeIfNeeded()
            let rep = view.bitmapImageRepForCachingDisplay(in: view.bounds)!
            view.cacheDisplay(in: view.bounds, to: rep)
            let image = NSImage(size: view.bounds.size)
            image.lockFocus()
            NSApp.appearance!.performAsCurrentDrawingAppearance {
                NSColor.windowBackgroundColor.setFill()
                view.bounds.fill()
            }
            rep.draw(in: view.bounds)
            image.unlockFocus()
            let png = NSBitmapImageRep(data: image.tiffRepresentation!)!.representation(using: .png, properties: [:])!
            try! png.write(to: output.appendingPathComponent("popover-\(name).png"))
        }
    }
}
