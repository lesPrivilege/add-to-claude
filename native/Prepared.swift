import Foundation

/// The conversation on screen, compiled in the page's isolated content world. Memory only.
struct Prepared {
    let revision: UUID
    let page: String
    let markdown: String
    let title: String
    let turns: Int
    let files: Int
    let verification: String
    let issues: [String]
    let attachments: [Attachment]
    /// Whether only missing local files keep it partial.
    let verifiedWithFiles: Bool
    /// Each turn: id, role, position, preview, hash and file keys, for choosing turns and the log.
    var turnList: [TurnInfo] = []
    /// How many of each content check this text carries, by code, for diagnostics.
    var checks: [String: Int] = [:]

    /// The ChatGPT conversation id; nil for a chat that has none yet.
    var sourceId: String? { sourceConversationId(page) }

    /// The same preparation carrying another text: some of its turns, projected by the compiler.
    func projected(_ text: ProjectedText) -> Prepared {
        Prepared(revision: revision, page: page, markdown: text.markdown, title: title, turns: turns, files: text.attachments.count,
                 verification: text.verification, issues: issues, attachments: text.attachments,
                 verifiedWithFiles: text.verifiedWithFiles, turnList: turnList, checks: text.checks)
    }
}

/// Some turns of a prepared conversation as the compiler projected them; line numbers are this text's.
struct ProjectedText {
    let markdown: String
    let attachments: [Attachment]
    let verification: String
    let verifiedWithFiles: Bool
    let checks: [String: Int]
}

/// The longest hand-off text the app takes, as the compiler's own limit.
let maximumMarkdownBytes = 16 * 1024 * 1024

/// Reads the compiler's "ready" message for `page`: the whole conversation. Nil when anything is malformed.
/// The shape is pinned by tests/fixtures/bridge-messages.json, which the JS and WebKit suites both read.
func parseReady(_ body: [String: Any], page: String) -> Prepared? {
    guard let markdown = body["markdown"] as? String, markdown.utf8.count <= maximumMarkdownBytes,
          let attachments = parseAttachments(body["attachments"], lineCount: markdown.components(separatedBy: "\n").count),
          let turnList = parseTurnList(body["turnList"]), turnList.count == body["turns"] as? Int else { return nil }
    return Prepared(revision: UUID(), page: page, markdown: markdown,
                    title: safeLabel(body["title"] as? String ?? "ChatGPT conversation", limit: 120),
                    turns: turnList.count, files: body["files"] as? Int ?? 0,
                    verification: body["verification"] as? String ?? "",
                    issues: (body["issues"] as? [String] ?? []).map { safeLabel($0, limit: 200) },
                    attachments: attachments,
                    verifiedWithFiles: body["verifiedWithFiles"] as? Bool ?? false, turnList: turnList,
                    checks: parseChecks(body["checks"]))
}

/// Reads the compiler's projection of `turns` chosen turns. Nil when anything is malformed.
func parseProjection(_ body: [String: Any], turns: Int) -> ProjectedText? {
    guard let markdown = body["markdown"] as? String, markdown.utf8.count <= maximumMarkdownBytes,
          body["selectedTurns"] as? Int == turns,
          let attachments = parseAttachments(body["attachments"], lineCount: markdown.components(separatedBy: "\n").count),
          let verification = body["verification"] as? String else { return nil }
    return ProjectedText(markdown: markdown, attachments: attachments, verification: verification,
                         verifiedWithFiles: body["verifiedWithFiles"] as? Bool ?? false, checks: parseChecks(body["checks"]))
}

/// Reads a compiler result's file list; nil when any entry is malformed or points outside the text.
func parseAttachments(_ value: Any?, lineCount: Int) -> [Attachment]? {
    guard let files = value as? [[String: Any]], files.count <= 1000 else { return nil }
    var result: [Attachment] = []
    for file in files {
        guard let key = file["key"] as? String, let id = file["id"] as? String, let line = file["line"] as? Int,
              (0..<lineCount).contains(line), key.utf8.count <= 1024, id.utf8.count <= 1024 else { return nil }
        let check = file["check"] as? Int ?? -1
        guard check == -1 || (0..<lineCount).contains(check) else { return nil }
        result.append(Attachment(key: key, id: id, name: safeLabel(file["name"] as? String ?? "", limit: 200),
                                 label: file["label"] as? String ?? "", turn: file["turn"] as? Int ?? 0,
                                 messageId: file["messageId"] as? String ?? "", line: line, check: check))
    }
    return result
}

