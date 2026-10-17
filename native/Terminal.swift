import AppKit
import ApplicationServices

// Terminal tabs as destinations. A tab may be showing a shell rather than an agent, so it receives one
// line only: a mention of the hand-off file, never multi-line text and never Return. The owner's rules
// are in docs/decisions/reading-and-projection.md §4.

/// The terminals whose tabs can be listed and written to: both name each tab's tty over Apple Events.
enum TerminalApp: String, CaseIterable {
    case terminal = "com.apple.Terminal"
    case iterm = "com.googlecode.iterm2"

    var name: String { self == .terminal ? "Terminal" : "iTerm2" }
}

/// One tab (an iTerm2 pane counts as one) as it was listed: where it is and what runs in it.
struct TerminalTab: Equatable {
    let app: TerminalApp
    let pid: pid_t
    let launchDate: Date
    /// The window's scripting id, as text.
    let window: String
    /// The tab's 1-based position in its window.
    let index: Int
    /// `/dev/ttysNNN`.
    let tty: String
    /// What names the tab while it lives: iTerm2's session id; Terminal's window id and tty.
    let session: String
    let title: String
    /// The name of the foreground process when it was listed (`claude`, `zsh`…), or "" if unknown.
    var process: String = ""
    /// That process's id: the same name in a new process (an agent restarted) is another target.
    var processID: Int32 = 0
    /// Whether its window holds more than one tab, so the tab number is worth showing.
    var numbered = false
    /// The tty's name, shown when the label alone would match another tab's.
    var cue = ""

    var key: String { "\(app.rawValue)|\(pid)|\(session)" }

    /// The picker's text after the app name: foreground process, title, tab number.
    var label: String {
        let title = safeLabel(self.title, limit: 40)
        let place = [title.isEmpty ? "window \(window)" : title, numbered ? "tab \(index)" : nil].compactMap { $0 }.joined(separator: " · ")
        // The process first: it says whether the tab holds an agent or a shell, so it must not be cut off.
        let label = process.isEmpty ? place : "\(safeLabel(process, limit: 32)) — \(place)"
        return cue.isEmpty ? label : "\(label) · \(cue)"
    }
}

/// Gives each tab whose label would match another tab of the same terminal its tty, so every row differs.
func distinguish(_ tabs: [TerminalTab]) -> [TerminalTab] {
    let counts = Dictionary(grouping: tabs) { "\($0.app.rawValue)|\($0.label)" }.mapValues(\.count)
    return tabs.map { tab in
        var tab = tab
        if (counts["\(tab.app.rawValue)|\(tab.label)"] ?? 0) > 1 { tab.cue = String(tab.tty.dropFirst("/dev/".count)) }
        return tab
    }
}

/// Programs that edit what is typed as a line until Return: shells and the agent CLIs this was built for.
/// Anything else (vim, less, a game) may act on each character, so Add asks before giving it the line.
let lineEditingProcesses: Set<String> = [
    "sh", "bash", "zsh", "fish", "dash", "ksh", "mksh", "tcsh", "csh", "nu", "xonsh", "elvish", "pwsh",
    "claude", "codex", "gemini", "aider", "opencode", "amp", "goose", "crush", "cursor-agent", "qwen", "copilot",
]

func editsLines(_ process: String) -> Bool { lineEditingProcesses.contains(process) }

/// Tabs from a listing script's rows: window id, tab number, tty, title and (iTerm2) session id. Rows
/// that do not have exactly that shape are dropped, never guessed at.
func terminalTabs(_ app: TerminalApp, pid: pid_t, launchDate: Date, rows: [[String]]) -> [TerminalTab] {
    let tabs: [TerminalTab] = rows.prefix(200).compactMap { row in
        guard row.count == 5, row[0].range(of: "^[0-9]{1,12}$", options: .regularExpression) != nil,
              let index = Int(row[1]), (1...999).contains(index), isTTY(row[2]) else { return nil }
        let session: String
        switch app {
        case .terminal: session = "\(row[0]):\(row[2])"
        case .iterm:
            guard row[4].range(of: "^[A-Za-z0-9:-]{1,128}$", options: .regularExpression) != nil else { return nil }
            session = row[4]
        }
        return TerminalTab(app: app, pid: pid, launchDate: launchDate, window: row[0], index: index, tty: row[2],
                           session: session, title: safeLabel(row[3], limit: 80))
    }
    let perWindow = Dictionary(grouping: tabs, by: \.window).mapValues { Set($0.map(\.index)).count }
    return tabs.map { tab in
        var tab = tab
        tab.numbered = (perWindow[tab.window] ?? 0) > 1
        return tab
    }
}

