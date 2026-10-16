import CryptoKit
import Foundation

// The delivery log and the scope rule, with synthetic turns and a throwaway file. No UI, no AX.
// Rows named "WO" are the logic rows of the acceptance matrix in docs/workorders/WO-01-incremental-handoff.md.
@main enum DeliveryTests {
    static var checks = 0
    static func check(_ condition: Bool, _ label: String) {
        guard condition else { print("FAIL: \(label)"); exit(1) }
        checks += 1
    }

    static func hash(_ seed: String) -> String {
        SHA256.hash(data: Data(seed.utf8)).map { String(format: "%02x", $0) }.joined()
    }
    static func turns(_ count: Int, edited: Set<Int> = []) -> [TurnInfo] {
        (1...count).map { position in
            TurnInfo(id: "m\(position)", role: position % 2 == 1 ? "user" : "assistant", position: position,
                     preview: "Synthetic turn \(position)", sha256: hash("m\(position)" + (edited.contains(position) ? "edited" : "")),
                     files: position == 4 ? ["1:file-a"] : [])
        }
    }
    static let claude = "com.anthropic.claudefordesktop"
    static func verified(_ id: String) -> TargetIdentity { TargetIdentity(app: claude, conversation: "claude.ai/chat/\(id)", confidence: .verified) }

    final class Clock { var now = Date(timeIntervalSince1970: 1_800_000_000) }

    static func memoryLog(_ clock: Clock = Clock()) -> DeliveryLog {
        DeliveryLog(file: nil, remember: { false }, retentionDays: { 30 }, now: { clock.now })
    }

    /// One Add that ends in `state`; returns its receipt.
    @discardableResult
    static func add(_ log: DeliveryLog, _ turns: [TurnInfo], source: String = "S1", target: TargetIdentity, mode: String = "all",
                    ending state: DeliveryState = .composerInserted) -> String {
        let id = log.begin(source: source, target: target, mode: mode, turns: turns, attachments: turns.flatMap(\.files))
        check(log.move(id, to: .insertionAttempted), "prepared → insertion_attempted")
        if state != .insertionAttempted { check(log.move(id, to: state), "insertion_attempted → \(state)") }
        return id
    }

    static func scope(_ log: DeliveryLog, _ turns: [TurnInfo], source: String? = "S1", target: TargetIdentity?,
                      choice: ScopeChoice = .auto) -> (ScopeAnalysis, ResolvedScope) {
        let analysis = analyzeScope(turns: turns, source: source, target: target, records: log.records)
        return (analysis, resolveScope(choice, turns: turns, analysis: analysis))
    }

    static func main() {
        stateMachine()
        acceptanceMatrix()
        identities()
        persistence()
        print("PASS: \(checks) delivery-log and scope checks")
    }

    static func stateMachine() {
        let log = memoryLog()
        let target = verified("t")
        let id = log.begin(source: "S1", target: target, mode: "all", turns: turns(2), attachments: [])
        check(log.record(id)?.state == .prepared, "a receipt starts prepared")
        check(!log.move(id, to: .composerInserted), "prepared cannot jump to composer_inserted")
        check(!log.move(id, to: .unknown), "prepared cannot become unknown")
        check(log.move(id, to: .insertionAttempted), "prepared → insertion_attempted")
        check(!log.move(id, to: .composerInserted, byUser: true), "the user cannot settle an attempt still running")
        check(log.move(id, to: .unknown), "insertion_attempted → unknown")
        check(!log.move(id, to: .composerInserted), "unknown does not turn into inserted by itself")
        check(log.move(id, to: .composerInserted, byUser: true) && log.record(id)?.confirmedByUser == true,
              "unknown → composer_inserted only by the user's answer, and marked so")
        check(!log.move(id, to: .failed, byUser: true), "an inserted receipt is final")
        check(!log.move("missing", to: .failed), "an unknown receipt id is refused")
    }

