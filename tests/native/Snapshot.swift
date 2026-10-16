import AppKit

// Renders the real handoff bar in several source states, the scope control, and the turn picker to
// PNG files for visual review. Synthetic data only; the target is this process, never a real app.
@main enum Snapshot {
    static func render(_ view: NSView, width: CGFloat? = nil, to url: URL) {
        view.appearance = NSApp.appearance
        if let width { view.setFrameSize(NSSize(width: width, height: view.fittingSize.height)) }
        else { view.setFrameSize(view.fittingSize) }
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
        try! png.write(to: url)
    }

    static func hash(_ seed: Int, edited: Bool = false) -> String {
        String(repeating: String(format: "%02x", (seed * 37 + (edited ? 101 : 0)) & 0xff), count: 32)
    }

    static let previews = ["Can you help me plan the hand-off between chat and an agent harness?",
                           "Here is a plan in three parts: what moves, how the target is identified, and what is logged.",
                           "What happens when the target window switches to another conversation?",
                           "Then the target id changes, so the next Add offers every turn again.",
                           "Show the scope control next to the Add button.", "Done. It reads “New · 6” when only six turns are new."]

    static func turns(_ count: Int, edited: Set<Int> = []) -> [TurnInfo] {
        (1...count).map { position in
            TurnInfo(id: "m\(position)", role: position % 2 == 1 ? "user" : "assistant", position: position,
                     preview: previews[(position - 1) % previews.count], sha256: hash(position, edited: edited.contains(position)),
                     files: position % 9 == 4 ? ["\(position):file"] : [])
        }
    }

    static func prepared(_ count: Int, edited: Set<Int> = []) -> Prepared {
        Prepared(revision: UUID(), page: "https://chatgpt.com/c/synthetic", markdown: "# Synthetic", title: "Agent harness handoff design",
                 turns: count, files: 2, verification: "verified", issues: [],
                 attachments: ["brief.md", "chart.png"].enumerated().map { index, name in
                     Attachment(key: "\(index)", id: name, name: name, label: name, turn: 4, messageId: "m4", line: 0, check: -1)
                 }, verifiedWithFiles: false, turnList: turns(count, edited: edited))
    }

    /// A bar that believes it may use Accessibility and has a target: this process, under a stated identity.
    static func trustedBar(_ log: DeliveryLog, _ state: Prepared, identity: TargetIdentity) -> HandoffBar {
        let bar = HandoffBar()
        bar.isTrusted = { true }
        bar.log = log
        _ = bar.view
        bar.show(.ready(state))
        let app = NSRunningApplication.current
        let element = AXUIElementCreateApplication(app.processIdentifier)
        let choice = WindowChoice(app: app, launchDate: Date(), window: element, title: "Synthetic composer")
        bar.select(Composer(choice: choice, editor: element), identity: identity)
        return bar
    }

    static func added(_ log: DeliveryLog, _ turns: [TurnInfo], to target: TargetIdentity) {
        let id = log.begin(source: "synthetic", target: target, mode: "all", turns: turns, attachments: [])
        log.move(id, to: .insertionAttempted)
        log.move(id, to: .composerInserted)
    }

    static func main() {
        _ = NSApplication.shared
        NSApp.appearance = NSAppearance(named: .aqua)
        let output = URL(fileURLWithPath: CommandLine.arguments[1])
        let ready = Prepared(revision: UUID(), page: "https://chatgpt.com/c/x", markdown: "# Synthetic", title: "Agent harness handoff design",
                             turns: 128, files: 3, verification: "verified", issues: [],
                             attachments: ["brief.md", "chart.png", "data.zip"].enumerated().map { index, name in
                                 Attachment(key: "\(index)", id: name, name: name, label: name, turn: 2, messageId: "m", line: 0, check: -1)
                             }, verifiedWithFiles: false)
        let partial = Prepared(revision: UUID(), page: "https://chatgpt.com/c/y", markdown: "# Synthetic",
                               title: "Research notes with a very long conversation title that truncates", turns: 14, files: 1,
                               verification: "partial", issues: ["report.pdf is a reference only."], attachments: [], verifiedWithFiles: false)
        let states: [(String, SourceState)] = [("waiting", .waiting), ("ready", .ready(ready)), ("partial", .ready(partial)),
                                               ("unavailable", .unavailable("The conversation could not be read. Open it again once any reply has finished."))]
        for (name, state) in states {
            let bar = HandoffBar()
            bar.isTrusted = { false }
            _ = bar.view
            bar.show(state)
            render(bar.view, width: 480, to: output.appendingPathComponent("bar-\(name).png"))
        }

        // The scope control. A verified Claude conversation that already has turns 1–36: New · 6.
        let verified = TargetIdentity(app: "com.anthropic.claudefordesktop", conversation: "claude.ai/chat/0f8fad5b-d9cb-469f-a165-70867728950e",
                                      confidence: .verified)
        let memory = { DeliveryLog(file: nil, remember: { false }, retentionDays: { 30 }) }
        let newLog = memory()
        added(newLog, Array(turns(42)[0..<30]) + Array(turns(42)[32..<36]), to: verified)
        render(trustedBar(newLog, prepared(42), identity: verified).view, width: 480, to: output.appendingPathComponent("bar-scope-new.png"))

        // A new target: All · 42, automatic, so no detail line.
        render(trustedBar(memory(), prepared(42), identity: verified).view, width: 480, to: output.appendingPathComponent("bar-scope-all.png"))

        // A window that does not say which conversation it shows, after one Add: All, with the binding offer.
        let session = TargetIdentity(app: "com.example.composer", conversation: "window:snapshot", confidence: .unconfirmed)
        let sessionLog = memory()
        added(sessionLog, turns(40), to: session)
        render(trustedBar(sessionLog, prepared(42), identity: session).view, width: 480, to: output.appendingPathComponent("bar-scope-unconfirmed.png"))
        let bound = TargetIdentity(app: "com.example.composer", conversation: "window:snapshot", confidence: .confirmed)
        render(trustedBar(sessionLog, prepared(42), identity: bound).view, width: 480, to: output.appendingPathComponent("bar-scope-continuing.png"))

        // Just added everything: Add asks before inserting the same turns twice.
        let againLog = memory()
        added(againLog, turns(12), to: verified)
        let again = trustedBar(againLog, prepared(12), identity: verified)
        findButton(in: again.view) { $0.title.hasPrefix("Add") }?.performClick(nil)
        render(again.view, width: 480, to: output.appendingPathComponent("bar-add-again.png"))

        // The turn picker: 42 turns, 1–30 and 33–36 added, turn 7 changed since, 37–42 chosen.
        let picker = TurnPicker(turns: turns(42, edited: [7]), added: Set((1...30).map { "m\($0)" } + (33...36).map { "m\($0)" }).subtracting(["m7"]),
                                lastAdd: Set((9...14).map { "m\($0)" }),
                                changed: ["m7"], selected: Set((37...42).map { "m\($0)" } + ["m7"]), changedSelection: { _ in }, done: {})
        let window = NSWindow(contentViewController: picker)
        window.layoutIfNeeded()
        RunLoop.main.run(until: Date().addingTimeInterval(0.3))
        render(picker.view, to: output.appendingPathComponent("turn-picker.png"))

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

    static func findButton(in view: NSView, _ matches: (NSButton) -> Bool) -> NSButton? {
        if let button = view as? NSButton, matches(button) { return button }
        for child in view.subviews { if let found = findButton(in: child, matches) { return found } }
        return nil
    }
}
