import Foundation

// The terminal adapter's own logic: reading tab listings and `ps`, the one-line mention, reading a
// line back off a screen, and the hand-off files' lifecycle. Synthetic rows and a throwaway folder;
// no Apple Events are sent and no real terminal is touched.
@main enum TerminalTests {
    static var checks = 0
    static func check(_ condition: Bool, _ label: String) {
        guard condition else { print("FAIL: \(label)"); exit(1) }
        checks += 1
    }

    static let launch = Date(timeIntervalSince1970: 1_800_000_000)

    static func listings() {
        let rows = [
            ["12", "1", "/dev/ttys003", "zsh", ""],
            ["12", "2", "/dev/ttys004", "claude", ""],
            ["13", "1", "/dev/ttys009", "", ""],
            ["13", "1", "/dev/tty003", "not a pty", ""],
            ["x1", "1", "/dev/ttys010", "bad window", ""],
            ["14", "0", "/dev/ttys011", "bad index", ""],
            ["14", "1", "/dev/ttys012"],
        ]
        let tabs = terminalTabs(.terminal, pid: 42, launchDate: launch, rows: rows)
        check(tabs.map(\.tty) == ["/dev/ttys003", "/dev/ttys004", "/dev/ttys009"], "only well-formed rows become tabs")
        check(tabs[0].session == "12:/dev/ttys003" && tabs[0].key == "com.apple.Terminal|42|12:/dev/ttys003", "a Terminal tab is named by its window and tty")
        check(tabs[0].numbered && tabs[1].numbered && !tabs[2].numbered, "tab numbers only where a window has several")
        var shown = tabs[1]
        shown.process = "claude"
        check(shown.label == "claude — claude · tab 2", "label: process, title, tab")
        check(tabs[2].label == "window 13", "an untitled tab names its window")
        let title = terminalTabs(.terminal, pid: 42, launchDate: launch, rows: [["1", "1", "/dev/ttys001", "a\u{1b}[31mb\nc", ""]])
        check(title.first?.title == "a[31mbc", "control characters are dropped from titles")

        let iterm = terminalTabs(.iterm, pid: 7, launchDate: launch, rows: [
            ["5", "1", "/dev/ttys020", "codex", "w0t0p0:6B1E9F2A-1C2D-4E5F-8A9B-0C1D2E3F4A5B"],
            ["5", "1", "/dev/ttys021", "split pane", "w0t0p1:7C2E"],
            ["5", "2", "/dev/ttys022", "bad session", "a b"],
            ["5", "3", "/dev/ttys023", "no session", ""],
        ])
        check(iterm.map(\.tty) == ["/dev/ttys020", "/dev/ttys021"], "an iTerm2 row needs a plain session id")
        check(iterm[0].session == "w0t0p0:6B1E9F2A-1C2D-4E5F-8A9B-0C1D2E3F4A5B", "an iTerm2 pane is named by its session id")
        check(!iterm[0].numbered, "two panes of one tab are not numbered tabs")
        check(terminalTabs(.terminal, pid: 1, launchDate: launch, rows: Array(repeating: ["1", "1", "/dev/ttys001", "", ""], count: 500)).count == 200,
              "at most 200 tabs are read")
        // Rows that would read the same get their tty, so none can hide another in the picker.
        let panes = distinguish(terminalTabs(.iterm, pid: 7, launchDate: launch, rows: [
            ["5", "1", "/dev/ttys020", "-zsh", "s1"], ["5", "1", "/dev/ttys021", "-zsh", "s2"], ["6", "1", "/dev/ttys030", "other", "s3"],
        ]).map { tab in var tab = tab; tab.process = "zsh"; return tab })
        check(panes.map(\.label) == ["zsh — -zsh · ttys020", "zsh — -zsh · ttys021", "zsh — other"], "same labels get their tty")
        check(Set(panes.map(\.label)).count == panes.count, "every row differs")
        check(isTTY("/dev/ttys000") && !isTTY("/dev/ttys") && !isTTY("/dev/ttys0001 ") && !isTTY("ttys001"), "tty shape")
    }

