import AppKit
import OSLog

/// One hand-off as structured events in the unified log: its stages, how long each took, sizes and
/// the outcome. Only counts, fixed stage names and outcomes are logged: never message text, titles,
/// file names or paths, so the record cannot become a second copy of a conversation.
struct HandoffTrace {
    enum Stage: String {
        case started, projected, filesFetched = "files", insertAttempted = "insert", inserted, unconfirmed, failed, confirmedByUser = "confirmed", declinedByUser = "declined"
    }

    static let subsystem = "io.lesprivilege.add-to-claude"
    private static let log = Logger(subsystem: subsystem, category: "handoff")
    let id = String(UUID().uuidString.prefix(8)).lowercased()
    private let start = Date()

    func record(_ stage: Stage, turns: Int? = nil, files: Int? = nil, bytes: Int? = nil, scope: String? = nil, target: String? = nil) {
        let ms = Int(Date().timeIntervalSince(start) * 1000)
        var fields = ["op=\(id)", "stage=\(stage.rawValue)", "t=\(ms)ms"]
        if let scope { fields.append("scope=\(scope)") }
        if let turns { fields.append("turns=\(turns)") }
        if let files { fields.append("files=\(files)") }
        if let bytes { fields.append("bytes=\(bytes)") }
        if let target { fields.append("target=\(target)") }
        let line = fields.joined(separator: " ")
        Self.log.notice("\(line, privacy: .public)")
    }

    /// Something outside a hand-off that explains a failure, such as the page's process stopping.
    static func event(_ name: String) {
        log.notice("event=\(name, privacy: .public)")
    }
}

enum Diagnostics {
    /// This session's hand-off events, with a short header, as plain text.
    static func sessionReport() throws -> String {
        let store = try OSLogStore(scope: .currentProcessIdentifier)
        let since = store.position(date: Date().addingTimeInterval(-24 * 3600))
        let entries = try store.getEntries(at: since, matching: NSPredicate(format: "subsystem == %@", HandoffTrace.subsystem))
        let time = ISO8601DateFormatter()
        let lines = entries.compactMap { $0 as? OSLogEntryLog }.map { "\(time.string(from: $0.date)) \($0.category) \($0.composedMessage)" }
        let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "?"
        let build = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "?"
        let header = [
            "Add to Claude \(version) (\(build)) · macOS \(ProcessInfo.processInfo.operatingSystemVersionString)",
            "Signature: \(Signing.current.summary) · Accessibility: \(AXIsProcessTrusted() ? "allowed" : "not allowed")",
            "Events this session: \(lines.count). No message text, titles, file names or paths are recorded.",
            "",
        ]
        return (header + lines).joined(separator: "\n") + "\n"
    }

    /// Asks where to save the report and writes it there.
    static func export() {
        let panel = NSSavePanel()
        panel.level = aboveChatPanel
        panel.nameFieldStringValue = "add-to-claude-diagnostics.txt"
        panel.allowedContentTypes = [.plainText]
        NSApp.activate()
        guard panel.runModal() == .OK, let url = panel.url else { return }
        do { try Data(try sessionReport().utf8).write(to: url, options: .atomic) }
        catch {
            let alert = NSAlert()
            alert.messageText = "Diagnostics could not be saved."
            alert.informativeText = "Choose another folder and try again."
            alert.runModal()
        }
    }
}
