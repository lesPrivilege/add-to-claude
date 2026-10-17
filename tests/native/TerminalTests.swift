import Foundation

// The terminal adapter's own logic: the one-line mention a terminal is given and the hand-off files'
// lifecycle. A throwaway folder; no real terminal is touched.
@main enum TerminalTests {
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
        mentions()
        try files()
        print("PASS terminal: \(checks) checks")
    }
}
