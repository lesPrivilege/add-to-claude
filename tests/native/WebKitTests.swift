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

    static func post(_ web: WKWebView, kind: String, page: String = "https://chatgpt.com/c/one") {
        let body = (try! JSONSerialization.data(withJSONObject: [conversation], options: .fragmentsAllowed))
        let literal = String(data: body, encoding: .utf8)!.dropFirst().dropLast()
        _ = evaluate(web, """
            window.postMessage({ type: 'gpt-handoff/source', packet: { kind: '\(kind)', pageUrl: '\(page)',
              responseUrl: 'https://chatgpt.com/backend-api/conversation/one', capturedAt: new Date().toISOString(),
              method: 'GET', body: \(literal) } }, location.origin); true
            """)
    }

    static func main() {
        _ = NSApplication.shared
        let scripts = URL(fileURLWithPath: CommandLine.arguments[1])
        var webView: WKWebView?
        let chat = ChatController(scripts: scripts) { web in
            webView = web
            web.loadHTMLString("<!doctype html><title>Synthetic</title><main>Chat</main>", baseURL: URL(string: "https://chatgpt.com/c/one")!)
        }
        let window = NSWindow(contentViewController: chat)
        window.setContentSize(NSSize(width: 480, height: 640))
        let web = webView!
        pump(until: { !web.isLoading && web.url != nil }, "synthetic page loads")

        check(evaluate(web, "window[Symbol.for('gpt-handoff.passive-observer')] === true") as? Bool == true,
              "observer runs in the page world")
        check(evaluate(web, "typeof window.webkit?.messageHandlers?.handoff") as? String == "undefined",
              "page scripts cannot reach the native handler")
        check(evaluate(web, "typeof window.webkit?.messageHandlers?.handoff", in: .defaultClient) as? String == "object",
              "the isolated bridge can")

        post(web, kind: "response")
        pump(until: { chat.prepared != nil }, "observed response becomes a prepared conversation")
        let prepared = chat.prepared!
        check(prepared.page == "https://chatgpt.com/c/one" && prepared.turns == 2 && prepared.verification == "verified",
              "prepared summary")
        check(prepared.markdown.contains("Original **Markdown** 中文 ✓\n")
              && prepared.markdown.range(of: "Synthetic question.")!.lowerBound
                 < prepared.markdown.range(of: "Original **Markdown**")!.lowerBound, "exact Markdown in order")
        check(chat.bar.isCurrent(prepared), "preparation is current")

        post(web, kind: "changed")
        pump(until: { chat.prepared == nil }, "a page change revokes the preparation")
        check(!chat.bar.isCurrent(prepared), "revoked preparation is no longer current")

        post(web, kind: "response")
        pump(until: { chat.prepared != nil }, "prepared again")
        let again = chat.prepared!
        _ = evaluate(web, "history.pushState(null, '', '/c/another'); true")
        pump(until: { chat.prepared == nil }, "navigating to another conversation revokes it")
        check(!chat.bar.isCurrent(again), "old preparation is not current on the new page")

        post(web, kind: "response", page: "https://example.com/c/one")
        RunLoop.main.run(until: Date().addingTimeInterval(0.5))
        check(chat.prepared == nil, "a packet naming another origin is dropped")

        print("PASS: \(checks) WebKit checks in a real WKWebView")
        exit(0)
    }
}
