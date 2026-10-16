import Foundation

// What was added where, and which turns Add offers next. Pure logic plus a small JSON file; no UI.
// The log holds ids, positions, hashes, states, times and target ids. Never message text.

/// One turn as the compiler describes it: id, role, 1-based position, a one-line preview, the
/// SHA-256 of its projected body, and the keys of its files.
struct TurnInfo: Equatable {
    let id: String
    let role: String
    let position: Int
    let preview: String
    let sha256: String
    let files: [String]
}

/// How sure the app is which conversation a target window shows.
/// `verified`: the window names it (a conversation id in its page URL). `confirmed`: the user said
/// "Continue in this conversation" for this window session. `unconfirmed`: neither; nothing is inferred.
enum Confidence: String, Codable { case verified, confirmed, unconfirmed }

struct TargetIdentity: Equatable {
    /// The target app's bundle identifier.
    let app: String
    /// `claude.ai/chat/<uuid>` when verified; otherwise `window:<uuid>`, one per window session.
    let conversation: String
    let confidence: Confidence
}

/// prepared → insertion_attempted → composer_inserted | failed | unknown. Only composer_inserted counts
/// as added. An unknown result moves on only when the user says what they see in the draft.
enum DeliveryState: String, Codable {
    case prepared
    case insertionAttempted = "insertion_attempted"
    case composerInserted = "composer_inserted"
    case failed
    case unknown

    func canMove(to next: DeliveryState, byUser: Bool) -> Bool {
        switch (self, next) {
        case (.prepared, .insertionAttempted), (.prepared, .failed): return !byUser
        case (.insertionAttempted, .composerInserted), (.insertionAttempted, .failed), (.insertionAttempted, .unknown): return !byUser
        case (.unknown, .composerInserted), (.unknown, .failed): return byUser
        default: return false
        }
    }
}

struct DeliveryRecord: Codable, Equatable {
    struct Source: Codable, Equatable { var provider: String; var conversationId: String }
    struct Target: Codable, Equatable { var provider: String; var conversationId: String; var identityConfidence: Confidence }
    struct Message: Codable, Equatable { var id: String; var position: Int; var contentSha256: String }
    var handoffId: String
    var source: Source
    var target: Target
    /// all, new, new_and_changed, chosen or again.
    var mode: String
    var messages: [Message]
    /// File keys carried with these turns.
    var attachments: [String]
    var state: DeliveryState
    var createdAt: Date
    var updatedAt: Date
    /// Set when the state came from the user's answer to "Could not confirm".
    var confirmedByUser: Bool

    fileprivate var isValid: Bool {
        let short = { (text: String) in !text.isEmpty && text.utf8.count <= 512 }
        return short(handoffId) && short(source.provider) && short(source.conversationId) && short(target.provider)
            && short(target.conversationId) && short(mode) && messages.count <= 5000 && attachments.count <= 1000
            && messages.allSatisfy { short($0.id) && $0.position > 0 && isSHA256($0.contentSha256) }
            && attachments.allSatisfy(short)
    }
}

func isSHA256(_ text: String) -> Bool {
    text.utf8.count == 64 && text.utf8.allSatisfy { (48...57).contains($0) || (97...102).contains($0) }
}

