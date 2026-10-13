import AppKit

// Only the composer backend is synthetic. Chrome launches the real shared host runtime/protocol.
// It has no Accessibility, browser account, keyboard, filesystem-command or network capability.
final class FixtureJournal {
    let file: URL
    var events: [String] = []
    var draft = "Existing synthetic draft."
    init() {
        file = URL(fileURLWithPath: CommandLine.arguments[0]).deletingLastPathComponent().appendingPathComponent("native-fixture-result.json")
    }
    func record(_ event: String) {
        events.append(event)
        let value: [String: Any] = ["pid": ProcessInfo.processInfo.processIdentifier, "events": events, "draft": draft]
        if let data = try? JSONSerialization.data(withJSONObject: value) { try? data.write(to: file, options: .atomic) }
    }
}
final class PipeFixtureComposer: NativeComposerBackend {
    let journal: FixtureJournal
    var selected = false
    var trusted: Bool { true }
    init(_ journal: FixtureJournal) { self.journal = journal }
    func requestAccess() { journal.record("unexpected-access-request") }
    func discover() -> [[String: String]] { journal.record("targets"); return [["id": "window-a", "app": "Synthetic Agent", "window": "Composer A"]] }
    func select(_ id: String) -> String? { selected = id == "window-a"; journal.record("select"); return selected ? "Synthetic Agent" : nil }
    func clear() { selected = false }
    func append(_ text: String, valid: @escaping () -> Bool, revalidate: @escaping (@escaping (Bool) -> Void) -> Void,
                completion: @escaping (String, Bool) -> Void) {
        journal.record("append-requested")
        revalidate { current in
            guard current, valid(), self.selected else { self.journal.record("append-refused"); completion("Source changed. Nothing was added.", false); return }
            self.journal.draft += "\n\n" + text
            self.journal.record("append-confirmed")
            completion("Added and verified. Nothing sent.", true)
        }
    }
}
@main enum FixtureMain {
    static func main() {
        guard CommandLine.arguments.count >= 2, CommandLine.arguments[1] == nativeHostAllowedOrigin else { exit(1) }
        let journal = FixtureJournal(); journal.record("started")
        let app = NSApplication.shared
        let delegate = NativeHostApplication(backend: PipeFixtureComposer(journal), terminated: { journal.record("terminated") })
        app.delegate = delegate
        app.setActivationPolicy(.prohibited)
        app.run()
    }
}