func isTTY(_ text: String) -> Bool { text.range(of: "^/dev/ttys[0-9]{1,4}$", options: .regularExpression) != nil }

/// The foreground job from `ps -o pid=,pgid=,tpgid=,comm= -t <tty>`: the leader of the tty's foreground
/// process group, else any member of it. Its id and the executable's name only, never its arguments.
func foregroundProcess(_ ps: String) -> (id: Int32, name: String)? {
    let rows = ps.split(separator: "\n").compactMap { line -> (pid: Int, pgid: Int, tpgid: Int, name: String)? in
        let fields = line.split(separator: " ", maxSplits: 3, omittingEmptySubsequences: true)
        guard fields.count == 4, let pid = Int(fields[0]), let pgid = Int(fields[1]), let tpgid = Int(fields[2]) else { return nil }
        return (pid, pgid, tpgid, String(fields[3]))
    }
    guard let row = rows.first(where: { $0.pid == $0.tpgid }) ?? rows.first(where: { $0.pgid == $0.tpgid }) else { return nil }
    var name = (row.name as NSString).lastPathComponent
    if name.hasPrefix("-") { name.removeFirst() } // A login shell.
    guard !name.isEmpty, let id = Int32(exactly: row.pid) else { return nil }
    return (id, safeLabel(name, limit: 32))
}

/// Characters a shell still acts on inside double quotes (`$` and backticks substitute, `\` escapes, `!`
/// expands history), so a mention left at a prompt and run by Return would run more than a missing command.
let shellActiveCharacters = CharacterSet(charactersIn: "\"$`\\!")

/// What a tab receives: `@"<path>"`, with no newline. Nil for a path a one-line mention cannot carry
/// inertly: not absolute, or holding a control character or a character a shell acts on inside quotes.
func handoffMention(_ path: String) -> String? {
    guard path.hasPrefix("/"), path.utf8.count <= 1024, path.rangeOfCharacter(from: shellActiveCharacters) == nil,
          !path.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) }) else { return nil }
    return "@\"\(path)\""
}

/// How many times `line` shows on a terminal screen. Line wrapping, padding and box borders are ignored,
/// since a TUI may wrap a long input inside its frame.
func occurrences(of line: String, in screen: String) -> Int {
    let squeeze = { (text: String) in
        String(String.UnicodeScalarView(text.unicodeScalars.filter {
            !CharacterSet.whitespacesAndNewlines.contains($0) && !(0x2500...0x257F).contains($0.value)
        }))
    }
    let needle = squeeze(line), haystack = squeeze(screen)
    guard !needle.isEmpty else { return 0 }
    return haystack.components(separatedBy: needle).count - 1
}

// MARK: scripting

private func fourCC(_ code: String) -> FourCharCode { code.utf8.reduce(0) { $0 << 8 | FourCharCode($1) } }

/// Apple Events to the terminals, one at a time on their own queue. Values reach a script only as
/// handler arguments, never spliced into its source.
enum TerminalScripting {
    static let queue = DispatchQueue(label: "io.lesprivilege.add-to-claude.terminal")
    private static var compiled: [TerminalApp: NSAppleScript] = [:]