/// The ChatGPT conversation id in a page URL (`/c/<id>` or `/g/<gpt>/c/<id>`), or nil for a new chat.
func sourceConversationId(_ page: String) -> String? {
    guard let url = URL(string: page), url.scheme == "https", ["chatgpt.com", "chat.openai.com"].contains(url.host ?? ""),
          let match = url.path.range(of: #"^/(?:g/[A-Za-z0-9_-]{1,200}/)?c/[A-Za-z0-9_-]{1,200}/?$"#, options: .regularExpression)
    else { return nil }
    let path = url.path[match].split(separator: "/")
    return path.last.map(String.init)
}

/// The Settings keys for history: "Remember what was added" (default on) and how many days to keep it.
enum HistoryKeys {
    static let remember = "RememberAdded"
    static let days = "HistoryDays"
    static let defaults: [String: Any] = [remember: true, days: 30]
}

/// Delivery receipts in memory, and the verified ones in a small JSON file when the user keeps history.
final class DeliveryLog {
    static let shared = DeliveryLog(file: DeliveryLog.defaultFile,
                                    remember: { UserDefaults.standard.bool(forKey: HistoryKeys.remember) },
                                    retentionDays: { UserDefaults.standard.integer(forKey: HistoryKeys.days) })
    static let maximumRecords = 2000

    /// ~/Library/Application Support/add-to-claude/delivery-log.json
    static var defaultFile: URL? {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first?
            .appendingPathComponent("add-to-claude", isDirectory: true).appendingPathComponent("delivery-log.json")
    }

    private(set) var records: [DeliveryRecord] = []
    let file: URL?
    private let remember: () -> Bool
    private let retentionDays: () -> Int
    private let now: () -> Date

    init(file: URL?, remember: @escaping () -> Bool, retentionDays: @escaping () -> Int, now: @escaping () -> Date = Date.init) {
        self.file = file
        self.remember = remember
        self.retentionDays = retentionDays
        self.now = now
    }

    private static let encoder: JSONEncoder = {
        let encoder = JSONEncoder()
        encoder.keyEncodingStrategy = .convertToSnakeCase
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.sortedKeys]
        return encoder
    }()
    private static let decoder: JSONDecoder = {
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }()

    /// At launch: read the file, drop what is past retention or malformed, and mark receipts a previous
    /// run left mid-way as unknown, since nobody saw how they ended.
    func load() {
        guard remember(), let file, let data = try? Data(contentsOf: file), data.count <= 16 * 1024 * 1024,
              let stored = try? Self.decoder.decode([DeliveryRecord].self, from: data) else { return prune() }
        let ours = Set(records.map(\.handoffId))
        records = stored.filter { $0.isValid && !ours.contains($0.handoffId) }.map { record in
            var record = record
            if record.state == .prepared || record.state == .insertionAttempted { record.state = .unknown }
            return record
        } + records
        prune()
    }

    /// A new receipt in the prepared state; returns its id.
    func begin(source: String, target: TargetIdentity, mode: String, turns: [TurnInfo], attachments: [String]) -> String {
        let id = UUID().uuidString.lowercased()
        let time = now()
        records.append(DeliveryRecord(handoffId: id, source: .init(provider: "chatgpt", conversationId: source),
                                      target: .init(provider: target.app, conversationId: target.conversation,
                                                    identityConfidence: target.confidence),
                                      mode: mode,
                                      messages: turns.map { .init(id: $0.id, position: $0.position, contentSha256: $0.sha256) },
                                      attachments: attachments, state: .prepared, createdAt: time, updatedAt: time,
                                      confirmedByUser: false))
        if records.count > Self.maximumRecords { records.removeFirst(records.count - Self.maximumRecords) }
        return id
    }

    /// Moves a receipt along; refuses any move the state machine does not allow.
    @discardableResult
    func move(_ id: String, to next: DeliveryState, byUser: Bool = false) -> Bool {
        guard let index = records.firstIndex(where: { $0.handoffId == id }),
              records[index].state.canMove(to: next, byUser: byUser) else { return false }
        records[index].state = next
        records[index].updatedAt = now()
        records[index].confirmedByUser = byUser
        if next == .composerInserted || next == .failed || next == .unknown { save() }
        return true
    }

    func record(_ id: String) -> DeliveryRecord? { records.first { $0.handoffId == id } }

    /// Drops receipts older than the retention period; in memory, and in the file.
    func prune() {
        let days = max(1, retentionDays())
        let cutoff = now().addingTimeInterval(-Double(days) * 86400)
        records.removeAll { $0.updatedAt < cutoff }
        save()
    }

    /// Forgets everything, in memory and on disk.
    func clear() {
        records.removeAll()
        if let file { try? FileManager.default.removeItem(at: file) }
    }

    /// Called when "Remember what was added" changes: off removes the file, on writes what is known.
    func preferencesChanged() {
        if remember() { save() } else if let file { try? FileManager.default.removeItem(at: file) }
    }

    /// Only receipts for a verified target conversation are worth keeping across launches: a window
    /// session's id means nothing after it closes. Finished receipts only.
    private func save() {
        guard remember(), let file else { return }
        let kept = records.filter { $0.target.identityConfidence == .verified && $0.state != .prepared && $0.state != .insertionAttempted }
        do {
            let folder = file.deletingLastPathComponent()
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true,
                                                    attributes: [.posixPermissions: 0o700])
            try Self.encoder.encode(kept).write(to: file, options: .atomic)
            try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: file.path)
        } catch {}
    }
}

