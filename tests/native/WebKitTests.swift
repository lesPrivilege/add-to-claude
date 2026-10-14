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
            window.postMessage({ type: 'gpt-handoff/source', packet: \(packet) }, location.origin);
            const channel = new MessageChannel();
            window.postMessage({ type: 'gpt-handoff/port' }, location.origin, [channel.port2]);
            channel.port1.postMessage(\(packet)); true
            """)
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

        check(evaluate(web, "window[Symbol.for('gpt-handoff.passive-observer')] === true") as? Bool == true,
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

        _ = evaluate(web, "history.pushState(null, '', '/c/another'); true")
        pump(until: { chat.prepared == nil }, "navigating to another conversation revokes it")
        check(!chat.bar.isCurrent(prepared), "old preparation is not current on the new page")

        _ = evaluate(web, "fetch('/backend-api/conversation/one').then((r) => r.text()); true")
        RunLoop.main.run(until: Date().addingTimeInterval(0.5))
        check(chat.prepared == nil, "a response for a conversation no longer shown is not prepared")

        print("PASS: \(checks) WebKit checks in a real WKWebView")
        exit(0)
    }
}
