import AppKit
import WebKit

private final class ChatPanel: NSPanel {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { true }
    override func cancelOperation(_ sender: Any?) { orderOut(nil) }
}

/// Website content and local compilation use separate webviews and data stores.
/// Only the local compiled text can reach the app-owned Add callback.
final class WorkspaceController: NSWindowController, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler, NSWindowDelegate {
    let source: WKWebView
    private let core: WKWebView
    private let status = NSTextField(labelWithString: "Sign in to ChatGPT here. Choose an open composer when ready.")
    private let target = NSPopUpButton(frame: .zero, pullsDown: true)
    private let add = NSButton(title: "Add to Agent", target: nil, action: nil)
    private let preview = NSButton(title: "Preview", target: nil, action: nil)
    private var response: [String: Any]?
    private var prepared: [String: Any]?
    private var sourceVersion = 0
    private var preparingVersion: Int?
    private var inserting = false
    private var selectedTarget = false
    private var coreReady = false
    private var responsePageIdentity: String?
    private var locationObservation: NSKeyValueObservation?
    private var previewPanel: NSPanel?
    private var popups: [NSWindow] = []
    var refreshTargets: (() -> Void)?
    var addText: ((String, @escaping () -> Bool, @escaping (String, Bool) -> Void) -> Void)?