    private static let sources: [TerminalApp: String] = [
        .terminal: """
        on listTabs()
            with timeout of 5 seconds
                tell application id "com.apple.Terminal"
                    set rows to {}
                    repeat with w in windows
                        try
                            set wid to (id of w) as text
                            set n to 0
                            repeat with t in tabs of w
                                set n to n + 1
                                set end of rows to {wid, n as text, (tty of t) as text, (custom title of t) as text, ""}
                            end repeat
                        end try
                    end repeat
                    return rows
                end tell
            end timeout
        end listTabs

        on screenText(wid, ttyName)
            with timeout of 5 seconds
                tell application id "com.apple.Terminal"
                    repeat with w in windows
                        set found to missing value
                        try
                            if ((id of w) as text) is wid then
                                repeat with t in tabs of w
                                    if (tty of t) is ttyName then set found to t
                                end repeat
                            end if
                        end try
                        if found is not missing value then return (contents of found) as text
                    end repeat
                end tell
            end timeout
            error "The tab is gone." number 1001
        end screenText

        on bringForward(wid, ttyName)
            with timeout of 5 seconds
                tell application id "com.apple.Terminal"
                    repeat with w in windows
                        set found to missing value
                        try
                            if ((id of w) as text) is wid then
                                repeat with t in tabs of w
                                    if (tty of t) is ttyName then set found to t
                                end repeat
                            end if
                        end try
                        if found is not missing value then
                            set selected of found to true
                            set index of w to 1
                            return (tty of selected tab of front window) as text
                        end if
                    end repeat
                end tell
            end timeout
            error "The tab is gone." number 1001
        end bringForward
        """,
        .iterm: """
        on listTabs()
            with timeout of 5 seconds
                tell application id "com.googlecode.iterm2"
                    set rows to {}
                    repeat with w in windows
                        try
                            set wid to (id of w) as text
                            set n to 0
                            repeat with t in tabs of w
                                set n to n + 1
                                repeat with s in sessions of t
                                    set end of rows to {wid, n as text, (tty of s) as text, (name of s) as text, (id of s) as text}
                                end repeat
                            end repeat
                        end try
                    end repeat
                    return rows
                end tell
            end timeout
        end listTabs

        on screenText(sid)
            with timeout of 5 seconds
                tell application id "com.googlecode.iterm2"
                    repeat with w in windows
                        set found to missing value
                        try
                            repeat with t in tabs of w
                                repeat with s in sessions of t
                                    if ((id of s) as text) is sid then set found to s
                                end repeat
                            end repeat
                        end try
                        if found is not missing value then return (contents of found) as text
                    end repeat
                end tell
            end timeout
            error "The tab is gone." number 1001
        end screenText

        on writeLine(sid, txt)
            with timeout of 5 seconds
                tell application id "com.googlecode.iterm2"
                    repeat with w in windows
                        set found to missing value
                        try
                            repeat with t in tabs of w
                                repeat with s in sessions of t
                                    if ((id of s) as text) is sid then set found to s
                                end repeat
                            end repeat
                        end try
                        if found is not missing value then
                            tell found to write text txt without newline
                            return "written"
                        end if
                    end repeat
                end tell
            end timeout
            error "The tab is gone." number 1001
        end writeLine
        """,
    ]

    /// Calls one handler of the app's script. On `queue` only. The error number is the Apple Event
    /// status (-1743: not allowed, -600: not running) or the script's own (1001: the tab is gone).
    static func call(_ app: TerminalApp, _ handler: String, _ arguments: [String]) -> Result<NSAppleEventDescriptor, TerminalError> {
        dispatchPrecondition(condition: .onQueue(queue))
        guard NSRunningApplication.runningApplications(withBundleIdentifier: app.rawValue).contains(where: { !$0.isTerminated }) else {
            return .failure(TerminalError(code: -600)) // Never launch a terminal just to look at it.
        }
        let script = compiled[app] ?? {
            let script = NSAppleScript(source: sources[app]!)!
            compiled[app] = script
            return script
        }()
        let event = NSAppleEventDescriptor(eventClass: fourCC("ascr"), eventID: fourCC("psbr"), targetDescriptor: .currentProcess(),
                                           returnID: AEReturnID(kAutoGenerateReturnID), transactionID: AETransactionID(kAnyTransactionID))
        event.setDescriptor(NSAppleEventDescriptor(string: handler.lowercased()), forKeyword: fourCC("snam"))
        let list = NSAppleEventDescriptor.list()
        for (offset, argument) in arguments.enumerated() { list.insert(NSAppleEventDescriptor(string: argument), at: offset + 1) }
        event.setParam(list, forKeyword: fourCC("----"))
        var error: NSDictionary?
        let result = script.executeAppleEvent(event, error: &error)
        if let error { return .failure(TerminalError(code: (error[NSAppleScript.errorNumber] as? Int) ?? -1)) }
        return .success(result)
    }

