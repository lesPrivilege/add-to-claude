import Foundation

// The bar's logic that needs no window: the one-line mention a terminal is given, which apps count as
// terminals, the hand-off files' lifecycle, and how a drag paints the turn list. A throwaway folder; no
// real terminal or window is touched.
@main enum BarTests {
    static var checks = 0
    static func check(_ condition: Bool, _ label: String) {
        guard condition else { print("FAIL: \(label)"); exit(1) }
        checks += 1
    }

    static func mentions() {
        check(handoffMention("/Users/a/Downloads/Add to Claude/Plan/handoff.add-to-claude.md")
              == "@\"/Users/a/Downloads/Add to Claude/Plan/handoff.add-to-claude.md\"", "a quoted mention, spaces kept")
        check(handoffMention("/Users/a/计划 · 草稿/handoff.add-to-claude.md") != nil, "non-ASCII folders are fine")
        check(handoffMention("/Users/a/\"x\"/h.md") == nil, "a double quote cannot be carried")
        for active in ["$(curl x|sh)", "`id`", "a\\b", "hi!", "$HOME"] {
            check(handoffMention("/Users/a/\(active)/h.md") == nil, "nothing a shell acts on inside quotes: \(active)")
        }
        check(handoffMention("/Users/a/x\n/h.md") == nil && handoffMention("/Users/a/x\r/h.md") == nil, "no line breaks")
        check(handoffMention("/Users/a/x\u{1b}/h.md") == nil, "no control characters")
        check(handoffMention("relative/h.md") == nil, "absolute paths only")
        check(handoffMention("/" + String(repeating: "a", count: 1100)) == nil, "bounded length")
        check(!(handoffMention("/a/b.md") ?? "\n").contains("\n"), "never a newline")
        check(FilesFolder.folder(for: "The \"best\" plan").lastPathComponent == "The 'best' plan", "folder names carry no double quote")
        let risky = FilesFolder.folder(for: "Fix $(curl x|sh) `id` a\\b now!")
        check(risky.lastPathComponent == "Fix _(curl x|sh) 'id' a_b now", "folder names carry nothing a shell acts on")
        check(handoffMention(risky.appendingPathComponent("h.md").path) != nil || FilesFolder.root.path.rangeOfCharacter(from: shellActiveCharacters) != nil,
              "so a mention of a file there is accepted")
    }

