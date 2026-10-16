import AppKit
import CryptoKit
import OSLog
import WebKit

// TEMPORARY diagnostic: request shapes from the live page (ids redacted) go to the local system log.
private let traceLog = Logger(subsystem: "io.lesprivilege.gpt-handoff", category: "trace")
private let navLog = Logger(subsystem: "io.lesprivilege.gpt-handoff", category: "nav")

private let chatHosts: Set<String> = ["chatgpt.com", "chat.openai.com"]
/// Hosts that sign-in may pass through. Anything else a link opens goes to the default browser.
private let signInHosts: Set<String> = ["chatgpt.com", "chat.openai.com", "auth.openai.com", "auth0.openai.com",
                                        "accounts.google.com", "appleid.apple.com", "login.microsoftonline.com",
                                        "login.live.com"]

/// The chat root (new chat), where a conversation URL is assigned only after the first reply starts.
private func isChatRoot(_ url: URL?) -> Bool {
    guard pageKey(url) != nil, let path = url?.path else { return false }
    return path == "/" || path.range(of: #"^/g/[A-Za-z0-9_-]+/?$"#, options: .regularExpression) != nil
}

func pageKey(_ url: URL?) -> String? {
    guard let url, url.scheme == "https", let host = url.host, chatHosts.contains(host),
          url.user == nil, url.password == nil else { return nil }
    return "https://\(host)\(url.path)"
}

/// ChatGPT in the app's own persistent WebKit session, with the handoff bar beneath it.
/// The page observer runs in the page world; the compiler and bridge run in an isolated content world.
final class ChatController: NSViewController, WKScriptMessageHandler, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate, NSWindowDelegate {
    let bar = HandoffBar()
    var openSettings: () -> Void = {}
    private var web: WKWebView!
    private lazy var back = iconButton("back", "Back", #selector(goBack), self)
    private lazy var pin = iconButton("pin", "Keep open when switching apps", #selector(togglePin), self)
    private var urlObservation: NSKeyValueObservation?
    private var backObservation: NSKeyValueObservation?
    private var popups: [NSWindow] = []
    private(set) var panelOpen = false
    private(set) var prepared: Prepared?
    private var fileLinks: [String: FileLink] = [:]
    private lazy var fetcher = FileFetcher(web: web)
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
            // The bridge listens before the observer offers its private port.
            scripts.addUserScript(WKUserScript(source: bridge, injectionTime: .atDocumentStart, forMainFrameOnly: true, in: .defaultClient))
            scripts.addUserScript(WKUserScript(source: observer, injectionTime: .atDocumentStart, forMainFrameOnly: true, in: .page))
            scripts.add(self, contentWorld: .defaultClient, name: "handoff")
        }
        web = WKWebView(frame: NSRect(x: 0, y: 0, width: 480, height: 640), configuration: configuration)
        web.navigationDelegate = self
        web.uiDelegate = self
        web.allowsBackForwardNavigationGestures = true
        urlObservation = web.observe(\.url, options: [.new]) { [weak self] view, _ in
            DispatchQueue.main.async { self?.pageMoved(to: view.url) }
        }
        backObservation = web.observe(\.canGoBack, options: [.initial, .new]) { [weak self] view, _ in
            DispatchQueue.main.async { self?.back.isEnabled = view.canGoBack }
        }
        bar.withFiles = { [weak self] prepared in self?.withFiles(prepared) ?? (prepared.markdown, "") }
        bar.fileRows = { [weak self] in self?.fileRows() ?? [] }
        bar.downloadFiles = { [weak self] ids, done in self?.downloadSelected(ids, done: done) ?? done() }
        bar.isCurrent = { [weak self] candidate in
            guard let self, let prepared = self.prepared else { return false }
            return prepared.revision == candidate.revision && pageKey(self.web.url) == candidate.page
        }

        let column = NSStackView(views: [header(), web, bar.view])
        column.orientation = .vertical
        column.spacing = 0
        for view in column.arrangedSubviews { view.widthAnchor.constraint(equalTo: column.widthAnchor).isActive = true }
        web.setContentHuggingPriority(.defaultLow, for: .vertical)
        // A web view has no natural size; without these the window shrinks to the bar's size.
        web.widthAnchor.constraint(greaterThanOrEqualToConstant: 360).isActive = true
        web.heightAnchor.constraint(greaterThanOrEqualToConstant: 360).isActive = true
        preferredContentSize = NSSize(width: 480, height: 760)
        view = column
        start(web)
    }

    /// The panel's own controls, in the title bar's space: page navigation on the left, the panel on the right.
    private func header() -> NSView {
        let reload = iconButton("refresh", "Reload page", #selector(ChatController.reload), self)
        let browser = iconButton("external", "Open in your browser", #selector(openInBrowser), self)
        let settings = iconButton("settings", "Settings", #selector(showSettings), self)
        let row = NSStackView(views: [back, reload, browser, NSView(), pin, settings])
        row.spacing = 2
        row.edgeInsets = NSEdgeInsets(top: 4, left: 8, bottom: 4, right: 8)
        row.heightAnchor.constraint(equalToConstant: 32).isActive = true
        preferencesChanged()
        return row
    }

    @objc func goBack() { web.goBack() }
    @objc func reload() { web.reload() }
    @objc private func showSettings() { openSettings() }
    @objc private func togglePin() { Preferences.pinned.toggle() }

    @objc private func openInBrowser() {
        openExternally(web.url ?? URL(string: "https://chatgpt.com/")!)
    }

    /// Clears the panel's own cookies and site data, then shows ChatGPT's sign-in page.
    func signOut() {
        let store = WKWebsiteDataStore.default()
        store.removeData(ofTypes: WKWebsiteDataStore.allWebsiteDataTypes(), modifiedSince: .distantPast) { [weak self] in
            self?.set(nil, .waiting)
            self?.web.load(URLRequest(url: URL(string: "https://chatgpt.com/")!))
        }
    }

    func preferencesChanged() {
        let pinned = Preferences.pinned
        pin.image = glyph(pinned ? "pinned" : "pin")
        pin.contentTintColor = pinned ? .controlAccentColor : nil
        pin.toolTip = pinned ? "Pinned: stays open when you switch apps" : "Keep open when switching apps"
        pin.setAccessibilityValue(pinned ? "on" : "off")
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
        guard message.webView === web, message.world == .defaultClient, message.frameInfo.isMainFrame,
              message.frameInfo.securityOrigin.protocol == "https",
              chatHosts.contains(message.frameInfo.securityOrigin.host),
              let body = message.body as? [String: Any], let kind = body["kind"] as? String,
              let page = pageKey(URL(string: body["page"] as? String ?? "")),
              page.hasPrefix("https://\(message.frameInfo.securityOrigin.host)/") else { return }
        switch kind {
        case "ready":
            // A late answer for a conversation the panel has already left is not the one on screen.
            guard let markdown = body["markdown"] as? String, page == pageKey(web.url) || isChatRoot(web.url) else { return }
            let prepared = Prepared(revision: UUID(), page: page, markdown: markdown,
                                    title: safeLabel(body["title"] as? String ?? "ChatGPT conversation", limit: 120),
                                    turns: body["turns"] as? Int ?? 0, files: body["files"] as? Int ?? 0,
                                    verification: body["verification"] as? String ?? "",
                                    issues: (body["issues"] as? [String] ?? []).map { safeLabel($0, limit: 200) },
                                    attachments: (body["attachments"] as? [[String: Any]] ?? []).compactMap { file in
                                        guard let id = file["id"] as? String, let line = file["line"] as? String else { return nil }
                                        return (id, safeLabel(file["name"] as? String ?? "", limit: 200), file["turn"] as? Int ?? 0, line)
                                    })
            if !prepared.issues.isEmpty {
                traceLog.info("partial: \(prepared.issues.joined(separator: " | "), privacy: .public)")
            }
            set(prepared, .ready(prepared))
        case "trace": traceLog.info("\(body["method"] as? String ?? "", privacy: .public) \(body["path"] as? String ?? "", privacy: .public)")
        case "file":
            // A link the page itself requested for one of its files; only https on ChatGPT's own hosts.
            guard let id = body["id"] as? String, let text = body["url"] as? String, let url = URL(string: text),
                  url.scheme == "https", let host = url.host,
                  chatHosts.contains(host) || host.hasSuffix(".oaiusercontent.com") else { return }
            fileLinks[id] = FileLink(url: url, name: body["name"] as? String ?? "", seen: Date())
        case "changed": set(nil, .waiting)
        case "invalid": set(nil, .unavailable(safeLabel(body["message"] as? String ?? "", limit: 160)))
        case "unavailable": set(nil, .unavailable("This page did not expose its original messages."))
        default: break
        }
    }

    // MARK: files

    /// Files saved for each conversation page, by file name: from the files list or the page's own download.
    private var saved: [String: [String: (path: URL, sha256: String)]] = [:]

    private func savedFile(_ name: String) -> (path: URL, sha256: String)? {
        prepared.flatMap { saved[$0.page]?[name.lowercased()] }
    }

    private func record(_ path: URL, sha256: String, name: String) {
        guard let page = prepared?.page ?? pageKey(web.url) else { return }
        saved[page, default: [:]][name.lowercased()] = (path, sha256)
    }

    /// Each saved file's line points at its local copy; the rest stay references.
    private func withFiles(_ prepared: Prepared) -> (String, String) {
        var markdown = prepared.markdown, linked = 0
        for file in prepared.attachments {
            guard let copy = saved[prepared.page]?[file.name.lowercased()] else { continue }
            markdown = markdown.replacingOccurrences(of: file.line, with: "- \(file.name) — `\(copy.path.path)` · sha256 \(copy.sha256)")
            linked += 1
        }
        let total = prepared.attachments.count
        return (markdown, total == 0 ? "" : linked == total ? "\(linked) file\(linked == 1 ? "" : "s") linked."
                : "\(linked) of \(total) files linked; the rest are references (download them from the Files list).")
    }

    /// The page's link for a file: by its id, or by name, since generated files are referred to by
    /// their sandbox path in the conversation but fetched by an internal file id.
    private func link(for file: (id: String, name: String, turn: Int, line: String)) -> FileLink? {
        fileLinks[file.id] ?? fileLinks.values.filter { $0.name == file.name }.max { $0.seen < $1.seen }
    }

    private func fileRows() -> [FileRow] {
        (prepared?.attachments ?? []).map { file in
            FileRow(id: file.id, name: file.name, turn: file.turn, saved: savedFile(file.name)?.path, linkReady: link(for: file) != nil)
        }
    }

    private func downloadSelected(_ ids: [String], done: @escaping () -> Void) {
        guard let prepared else { return done() }
        let files = prepared.attachments.filter { ids.contains($0.id) && link(for: $0) != nil }
        let links = files.map { file in
            let link = link(for: file)!
            return FileLink(url: link.url, name: file.name, seen: link.seen)
        }
        fetcher.fetch(links, into: FilesFolder.folder(for: prepared.title)) { [weak self] outcomes in
            guard let self else { return }
            for (file, outcome) in zip(files, outcomes) {
                if let path = outcome.path, let hash = outcome.sha256 { self.record(path, sha256: hash, name: file.name) }
            }
            let failed = outcomes.compactMap(\.problem)
            self.bar.filesChanged(failed.isEmpty ? "\(outcomes.count) file\(outcomes.count == 1 ? "" : "s") saved."
                                  : "\(outcomes.count - failed.count) saved; \(failed.count) failed: \(failed[0]).")
            done()
        }
    }

    // MARK: navigation

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url else { return decisionHandler(.cancel) }
        // TEMPORARY diagnostic: how the page's file clicks navigate (scheme, host, path shape only).
        navLog.info("navigate \(url.scheme ?? "-", privacy: .public)://\(url.host ?? "", privacy: .public)\(url.path.replacingOccurrences(of: #"[A-Za-z0-9_-]{20,}"#, with: ":id", options: .regularExpression), privacy: .public) type=\(action.navigationType.rawValue) main=\(action.targetFrame?.isMainFrame ?? false) download=\(action.shouldPerformDownload)")
        if action.shouldPerformDownload { return decisionHandler(.download) }
        guard action.targetFrame?.isMainFrame != false else {
            return decisionHandler(["https", "about", "blob", "data"].contains(url.scheme ?? "") ? .allow : .cancel)
        }
        // Top-level pages stay on ChatGPT and its sign-in hosts; anything else is the user's browser's job.
        if url.scheme == "https", let host = url.host, signInHosts.contains(host) { return decisionHandler(.allow) }
        if url.scheme == "about" && webView !== web { return decisionHandler(.allow) }
        openExternally(url)
        decisionHandler(.cancel)
    }

    func webView(_ webView: WKWebView, decidePolicyFor response: WKNavigationResponse,
                 decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        navLog.info("response \(response.response.mimeType ?? "-", privacy: .public) show=\(response.canShowMIMEType) main=\(response.isForMainFrame)")
        decisionHandler(response.canShowMIMEType ? .allow : .download)
    }

    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        if webView === web { set(nil, .waiting) }
    }

    private var lastCrash = Date.distantPast
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        guard webView === web else { return }
        // Reload once; a page that keeps crashing waits for the user instead of looping.
        if Date().timeIntervalSince(lastCrash) > 60 {
            set(nil, .unavailable("The page stopped. It is reloading."))
            web.reload()
        } else { set(nil, .unavailable("The page stopped again. Quit and reopen gpt-handoff.")) }
        lastCrash = Date()
    }

    /// Only web links leave the app, and only to the default browser. Other schemes are dropped.
    private func openExternally(_ url: URL) {
        if url.scheme == "https" || url.scheme == "http" { NSWorkspace.shared.open(url) }
    }

    // Sign-in may open a popup; it keeps this session. Other new windows open in the default browser.
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        guard let url = action.request.url else { return nil }
        navLog.info("new window \(url.scheme ?? "-", privacy: .public)://\(url.host ?? "", privacy: .public)")
        guard url.scheme == "about" || (url.scheme == "https" && url.host.map(signInHosts.contains) == true) else {
            openExternally(url)
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
        window.delegate = self
        popups.append(window)
        window.makeKeyAndOrderFront(nil)
        return popup
    }

    func windowWillClose(_ notification: Notification) {
        popups.removeAll { $0 === notification.object as? NSWindow }
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
        panel.level = aboveChatPanel
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

    /// The page's own downloads go straight into the conversation's folder, and Add can then point at them.
    private var pageDownloads: [ObjectIdentifier: (path: URL, name: String)] = [:]

    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String,
                  completionHandler: @escaping (URL?) -> Void) {
        let folder = FilesFolder.folder(for: prepared?.title ?? "ChatGPT")
        guard (try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)) != nil else {
            bar.filesChanged("The files folder is not writable. Choose another in Settings.")
            return completionHandler(nil)
        }
        let name = safeLabel(suggestedFilename, limit: 120).replacingOccurrences(of: "/", with: "-")
        var path = folder.appendingPathComponent(name.isEmpty ? "download" : name), index = 2
        while FileManager.default.fileExists(atPath: path.path) {
            path = folder.appendingPathComponent("\((name as NSString).deletingPathExtension) \(index)" + ((name as NSString).pathExtension.isEmpty ? "" : ".\((name as NSString).pathExtension)"))
            index += 1
        }
        navLog.info("download to conversation folder: \(path.lastPathComponent, privacy: .public)")
        pageDownloads[ObjectIdentifier(download)] = (path, suggestedFilename)
        completionHandler(path)
    }

    func downloadDidFinish(_ download: WKDownload) {
        guard let (path, name) = pageDownloads.removeValue(forKey: ObjectIdentifier(download)),
              let data = try? Data(contentsOf: path, options: .mappedIfSafe) else { return }
        record(path, sha256: SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined(), name: name)
        bar.filesChanged("Saved \(path.lastPathComponent) to the files folder.")
    }

    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        guard pageDownloads.removeValue(forKey: ObjectIdentifier(download)) != nil else { return }
        bar.filesChanged("The download failed. Try it again in the chat.")
    }
}