    /// Whether this app may send Apple Events to the terminal; asking shows macOS's prompt once and waits for it.
    static func access(_ app: TerminalApp, ask: Bool) -> OSStatus {
        let target = NSAppleEventDescriptor(bundleIdentifier: app.rawValue)
        guard let desc = target.aeDesc else { return OSStatus(procNotFound) }
        return AEDeterminePermissionToAutomateTarget(desc, fourCC("****"), fourCC("****"), ask)
    }

    static func rows(_ descriptor: NSAppleEventDescriptor) -> [[String]] {
        guard descriptor.numberOfItems > 0 else { return [] }
        return (1...min(descriptor.numberOfItems, 200)).compactMap { descriptor.atIndex($0) }.map { row in
            row.numberOfItems > 0 ? (1...min(row.numberOfItems, 8)).map { row.atIndex($0)?.stringValue ?? "" } : []
        }
    }
}

struct TerminalError: Error {
    let code: Int
    var problem: String {
        switch code {
        case -1743: return "this app is not allowed to control it (System Settings → Privacy & Security → Automation)"
        case -1744: return "it has not been allowed yet"
        case -600: return "it is not running"
        case -1712: return "it did not answer in time"
        case 1001: return "the tab closed"
        default: return "it refused the request (\(code))"
        }
    }
}

/// Whether Add may list a terminal's tabs: allowed, not asked yet, or refused in System Settings.
enum TerminalAccess: Equatable { case allowed, notAsked, refused }

func terminalAccess(_ status: OSStatus) -> TerminalAccess {
    switch status {
    case noErr: return .allowed
    case OSStatus(errAEEventWouldRequireUserConsent): return .notAsked
    default: return .refused
    }
}

/// The foreground process of a tty, from `ps`. Blocking; off the main thread.
func foregroundProcess(tty: String) -> (id: Int32, name: String)? {
    guard isTTY(tty) else { return nil }
    let ps = Process(), pipe = Pipe()
    ps.executableURL = URL(fileURLWithPath: "/bin/ps")
    ps.arguments = ["-o", "pid=,pgid=,tpgid=,comm=", "-t", String(tty.dropFirst("/dev/".count))]
    ps.standardOutput = pipe
    ps.standardError = FileHandle.nullDevice
    do { try ps.run() } catch { return nil }
    let data = pipe.fileHandleForReading.readDataToEndOfFile()
    ps.waitUntilExit()
    return foregroundProcess(String(decoding: data.prefix(64 * 1024), as: UTF8.self))
}

/// The running terminals' tabs, and which terminals are running but not allowed. Blocking; off the main thread.
func discoverTerminalTabs() -> (tabs: [TerminalTab], blocked: [(TerminalApp, TerminalAccess)]) {
    var tabs: [TerminalTab] = [], blocked: [(TerminalApp, TerminalAccess)] = []
    for app in TerminalApp.allCases {
        guard let running = NSRunningApplication.runningApplications(withBundleIdentifier: app.rawValue).first(where: { !$0.isTerminated }),
              let launchDate = running.launchDate else { continue }
        let access = terminalAccess(TerminalScripting.access(app, ask: false))
        guard access == .allowed else { blocked.append((app, access)); continue }
        let rows = TerminalScripting.queue.sync { TerminalScripting.call(app, "listTabs", []) }
        guard case .success(let list) = rows else { continue }
        tabs += terminalTabs(app, pid: running.processIdentifier, launchDate: launchDate, rows: TerminalScripting.rows(list)).map { tab in
            var tab = tab
            let process = foregroundProcess(tty: tab.tty)
            tab.process = process?.name ?? ""
            tab.processID = process?.id ?? 0
            return tab
        }
    }
    return (distinguish(tabs), blocked)
}