    static func files() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("terminal-tests-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: root) }
        let defaults = UserDefaults(suiteName: "terminal-tests-\(UUID().uuidString)")!
        final class Clock { var now = Date(timeIntervalSince1970: 1_800_000_000) }
        let clock = Clock()
        let store = HandoffFiles(defaults: defaults, folder: { root.appendingPathComponent($0) }, now: { clock.now })
        let a = "6812a3f0-0000-4000-8000-000000000001", b = "77aa00bb-0000-4000-8000-000000000002"

        let w1 = "window:9f8e7d6c-0000-4000-8000-000000000001", w2 = "window:1a2b3c4d-0000-4000-8000-000000000002"
        let name = { (conversation: String?, window: String) in HandoffFiles.name(conversation: conversation, window: window, unsaved: "R1") }
        check(name(a, w1) == "handoff-6812a3f0-9f8e7d.add-to-claude.md", "named by the conversation and the window")
        check(name(a, w2) != name(a, w1), "one conversation in two terminal windows: two files")
        check(name(b, w1) != name(a, w1), "two conversations in one window: two files")
        check(HandoffFiles.name(conversation: nil, window: w1, unsaved: "AB12CD34") == "handoff-unsaved-ab12cd-9f8e7d.add-to-claude.md", "a chat with no id yet")
        check(HandoffFiles.name(conversation: nil, window: w1, unsaved: "AB12CD34") != HandoffFiles.name(conversation: nil, window: w1, unsaved: "EF56AB78"),
              "two chats with no id never share one")
        check(name("../$x/..", "window:../$") == "handoff-x.add-to-claude.md", "only letters and digits from either id")

        guard case .success(let first) = store.write("# One\n", title: "Plan", name: name(a, w1)) else { return check(false, "first write") }
        check(first.lastPathComponent == name(a, w1) && first.deletingLastPathComponent().lastPathComponent == "Plan", "in the conversation's folder")
        check(try String(contentsOf: first) == "# One\n", "the text as given")
        guard case .success(let second) = store.write("# Two\n", title: "Plan", name: name(a, w1)) else { return check(false, "second write") }
        check(try second == first && String(contentsOf: first) == "# Two\n", "one per conversation, replaced by each Add")

        // Two conversations with one title: two files, neither overwrites the other's.
        guard case .success(let other) = store.write("# Other\n", title: "Plan", name: name(b, w1)) else { return check(false, "same title") }
        check(try other != first && String(contentsOf: first) == "# Two\n" && String(contentsOf: other) == "# Other\n", "same title, separate files")

        let foreign = root.appendingPathComponent("Theirs").appendingPathComponent(name(a, w1))
        try FileManager.default.createDirectory(at: foreign.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Data("mine".utf8).write(to: foreign)
        check(store.write("# Three\n", title: "Theirs", name: name(a, w1)) == .failure(.taken(foreign)), "a file Add did not write is never replaced")
        check(try String(contentsOf: foreign) == "mine", "and stays as it was")
        check(store.write(String(repeating: "a", count: maximumMarkdownBytes + 1), title: "Big", name: name(a, w1)) == .failure(.tooLarge), "bounded size")

        // A hand-off file the user edited is theirs now: not replaced, not removed.
        try Data("# Two, with my notes\n".utf8).write(to: other)
        check(store.write("# Other again\n", title: "Plan", name: name(b, w1)) == .failure(.taken(other)), "an edited hand-off is not replaced")

        clock.now += 3600
        guard case .success(let later) = store.write("# Later\n", title: "Later", name: name(a, w1)) else { return check(false, "later write") }
        clock.now += 23 * 3600 + 1
        store.remove(olderThan: 24 * 3600)
        check(!FileManager.default.fileExists(atPath: first.path), "a day old: removed")
        check(try FileManager.default.fileExists(atPath: other.path) && String(contentsOf: other) == "# Two, with my notes\n", "an edited one stays")
        check(FileManager.default.fileExists(atPath: later.path), "younger: kept")
        store.clear()
        check(!FileManager.default.fileExists(atPath: later.path), "Clear History removes the rest")
        check(FileManager.default.fileExists(atPath: foreign.path), "and never a file Add did not write")
        check(defaults.dictionary(forKey: "HandoffFiles")?.isEmpty ?? true, "nothing left remembered")

        // A folder a mention cannot name is refused before anything is written.
        let unsafe = HandoffFiles(defaults: defaults, folder: { root.appendingPathComponent("Hi!").appendingPathComponent($0) })
        check(unsafe.write("# Text\n", title: "Plan", name: name(a, w1)) == .failure(.unsafePath), "an unsafe folder is refused")
        check(!FileManager.default.fileExists(atPath: root.appendingPathComponent("Hi!").path), "and nothing is written there")

        // A tracked file deleted outside the app is simply forgotten.
        guard case .success(let gone) = store.write("# Gone\n", title: "Gone", name: name(a, w2)) else { return check(false, "gone write") }
        try FileManager.default.removeItem(at: gone)
        store.clear()
        check(defaults.dictionary(forKey: "HandoffFiles")?.isEmpty ?? true, "a missing file is forgotten")
    }

    static func terminals() {
        for id in ["com.apple.Terminal", "com.googlecode.iterm2", "com.mitchellh.ghostty", "com.github.wez.wezterm", "dev.warp.Warp-Stable",
                   "net.kovidgoyal.kitty", "org.alacritty", "co.zeit.hyper", "org.tabby", "com.raphaelamorim.rio"] {
            check(isTerminalBundle(id), "a terminal: \(id)")
        }
        for id in ["com.example.hyperlink-notes", "com.anthropic.claudefordesktop", "com.apple.TextEdit", "com.example.warpdrive", "", "com.example.terminally"] {
            check(!isTerminalBundle(id), "not a terminal: \(id)")
        }
    }

    static func drags() {
        var checked: Set<Int> = [2, 5]
        let isChecked = { (row: Int) in checked.contains(row) }
        func apply(_ changes: [Int: Bool]) { for (row, on) in changes { if on { checked.insert(row) } else { checked.remove(row) } } }

        var drag = DragPaint(start: 3, wasChecked: isChecked(3))
        check(drag.state, "a drag from an unchecked row checks")
        apply([3: drag.state])
        apply(drag.move(to: 6, isChecked: isChecked))
        check(checked == [2, 3, 4, 5, 6], "down to row 6: 3–6 checked")
        check(drag.move(to: 6, isChecked: isChecked).isEmpty, "staying on a row changes nothing")
        apply(drag.move(to: 4, isChecked: isChecked))
        check(checked == [2, 3, 4, 5], "back to row 4: 6 is back as it was, 5 stays (it was checked)")
        apply(drag.move(to: 1, isChecked: isChecked))
        check(checked == [1, 2, 3, 5], "past the start upward: 1–3 checked, 4 back to unchecked")
        check(drag.covered == 1...3, "covers from the start to the row reached")

        checked = [0, 1, 2, 3]
        var clear = DragPaint(start: 1, wasChecked: isChecked(1))
        check(!clear.state, "a drag from a checked row clears")
        apply([1: clear.state])
        apply(clear.move(to: 3, isChecked: isChecked))
        check(checked == [0], "rows 1–3 cleared")
    }

    static func prepared(_ page: String) -> Prepared {
        Prepared(revision: UUID(), page: page, markdown: "# Synthetic", title: "Synthetic", turns: 0, files: 0, verification: "verified",
                 issues: [], attachments: [], verifiedWithFiles: false)
    }

    /// While a reply streams, the bar keeps the last ready preparation of that same conversation.
    static func sources() {
        let a = "https://chatgpt.com/c/a", b = "https://chatgpt.com/c/b", root = "https://chatgpt.com/"
        let kept = prepared(a)
        let ready = SourceState.ready(kept)
        let same = { (state: SourceState) in state.prepared?.revision == kept.revision }
        let replying = ready.updating("replying", on: a)
        check(same(replying), "a reply in the same conversation keeps the preparation, revision and all, so an Add of it still applies")
        if case .ready(_, true) = replying {} else { check(false, "and says a reply is in progress") }
        check(same(ready.updating("changed", on: a)), "the page loading the same conversation again keeps it until the next result")
        if case .ready(_, false) = replying.updating("changed", on: a) {} else { check(false, "a change notice ends the note") }
        if case .replying(a) = SourceState.waiting.updating("replying", on: a) {} else { check(false, "nothing ready: reply in progress, as before") }
        if case .waiting = ready.updating("changed", on: b) {} else { check(false, "another conversation waits") }
        if case .replying(b) = ready.updating("replying", on: b) {} else { check(false, "a reply on another conversation keeps nothing") }

        check(same(replying.moved(to: a)), "the address settling on the same page keeps it")
        if case .waiting = replying.moved(to: b) {} else { check(false, "moving to another conversation drops it") }
        if case .waiting = ready.moved(to: nil) {} else { check(false, "leaving ChatGPT drops it") }
        // A new chat: the first reply starts on the chat root and the page gets its address mid-stream.
        if case .replying("https://chatgpt.com/c/new") = SourceState.replying(page: root).moved(to: "https://chatgpt.com/c/new") {}
        else { check(false, "a new chat given its address stays in progress") }
        if case .replying("https://chatgpt.com/g/g-x/c/new") = SourceState.replying(page: "https://chatgpt.com/g/g-x")
            .moved(to: "https://chatgpt.com/g/g-x/c/new") {} else { check(false, "also in a GPT") }
        if case .replying(a) = SourceState.replying(page: a).moved(to: a) {} else { check(false, "the same address again changes nothing") }
        if case .waiting = SourceState.replying(page: a).moved(to: b) {} else { check(false, "a reply in one conversation is not another's") }
        if case .waiting = SourceState.replying(page: root).moved(to: root + "gpts") {} else { check(false, "a page that is no conversation waits") }

        // A refetch that reads the same keeps the shown revision; a different one replaces it.
        let refetched = prepared(a)
        check(same(ready.received(refetched)), "an identical refetch keeps the shown revision, so an Add under way stands")
        check(same(replying.received(refetched)), "also while a reply was in progress")
        if case .ready(_, false) = replying.received(refetched) {} else { check(false, "and a result ends the reply note") }
        let edited = Prepared(revision: UUID(), page: a, markdown: "# Synthetic\n\nmore", title: "Synthetic", turns: 0, files: 0,
                              verification: "verified", issues: [], attachments: [], verifiedWithFiles: false)
        check(ready.received(edited).prepared?.revision == edited.revision, "a refetch that reads differently replaces it")
        check(SourceState.ready(prepared(b)).received(refetched).prepared?.revision == refetched.revision, "another page's result is not kept")
        // A refetch that fails keeps what was read on that page.
        check(same(ready.failed("x", on: a, refetch: true)), "a failed refetch of the shown conversation keeps it")
        if case .ready(_, false) = replying.failed("x", on: a, refetch: true) {} else { check(false, "and ends a reply note") }
        if case .unavailable = replying.failed("x", on: a, refetch: false) {} else { check(false, "a failed reply or replay is shown, not the kept result") }
        if case .unavailable = ready.failed("x", on: b, refetch: true) {} else { check(false, "a failure elsewhere is shown") }
        if case .unavailable = SourceState.waiting.failed("x", on: a, refetch: true) {} else { check(false, "with nothing shown, the failure is shown") }

        for text in ["", "a", "a\n", "\n\n", "one\r\ntwo\nthree", "中文\n✓"] {
            check(lineCount(text) == text.components(separatedBy: "\n").count, "line count of \(text.debugDescription)")
        }
    }

    static func main() throws {
        sources()
        mentions()
        terminals()
        drags()
        try files()
        print("PASS bar: \(checks) checks")
    }
}