// MARK: scope

/// What the user picked in the scope menu. Never saved: it is reset after each Add and whenever the
/// source conversation or the target changes.
enum ScopeChoice: Equatable {
    case auto, all, new, newAndChanged
    /// Turn ids, in source order.
    case chosen([String])
    /// The last batch, once more, after "Add again?".
    case again
}

/// What the log says about this source conversation in this target.
struct ScopeAnalysis: Equatable {
    /// Same source, a verified or confirmed target, and a successful insertion there.
    let newApplicable: Bool
    /// Turns after the furthest position added there.
    let newTurns: [TurnInfo]
    /// Turns at or before it that were added with another text.
    let changedTurns: [TurnInfo]
    /// Turns at or before it that were never added (skipped by a manual choice).
    let neverAdded: Int
    /// Turns added there with the text they have now.
    let added: Set<String>
    /// The last inserted batch, as far as its turns still exist unchanged.
    let lastBatch: [TurnInfo]
}

/// Rule 1: a new or unconfirmed target gets every turn; the same source in a verified (or user
/// confirmed) target conversation with a successful insertion gets the turns after the furthest one
/// added. Receipts in any other state never count. Ids and hashes decide; nothing else is inferred.
func analyzeScope(turns: [TurnInfo], source: String?, target: TargetIdentity?, records: [DeliveryRecord]) -> ScopeAnalysis {
    guard let source, let target else {
        return ScopeAnalysis(newApplicable: false, newTurns: turns, changedTurns: [], neverAdded: 0, added: [], lastBatch: [])
    }
    let inserted = records.filter {
        $0.state == .composerInserted && $0.source.conversationId == source
            && $0.target.provider == target.app && $0.target.conversationId == target.conversation
    }.sorted { $0.updatedAt < $1.updatedAt }
    // The latest hash each turn was added with.
    var addedHash: [String: String] = [:]
    for record in inserted { for message in record.messages { addedHash[message.id] = message.contentSha256 } }
    let present = turns.filter { addedHash[$0.id] != nil }
    let cursor = present.map(\.position).max()
    let added = Set(present.filter { addedHash[$0.id] == $0.sha256 }.map(\.id))
    let last = inserted.last.map { record in
        record.messages.compactMap { message in turns.first { $0.id == message.id && $0.sha256 == message.contentSha256 } }
    } ?? []
    guard let cursor else {
        return ScopeAnalysis(newApplicable: false, newTurns: turns, changedTurns: [], neverAdded: 0, added: added, lastBatch: last)
    }
    let earlier = turns.filter { $0.position <= cursor }
    return ScopeAnalysis(newApplicable: target.confidence != .unconfirmed,
                         newTurns: turns.filter { $0.position > cursor },
                         changedTurns: earlier.filter { turn in addedHash[turn.id].map { $0 != turn.sha256 } ?? false },
                         neverAdded: earlier.filter { addedHash[$0.id] == nil }.count,
                         added: added, lastBatch: last)
}

/// A scope choice made concrete: which turns, the note for the hand-off text, and what the bar says.
struct ResolvedScope: Equatable {
    /// What the receipt calls it: all, new, new_and_changed, chosen or again.
    let mode: String
    let turns: [TurnInfo]
    /// The scope line's note in the hand-off text (see SCOPE_NOTES in src/model.js).
    let note: String
    /// Whether these are all the turns, so the whole prepared text applies.
    let everything: Bool
    /// Short label on the scope control: "New · 6", "All · 42", "3 selected".
    let label: String
    /// One line on what it covers and what the log knows.
    let detail: String
    let automatic: Bool
}

