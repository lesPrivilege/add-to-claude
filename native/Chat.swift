import AppKit
import CryptoKit
import WebKit


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
    private let notice = Notice()
    /// Set once the user has read the sign-in note or a conversation has loaded (so they are signed in).
    private static let signInNoteKey = "SignInNoteSeen"
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
        bar.project = { [weak self] prepared, turns, note, done in
            guard let self else { return done(.failure("The panel closed.")) }
            self.project(prepared, turns: turns, note: note, done: done)
        }
        bar.isCurrent = { [weak self] candidate in
            guard let self, let prepared = self.prepared else { return false }
            return prepared.revision == candidate.revision && pageKey(self.web.url) == candidate.page
        }

        let column = NSStackView(views: [header(), notice, web, bar.view])
        if !UserDefaults.standard.bool(forKey: Self.signInNoteKey) {
            notice.show("This panel is its own browser, so ChatGPT will see a new device and may ask for a code and email you about a new sign-in. That is expected. You stay signed in after that.") {
                UserDefaults.standard.set(true, forKey: Self.signInNoteKey)
            }
        }
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

    /// Clears only WebKit's caches (memory, disk, fetch), then reloads. Cookies and site storage stay,
    /// so the sign-in survives; downloaded files and settings are not WebKit data at all.
    func clearWebCache() {
        let types: Set<String> = [WKWebsiteDataTypeMemoryCache, WKWebsiteDataTypeDiskCache, WKWebsiteDataTypeFetchCache,
                                  WKWebsiteDataTypeOfflineWebApplicationCache]
        WKWebsiteDataStore.default().removeData(ofTypes: types, modifiedSince: .distantPast) { [weak self] in
            HandoffTrace.event("web-cache-cleared")
            self?.web.reload()
        }
    }

    /// Clears the panel's own cookies and site data, then shows ChatGPT's sign-in page.
    func signOut() {
        let store = WKWebsiteDataStore.default()
        store.removeData(ofTypes: WKWebsiteDataStore.allWebsiteDataTypes(), modifiedSince: .distantPast) { [weak self] in
            self?.fileLinks.removeAll()
            self?.saved.clear()
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
            if !UserDefaults.standard.bool(forKey: Self.signInNoteKey) {
                UserDefaults.standard.set(true, forKey: Self.signInNoteKey)
                notice.dismiss()
            }
            // A late answer for a conversation the panel has already left is not the one on screen.
            guard let markdown = body["markdown"] as? String, page == pageKey(web.url) || isChatRoot(web.url) else { return }
            guard let attachments = parseAttachments(body["attachments"], lineCount: markdown.components(separatedBy: "\n").count),
                  let turnList = parseTurnList(body["turnList"]), turnList.count == body["turns"] as? Int else {
                return set(nil, .unavailable("This conversation could not be read."))
            }
            let prepared = Prepared(revision: UUID(), page: page, markdown: markdown,
                                    title: safeLabel(body["title"] as? String ?? "ChatGPT conversation", limit: 120),
                                    turns: turnList.count, files: body["files"] as? Int ?? 0,
                                    verification: body["verification"] as? String ?? "",
                                    issues: (body["issues"] as? [String] ?? []).map { safeLabel($0, limit: 200) },
                                    attachments: attachments,
                                    verifiedWithFiles: body["verifiedWithFiles"] as? Bool ?? false, turnList: turnList)
            set(prepared, .ready(prepared))
        case "file":
            // A link the page itself requested for one of its files; only https on ChatGPT's own hosts.
            guard let id = body["id"] as? String, let text = body["url"] as? String, let url = URL(string: text),
                  url.scheme == "https", let host = url.host,
                  chatHosts.contains(host) || host.hasSuffix(".oaiusercontent.com") else { return }
            guard let page = pageKey(URL(string: body["page"] as? String ?? "")) else { return }
            let key = id + "|" + (body["messageId"] as? String ?? "")
            fileLinks[key] = FileLink(url: url, name: body["name"] as? String ?? "", seen: Date(), page: page)
            settle(key)
        case "file-missing":
            settle((body["id"] as? String ?? "") + "|" + (body["messageId"] as? String ?? ""))
        case "changed": set(nil, .waiting)
        case "replying": set(nil, .replying)
        case "invalid": set(nil, .unavailable(safeLabel(body["message"] as? String ?? "", limit: 160)))
        case "unavailable": set(nil, .unavailable("The conversation could not be read. Open it again once any reply has finished."))
        default: break
        }
    }

    // MARK: some turns

    /// Asks the compiler, in the isolated world, for these turns of the conversation on screen. It
    /// answers only when each turn still has the hash shown, on the same page; the result is checked here.
    func project(_ prepared: Prepared, turns: [TurnInfo], note: String,
                 done: @escaping (ProjectionResult) -> Void) {
        guard self.prepared?.revision == prepared.revision, !turns.isEmpty else { return done(.failure("The conversation changed.")) }
        web.callAsyncJavaScript("return addToClaudeProject(page, turns, note)",
                                arguments: ["page": prepared.page, "turns": turns.map { ["id": $0.id, "sha256": $0.sha256] }, "note": note],
                                in: nil, in: .defaultClient) { [weak self] outcome in
            guard let self, self.prepared?.revision == prepared.revision else { return done(.failure("The conversation changed.")) }
            guard case .success(let value) = outcome, let body = value as? [String: Any] else {
                return done(.failure("These turns could not be prepared."))
            }
            if let error = body["error"] as? String { return done(.failure(safeLabel(error, limit: 160))) }
            guard let markdown = body["markdown"] as? String, markdown.utf8.count <= 16 * 1024 * 1024,
                  body["selectedTurns"] as? Int == turns.count,
                  let attachments = parseAttachments(body["attachments"], lineCount: markdown.components(separatedBy: "\n").count),
                  let verification = body["verification"] as? String else {
                return done(.failure("These turns could not be prepared."))
            }
            done(.success(ProjectedText(markdown: markdown, attachments: attachments, verification: verification,
                                        verifiedWithFiles: body["verifiedWithFiles"] as? Bool ?? false)))
        }
    }

    // MARK: files

    private let saved = SavedFiles.shared

    private func savedFile(_ file: Attachment, on page: String) -> (path: URL, sha256: String)? {
        saved.copy(page: page, file: file.id + "|" + file.messageId)
    }

    private func withFiles(_ prepared: Prepared) -> (String, String) {
        linkFiles(prepared, copies: Dictionary(uniqueKeysWithValues: prepared.attachments.compactMap { file in
            savedFile(file, on: prepared.page).map { (file.key, $0) }
        }))
    }

    /// The page's link for a file: the one fetched for this file in this message, or the page's own
    /// fetch by its file id, or by name when only one file in the conversation has that name. Only links
    /// fetched on this conversation's page count: sandbox paths and names repeat across conversations.
    /// Links last minutes.
    private func link(for file: Attachment) -> FileLink? {
        guard let prepared else { return nil }
        return chooseLink(fileLinks, for: file, on: prepared.page,
                          nameIsUnique: prepared.attachments.filter { $0.name == file.name }.count == 1)
    }

    private func fileRows() -> [FileRow] {
        guard let prepared else { return [] }
        return prepared.attachments.map { file in
            FileRow(id: file.key, name: file.name, turn: file.turn, saved: savedFile(file, on: prepared.page)?.path)
        }
    }

    /// Links the page has been asked for, and who is waiting on which of them.
    private var requested = Set<String>()
    private var waiters: [(id: UUID, keys: Set<String>, done: () -> Void)] = []

    /// Asks the page for fresh links to these files, the way it asks when the user opens one.
    /// Calls back when each has answered, or after 30 s.
    private func resolveLinks(_ files: [Attachment], done: @escaping () -> Void) {
        let missing = files.filter { link(for: $0) == nil }
        guard !missing.isEmpty else { return done() }
        let keys = Set(missing.map { $0.id + "|" + $0.messageId })
        let ask = missing.filter { !requested.contains($0.id + "|" + $0.messageId) }
        requested.formUnion(keys)
        let waiter = UUID()
        waiters.append((waiter, keys, done))
        if !ask.isEmpty {
            web.callAsyncJavaScript("addToClaudeResolve(files)", arguments: ["files": ask.map { ["id": $0.id, "messageId": $0.messageId] }],
                                    in: nil, in: .defaultClient) { _ in }
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 30) { [weak self] in
            guard let self, let index = self.waiters.firstIndex(where: { $0.id == waiter }) else { return }
            let late = self.waiters.remove(at: index)
            self.requested.subtract(late.keys)
            late.done()
        }
    }

    /// One file's link arrived, or the page could not get it.
    private func settle(_ key: String) {
        requested.remove(key)
        for index in waiters.indices { waiters[index].keys.remove(key) }
        let ready = waiters.filter(\.keys.isEmpty)
        waiters.removeAll { $0.keys.isEmpty }
        ready.forEach { $0.done() }
    }

    /// Downloads the chosen files that are not saved yet into the conversation's folder.
    private func downloadSelected(_ keys: [String], done: @escaping () -> Void) {
        guard let prepared else { return done() }
        let wanted = prepared.attachments.filter { keys.contains($0.key) && savedFile($0, on: prepared.page) == nil }
        guard !wanted.isEmpty else { return done() }
        resolveLinks(wanted) { [weak self] in self?.download(wanted, of: prepared, done: done) ?? done() }
    }

    private func download(_ wanted: [Attachment], of prepared: Prepared, done: @escaping () -> Void) {
        let items = wanted.compactMap { file in link(for: file).map { FileFetcher.Item(key: file.key, link: FileLink(url: $0.url, name: file.name, seen: $0.seen)) } }
        guard !items.isEmpty else {
            bar.filesChanged("No download link for \(wanted.count == 1 ? wanted[0].name : "\(wanted.count) files"). Open it once in the chat, then try again.")
            return done()
        }
        fetcher.fetch(items, into: FilesFolder.folder(for: prepared.title)) { [weak self] outcomes in
            guard let self else { return }
            for file in wanted {
                if let outcome = outcomes[file.key], let path = outcome.path, let hash = outcome.sha256 {
                    self.saved.saved(page: prepared.page, file: file.id + "|" + file.messageId, path: path, sha256: hash)
                }
            }
            let failed = outcomes.values.compactMap(\.problem)
            let unlinked = wanted.count - items.count
            self.bar.filesChanged((failed.isEmpty ? "\(outcomes.count) file\(outcomes.count == 1 ? "" : "s") saved."
                                   : "\(outcomes.count - failed.count) saved; \(failed.count) failed: \(failed[0]).")
                                  + (unlinked > 0 ? " \(unlinked) had no download link." : ""))
            done()
        }
    }

    // MARK: navigation

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url else { return decisionHandler(.cancel) }
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
        // Google does not allow its sign-in in embedded browsers. Say so plainly instead of working around it.
        if let url = response.response.url, url.host == "accounts.google.com",
           (response.response as? HTTPURLResponse)?.statusCode == 403 || url.absoluteString.contains("disallowed_useragent") {
            notice.show("Google sign-in is not available inside this panel. Sign in to ChatGPT with your email and password instead.")
        }
        decisionHandler(response.canShowMIMEType ? .allow : .download)
    }

    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        if webView === web { set(nil, .waiting) }
    }

    private var lastCrash = Date.distantPast
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        HandoffTrace.event("web-content-process-terminated")
        guard webView === web else { return }
        // Reload once; a page that keeps crashing waits for the user instead of looping.
        if Date().timeIntervalSince(lastCrash) > 60 {
            set(nil, .unavailable("The page stopped. It is reloading."))
            web.reload()
        } else { set(nil, .unavailable("The page stopped again. Quit and reopen Add to Claude.")) }
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

    /// The page's own downloads go straight into the conversation's folder. When exactly one file in
    /// that conversation has the downloaded name, Add can then point at it.
    private var pageDownloads: [ObjectIdentifier: (path: URL, name: String, prepared: Prepared?)] = [:]

    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String,
                  completionHandler: @escaping (URL?) -> Void) {
        let folder = FilesFolder.folder(for: prepared?.title ?? "ChatGPT")
        guard (try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)) != nil else {
            bar.filesChanged("The files folder is not writable. Choose another in Settings.")
            return completionHandler(nil)
        }
        let path = freePath(in: folder, for: safeFileName(suggestedFilename, fallback: "download"))
        pageDownloads[ObjectIdentifier(download)] = (path, suggestedFilename, prepared)
        completionHandler(path)
    }

    func downloadDidFinish(_ download: WKDownload) {
        guard let (written, name, prepared) = pageDownloads.removeValue(forKey: ObjectIdentifier(download)),
              let hash = sha256(of: written) else { return }
        let path = reuseIdentical(written, sha256: hash, name: safeFileName(name, fallback: "download"))
        if let prepared, case let matches = prepared.attachments.filter({ $0.name == name }), matches.count == 1 {
            saved.saved(page: prepared.page, file: matches[0].id + "|" + matches[0].messageId, path: path, sha256: hash)
        }
        bar.filesChanged("Saved \(path.lastPathComponent) to the files folder.")
    }

    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        guard pageDownloads.removeValue(forKey: ObjectIdentifier(download)) != nil else { return }
        bar.filesChanged("The download failed. Try it again in the chat.")
    }
}