    static func acceptanceMatrix() {
        let target = verified("11111111-1111-1111-1111-111111111111")
        // WO: new source → new target: everything.
        do {
            let (analysis, scope) = scope(memoryLog(), turns(42), target: target)
            check(!analysis.newApplicable && scope.mode == "all" && scope.turns.count == 42 && scope.everything && scope.label == "All · 42",
                  "WO new source → new target: All")
        }
        // WO: same source → the same verified target after a successful insertion: only what follows.
        let log = memoryLog()
        add(log, turns(36), target: target)
        do {
            let (analysis, scope) = scope(log, turns(42), target: target)
            check(analysis.newApplicable && scope.mode == "new" && scope.turns.map(\.position) == Array(37...42),
                  "WO same source → confirmed same target: turns after the last added")
            check(scope.label == "New · 6" && scope.detail == "Turns 37–42 of 42 · new since last add", "the range is visible: \(scope.detail)")
            check(scope.note == "new since last add" && !scope.everything, "the text gets the scope line")
        }
        // WO: same source → another target: everything, and the first target keeps its progress.
        do {
            let (_, other) = scope(log, turns(42), target: verified("22222222-2222-2222-2222-222222222222"))
            let (_, first) = scope(log, turns(42), target: target)
            check(other.mode == "all" && other.turns.count == 42 && first.turns.count == 6, "WO same source → new target: All; old target kept")
        }
        // WO: the same window now shows another conversation: its id differs, nothing carries over.
        do {
            let (_, scope) = scope(log, turns(42), target: verified("33333333-3333-3333-3333-333333333333"))
            check(scope.mode == "all", "WO target conversation changed in the same window: no carried-over increment")
        }
        // WO: no stable identity: nothing is guessed; only the user's explicit binding enables New.
        do {
            let session = TargetIdentity(app: claude, conversation: "window:abc", confidence: .unconfirmed)
            let unbound = memoryLog()
            add(unbound, turns(10), target: session)
            let (analysis, scope) = scope(unbound, turns(12), target: session)
            check(!analysis.newApplicable && scope.mode == "all" && analysis.added.count == 10,
                  "WO no stable target identity: All by default, though the session knows what it added")
            let bound = TargetIdentity(app: claude, conversation: "window:abc", confidence: .confirmed)
            let (_, after) = Self.scope(unbound, turns(12), target: bound)
            check(after.mode == "new" && after.turns.map(\.position) == [11, 12], "an explicit binding enables New for that window session")
            let (_, newChoice) = Self.scope(unbound, turns(12), target: session, choice: .new)
            check(newChoice.mode == "all", "New cannot be forced for an unconfirmed target")
            let (_, none) = Self.scope(unbound, turns(12), source: nil, target: bound)
            check(none.mode == "all", "a chat without an id has no history")
        }
        // WO: manual, non-contiguous choice: source order; skipped turns are not counted as delivered.
        do {
            let manual = memoryLog()
            let all = turns(10)
            let (_, chosen) = scope(manual, all, target: target, choice: .chosen(["m9", "m3", "m5", "m6"]))
            check(chosen.turns.map(\.position) == [3, 5, 6, 9] && chosen.label == "4 selected"
                  && chosen.detail == "Turns 3, 5–6, 9 of 10 · chosen", "WO manual choice in source order: \(chosen.detail)")
            add(manual, chosen.turns, target: target, mode: "chosen")
            let (analysis, next) = scope(manual, turns(12), target: target)
            check(next.turns.map(\.position) == [10, 11, 12] && analysis.neverAdded == 5,
                  "next New starts after the last added position; skipped turns stay unsent")
            check(next.detail.hasSuffix("5 earlier turns were never added"), "the range says what was never added: \(next.detail)")
            check(!analysis.added.contains("m4") && analysis.added.contains("m5"), "only chosen turns count as added")
        }
        // WO: an edited or regenerated turn: its hash differs; it is reported and offered, not re-sent.
        do {
            let changed = memoryLog()
            add(changed, turns(8), target: target)
            let edited = turns(10, edited: [3, 7])
            let (analysis, scope) = scope(changed, edited, target: target)
            check(analysis.changedTurns.map(\.position) == [3, 7] && scope.turns.map(\.position) == [9, 10],
                  "WO changed text detected by hash and kept out of New")
            check(scope.detail.contains("2 earlier turns changed since added"), "the change is reported: \(scope.detail)")
            let (_, both) = Self.scope(changed, edited, target: target, choice: .newAndChanged)
            check(both.turns.map(\.position) == [3, 7, 9, 10] && both.note == "new and changed since last add", "changed turns are offered on request")
            check(!analysis.added.contains("m3") && analysis.added.contains("m4"), "a changed turn is not marked added")
            // A regenerated answer has a new id: it is simply new.
            var regenerated = turns(8)
            regenerated[7] = TurnInfo(id: "m8b", role: "assistant", position: 8, preview: "", sha256: hash("m8b"), files: [])
            let (_, again) = Self.scope(changed, regenerated, target: target)
            check(again.turns.map(\.id) == ["m8b"], "a regenerated last answer is offered as new")
        }
        // WO: prepared but the paste failed; and a result that could not be confirmed.
        do {
            let failing = memoryLog()
            add(failing, turns(5), target: target)
            add(failing, Array(turns(9)[5...]), target: target, mode: "new", ending: .failed)
            let (_, scope) = scope(failing, turns(9), target: target)
            check(scope.turns.map(\.position) == [6, 7, 8, 9], "WO paste failed: the cursor does not move; retry offers the same turns")
            let unknown = add(failing, Array(turns(9)[5...]), target: target, mode: "new", ending: .unknown)
            check(Self.scope(failing, turns(9), target: target).1.turns.count == 4, "WO unconfirmed paste: unknown is not inserted")
            check(failing.move(unknown, to: .composerInserted, byUser: true), "the user can say it is there")
            check(Self.scope(failing, turns(9), target: target).1.turns.isEmpty, "then it counts as added")
            add(failing, turns(9), target: target, ending: .insertionAttempted)
            check(Self.scope(failing, turns(9), target: target).1.turns.isEmpty, "an attempt still running counts for nothing")
        }
        // WO: added, then the draft was cleared or not sent: Add again is explicit, never silent.
        do {
            let again = memoryLog()
            add(again, turns(6), target: target)
            let (analysis, auto) = scope(again, turns(6), target: target)
            check(auto.mode == "new" && auto.turns.isEmpty && auto.detail == "Nothing new since last add" && analysis.lastBatch.count == 6,
                  "WO after an add nothing is new; the last batch is offered again on request")
            let batch = resolveScope(.again, turns: turns(6), analysis: analysis)
            check(batch.turns.count == 6 && batch.note == "added again" && batch.everything, "Add again re-adds the last batch")
            let (_, all) = scope(again, turns(6), target: target, choice: .all)
            check(isAlreadyAdded(all, analysis: analysis), "WO repeated Add of an unchanged, just-added scope asks first")
            check(!isAlreadyAdded(batch, analysis: analysis), "an explicit Add again does not ask twice")
            let (editedAnalysis, editedAll) = scope(again, turns(6, edited: [2]), target: target, choice: .all)
            check(!isAlreadyAdded(editedAll, analysis: editedAnalysis), "a changed turn makes it a different scope")
        }
        // WO: one source, several targets at once: independent mappings.
        do {
            let parallel = memoryLog()
            let a = verified("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"), b = verified("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb")
            add(parallel, turns(4), target: a)
            add(parallel, turns(7), target: b)
            add(parallel, turns(3), source: "S2", target: a)
            check(scope(parallel, turns(9), target: a).1.turns.map(\.position) == [5, 6, 7, 8, 9]
                  && scope(parallel, turns(9), target: b).1.turns.map(\.position) == [8, 9]
                  && scope(parallel, turns(9), source: "S2", target: a).1.turns.map(\.position) == [4, 5, 6, 7, 8, 9],
                  "WO same source to several targets, and several sources to one target, stay independent")
            let otherApp = TargetIdentity(app: "com.example.other", conversation: a.conversation, confidence: .verified)
            check(scope(parallel, turns(9), target: otherApp).1.mode == "all", "the target app is part of its identity")
        }
        // WO: files go with their turns.
        do {
            let files = memoryLog()
            let id = add(files, turns(5), target: target)
            check(files.record(id)?.attachments == ["1:file-a"], "WO the receipt names the files carried with its turns")
        }
    }