    static func processes() {
        let leader = foregroundProcess("  100   100   300 -zsh\n  300   300   300 /opt/homebrew/bin/claude\n  301   300   300 node\n")
        check(leader?.name == "claude" && leader?.id == 300, "the foreground group's leader, with its id")
        check(foregroundProcess("  100   100   100 -zsh\n")?.name == "zsh", "a login shell at its prompt")
        check(foregroundProcess("  100   100   300 -zsh\n  301   300   300 /usr/bin/python3\n")?.name == "python3", "a member when the leader is gone")
        check(foregroundProcess("  100   100   200 -zsh\n") == nil, "no process in the foreground group")
        check(foregroundProcess("garbage\n\n  1 2\n") == nil, "unreadable output")
        check(foregroundProcess("  9  9  9 /Applications/My Tool.app/Contents/MacOS/my tool\n")?.name == "my tool", "a name with spaces")
        check(editsLines("zsh") && editsLines("claude") && editsLines("codex") && editsLines("fish"), "shells and agents edit a line")
        check(!editsLines("vim") && !editsLines("less") && !editsLines("") && !editsLines("node"), "anything else is asked about first")
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

    static func readback() {
        let line = "@\"/Users/a/Downloads/Add to Claude/A long conversation title/handoff.add-to-claude.md\""
        check(occurrences(of: line, in: "% " + line) == 1, "on one line")
        let wrapped = "╭────────╮\n│ > @\"/Users/a/Downloads/Add to Claude/A long conv │\n│ ersation title/handoff.add-to-claude.md\"     │\n╰────────╯"
        check(occurrences(of: line, in: wrapped) == 1, "wrapped inside a TUI's frame")
        check(occurrences(of: line, in: wrapped + "\n" + wrapped) == 2, "counted each time it shows")
        check(occurrences(of: line, in: "% ls") == 0, "absent")
        check(occurrences(of: "  ", in: "a  b") == 0, "an empty line never matches")
    }

    static func access() {
        check(terminalAccess(noErr) == .allowed, "allowed")
        check(terminalAccess(OSStatus(errAEEventWouldRequireUserConsent)) == .notAsked, "not asked yet")
        check(terminalAccess(OSStatus(errAEEventNotPermitted)) == .refused, "refused")
        check(terminalAccess(OSStatus(procNotFound)) == .refused, "anything else does not list tabs")
    }

    static func files() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("terminal-tests-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: root) }
        let defaults = UserDefaults(suiteName: "terminal-tests-\(UUID().uuidString)")!
        final class Clock { var now = Date(timeIntervalSince1970: 1_800_000_000) }
        let clock = Clock()
        let store = HandoffFiles(defaults: defaults, folder: { root.appendingPathComponent($0) }, now: { clock.now })
        let a = "6812a3f0-0000-4000-8000-000000000001", b = "77aa00bb-0000-4000-8000-000000000002"

        check(HandoffFiles.name(for: a) == "handoff-6812a3f0.add-to-claude.md", "named by the conversation id")
        check(HandoffFiles.name(for: nil) == "handoff-unsaved.add-to-claude.md", "a chat with no id yet")
        check(HandoffFiles.name(for: "../$x/..") == "handoff-x.add-to-claude.md", "only letters and digits from the id")

        guard case .success(let first) = store.write("# One\n", title: "Plan", conversation: a) else { return check(false, "first write") }
        check(first.lastPathComponent == HandoffFiles.name(for: a) && first.deletingLastPathComponent().lastPathComponent == "Plan", "in the conversation's folder")
        check(try String(contentsOf: first) == "# One\n", "the text as given")
        guard case .success(let second) = store.write("# Two\n", title: "Plan", conversation: a) else { return check(false, "second write") }
        check(try second == first && String(contentsOf: first) == "# Two\n", "one per conversation, replaced by each Add")

        // Two conversations with one title: two files, neither overwrites the other's.
        guard case .success(let other) = store.write("# Other\n", title: "Plan", conversation: b) else { return check(false, "same title") }
        check(try other != first && String(contentsOf: first) == "# Two\n" && String(contentsOf: other) == "# Other\n", "same title, separate files")

        let foreign = root.appendingPathComponent("Theirs").appendingPathComponent(HandoffFiles.name(for: a))
        try FileManager.default.createDirectory(at: foreign.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Data("mine".utf8).write(to: foreign)
        check(store.write("# Three\n", title: "Theirs", conversation: a) == .failure(.taken(foreign)), "a file Add did not write is never replaced")
        check(try String(contentsOf: foreign) == "mine", "and stays as it was")
        check(store.write(String(repeating: "a", count: maximumMarkdownBytes + 1), title: "Big", conversation: a) == .failure(.tooLarge), "bounded size")

        // A hand-off file the user edited is theirs now: not replaced, not removed.
        try Data("# Two, with my notes\n".utf8).write(to: other)
        check(store.write("# Other again\n", title: "Plan", conversation: b) == .failure(.taken(other)), "an edited hand-off is not replaced")

        clock.now += 3600
        guard case .success(let later) = store.write("# Later\n", title: "Later", conversation: a) else { return check(false, "later write") }
        clock.now += 23 * 3600 + 1
        store.remove(olderThan: 24 * 3600)
        check(!FileManager.default.fileExists(atPath: first.path), "a day old: removed")
        check(try FileManager.default.fileExists(atPath: other.path) && String(contentsOf: other) == "# Two, with my notes\n", "an edited one stays")
        check(FileManager.default.fileExists(atPath: later.path), "younger: kept")
        store.clear()
        check(!FileManager.default.fileExists(atPath: later.path), "Clear History removes the rest")
        check(FileManager.default.fileExists(atPath: foreign.path), "and never a file Add did not write")
        check(defaults.dictionary(forKey: "HandoffFiles")?.isEmpty ?? true, "nothing left remembered")
    }

    static func main() throws {
        listings()
        processes()
        mentions()
        readback()
        access()
        try files()
        print("PASS terminal: \(checks) checks")
    }
}
