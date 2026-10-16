import AppKit

// Renders the real handoff bar in several source states to PNG files for visual review.
@main enum Snapshot {
    static func main() {
        _ = NSApplication.shared
        NSApp.appearance = NSAppearance(named: .aqua)
        let output = URL(fileURLWithPath: CommandLine.arguments[1])
        let ready = Prepared(revision: UUID(), page: "https://chatgpt.com/c/x", markdown: "# Synthetic", title: "Agent harness handoff design",
                             turns: 128, files: 3, verification: "verified", issues: [], attachments: [])
        let partial = Prepared(revision: UUID(), page: "https://chatgpt.com/c/y", markdown: "# Synthetic",
                               title: "Research notes with a very long conversation title that truncates", turns: 14, files: 1,
                               verification: "partial", issues: ["report.pdf is a reference only."], attachments: [])
        let states: [(String, SourceState)] = [("waiting", .waiting), ("ready", .ready(ready)), ("partial", .ready(partial)),
                                               ("unavailable", .unavailable("This page did not expose its original messages."))]
        for (name, state) in states {
            let bar = HandoffBar()
            let view = bar.view
            view.appearance = NSApp.appearance
            bar.show(state)
            view.setFrameSize(NSSize(width: 480, height: view.fittingSize.height))
            view.layoutSubtreeIfNeeded()
            let rep = view.bitmapImageRepForCachingDisplay(in: view.bounds)!
            view.cacheDisplay(in: view.bounds, to: rep)
            let image = NSImage(size: view.bounds.size)
            image.lockFocus()
            NSColor.windowBackgroundColor.setFill()
            view.bounds.fill()
            rep.draw(in: view.bounds)
            image.unlockFocus()
            let png = NSBitmapImageRep(data: image.tiffRepresentation!)!.representation(using: .png, properties: [:])!
            try! png.write(to: output.appendingPathComponent("bar-\(name).png"))
        }
        // The Settings window's content, laid out as it opens.
        let settings = SettingsWindow()
        settings.show()
        RunLoop.main.run(until: Date().addingTimeInterval(1))
        if let view = NSApp.windows.first(where: { $0.title.hasSuffix("Settings") })?.contentView {
            view.appearance = NSApp.appearance
            view.layoutSubtreeIfNeeded()
            let rep = view.bitmapImageRepForCachingDisplay(in: view.bounds)!
            view.cacheDisplay(in: view.bounds, to: rep)
            try! rep.representation(using: .png, properties: [:])!.write(to: output.appendingPathComponent("settings.png"))
        }
    }
}