    static func identities() {
        check(targetConversationId("https://claude.ai/chat/0F8FAD5B-D9CB-469F-A165-70867728950E") == "claude.ai/chat/0f8fad5b-d9cb-469f-a165-70867728950e",
              "a Claude conversation URL names its conversation")
        check(targetConversationId("https://claude.ai/epitaxy/local_CC1B9807-0BEA-492F-B51A-627F236C886E") == "claude.ai/epitaxy/local_cc1b9807-0bea-492f-b51a-627f236c886e"
              && targetConversationId("https://claude.ai/epitaxy/cc1b9807-0bea-492f-b51a-627f236c886e/") == "claude.ai/epitaxy/cc1b9807-0bea-492f-b51a-627f236c886e",
              "a Claude Code session in Claude for Mac names its session")
        for url in ["https://claude.ai/new", "https://claude.ai/chat/", "https://claude.ai/chat/not-a-uuid", "http://claude.ai/chat/0f8fad5b-d9cb-469f-a165-70867728950e",
                    "https://evil.example/chat/0f8fad5b-d9cb-469f-a165-70867728950e", "https://claude.ai.evil.example/chat/0f8fad5b-d9cb-469f-a165-70867728950e",
                    "https://user@claude.ai/chat/0f8fad5b-d9cb-469f-a165-70867728950e", "https://claude.ai/epitaxy/local_not-a-uuid",
                    "https://claude.ai/epitaxy/", "file:///Applications/Claude.app/Contents/Resources/app.asar/.vite/renderer/main_window/index.html", "Claude", ""] {
            check(targetConversationId(url) == nil, "no conversation id in \(url)")
        }
        check(sourceConversationId("https://chatgpt.com/c/6acb722f-383c") == "6acb722f-383c", "ChatGPT conversation id")
        check(sourceConversationId("https://chatgpt.com/g/g-abc/c/xyz") == "xyz", "a GPT's conversation id")
        check(sourceConversationId("https://chatgpt.com/") == nil && sourceConversationId("https://example.com/c/x") == nil, "no id for a new chat or another host")
        check(turnsText([3, 5, 6, 7, 8, 9], of: 42) == "Turns 3, 5–9 of 42" && turnsText([15], of: 42) == "Turn 15 of 42", "ranges read as in the text")
    }

