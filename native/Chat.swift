import AppKit
import WebKit

private let chatHosts: Set<String> = ["chatgpt.com", "chat.openai.com"]
/// Hosts that sign-in may pass through. Anything else a link opens goes to the default browser.
private let signInHosts: Set<String> = ["chatgpt.com", "chat.openai.com", "auth.openai.com", "auth0.openai.com",
                                        "accounts.google.com", "appleid.apple.com", "login.microsoftonline.com",
                                        "login.live.com"]

func pageKey(_ url: URL?) -> String? {
    guard let url, url.scheme == "https", let host = url.host, chatHosts.contains(host),
          url.user == nil, url.password == nil else { return nil }
    return "https://\(host)\(url.path)"
}

/// ChatGPT in the app's own persistent WebKit session, with the handoff bar beneath it.
/// The page observer runs in the page world; the compiler and bridge run in an isolated content world.
final class ChatController: NSViewController, WKScriptMessageHandler, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate {
    let bar = HandoffBar()
    private var web: WKWebView!
    private var urlObservation: NSKeyValueObservation?
    private var popups: [NSWindow] = []
    private(set) var panelOpen = false
    private(set) var prepared: Prepared?
    private let scripts: URL?
    private let start: (WKWebView) -> Void

    /// `scripts` holds observer.js and bridge.js; tests pass their own folder and page.
    init(scripts: URL? = Bundle.main.url(forResource: "webkit", withExtension: nil),
         start: @escaping (WKWebView) -> Void = { $0.load(URLRequest(url: URL(string: "https://chatgpt.com/")!)) }) {
        self.scripts = scripts
        self.start = start
        super.init(nibName: nil, bundle: nil)
    }
    required init?(coder: NSCoder) { fatalError() }

    override func loadView() {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        let scripts = configuration.userContentController
        if let observer = script("observer"), let bridge = script("bridge") {
            scripts.addUserScript(WKUserScript(source: observer, injectionTime: .atDocumentStart, forMainFrameOnly: true, in: .page))
            scripts.addUserScript(WKUserScript(source: bridge, injectionTime: .atDocumentStart, forMainFrameOnly: true, in: .defaultClient))
            scripts.add(self, contentWorld: .defaultClient, name: "handoff")
        }
        web = WKWebView(frame: NSRect(x: 0, y: 0, width: 480, height: 640), configuration: configuration)
        web.navigationDelegate = self
        web.uiDelegate = self
        web.allowsBackForwardNavigationGestures = true
        urlObservation = web.observe(\.url, options: [.new]) { [weak self] view, _ in
            DispatchQueue.main.async { self?.pageMoved(to: view.url) }
        }
        bar.isCurrent = { [weak self] candidate in
            guard let self, let prepared = self.prepared else { return false }
            return prepared.revision == candidate.revision && pageKey(self.web.url) == candidate.page
        }

        let column = NSStackView(views: [web, bar.view])
        column.orientation = .vertical
        column.spacing = 0
        for view in [web!, bar.view] { view.widthAnchor.constraint(equalTo: column.widthAnchor).isActive = true }
        web.setContentHuggingPriority(.defaultLow, for: .vertical)
        view = column
        start(web)
    }

    private func script(_ name: String) -> String? {
        scripts.flatMap { try? String(contentsOf: $0.appendingPathComponent(name + ".js"), encoding: .utf8) }
    }

    /// Whether a login, preview, save or file panel of ours is in front, so the chat must stay shown.
    var keepsPanelOpen: Bool {
        panelOpen || bar.panelOpen || popups.contains { $0.isVisible }
    }

    // MARK: source

    private func set(_ next: Prepared?, _ state: SourceState) {
        prepared = next
        bar.show(state)
    }