    init(coreURL: URL, observerScript: String) {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        source = WKWebView(frame: .zero, configuration: configuration)
        let coreConfiguration = WKWebViewConfiguration()
        coreConfiguration.websiteDataStore = .nonPersistent()
        core = WKWebView(frame: .zero, configuration: coreConfiguration)
        let panel = ChatPanel(contentRect: NSRect(x: 0, y: 0, width: 940, height: 740),
                              styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        panel.title = "Handoff"
        panel.minSize = NSSize(width: 600, height: 480)
        panel.isReleasedWhenClosed = false
        panel.hidesOnDeactivate = false
        panel.hasShadow = false
        panel.setFrameAutosaveName("HandoffChatWindow")
        super.init(window: panel)
        panel.delegate = self
        target.addItem(withTitle: "Choose Agent")
        source.navigationDelegate = self
        source.uiDelegate = self
        locationObservation = source.observe(\.url, options: [.new]) { [weak self] view, _ in
            guard let self, let captured = self.responsePageIdentity, captured != view.url?.absoluteString else { return }
            self.invalidateSource("Waiting for the current conversation's original data.")
        }
        core.navigationDelegate = self
        source.configuration.userContentController.add(self, name: "handoffSource")
        source.configuration.userContentController.addUserScript(WKUserScript(source: observerScript, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        let back = NSButton(title: "‹", target: self, action: #selector(goBack))
        back.toolTip = "Back"
        back.setAccessibilityLabel("Back")
        let chat = NSTextField(labelWithString: "ChatGPT")
        chat.font = .systemFont(ofSize: 13, weight: .medium)
        let spacer = NSView()
        spacer.setContentHuggingPriority(.defaultLow, for: .horizontal)
        for button in [back, target, add, preview] { button.controlSize = .small; button.bezelStyle = .rounded }
        add.target = self; add.action = #selector(addPrepared)
        preview.target = self; preview.action = #selector(showPreview)
        preview.isEnabled = false
        let bar = NSStackView(views: [back, chat, spacer, target, preview, add])
        bar.orientation = .horizontal
        bar.spacing = 8
        bar.edgeInsets = NSEdgeInsets(top: 7, left: 12, bottom: 7, right: 12)
        status.font = .systemFont(ofSize: 11)
        status.textColor = .secondaryLabelColor
        status.lineBreakMode = .byTruncatingTail
        let footer = NSStackView(views: [status])
        footer.edgeInsets = NSEdgeInsets(top: 4, left: 12, bottom: 6, right: 12)
        let column = NSStackView(views: [bar, source, footer])
        column.orientation = .vertical
        column.spacing = 0
        column.alignment = .leading
        column.translatesAutoresizingMaskIntoConstraints = false
        panel.contentView?.addSubview(column)
        NSLayoutConstraint.activate([
            column.leadingAnchor.constraint(equalTo: panel.contentView!.leadingAnchor),
            column.trailingAnchor.constraint(equalTo: panel.contentView!.trailingAnchor),
            column.topAnchor.constraint(equalTo: panel.contentView!.topAnchor),
            column.bottomAnchor.constraint(equalTo: panel.contentView!.bottomAnchor),
            bar.widthAnchor.constraint(equalTo: column.widthAnchor),
            source.widthAnchor.constraint(equalTo: column.widthAnchor),
            footer.widthAnchor.constraint(equalTo: column.widthAnchor),
            source.heightAnchor.constraint(greaterThanOrEqualToConstant: 300)
        ])
        source.setContentHuggingPriority(.defaultLow, for: .vertical)
        panel.center()
        core.load(URLRequest(url: coreURL))
        source.load(URLRequest(url: URL(string: "https://chatgpt.com/")!))
        updateAdd()
    }

    required init?(coder: NSCoder) { fatalError("Not used") }

    func present() {
        showWindow(nil)
        NSApp.activate(ignoringOtherApps: true)
        window?.makeKeyAndOrderFront(nil)
        refreshTargets?()
    }

    func setTargets(_ menu: NSMenu) {
        let title = target.item(at: 0)?.title ?? "Choose Agent"
        menu.insertItem(withTitle: title, action: nil, keyEquivalent: "", at: 0)
        target.menu = menu
    }

    func setTarget(name: String?, detail: String? = nil) {
        selectedTarget = name != nil
        target.item(at: 0)?.title = name ?? "Choose Agent"
        target.toolTip = detail
        add.title = name.map { "Add to \($0)" } ?? "Add to Agent"
        updateAdd()
    }

    func showStatus(_ text: String) { status.stringValue = text }
    private var preparedIsVerified: Bool {
        let model = prepared?["model"] as? [String: Any]
        let verification = model?["verification"] as? [String: Any]
        return verification?["status"] as? String == "verified"
    }
    private func updateAdd() {
        add.isEnabled = selectedTarget && preparedIsVerified && coreReady && preparingVersion == nil && !inserting
        preview.isEnabled = prepared != nil
    }
    func connectCore(_ url: URL) { if !coreReady && !core.isLoading { core.load(URLRequest(url: url)) } }
    func windowDidBecomeKey(_ notification: Notification) { refreshTargets?() }
    @objc private func goBack() { if source.canGoBack { source.goBack() } }

    private func invalidateSource(_ message: String, keepingResponse: Bool = false) {
        sourceVersion += 1
        preparingVersion = nil
        prepared = nil
        if !keepingResponse {
            response = nil
            responsePageIdentity = nil
        }
        preview.isEnabled = false
        if let scroll = previewPanel?.contentView?.subviews.first as? NSScrollView,
           let editor = scroll.documentView as? NSTextView { editor.string = "" }
        previewPanel?.orderOut(nil)
        status.stringValue = message
        updateAdd()
    }

    private func packetMatchesCurrentPage(_ packet: [String: Any]) -> Bool {
        guard let text = packet["pageUrl"] as? String, let reported = URL(string: text),
              let current = source.url, current.scheme == "https",
              ["chatgpt.com", "chat.openai.com"].contains(current.host ?? ""),
              current.user == nil, current.password == nil,
              current.port == nil || current.port == 443 else { return false }
        return reported.scheme == current.scheme && reported.host == current.host
            && (reported.port ?? 443) == (current.port ?? 443) && reported.path == current.path
            && reported.user == nil && reported.password == nil
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.webView === source, message.frameInfo.isMainFrame,
              message.frameInfo.securityOrigin.protocol == "https",
              ["chatgpt.com", "chat.openai.com"].contains(message.frameInfo.securityOrigin.host),
              [0, 443].contains(message.frameInfo.securityOrigin.port),
              let packet = message.body as? [String: Any], let kind = packet["kind"] as? String,
              packetMatchesCurrentPage(packet) else { return }
        invalidateSource("Waiting for the current conversation's original data.")
        defer { updateAdd() }
        guard kind == "response", let body = packet["body"] as? String, body.utf8.count <= 64 * 1024 * 1024,
              let pageURL = packet["pageUrl"] as? String,
              let current = source.url, current.scheme == "https",
              current.scheme! + "://" + (current.host ?? "") + current.path == pageURL else {
            status.stringValue = kind == "unavailable" ? "Original messages are unavailable. The chat remains usable." : "Waiting for the current conversation's original data."
            return
        }
        response = packet
        responsePageIdentity = source.url?.absoluteString
        prepareSource()
    }

    private func prepareSource() {
        guard coreReady, let response, preparingVersion != sourceVersion else { return }
        guard packetMatchesCurrentPage(response), responsePageIdentity == source.url?.absoluteString else {
            invalidateSource("Waiting for the current conversation's original data.")
            return
        }
        let version = sourceVersion
        preparingVersion = version
        updateAdd()
        status.stringValue = "Preparing the selected conversation…"
        let evidence: [String: Any] = ["pageUrl": response["pageUrl"] ?? "", "responseUrl": response["responseUrl"] ?? "", "capturedAt": response["capturedAt"] ?? "", "method": response["method"] ?? "GET"]
        core.callAsyncJavaScript("return window.handoffCore.compile(body, evidence)", arguments: ["body": response["body"] ?? "", "evidence": evidence], in: nil, in: .page) { [weak self] result in
            guard let self, version == self.sourceVersion else { return }
            self.preparingVersion = nil
            defer { self.updateAdd() }
            guard case .success(let value) = result, let compiled = value as? [String: Any],
                  compiled["markdown"] is String, compiled["model"] is [String: Any] else {
                self.status.stringValue = "This conversation's original data could not be prepared. The chat is unchanged."
                return
            }
            self.prepared = compiled
            self.status.stringValue = self.preparedIsVerified
                ? "Context ready. Choose a composer, then Add. Nothing is sent by Handoff."
                : "Some content or files need attention. Open Preview to review the gaps."
        }
    }

    @objc private func addPrepared() {
        guard !inserting, selectedTarget, preparedIsVerified,
              let text = prepared?["markdown"] as? String, let addText else { return }
        let version = sourceVersion
        let isCurrent: () -> Bool = { [weak self] in
            guard let self, version == self.sourceVersion, let response = self.response else { return false }
            return self.preparedIsVerified && self.packetMatchesCurrentPage(response)
                && self.responsePageIdentity == self.source.url?.absoluteString
        }
        guard isCurrent() else { invalidateSource("The source changed. Wait for the current conversation."); return }
        inserting = true
        updateAdd()
        status.stringValue = "Adding to the selected composer…"
        addText(text, isCurrent) { [weak self] message, success in
            guard let self else { return }
            self.inserting = false
            if version == self.sourceVersion { self.status.stringValue = message }
            if success { self.setTarget(name: nil) }
            self.updateAdd()
        }
    }

    @objc private func showPreview() {
        guard let text = prepared?["markdown"] as? String else { return }
        if previewPanel == nil {
            let panel = NSPanel(contentRect: NSRect(x: 0, y: 0, width: 620, height: 520), styleMask: [.titled, .closable, .resizable], backing: .buffered, defer: false)
            panel.title = "Handoff preview"
            panel.isReleasedWhenClosed = false
            panel.hasShadow = false
            let scroll = NSScrollView(frame: panel.contentView!.bounds)
            scroll.autoresizingMask = [.width, .height]
            scroll.hasVerticalScroller = true
            let editor = NSTextView(frame: scroll.bounds)
            editor.isEditable = false
            editor.isRichText = false
            editor.font = .monospacedSystemFont(ofSize: 12, weight: .regular)
            editor.autoresizingMask = [.width]
            editor.isVerticallyResizable = true
            scroll.documentView = editor
            panel.contentView?.addSubview(scroll)
            previewPanel = panel
        }
        if let scroll = previewPanel?.contentView?.subviews.first as? NSScrollView, let editor = scroll.documentView as? NSTextView { editor.string = text }
        previewPanel?.center()
        previewPanel?.makeKeyAndOrderFront(nil)
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else { decisionHandler(.cancel); return }
        if webView === core {
            decisionHandler(url.scheme == "http" && url.host == "127.0.0.1" && url.port == 43119 && url.path == "/native-core.html" ? .allow : .cancel)
        } else { decisionHandler(url.scheme == "https" || url.absoluteString == "about:blank" ? .allow : .cancel) }
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        if webView === source { status.stringValue = "ChatGPT could not load. Check the connection; your chat session is retained." }
        if webView === core { coreReady = false; updateAdd() }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        if webView === core { coreReady = true; prepareSource(); updateAdd() }
    }

    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        if webView === source { invalidateSource("Waiting for the current conversation's original data.") }
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        if webView === source { invalidateSource("ChatGPT stopped responding. Reopen Handoff to reconnect.") }
        if webView === core { coreReady = false; invalidateSource("Preparation stopped. Reopen Handoff to retry; the chat is retained.", keepingResponse: true) }
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        guard webView !== core, navigationAction.targetFrame == nil,
              navigationAction.request.url?.scheme == "https" else { return nil }
        // Login/provider popups remain inside this application and use WebKit's supplied session.
        let popup = WKWebView(frame: NSRect(x: 0, y: 0, width: 620, height: 680), configuration: configuration)
        popup.navigationDelegate = self
        popup.uiDelegate = self
        let panel = NSWindow(contentRect: popup.frame, styleMask: [.titled, .closable, .resizable], backing: .buffered, defer: false)
        panel.title = "ChatGPT"
        panel.contentView = popup
        panel.isReleasedWhenClosed = false
        panel.center()
        popups.append(panel)
        panel.makeKeyAndOrderFront(nil)
        return popup
    }

    func webViewDidClose(_ webView: WKWebView) {
        if let panel = popups.first(where: { $0.contentView === webView }) { panel.close(); popups.removeAll { $0 === panel } }
    }
}
