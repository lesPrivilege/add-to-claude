import AppKit
import WebKit

// Isolated native WebKit fixture runner: no account, external network, target access or visible window.
final class FixtureRunner: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKScriptMessageHandler {
    var view: WKWebView!
    var completed = false
    var initialNavigation = true
    func applicationDidFinishLaunching(_ notification: Notification) {
        do {
            let configuration = WKWebViewConfiguration()
            configuration.websiteDataStore = .nonPersistent()
            configuration.userContentController.add(self, name: "handoffSource")
            configuration.userContentController.add(self, name: "fixtureResult")
            for path in CommandLine.arguments.dropFirst() {
                let script = try String(contentsOfFile: path, encoding: .utf8)
                configuration.userContentController.addUserScript(WKUserScript(source: script, injectionTime: .atDocumentStart, forMainFrameOnly: true))
            }
            view = WKWebView(frame: NSRect(x: 0, y: 0, width: 800, height: 600), configuration: configuration)
            view.navigationDelegate = self
            view.loadHTMLString("<!doctype html><title>Synthetic WebKit test</title><textarea id='draft'>Unsent synthetic draft.</textarea>", baseURL: URL(string: "https://chatgpt.com/c/native-synthetic")!)
            DispatchQueue.main.asyncAfter(deadline: .now() + 25) { self.finish(false, "Native WebKit fixture timed out") }
        } catch { finish(false, "Fixture setup failed: \(error)") }
    }
    func finish(_ success: Bool, _ message: String) {
        guard !completed else { return }
        completed = true
        print(message)
        fflush(stdout)
        exit(success ? 0 : 1)
    }
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        // loadHTMLString is the only navigation; any fixture attempt to contact a host fails closed.
        let allowed = initialNavigation && ["about:blank", "https://chatgpt.com/c/native-synthetic"].contains(navigationAction.request.url?.absoluteString ?? "")
        initialNavigation = false
        decisionHandler(allowed ? .allow : .cancel)
    }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        webView.evaluateJavaScript("void window.runNativeFixtures()") { _, error in
            if let error { self.finish(false, "Fixture JavaScript failed: \(error)") }
        }
    }
    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any] else { finish(false, "Invalid fixture packet"); return }
        if message.name == "fixtureResult" {
            finish(body["ok"] as? Bool == true, body["message"] as? String ?? "No test result")
        } else {
            view.callAsyncJavaScript("window.acceptNativePacket(packet)", arguments: ["packet": body], in: nil, in: .page) { result in
                if case .failure(let error) = result { self.finish(false, "Native packet delivery failed: \(error)") }
            }
        }
    }
}
let app = NSApplication.shared
let runner = FixtureRunner()
app.delegate = runner
app.setActivationPolicy(.prohibited)
app.run()