/// Reads the compiler's count of content checks by code; codes are the compiler's fixed names, never text.
func parseChecks(_ value: Any?) -> [String: Int] {
    guard let counts = value as? [String: Any], counts.count <= 64 else { return [:] }
    var result: [String: Int] = [:]
    for (code, count) in counts {
        guard code.range(of: "^[a-z][a-z-]{0,63}$", options: .regularExpression) != nil,
              let count = count as? Int, count > 0 else { return [:] }
        result[code] = count
    }
    return result
}

/// Reads the compiler's per-turn list; nil when malformed. Positions must run 1, 2, 3… in order.
func parseTurnList(_ value: Any?) -> [TurnInfo]? {
    guard let rows = value as? [[String: Any]], rows.count <= 5000 else { return nil }
    var result: [TurnInfo] = []
    for (index, row) in rows.enumerated() {
        guard let id = row["id"] as? String, !id.isEmpty, id.utf8.count <= 512,
              let role = row["role"] as? String, role == "user" || role == "assistant",
              row["position"] as? Int == index + 1, let hash = row["sha256"] as? String, isSHA256(hash) else { return nil }
        let files = (row["files"] as? [String] ?? []).prefix(1000).map { String($0.prefix(1024)) }
        result.append(TurnInfo(id: id, role: role, position: index + 1, preview: safeLabel(row["preview"] as? String ?? "", limit: 80),
                               sha256: hash, files: files))
    }
    return Set(result.map(\.id)).count == result.count ? result : nil
}

/// A file the conversation refers to. `key` is unique in the conversation; `id` and `messageId` are how
/// the page fetches it (a file id or sandbox path, and its message); `line` and `check` are the line
/// numbers of its file line and of its "download this file" check (-1 for none) in the Markdown.
struct Attachment {
    let key: String
    let id: String
    let name: String
    let label: String
    let turn: Int
    let messageId: String
    let line: Int
    let check: Int
}

enum SourceState {
    case waiting
    /// A reply is streaming in the page; Add waits for it to finish.
    case replying
    case ready(Prepared)
    case unavailable(String)
}

struct FileRow {
    let id: String
    let name: String
    let turn: Int
    let saved: URL?
}

/// Each saved file's line points at its local copy, and a "download this file" check goes once
/// every file it was about has a copy. When only the files kept it partial, it reads verified.
func linkFiles(_ prepared: Prepared, copies: [String: (path: URL, sha256: String)]) -> (String, String) {
    var lines = prepared.markdown.components(separatedBy: "\n")
    var linked = Set<String>(), dropped = Set<Int>()
    for file in prepared.attachments where lines.indices.contains(file.line) {
        guard let copy = copies[file.key] else { continue }
        let path = copy.path.path.contains("`") ? "`` \(copy.path.path) ``" : "`\(copy.path.path)`"
        lines[file.line] = "- \(file.label) — \(path) · sha256 \(copy.sha256)"
        linked.insert(file.key)
    }
    for check in Set(prepared.attachments.map(\.check)) where check >= 0 {
        if prepared.attachments.filter({ $0.check == check }).allSatisfy({ linked.contains($0.key) }) { dropped.insert(check) }
    }
    lines = lines.enumerated().filter { !dropped.contains($0.offset) }.map(\.element)
    if let header = lines.firstIndex(of: "## Content checks"), header > 0, header + 2 < lines.count,
       lines[header + 1].isEmpty, lines[header + 2].isEmpty {
        lines.removeSubrange(header - 1...header + 1)
    }
    let total = prepared.attachments.count
    if total > 0, linked.count == total, prepared.verifiedWithFiles, let source = lines.firstIndex(where: { $0.hasPrefix("Source: ") }) {
        lines[source] = lines[source].replacingOccurrences(of: " · verification: partial", with: " · verification: verified")
    }
    return (lines.joined(separator: "\n"), total == 0 ? "" : linked.count == total ? "\(total) file\(total == 1 ? "" : "s") linked."
            : "\(linked.count) of \(total) files linked; the rest are references (download them from the Files list).")
}

/// What the compiler gave for a choice of turns.
enum ProjectionResult {
    case success(ProjectedText)
    case failure(String)
}