// MARK: delivery

/// Puts `line` into the chosen tab without running it. iTerm2 writes it to that session directly; Terminal
/// has no such command, so its tab is brought forward inside Terminal and Terminal's own Paste menu item is
/// pressed, as the user's paste would be, whatever the keyboard layout. Neither is activated. Before writing,
/// the tab must still exist and run the very process the picker showed. Success means the line was read
/// back on the tab's screen. The clipboard is restored either way, unless something else was copied.
func appendToTerminal(_ tab: TerminalTab, line: String, operationValid: @escaping () -> Bool,
                      completion: @escaping (String, AddOutcome) -> Void) {
    let main = { (message: String, outcome: AddOutcome) in DispatchQueue.main.async { completion(message, outcome) } }
    guard !line.contains("\n"), !line.contains("\r"), operationValid() else {
        return completion("The hand-off changed. Nothing was added.", .failed)
    }
    let running = NSRunningApplication(processIdentifier: tab.pid)
    guard let running, !running.isTerminated, running.launchDate == tab.launchDate else {
        return completion("\(tab.app.name) quit or restarted. Choose the tab again.", .failed)
    }
    TerminalScripting.queue.async {
        // The same tab, still running what the user saw when choosing it.
        guard case .success(let list) = TerminalScripting.call(tab.app, "listTabs", []),
              terminalTabs(tab.app, pid: tab.pid, launchDate: tab.launchDate, rows: TerminalScripting.rows(list))
                  .contains(where: { $0.session == tab.session && $0.tty == tab.tty }) else {
            return main("The tab closed or moved. Choose it again.", .failed)
        }
        let process = foregroundProcess(tty: tab.tty)
        guard process?.name ?? "" == tab.process, process?.id ?? 0 == tab.processID else {
            let now = process?.name ?? "something else"
            return main(now == tab.process ? "\(now) in the tab restarted since you chose it. Choose the tab again."
                        : "The tab now runs \(now), not \(tab.process.isEmpty ? "what it ran" : tab.process). Choose it again.", .failed)
        }
        let screenArguments = tab.app == .iterm ? [tab.session] : [tab.window, tab.tty]
        let screen = { () -> String? in
            guard case .success(let text) = TerminalScripting.call(tab.app, "screenText", screenArguments) else { return nil }
            return text.stringValue
        }
        let before = occurrences(of: line, in: screen() ?? "")
        // Up to two seconds for the line to show on the tab's screen once more than before.
        func confirm(_ left: Int = 10, done: @escaping (Bool) -> Void) {
            TerminalScripting.queue.asyncAfter(deadline: .now() + 0.2) {
                if occurrences(of: line, in: screen() ?? "") > before { return done(true) }
                left > 0 ? confirm(left - 1, done: done) : done(false)
            }
        }
        switch tab.app {
        case .iterm:
            // The bar's state lives on the main thread; the main thread never waits on this queue.
            guard DispatchQueue.main.sync(execute: operationValid) else { return main("The hand-off expired or changed. Nothing was added.", .failed) }
            if case .failure(let error) = TerminalScripting.call(.iterm, "writeLine", [tab.session, line]) {
                return main("iTerm2 did not take the line: \(error.problem). Nothing was added.", .failed)
            }
            confirm { seen in
                seen ? main("Added a mention of the hand-off file to the tab. Nothing was run.", .inserted)
                    : main("Written to the tab, but it could not be read back there. Check the tab; nothing was run.", .unconfirmed)
            }
        case .terminal:
            guard case .success(let front) = TerminalScripting.call(.terminal, "bringForward", [tab.window, tab.tty]),
                  front.stringValue == tab.tty else {
                return main("Terminal could not bring the tab forward. Nothing was added; click the tab, then Add again.", .failed)
            }
            DispatchQueue.main.async {
                guard operationValid() else { return completion("The hand-off expired or changed. Nothing was added.", .failed) }
                guard let paste = pasteMenuItem(tab.pid) else {
                    return completion("Terminal's Paste menu item could not be found. Nothing was added; use Copy Line and paste it into the tab.", .failed)
                }
                let board = NSPasteboard.general
                let saved = board.pasteboardItems?.map { item in item.types.compactMap { type in item.data(forType: type).map { (type, $0) } } } ?? []
                board.clearContents()
                board.setString(line, forType: .string)
                let ours = board.changeCount
                let pressed = AXUIElementPerformAction(paste, kAXPressAction as CFString)
                TerminalScripting.queue.async {
                    confirm { seen in
                        DispatchQueue.main.async {
                            // Restore what was there, unless something else was copied in the meantime.
                            if board.changeCount == ours {
                                board.clearContents()
                                board.writeObjects(saved.map { pairs in
                                    let item = NSPasteboardItem()
                                    for (type, data) in pairs { item.setData(data, forType: type) }
                                    return item
                                })
                            }
                            if seen { return completion("Added a mention of the hand-off file to the tab. Nothing was run.", .inserted) }
                            if pressed != .success {
                                return completion("Terminal did not take the paste. Nothing was added; use Copy Line and paste it into the tab.", .failed)
                            }
                            completion("The line could not be read back in the tab. If it is not there, choose It's Not to copy it, then paste it into the tab. Nothing was run.", .unconfirmed)
                        }
                    }
                }
            }
        }
    }
}

