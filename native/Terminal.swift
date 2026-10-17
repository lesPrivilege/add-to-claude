import AppKit
import ApplicationServices

// Terminal windows as destinations. A terminal may be showing a shell rather than an agent, so it never
// receives the conversation itself: Add writes the text to a hand-off file, puts one line naming that
// file on the clipboard, and brings the chosen window forward. The user pastes it; Add never types,
// pastes or presses Return in a terminal. The owner's rules are in docs/decisions/reading-and-projection.md §4.

/// Whether a chosen terminal window is still open in the same run of its app. Its title may change
/// (terminals title windows by what runs in them), so only the window itself counts.
func terminalWindowOpen(_ choice: WindowChoice) -> Bool {
    guard !choice.app.isTerminated, choice.app.launchDate == choice.launchDate else { return false }
    let app = AXUIElementCreateApplication(choice.app.processIdentifier)
    return (attribute(app, kAXWindowsAttribute) as? [AXUIElement])?.contains { CFEqual($0, choice.window) } ?? false
}

/// Puts `line` on the clipboard and brings the terminal window forward, so the user's ⌘V lands it where
/// they choose. Nothing is typed, pasted or run by Add. Copied is not pasted: the outcome is always
/// `unconfirmed` until the user says what they see.
func handToTerminal(_ choice: WindowChoice, line: String, operationValid: () -> Bool,
                    completion: (String, AddOutcome) -> Void) {
    guard !line.contains("\n"), !line.contains("\r"), operationValid() else {
        return completion("The hand-off changed. Nothing was copied.", .failed)
    }
    guard terminalWindowOpen(choice) else {
        return completion("The terminal window closed. Choose a window again.", .failed)
    }
    NSPasteboard.general.clearContents()
    NSPasteboard.general.setString(line, forType: .string)
    // A minimized window is not brought back by raising it; activating would then front another window.
    if attribute(choice.window, kAXMinimizedAttribute) as? Bool == true {
        AXUIElementSetAttributeValue(choice.window, kAXMinimizedAttribute as CFString, kCFBooleanFalse)
    }
    AXUIElementPerformAction(choice.window, kAXRaiseAction as CFString)
    choice.app.activate()
    let app = safeLabel(choice.app.localizedName ?? "the terminal", limit: 24)
    completion("Line copied, \(app) in front: click where it goes and press ⌘V. Nothing runs.", .unconfirmed)
}

/// Characters a shell still acts on inside double quotes (`$` and backticks substitute, `\` escapes, `!`
/// expands history), so a mention left at a prompt and run by Return would run more than a missing command.
let shellActiveCharacters = CharacterSet(charactersIn: "\"$`\\!")

/// What a terminal is given to paste: `@"<path>"`, with no newline. Nil for a path a one-line mention cannot carry
/// inertly: not absolute, or holding a control character or a character a shell acts on inside quotes.
func handoffMention(_ path: String) -> String? {
    guard path.hasPrefix("/"), path.utf8.count <= 1024, path.rangeOfCharacter(from: shellActiveCharacters) == nil,
          !path.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) }) else { return nil }
    return "@\"\(path)\""
}

// MARK: hand-off files

/// The files a terminal's mention points at: one per source conversation and terminal window, in the folder
/// the conversation's files go to, replaced by each Add there. Removed by Clear History, and once a day old (checked at launch and whenever
/// the panel opens). Each path is remembered with the SHA-256 Add wrote: a file Add did not write, or that
/// changed since, is never replaced or removed.
final class HandoffFiles {
    static let shared = HandoffFiles(defaults: .standard, folder: FilesFolder.folder(for:))

    /// `handoff-<first 8 of the conversation id>-<first 6 of the window session>.add-to-claude.md`: two
    /// conversations with one title, or one conversation added to two terminal windows, never share a file.
    /// A chat with no id yet is `unsaved-` plus the start of `unsaved`, a value that changes with each Add.
    static func name(conversation: String?, window: String, unsaved: String) -> String {
        let plain = { (text: String, count: Int) in
            String(text.unicodeScalars.filter { CharacterSet.alphanumerics.contains($0) && $0.isASCII }.prefix(count)).lowercased()
        }
        let id = plain(conversation ?? "", 8)
        let source = id.isEmpty ? "unsaved-" + plain(unsaved, 6) : id
        let target = plain(window.hasPrefix("window:") ? String(window.dropFirst(7)) : window, 6)
        return "handoff-\(source)\(target.isEmpty ? "" : "-" + target).add-to-claude.md"
    }

    private let key = "HandoffFiles"
    private let defaults: UserDefaults
    private let folder: (String) -> URL
    private let now: () -> Date
    private let hash: (URL) -> String?

    init(defaults: UserDefaults, folder: @escaping (String) -> URL, now: @escaping () -> Date = Date.init,
         hash: @escaping (URL) -> String? = sha256(of:)) {
        self.defaults = defaults
        self.folder = folder
        self.now = now
        self.hash = hash
    }

    /// Written paths, each with "<seconds since 1970> <sha256>".
    private var written: [String: String] {
        get { (defaults.dictionary(forKey: key) as? [String: String]) ?? [:] }
        set { defaults.set(newValue, forKey: key) }
    }

    /// Whether the file at `path` is still the one Add wrote there.
    private func isOurs(_ path: String) -> Bool {
        guard let record = written[path], let recorded = record.split(separator: " ").last else { return false }
        return hash(URL(fileURLWithPath: path)) == String(recorded)
    }

    /// Writes the hand-off file `name` in the conversation's folder, replacing the one Add wrote there
    /// before, and returns its path. A path a one-line mention cannot carry is refused before anything is written.
    func write(_ markdown: String, title: String, name: String) -> Result<URL, HandoffFileError> {
        guard markdown.utf8.count <= maximumMarkdownBytes else { return .failure(.tooLarge) }
        let directory = folder(title)
        let path = directory.appendingPathComponent(name)
        guard handoffMention(path.path) != nil else { return .failure(.unsafePath) }
        if FileManager.default.fileExists(atPath: path.path) && !isOurs(path.path) { return .failure(.taken(path)) }
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            try Data(markdown.utf8).write(to: path, options: .atomic)
        } catch { return .failure(.notWritable) }
        guard let sha = hash(path) else { return .failure(.notWritable) }
        written[path.path] = "\(now().timeIntervalSince1970) \(sha)"
        return .success(path)
    }

    /// Removes the hand-off files written more than `age` seconds ago (all of them for 0). A file that
    /// changed since Add wrote it is left where it is and forgotten.
    func remove(olderThan age: TimeInterval) {
        let cutoff = now().timeIntervalSince1970 - age
        var kept = written
        for (path, record) in kept {
            guard let time = record.split(separator: " ").first.flatMap({ Double($0) }), age == 0 || time < cutoff else { continue }
            if isOurs(path) { try? FileManager.default.removeItem(atPath: path) }
            kept[path] = nil
        }
        written = kept
    }

    func clear() { remove(olderThan: 0) }
}

enum HandoffFileError: Error, Equatable {
    case tooLarge, notWritable, unsafePath, taken(URL)
    var message: String {
        switch self {
        case .tooLarge: return "The hand-off is over 16 MB. Choose fewer turns."
        case .notWritable: return "The files folder is not writable. Choose another in Settings."
        case .unsafePath: return "The files folder's path holds a character a shell acts on (\" $ ` \\ !) or a control character, so a one-line mention could run something. Choose another folder in Settings."
        case .taken(let path): return "\(path.lastPathComponent) in the conversation's folder was not written by Add, or changed since, so it is left alone. Move it away, then Add again."
        }
    }
}