func resolveScope(_ choice: ScopeChoice, turns: [TurnInfo], analysis: ScopeAnalysis) -> ResolvedScope {
    let automatic = choice == .auto
    var effective = choice == .auto ? (analysis.newApplicable ? .new : .all) : choice
    if (effective == .new || effective == .newAndChanged) && !analysis.newApplicable { effective = .all }
    if effective == .newAndChanged && analysis.changedTurns.isEmpty { effective = .new }
    let total = turns.count
    var notes: [String] = []
    if analysis.neverAdded > 0 { notes.append("\(analysis.neverAdded) earlier turn\(analysis.neverAdded == 1 ? " was" : "s were") never added") }
    let changed = analysis.changedTurns.count
    switch effective {
    case .new, .auto:
        if changed > 0 { notes.insert("\(changed) earlier turn\(changed == 1 ? "" : "s") changed since added", at: 0) }
        let chosen = analysis.newTurns
        let which = chosen.isEmpty ? "Nothing new since last add" : turnsText(chosen.map(\.position), of: total) + " · new since last add"
        return ResolvedScope(mode: "new", turns: chosen, note: "new since last add", everything: false,
                             label: "New · \(chosen.count)", detail: ([which] + notes).joined(separator: " · "), automatic: automatic)
    case .newAndChanged:
        let ids = Set((analysis.changedTurns + analysis.newTurns).map(\.id))
        let chosen = turns.filter { ids.contains($0.id) }
        return ResolvedScope(mode: "new_and_changed", turns: chosen, note: "new and changed since last add", everything: chosen.count == total,
                             label: "New + changed · \(chosen.count)",
                             detail: ([turnsText(chosen.map(\.position), of: total) + " · new and changed since last add"] + notes)
                                .joined(separator: " · "), automatic: false)
    case .all:
        return ResolvedScope(mode: "all", turns: turns, note: "", everything: true, label: "All · \(total)",
                             detail: "All \(total) turn\(total == 1 ? "" : "s")", automatic: automatic)
    case .chosen(let ids):
        let set = Set(ids)
        let chosen = turns.filter { set.contains($0.id) }
        return ResolvedScope(mode: "chosen", turns: chosen, note: "chosen", everything: chosen.count == total && total > 0,
                             label: "\(chosen.count) selected",
                             detail: chosen.isEmpty ? "No turns chosen" : turnsText(chosen.map(\.position), of: total) + " · chosen",
                             automatic: false)
    case .again:
        let chosen = analysis.lastBatch
        return ResolvedScope(mode: "again", turns: chosen, note: "added again", everything: chosen.count == total && total > 0,
                             label: "Again · \(chosen.count)",
                             detail: turnsText(chosen.map(\.position), of: total) + " · added again", automatic: false)
    }
}

/// Whether this exact set of turns, with this exact text, is what was last inserted into the target.
func isAlreadyAdded(_ scope: ResolvedScope, analysis: ScopeAnalysis) -> Bool {
    guard !scope.turns.isEmpty, scope.mode != "again" else { return false }
    let key = { (turns: [TurnInfo]) in Set(turns.map { $0.id + "|" + $0.sha256 }) }
    return key(scope.turns) == key(analysis.lastBatch) && scope.turns.count == analysis.lastBatch.count
}

/// "Turn 15 of 42", "Turns 15–21 of 42", "Turns 3, 5–9 of 42": the same wording as the text's scope line.
func turnsText(_ positions: [Int], of total: Int) -> String {
    guard let first = positions.first, let last = positions.last else { return "No turns" }
    if positions.count == 1 { return "Turn \(first) of \(total)" }
    if last - first == positions.count - 1 { return "Turns \(first)–\(last) of \(total)" }
    var parts: [String] = [], index = 0
    while index < positions.count {
        var end = index
        while end + 1 < positions.count && positions[end + 1] == positions[end] + 1 { end += 1 }
        parts.append(end == index ? "\(positions[index])" : "\(positions[index])–\(positions[end])")
        index = end + 1
    }
    return "Turns \(parts.joined(separator: ", ")) of \(total)"
}
