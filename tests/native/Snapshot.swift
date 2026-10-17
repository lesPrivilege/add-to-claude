import AppKit

// Renders the real handoff bar in several source states, the scope control, and the turn picker to
// PNG files for visual review. Synthetic data only; the target is this process, never a real app.
@main enum Snapshot {
    static let dark = ProcessInfo.processInfo.environment["SNAPSHOT_APPEARANCE"] == "dark"

    static func render(_ view: NSView, width: CGFloat? = nil, to url: URL) {
        view.appearance = NSApp.appearance
        if let width { view.setFrameSize(NSSize(width: width, height: view.fittingSize.height)) }
        else { view.setFrameSize(view.fittingSize) }
        view.layoutSubtreeIfNeeded()
        if dark { return renderInWindow(view, to: url) }
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

    /// An off-window cache draws dark text on an opaque white ground, so the dark appearance is rendered
    /// in a borderless window. The snapshot process is never the active app, so accent-colored buttons draw grey there.
    static func renderInWindow(_ view: NSView, to url: URL) {
        let window = NSWindow(contentRect: NSRect(origin: .zero, size: view.frame.size), styleMask: [.borderless], backing: .buffered, defer: false)
        window.appearance = NSApp.appearance
        window.backgroundColor = .windowBackgroundColor
        window.contentView = view
        view.layoutSubtreeIfNeeded()
        let frame = window.contentView!.superview!
        let rep = frame.bitmapImageRepForCachingDisplay(in: frame.bounds)!
        frame.cacheDisplay(in: frame.bounds, to: rep)
        try! rep.representation(using: .png, properties: [:])!.write(to: url)
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
        bar.select(choice, identity: identity)
        return bar
    }

    static func added(_ log: DeliveryLog, _ turns: [TurnInfo], to target: TargetIdentity) {
        let id = log.begin(source: "synthetic", target: target, mode: "all", turns: turns, attachments: [])
        log.move(id, to: .insertionAttempted)
        log.move(id, to: .composerInserted)
    }

    static func main() {
        _ = NSApplication.shared
        // SNAPSHOT_APPEARANCE=dark renders the dark appearance.
        NSApp.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
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
                                               ("replying", .replying(page: "https://chatgpt.com/")),
                                               ("replying-kept", .ready(ready, replying: true)),
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

        // A reply streaming over the kept result: the bar stays as it was, with a note, and Add stays enabled.
        let kept = trustedBar(newLog, prepared(42), identity: verified)
        kept.show(.ready(prepared(42), replying: true))
        render(kept.view, width: 480, to: output.appendingPathComponent("bar-scope-replying.png"))

        // A new target: All · 42, automatic, so no detail line.
        render(trustedBar(memory(), prepared(42), identity: verified).view, width: 480, to: output.appendingPathComponent("bar-scope-all.png"))

        // A window that does not say which conversation it shows, after one Add: All, with the binding offer.
        let session = TargetIdentity(app: "com.example.composer", conversation: "window:snapshot", confidence: .unconfirmed)
        let sessionLog = memory()
        added(sessionLog, turns(40), to: session)
        render(trustedBar(sessionLog, prepared(42), identity: session).view, width: 480, to: output.appendingPathComponent("bar-scope-unconfirmed.png"))
        let bound = TargetIdentity(app: "com.example.composer", conversation: "window:snapshot", confidence: .confirmed)
        render(trustedBar(sessionLog, prepared(42), identity: bound).view, width: 480, to: output.appendingPathComponent("bar-scope-continuing.png"))

        // A terminal window as the target: Add names the terminal; nothing about the window is inferred.
        let terminal = trustedBar(memory(), prepared(42), identity: verified)
        let app = NSRunningApplication.current
        let terminalWindow = WindowChoice(app: app, launchDate: app.launchDate ?? Date(), window: AXUIElementCreateApplication(app.processIdentifier), title: "claude — 80×24")
        terminal.apply(Discovery(targets: [Target(id: "terminal", app: "Terminal", window: terminalWindow.title, icon: nil, terminal: true)],
                                 terminals: ["terminal": terminalWindow]))
        terminal.select(terminal: terminalWindow)
        render(terminal.view, width: 480, to: output.appendingPathComponent("bar-terminal.png"))

        // Just added everything: Add asks before inserting the same turns twice.
        let againLog = memory()
        added(againLog, turns(12), to: verified)
        let again = trustedBar(againLog, prepared(12), identity: verified)
        findButton(in: again.view) { $0.title.hasPrefix("Add") }?.performClick(nil)
        render(again.view, width: 480, to: output.appendingPathComponent("bar-add-again.png"))

        // The header's update button, in each state, beside the pin and Settings as in the panel.
        for (name, offer) in [("available", UpdateOffer.available("0.8.1")), ("downloading", .downloading("0.8.1")), ("ready", .ready("0.8.1"))] {
            let button = UpdateButton()
            button.show(offer)
            button.alphaValue = 1
            let row = NSStackView(views: [NSView(), button, iconButton("pin", "Pin", #selector(NSObject.copy), NSObject()),
                                          iconButton("settings", "Settings", #selector(NSObject.copy), NSObject())])
            row.spacing = 2
            row.setCustomSpacing(6, after: button)
            row.edgeInsets = NSEdgeInsets(top: 4, left: 8, bottom: 4, right: 8)
            row.heightAnchor.constraint(equalToConstant: 32).isActive = true
            render(row, width: 320, to: output.appendingPathComponent("update-\(name).png"))
        }

        // The turn picker: 42 turns, 1–30 and 33–36 added, turn 7 changed since, 37–42 chosen.
        let picker = TurnPicker(turns: turns(42, edited: [7]), added: Set((1...30).map { "m\($0)" } + (33...36).map { "m\($0)" }).subtracting(["m7"]),
                                lastAdd: Set((9...14).map { "m\($0)" }),
                                changed: ["m7"], selected: Set((37...42).map { "m\($0)" } + ["m7"]), changedSelection: { _ in }, done: {})
        let window = NSWindow(contentViewController: picker)
        window.layoutIfNeeded()
        RunLoop.main.run(until: Date().addingTimeInterval(0.3))
        render(picker.view, to: output.appendingPathComponent("turn-picker.png"))

        // The same picker in a real popover, as the bar shows it: its edges must not clip the insets.
        let host = NSWindow(contentRect: NSRect(x: 200, y: 200, width: 480, height: 120), styleMask: [.titled], backing: .buffered, defer: false)
        host.appearance = NSApp.appearance
        let anchor = NSButton(title: "30 selected", target: nil, action: nil)
        anchor.frame = NSRect(x: 200, y: 20, width: 120, height: 28)
        host.contentView?.addSubview(anchor)
        host.orderFront(nil)
        let popover = NSPopover()
        popover.appearance = NSApp.appearance
        popover.contentViewController = TurnPicker(turns: turns(30), added: [], changed: [], selected: Set(turns(30).map(\.id)),
                                                   changedSelection: { _ in }, done: {})
        popover.show(relativeTo: anchor.bounds, of: anchor, preferredEdge: .maxY)
        RunLoop.main.run(until: Date().addingTimeInterval(0.6))
        if let frame = popover.contentViewController?.view.window?.contentView?.superview {
            let rep = frame.bitmapImageRepForCachingDisplay(in: frame.bounds)!
            frame.cacheDisplay(in: frame.bounds, to: rep)
            try! rep.representation(using: .png, properties: [:])!.write(to: output.appendingPathComponent("turn-picker-popover.png"))
        }
        popover.close()
        host.orderOut(nil)

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