/// The app's own Paste item: the one enabled menu item whose shortcut is ⌘V with no other modifier,
/// found by its shortcut rather than its title, which is localized. Nil unless there is exactly one.
func pasteMenuItem(_ pid: pid_t) -> AXUIElement? {
    guard let bar = axElement(AXUIElementCreateApplication(pid), kAXMenuBarAttribute),
          let menus = attribute(bar, kAXChildrenAttribute) as? [AXUIElement] else { return nil }
    var found: [AXUIElement] = []
    for menu in menus.prefix(20) {
        for list in (attribute(menu, kAXChildrenAttribute) as? [AXUIElement] ?? []).prefix(2) {
            for item in (attribute(list, kAXChildrenAttribute) as? [AXUIElement] ?? []).prefix(80)
            where axString(item, kAXMenuItemCmdCharAttribute) == "V"
                && (attribute(item, kAXMenuItemCmdModifiersAttribute) as? Int) == 0
                && (attribute(item, kAXEnabledAttribute) as? Bool) == true {
                found.append(item)
            }
        }
    }
    return found.count == 1 ? found[0] : nil
}

// MARK: hand-off files

/// The files a terminal tab's mention points at: one per source conversation, in the folder its files go
/// to, replaced by each Add. Removed by Clear History, and once a day old (checked at launch and whenever
/// the panel opens). Each path is remembered with the SHA-256 Add wrote: a file Add did not write, or that
/// changed since, is never replaced or removed.
final class HandoffFiles {
    static let shared = HandoffFiles(defaults: .standard, folder: FilesFolder.folder(for:))

    /// `handoff-<first 8 of the conversation id>.add-to-claude.md`, so two conversations with one title
    /// never share a file; `handoff-unsaved…` for a chat that has no id yet.
    static func name(for conversation: String?) -> String {
        let id = String((conversation ?? "").unicodeScalars.filter { CharacterSet.alphanumerics.contains($0) && $0.isASCII }.prefix(8))
        return "handoff-\(id.isEmpty ? "unsaved" : id.lowercased()).add-to-claude.md"
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

    /// Writes the conversation's hand-off file, replacing the one Add wrote before, and returns its path.
    func write(_ markdown: String, title: String, conversation: String?) -> Result<URL, HandoffFileError> {
        guard markdown.utf8.count <= maximumMarkdownBytes else { return .failure(.tooLarge) }
        let directory = folder(title)
        let path = directory.appendingPathComponent(Self.name(for: conversation))
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
    case tooLarge, notWritable, taken(URL)
    var message: String {
        switch self {
        case .tooLarge: return "The hand-off is over 16 MB. Choose fewer turns."
        case .notWritable: return "The files folder is not writable. Choose another in Settings."
        case .taken(let path): return "\(path.lastPathComponent) in the conversation's folder was not written by Add, or changed since, so it is left alone. Move it away, then Add again."
        }
    }
}
