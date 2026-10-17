import AppKit
import WebKit

// The real ChatController in a real WKWebView, with a synthetic page served from memory at a
// chatgpt.com URL. No network: the page posts what the observer would post.
@main enum WebKitTests {
    static var checks = 0
    static func check(_ condition: Bool, _ label: String) {
        guard condition else { print("FAIL: \(label)"); exit(1) }
        checks += 1
    }
    static func pump(until done: () -> Bool, _ label: String) {
        let deadline = Date().addingTimeInterval(10)
        while !done() && Date() < deadline { RunLoop.main.run(until: Date().addingTimeInterval(0.02)) }
        check(done(), label)
    }
    static func evaluate(_ web: WKWebView, _ script: String, in world: WKContentWorld = .page) -> Any? {
        var result: Any?, finished = false
        web.evaluateJavaScript(script, in: nil, in: world) { outcome in
            if case .success(let value) = outcome { result = value }
            finished = true
        }
        pump(until: { finished }, "evaluate \(script.prefix(40))")
        return result
    }

    static let conversation = #"{"conversation_id":"one","title":"Synthetic chat","current_node":"a","mapping":{"root":{"parent":null,"children":["u"],"message":null},"u":{"parent":"root","children":["a"],"message":{"id":"u","author":{"role":"user"},"status":"finished_successfully","content":{"content_type":"text","parts":["Synthetic question."]}}},"a":{"parent":"u","children":[],"message":{"id":"a","author":{"role":"assistant"},"status":"finished_successfully","end_turn":true,"content":{"content_type":"text","parts":["Original **Markdown** 中文 ✓\n"]}}}}}"#

    static func forge(_ web: WKWebView) {
        let literal = String(data: try! JSONSerialization.data(withJSONObject: [conversation], options: .fragmentsAllowed), encoding: .utf8)!
        let packet = "{ kind: 'response', pageUrl: location.origin + location.pathname, responseUrl: location.origin + '/backend-api/conversation/one', capturedAt: new Date().toISOString(), method: 'GET', body: \(literal.dropFirst().dropLast()) }"
        _ = evaluate(web, """
            window.postMessage({ type: 'add-to-claude/source', packet: \(packet) }, location.origin);
            const channel = new MessageChannel();
            window.postMessage({ type: 'add-to-claude/port' }, location.origin, [channel.port2]);
            channel.port1.postMessage(\(packet)); true
            """)
    }

    /// Two turns made files with the same name; each line gets its own copy, and the shared check goes
    /// only when both have one.
    /// A hand-off's trace reaches the exported report as counts and stage names only.
    static func diagnostics() {
        let trace = HandoffTrace()
        trace.record(.started, turns: 3, scope: "new", target: "com.example.target")
        trace.record(.inserted)
        let report = (try? Diagnostics.sessionReport()) ?? ""
        check(report.contains("op=\(trace.id) stage=started") && report.contains("turns=3") && report.contains("op=\(trace.id) stage=inserted"),
              "the diagnostics report carries this session's hand-off stages")
        check(report.contains("No message text"), "the report says what it never records")
    }

    static func linkedFiles() {
        let markdown = ["# Charts", "", "Source: <https://chatgpt.com/c/two> · 4 turns · verification: partial", "<!-- b -->",
                        "", "## Content checks", "", "- chart.png: download this file…", "", "## Turn 2 — Assistant", "",
                        "### Files", "", "- chart.png — download-needed", "", "## Turn 4 — Assistant", "", "### Files", "",
                        "- chart.png — download-needed", ""].joined(separator: "\n")
        let files = [Attachment(key: "1:a", id: "sandbox:/mnt/data/chart.png", name: "chart.png", label: "chart.png", turn: 2,
                                messageId: "a1", line: 13, check: 7),
                     Attachment(key: "2:b", id: "sandbox:/mnt/data/chart.png", name: "chart.png", label: "chart.png", turn: 4,
                                messageId: "a2", line: 19, check: 7)]
        let prepared = Prepared(revision: UUID(), page: "https://chatgpt.com/c/two", markdown: markdown, title: "Charts", turns: 4,
                                files: 2, verification: "partial", issues: [], attachments: files, verifiedWithFiles: true)
        let one = linkFiles(prepared, copies: ["1:a": (URL(fileURLWithPath: "/f/chart.png"), "aa")]).0
        check(one.contains("- chart.png — `/f/chart.png` · sha256 aa") && one.contains("- chart.png — download-needed")
              && one.contains("## Content checks") && one.contains("verification: partial"),
              "one of two same-name files linked keeps the other reference and the check")
        let both = linkFiles(prepared, copies: ["1:a": (URL(fileURLWithPath: "/f/chart.png"), "aa"),
                                                "2:b": (URL(fileURLWithPath: "/f/chart 2.png"), "bb")]).0
        check(both.contains("`/f/chart.png` · sha256 aa") && both.contains("`/f/chart 2.png` · sha256 bb")
              && !both.contains("Content checks") && both.contains("verification: verified")
              && !both.contains("\n\n\n"), "both linked: each its own copy, the check gone, verified")
    }