    private func pageMoved(to url: URL?) {
        guard let page = pageKey(url) else { return set(nil, .waiting) }
        // The observer can report a new chat before WebKit updates the URL; keep a matching preparation.
        if prepared?.page != page { set(nil, .waiting) }
    }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.world == .defaultClient, message.frameInfo.isMainFrame,
              message.frameInfo.securityOrigin.protocol == "https",
              chatHosts.contains(message.frameInfo.securityOrigin.host),
              let body = message.body as? [String: Any], let kind = body["kind"] as? String,
              let page = pageKey(URL(string: body["page"] as? String ?? "")),
              page.hasPrefix("https://\(message.frameInfo.securityOrigin.host)/") else { return }
        switch kind {
        case "ready":
            guard let markdown = body["markdown"] as? String else { return }
            let prepared = Prepared(revision: UUID(), page: page, markdown: markdown,
                                    title: safeLabel(body["title"] as? String ?? "ChatGPT conversation", limit: 120),
                                    turns: body["turns"] as? Int ?? 0, files: body["files"] as? Int ?? 0,
                                    verification: body["verification"] as? String ?? "",
                                    issues: (body["issues"] as? [String] ?? []).map { safeLabel($0, limit: 200) })
            set(prepared, .ready(prepared))
        case "changed": set(nil, .waiting)
        case "invalid": set(nil, .unavailable(safeLabel(body["message"] as? String ?? "", limit: 160)))
        case "unavailable": set(nil, .unavailable("This page did not expose its original messages."))
        default: break
        }
    }

    // MARK: navigation

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url else { return decisionHandler(.cancel) }
        if action.shouldPerformDownload { return decisionHandler(.download) }
        let followedLink = action.navigationType == .linkActivated && action.targetFrame?.isMainFrame != false
        if url.scheme == "https", let host = url.host, !signInHosts.contains(host), followedLink {
            NSWorkspace.shared.open(url)
            return decisionHandler(.cancel)
        }
        decisionHandler(["https", "about", "blob", "data"].contains(url.scheme ?? "") ? .allow : .cancel)
    }

    func webView(_ webView: WKWebView, decidePolicyFor response: WKNavigationResponse,
                 decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        decisionHandler(response.canShowMIMEType ? .allow : .download)
    }

    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        if webView === web { set(nil, .waiting) }
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        if webView === web { set(nil, .unavailable("The page stopped. It is reloading.")); web.reload() }
    }

    // Sign-in may open a popup; it keeps this session. Other new windows open in the default browser.
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        guard let url = action.request.url else { return nil }
        guard url.scheme == "about" || url.host.map(signInHosts.contains) == true else {
            NSWorkspace.shared.open(url)
            return nil
        }
        let popup = WKWebView(frame: NSRect(x: 0, y: 0, width: 520, height: 680), configuration: configuration)
        popup.navigationDelegate = self
        popup.uiDelegate = self
        let window = NSWindow(contentRect: popup.frame, styleMask: [.titled, .closable, .resizable], backing: .buffered, defer: false)
        window.title = "Sign in"
        window.contentView = popup
        window.isReleasedWhenClosed = false
        window.center()
        window.level = .floating
        popups.append(window)
        window.makeKeyAndOrderFront(nil)
        return popup
    }

    func webViewDidClose(_ webView: WKWebView) {
        popups.removeAll { window in
            guard window.contentView === webView else { return false }
            window.close()
            return true
        }
    }

    // MARK: files

    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.canChooseDirectories = parameters.allowsDirectories
        panelOpen = true
        panel.begin { [weak self] response in
            self?.panelOpen = false
            completionHandler(response == .OK ? panel.urls : nil)
        }
    }

    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) { download.delegate = self }
    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) { download.delegate = self }

    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String,
                  completionHandler: @escaping (URL?) -> Void) {
        let panel = NSSavePanel()
        panel.nameFieldStringValue = suggestedFilename
        panelOpen = true
        panel.begin { [weak self] result in
            self?.panelOpen = false
            completionHandler(result == .OK ? panel.url : nil)
        }
    }
}