    static func persistence() {
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent("gh-delivery-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: folder) }
        let file = folder.appendingPathComponent("add-to-claude/delivery-log.json")
        let clock = Clock()
        var remember = true
        var days = 30
        let make = { DeliveryLog(file: file, remember: { remember }, retentionDays: { days }, now: { clock.now }) }
        let log = make()
        let target = verified("44444444-4444-4444-4444-444444444444")
        let secret = turns(3).map { TurnInfo(id: $0.id, role: $0.role, position: $0.position, preview: "SECRET PREVIEW \($0.position)",
                                             sha256: $0.sha256, files: $0.files) }
        add(log, secret, target: target)
        add(log, secret, target: TargetIdentity(app: claude, conversation: "window:xyz", confidence: .confirmed))
        let pending = log.begin(source: "S1", target: target, mode: "new", turns: secret, attachments: [])
        log.move(pending, to: .insertionAttempted)
        let data = (try? Data(contentsOf: file)) ?? Data()
        let text = String(decoding: data, as: UTF8.self)
        check(!data.isEmpty && !text.contains("SECRET") && !text.contains("Synthetic"), "the file holds no message text")
        check(text.contains("\"composer_inserted\"") && text.contains("\"content_sha256\"") && text.contains("\"identity_confidence\":\"verified\""),
              "the file holds states, hashes and the target's confidence")
        check(!text.contains("window:xyz"), "window-session receipts stay in memory")
        let attributes = try? FileManager.default.attributesOfItem(atPath: file.path)
        check((attributes?[.posixPermissions] as? Int) == 0o600, "the file is private to the user")

        // A new launch: what was added is known; an attempt left running is now unknown, not inserted.
        let reopened = make()
        reopened.load()
        check(reopened.records.count == 1 && reopened.records[0].state == .composerInserted, "a launch reads back the finished verified receipts")
        check(analyzeScope(turns: turns(5), source: "S1", target: target, records: reopened.records).newTurns.map(\.position) == [4, 5],
              "after a relaunch New continues from the file")

        // Retention: older than the period is dropped at launch.
        clock.now = clock.now.addingTimeInterval(31 * 86400)
        let later = make()
        later.load()
        check(later.records.isEmpty, "receipts older than 30 days are pruned at launch")
        check(String(decoding: (try? Data(contentsOf: file)) ?? Data(), as: UTF8.self) == "[]", "and from the file")
        days = 90
        add(later, secret, target: target)
        clock.now = clock.now.addingTimeInterval(60 * 86400)
        later.prune()
        check(later.records.count == 1, "a longer retention keeps them")

        // Off: nothing on disk; on again writes what is known; Clear forgets everything.
        remember = false
        later.preferencesChanged()
        check(!FileManager.default.fileExists(atPath: file.path), "turning off Remember removes the file")
        add(later, secret, target: target)
        check(!FileManager.default.fileExists(atPath: file.path), "and nothing is written while it is off")
        remember = true
        later.preferencesChanged()
        check(FileManager.default.fileExists(atPath: file.path), "turning it on writes what is known")
        later.clear()
        check(later.records.isEmpty && !FileManager.default.fileExists(atPath: file.path), "Clear history forgets everything")

        // A damaged or foreign file is ignored, not trusted.
        try? FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
        try? Data(#"[{"handoff_id":"x","source":{"provider":"chatgpt","conversation_id":"S1"},"target":{"provider":"a","conversation_id":"b","identity_confidence":"verified"},"mode":"all","messages":[{"id":"m1","position":1,"content_sha256":"zz"}],"attachments":[],"state":"composer_inserted","created_at":"2027-04-16T07:00:00Z","updated_at":"2027-04-16T07:00:00Z","confirmed_by_user":false}]"#.utf8).write(to: file)
        let damaged = make()
        damaged.load()
        check(damaged.records.isEmpty, "a receipt with a malformed hash is dropped")
        try? Data("not json".utf8).write(to: file)
        let garbage = make()
        garbage.load()
        check(garbage.records.isEmpty, "an unreadable file starts an empty log")
    }
}