    /// tests/fixtures/bridge-messages.json: what the compiler sends (tests/bridge.test.js checks that side).
    static func contract() {
        guard let data = try? Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[2])),
              let fixture = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let ready = fixture["ready"] as? [String: Any], let page = ready["page"] as? String,
              let project = fixture["project"] as? [String: Any], let result = project["result"] as? [String: Any],
              let chosen = project["turns"] as? [[String: Any]] else { return check(false, "the contract fixture reads") }
        let prepared = parseReady(ready, page: page)
        check(prepared?.turns == 4 && prepared?.attachments.count == 1 && prepared?.turnList.count == 4
              && prepared?.checks == ["attachment-download-needed": 1] && prepared?.markdown == ready["markdown"] as? String,
              "the app accepts the compiler's ready message whole")
        let text = parseProjection(result, turns: chosen.count)
        check(text?.attachments.first?.messageId == "a1" && text?.markdown == result["markdown"] as? String,
              "and its projection of chosen turns")
        if var whole = prepared, let text {
            whole.checks = ["unreadable-markup": 3, "attachment-download-needed": 5]
            check(text.checks == ["attachment-download-needed": 1] && whole.projected(text).checks == text.checks,
                  "a projection carries its own check counts, not the whole conversation's")
        } else { check(false, "a projection carries its own check counts") }
        func refused(_ change: (inout [String: Any]) -> Void) -> Bool {
            var body = ready
            change(&body)
            return parseReady(body, page: page) == nil
        }
        check(refused { $0["turns"] = 5 }, "a turn count that disagrees with the list is refused")
        check(refused { $0["markdown"] = String(repeating: "x", count: maximumMarkdownBytes + 1) }, "text over 16 MiB is refused")
        check(refused { body in
            var files = body["attachments"] as! [[String: Any]]
            files[0]["line"] = 10_000
            body["attachments"] = files
        }, "a file line outside the text is refused")
        check(refused { body in
            var rows = body["turnList"] as! [[String: Any]]
            rows[1]["sha256"] = "not-a-hash"
            body["turnList"] = rows
        }, "a turn without a SHA-256 is refused")
        check(refused { body in
            var rows = body["turnList"] as! [[String: Any]]
            rows[1]["id"] = rows[0]["id"]
            body["turnList"] = rows
        }, "two turns with one id are refused")
        check(parseProjection(result, turns: chosen.count + 1) == nil, "a projection of a different number of turns is refused")
    }

    static func checkCounts() {
        check(parseChecks(["attachment-download-needed": 2, "unreadable-markup": 1]) == ["attachment-download-needed": 2, "unreadable-markup": 1],
              "content-check counts read by code")
        check(parseChecks(["Some text": 1]).isEmpty && parseChecks(["code": "1"]).isEmpty && parseChecks(["code": 0]).isEmpty
              && parseChecks(nil).isEmpty, "a count that is not a fixed code and a positive number is dropped whole")
    }

    static func fileLinkChoice() {
        let report = Attachment(key: "1:b", id: "sandbox:/mnt/data/report.md", name: "report.md", label: "report.md", turn: 2,
                                messageId: "b1", line: 9, check: -1)
        let now = Date()
        let a = "https://chatgpt.com/c/a", b = "https://chatgpt.com/c/b"
        let fromA = FileLink(url: URL(string: "https://chatgpt.com/a.md")!, name: "report.md", seen: now, page: a)
        check(chooseLink(["file-a|": fromA], for: report, on: b, nameIsUnique: true, now: now) == nil,
              "a same-name link fetched in another conversation is never used")
        check(chooseLink(["sandbox:/mnt/data/report.md|a1": fromA], for: report, on: b, nameIsUnique: true, now: now) == nil,
              "a sandbox path repeated in another conversation is never used")
        let fromB = FileLink(url: URL(string: "https://chatgpt.com/b.md")!, name: "report.md", seen: now, page: b)
        check(chooseLink(["file-a|": fromA, "file-b|": fromB], for: report, on: b, nameIsUnique: true, now: now)?.url == fromB.url,
              "the same-name link from this conversation is used")
        check(chooseLink(["file-b|": fromB], for: report, on: b, nameIsUnique: false, now: now) == nil,
              "a name shared by two files in this conversation is not enough")
        check(chooseLink(["sandbox:/mnt/data/report.md|b1": fromB], for: report, on: b, nameIsUnique: false, now: now)?.url == fromB.url,
              "an exact file and message match is used")
        check(chooseLink(["sandbox:/mnt/data/report.md|b1": fromB], for: report, on: b, nameIsUnique: true,
                         now: now.addingTimeInterval(300)) == nil, "a stale link is not used")
    }

    static func main() {
        _ = NSApplication.shared
        // The real observer and bridge, with the page's fetch stubbed in front of the observer so it
        // sees a synthetic conversation response without any network request.
        let built = URL(fileURLWithPath: CommandLine.arguments[1])
        let scripts = FileManager.default.temporaryDirectory.appendingPathComponent("gh-webkit-\(UUID().uuidString)")
        try! FileManager.default.createDirectory(at: scripts, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: scripts) }
        let stub = """
            (() => {
              const body = \(String(data: try! JSONSerialization.data(withJSONObject: [conversation], options: .fragmentsAllowed), encoding: .utf8)!.dropFirst().dropLast());
              window.fetch = async (input) => {
                const response = new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });
                Object.defineProperty(response, 'url', { value: new URL(typeof input === 'string' ? input : input.url, location.href).href });
                return response;
              };
            })();

            """
        try! (stub + String(contentsOf: built.appendingPathComponent("observer.js"), encoding: .utf8))
            .write(to: scripts.appendingPathComponent("observer.js"), atomically: true, encoding: .utf8)
        try! FileManager.default.copyItem(at: built.appendingPathComponent("bridge.js"), to: scripts.appendingPathComponent("bridge.js"))

        var webView: WKWebView?
        let chat = ChatController(scripts: scripts) { web in
            webView = web
            web.loadHTMLString("<!doctype html><title>Synthetic</title><main>Chat</main>", baseURL: URL(string: "https://chatgpt.com/c/one")!)
        }
        let window = NSWindow(contentViewController: chat)
        window.setContentSize(NSSize(width: 480, height: 640))
        let web = webView!
        pump(until: { !web.isLoading && web.url != nil }, "synthetic page loads")

        check(evaluate(web, "window[Symbol.for('add-to-claude.passive-observer')] === true") as? Bool == true,
              "observer runs in the page world")
        check(evaluate(web, "typeof window.webkit?.messageHandlers?.handoff") as? String == "undefined",
              "page scripts cannot reach the native handler")
        check(evaluate(web, "typeof window.webkit?.messageHandlers?.handoff", in: .defaultClient) as? String == "object",
              "the isolated bridge can")

        forge(web)
        RunLoop.main.run(until: Date().addingTimeInterval(0.5))
        check(chat.prepared == nil, "packets posted by page scripts, directly or on their own port, are ignored")

        _ = evaluate(web, "fetch('/backend-api/conversation/one').then((r) => r.text()); true")
        pump(until: { chat.prepared != nil }, "the page's own response becomes a prepared conversation")
        let prepared = chat.prepared!
        check(prepared.page == "https://chatgpt.com/c/one" && prepared.turns == 2 && prepared.verification == "verified",
              "prepared summary")
        check(prepared.markdown.contains("Original **Markdown** 中文 ✓\n")
              && prepared.markdown.range(of: "Synthetic question.")!.lowerBound
                 < prepared.markdown.range(of: "Original **Markdown**")!.lowerBound, "exact Markdown in order")
        check(chat.bar.isCurrent(prepared), "preparation is current")
        check(prepared.turnList.map(\.role) == ["user", "assistant"] && prepared.turnList.allSatisfy { isSHA256($0.sha256) }
              && prepared.turnList[1].preview == "Original **Markdown** 中文 ✓" && prepared.sourceId == "one",
              "per-turn ids, roles, previews and hashes arrive with the preparation")

        // Some turns, projected by the compiler in the isolated world, for the hash the app was shown.
        var projected: ProjectionResult?
        chat.project(prepared, turns: [prepared.turnList[1]], note: "new since last add") { projected = $0 }
        pump(until: { projected != nil }, "the bridge answers a request for some turns")
        if case .success(let text) = projected! {
            check(text.markdown.contains("\nTurn 2 of 2 · new since last add\n") && text.markdown.contains("## Turn 2 — Assistant")
                  && !text.markdown.contains("Synthetic question.") && text.verification == "verified",
                  "the subset text: the chosen turn under its own number, with the scope line")
        } else { check(false, "the subset text") }
        projected = nil
        let stale = TurnInfo(id: "a", role: "assistant", position: 2, preview: "", sha256: String(repeating: "0", count: 64), files: [])
        chat.project(prepared, turns: [stale], note: "chosen") { projected = $0 }
        pump(until: { projected != nil }, "the bridge answers a stale request")
        if case .failure = projected! { check(true, "") } else { check(false, "a turn whose text changed since it was shown is refused") }

        _ = evaluate(web, "history.pushState(null, '', '/c/another'); true")
        pump(until: { chat.prepared == nil }, "navigating to another conversation revokes it")
        check(!chat.bar.isCurrent(prepared), "old preparation is not current on the new page")

        _ = evaluate(web, "fetch('/backend-api/conversation/one').then((r) => r.text()); true")
        RunLoop.main.run(until: Date().addingTimeInterval(0.5))
        check(chat.prepared == nil, "a response for a conversation no longer shown is not prepared")

        linkedFiles()
        fileLinkChoice()
        checkCounts()
        contract()
        diagnostics()
        print("PASS: \(checks) WebKit checks in a real WKWebView")
        exit(0)
    }
}
