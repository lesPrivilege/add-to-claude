import AppKit
import ApplicationServices
import CryptoKit

private let hostName = "io.lesprivilege.gpt_handoff"

func glyph(_ name: String, size: CGFloat = 16) -> NSImage? {
    guard let url = Bundle.main.url(forResource: name, withExtension: "svg", subdirectory: "icons"),
          let image = NSImage(contentsOf: url) else { return nil }
    image.isTemplate = true
    image.size = NSSize(width: size, height: size)
    return image
}

private func label(_ text: String = "", size: CGFloat = 12, weight: NSFont.Weight = .regular,
                   color: NSColor = .labelColor) -> NSTextField {
    let field = NSTextField(labelWithString: text)
    field.font = .systemFont(ofSize: size, weight: weight)
    field.textColor = color
    field.lineBreakMode = .byTruncatingTail
    field.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
    return field
}

private func iconButton(_ name: String, _ title: String, _ action: Selector, _ target: AnyObject) -> NSButton {
    let button = NSButton(image: glyph(name) ?? NSImage(), target: target, action: action)
    button.bezelStyle = .accessoryBarAction
    button.isBordered = true
    button.toolTip = title
    button.setAccessibilityLabel(title)
    button.widthAnchor.constraint(equalToConstant: 28).isActive = true
    button.heightAnchor.constraint(equalToConstant: 24).isActive = true
    return button
}

/// Glyph plus one word; a dashed outline means the state is not fully in effect.
final class Tag: NSView {
    private let image = NSImageView()
    private let text = label(size: 11, color: .secondaryLabelColor)
    var dashed = false { didSet { needsDisplay = true } }

    init() {
        super.init(frame: .zero)
        image.contentTintColor = .secondaryLabelColor
        text.setContentHuggingPriority(.required, for: .horizontal)
        let row = NSStackView(views: [image, text])
        row.spacing = 3
        row.edgeInsets = NSEdgeInsets(top: 1, left: 4, bottom: 1, right: 6)
        row.translatesAutoresizingMaskIntoConstraints = false
        setContentHuggingPriority(.required, for: .horizontal)
        addSubview(row)
        NSLayoutConstraint.activate([
            row.leadingAnchor.constraint(equalTo: leadingAnchor), row.trailingAnchor.constraint(equalTo: trailingAnchor),
            row.topAnchor.constraint(equalTo: topAnchor), row.bottomAnchor.constraint(equalTo: bottomAnchor),
        ])
    }
    required init?(coder: NSCoder) { fatalError() }

    func show(_ word: String, glyph name: String, dashed: Bool, help: String? = nil) {
        text.stringValue = word
        image.image = glyph(name, size: 12)
        self.dashed = dashed
        toolTip = help
        setAccessibilityLabel(word)
    }

    override func draw(_ dirtyRect: NSRect) {
        let path = NSBezierPath(roundedRect: bounds.insetBy(dx: 0.5, dy: 0.5), xRadius: 4, yRadius: 4)
        if dashed { path.setLineDash([3, 2], count: 2, phase: 0) }
        NSColor.tertiaryLabelColor.setStroke()
        path.stroke()
    }
}

final class HandoffViewController: NSViewController {
    private let link: ChromeLink
    private let registry = ComposerRegistry()
    private var chrome: [String: Any]?
    private var targets: [Target] = []
    private var composer: Composer?
    private var discovering = false
    private var busy = false
    private var operation = UUID()
    /// A save panel is open, so closing the popover must not hand focus away.
    private(set) var saving = false

    private let sourceTitle = label(size: 13, weight: .semibold)
    private let sourceDetail = label(color: .secondaryLabelColor)
    private let tag = Tag()
    private lazy var preview = iconButton("preview", "Preview context", #selector(togglePreview), self)
    private lazy var save = iconButton("save", "Save Markdown…", #selector(saveMarkdown), self)
    private let previewText = NSTextView()
    private lazy var previewScroll = NSScrollView()
    private let picker = NSPopUpButton(frame: .zero, pullsDown: false)
    private let targetRow = NSStackView()
    private lazy var refresh = iconButton("refresh", "Find open windows", #selector(findWindows), self)
    private lazy var add = NSButton(title: "Add", target: self, action: #selector(addContext))
    private let statusGlyph = NSImageView()
    private let statusText = label(color: .secondaryLabelColor)
    private let statusRow = NSStackView()
    private lazy var setup = NSButton(title: "Set up Chrome…", target: self, action: #selector(setUpChrome))
    private lazy var access = NSButton(title: "Allow Accessibility…", target: self, action: #selector(allowAccess))

    init(link: ChromeLink) {
        self.link = link
        super.init(nibName: nil, bundle: nil)
    }
    required init?(coder: NSCoder) { fatalError() }

    override func loadView() {
        let chatIcon = NSImageView(image: glyph("chat") ?? NSImage())
        let agentIcon = NSImageView(image: glyph("agent") ?? NSImage())
        for icon in [chatIcon, agentIcon] { icon.contentTintColor = .secondaryLabelColor }

        let facts = NSStackView(views: [sourceDetail, tag, NSView()])
        facts.spacing = 6
        let text = NSStackView(views: [sourceTitle, facts])
        text.orientation = .vertical
        text.alignment = .leading
        text.spacing = 3
        let source = NSStackView(views: [chatIcon, text, NSView(), preview, save])
        source.alignment = .centerY
        source.spacing = 8

        previewText.isEditable = false
        previewText.isRichText = false
        previewText.font = .monospacedSystemFont(ofSize: 11, weight: .regular)
        previewText.textContainerInset = NSSize(width: 4, height: 6)
        previewText.autoresizingMask = [.width]
        previewScroll.documentView = previewText
        previewScroll.hasVerticalScroller = true
        previewScroll.borderType = .lineBorder
        previewScroll.heightAnchor.constraint(equalToConstant: 220).isActive = true
        previewScroll.isHidden = true

        picker.setAccessibilityLabel("Composer window")
        picker.target = self
        picker.action = #selector(choose)
        targetRow.setViews([agentIcon, picker, refresh], in: .leading)
        targetRow.spacing = 8
        for button in [setup, access] {
            button.bezelStyle = .rounded
            button.imagePosition = .imageLeading
        }
        setup.image = glyph("chat")
        access.image = glyph("lock")

        add.image = glyph("add")
        add.imagePosition = .imageLeading
        add.bezelStyle = .rounded
        add.controlSize = .large
        add.lineBreakMode = .byTruncatingTail

        statusGlyph.contentTintColor = .secondaryLabelColor
        statusText.maximumNumberOfLines = 4
        statusText.lineBreakMode = .byWordWrapping
        statusText.cell?.truncatesLastVisibleLine = true
        statusRow.setViews([statusGlyph, statusText], in: .leading)
        statusRow.alignment = .top
        statusRow.spacing = 6
        statusRow.isHidden = true

        let separator = NSBox()
        separator.boxType = .separator
        let column = NSStackView(views: [source, previewScroll, separator, targetRow, add, setup, access, statusRow])
        column.orientation = .vertical
        column.alignment = .leading
        column.spacing = 10
        column.edgeInsets = NSEdgeInsets(top: 14, left: 14, bottom: 14, right: 14)
        for row in [source, previewScroll, separator, targetRow, add, statusRow] as [NSView] {
            row.widthAnchor.constraint(equalTo: column.widthAnchor, constant: -28).isActive = true
        }
        column.widthAnchor.constraint(equalToConstant: 340).isActive = true
        view = column
        render()
    }

    // MARK: state

    func chromeChanged(_ state: [String: Any]?) {
        let revision = chrome?["revision"] as? String
        chrome = state
        if revision != state?["revision"] as? String { hidePreview(); say("") }
        render()
    }

    /// Re-read everything that can change while the popover is closed.
    func willShow() {
        findWindows()
        render()
    }

    private var ready: Bool { chrome?["status"] as? String == "ready" }

    private func render() {
        guard isViewLoaded else { return }
        let status = chrome?["status"] as? String
        let title = (chrome?["title"] as? String).flatMap { $0.isEmpty ? nil : $0 }
        sourceTitle.stringValue = chrome == nil ? "Chrome is not connected" : title ?? "No ChatGPT tab"
        switch (chrome == nil, status) {
        case (true, _): sourceDetail.stringValue = "Open Chrome to connect."
        case (_, "ready"):
            let turns = chrome?["turns"] as? Int ?? 0, files = chrome?["files"] as? Int ?? 0
            let tooLong = (chrome?["bytes"] as? Int ?? 0) > maximumTextBytes
            sourceDetail.stringValue = "\(turns) turns · \(files) file\(files == 1 ? "" : "s")" + (tooLong ? " · too long, save instead" : "")
        case (_, "waiting"): sourceDetail.stringValue = "Open a conversation in this tab."
        case (_, "none"): sourceDetail.stringValue = "Switch to a ChatGPT conversation in Chrome."
        default: sourceDetail.stringValue = chrome?["message"] as? String ?? ""
        }
        sourceDetail.toolTip = sourceDetail.stringValue
        sourceTitle.toolTip = chrome?["page"] as? String
        if ready, let verification = chrome?["verification"] as? String {
            let issues = (chrome?["issues"] as? [String])?.joined(separator: "\n")
            if verification == "verified" { tag.show("Verified", glyph: "done", dashed: false) }
            else { tag.show("Partial", glyph: "unverified", dashed: true, help: issues) }
            tag.isHidden = false
        } else { tag.isHidden = true }
        preview.isHidden = !ready
        save.isHidden = !ready
        preview.state = previewScroll.isHidden ? .off : .on

        let trusted = AXIsProcessTrusted()
        access.isHidden = trusted
        setup.isHidden = chrome != nil
        targetRow.isHidden = !trusted
        add.isHidden = !trusted
        renderPicker(trusted: trusted)
        picker.isEnabled = trusted && !targets.isEmpty && !busy && !discovering
        refresh.isEnabled = trusted && !busy && !discovering

        let name = composer.map { safeLabel($0.choice.app.localizedName ?? "Agent", limit: 32) }
        add.title = name.map { "Add to \($0)" } ?? "Add"
        let bytes = chrome?["bytes"] as? Int ?? 0
        add.isEnabled = ready && composer != nil && !busy && bytes <= maximumTextBytes
    }

    private var pickerSignature = ""
    /// Rebuilt only when its rows change, so Chrome state updates never disturb an open menu.
    private func renderPicker(trusted: Bool) {
        let selectedId = composer.flatMap { registry.id(of: $0) }
        let signature = "\(trusted)|\(discovering)|\(selectedId ?? "")|" + targets.map(\.id).joined(separator: ",")
        guard signature != pickerSignature else { return }
        pickerSignature = signature
        picker.removeAllItems()
        picker.addItem(withTitle: !trusted ? "Allow Accessibility first" : discovering ? "Finding windows…" : targets.isEmpty ? "No open windows" : "Choose a window…")
        picker.item(at: 0)?.isEnabled = false
        for target in targets {
            picker.addItem(withTitle: "\(target.app) — \(target.window)")
            picker.lastItem?.representedObject = target.id
            picker.lastItem?.image = target.icon.map { icon in
                let copy = icon.copy() as! NSImage
                copy.size = NSSize(width: 16, height: 16)
                return copy
            }
        }
        if let selectedId, let index = targets.firstIndex(where: { $0.id == selectedId }) { picker.selectItem(at: index + 1) }
        else { picker.selectItem(at: 0) }
    }

    private func say(_ text: String, glyph name: String? = nil) {
        statusText.stringValue = text
        statusGlyph.image = name.flatMap { glyph($0, size: 14) }
        statusGlyph.isHidden = name == nil
        statusRow.isHidden = text.isEmpty
    }

    // MARK: targets

    @objc private func findWindows() {
        guard AXIsProcessTrusted(), !discovering else { return render() }
        discovering = true
        render()
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            let found = ComposerRegistry.discover()
            DispatchQueue.main.async {
                guard let self else { return }
                self.registry.apply(found)
                self.targets = found.targets
                self.discovering = false
                if let composer = self.composer, self.registry.id(of: composer) == nil { self.composer = nil }
                self.render()
            }
        }
    }

    @objc private func choose() {
        guard let id = picker.selectedItem?.representedObject as? String else { return }
        composer = registry.composer(id)
        if composer == nil {
            say("Click into that window's message box once, then choose it again.", glyph: "error")
        } else { say("") }
        render()
    }

    @objc private func allowAccess() {
        let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
        _ = AXIsProcessTrustedWithOptions(options)
        say("Turn on gpt-handoff in System Settings → Privacy & Security → Accessibility.")
        render()
    }

    // MARK: context

    /// Fetches the prepared Markdown and checks it is exactly the revision the popover shows.
    private func context(_ completion: @escaping (String?, String, String) -> Void) {
        let revision = chrome?["revision"] as? String ?? ""
        link.request("context", timeout: 10) { reply in
            guard let reply, reply["ok"] as? Bool == true, let text = reply["markdown"] as? String,
                  let hash = reply["hash"] as? String, reply["revision"] as? String == revision,
                  SHA256.hash(data: Data(text.utf8)).map({ String(format: "%02x", $0) }).joined() == hash else {
                return completion(nil, revision, "")
            }
            completion(text, revision, hash)
        }
    }

    @objc private func togglePreview() {
        if !previewScroll.isHidden { return hidePreview() }
        context { [weak self] text, _, _ in
            guard let self else { return }
            guard let text else { return self.say("The conversation changed. Try again.", glyph: "error") }
            self.previewText.string = text
            self.previewText.scrollToBeginningOfDocument(nil)
            self.previewScroll.isHidden = false
            self.render()
        }
    }

    private func hidePreview() {
        previewText.string = ""
        previewScroll.isHidden = true
        render()
    }

    @objc private func saveMarkdown() {
        let title = (chrome?["title"] as? String).map { safeLabel($0, limit: 60) } ?? "ChatGPT conversation"
        context { [weak self] text, _, _ in
            guard let self else { return }
            guard let text else { return self.say("The conversation changed. Try again.", glyph: "error") }
            let panel = NSSavePanel()
            panel.nameFieldStringValue = title.replacingOccurrences(of: "/", with: "-") + ".md"
            panel.allowedContentTypes = [.init(filenameExtension: "md")!]
            self.saving = true
            NSApp.activate()
            panel.begin { response in
                self.saving = false
                defer { if self.view.window?.isVisible != true { NSApp.hide(nil) } }
                guard response == .OK, let url = panel.url else { return }
                do {
                    try Data(text.utf8).write(to: url, options: .atomic)
                    self.say("Saved \(url.lastPathComponent).", glyph: "done")
                } catch { self.say("Could not save there. Choose another folder.", glyph: "error") }
            }
        }
    }

    // MARK: setup

    /// Registers the bundled relay for the extension's fixed id and shows the extension folder to load.
    @objc private func setUpChrome() {
        let relay = Bundle.main.bundleURL.appendingPathComponent("Contents/MacOS/gpt-handoff-host").path
        let manifest: [String: Any] = ["name": hostName, "description": "gpt-handoff relay", "path": relay,
                                       "type": "stdio", "allowed_origins": [nativeHostAllowedOrigin]]
        let folder = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Application Support/Google/Chrome/NativeMessagingHosts")
        do {
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            let data = try JSONSerialization.data(withJSONObject: manifest, options: [.prettyPrinted, .withoutEscapingSlashes])
            try data.write(to: folder.appendingPathComponent(hostName + ".json"), options: .atomic)
        } catch { return say("Could not register with Chrome. Check that Chrome's support folder is writable.", glyph: "error") }
        if let extensionFolder = Bundle.main.url(forResource: "extension", withExtension: nil) {
            NSWorkspace.shared.activateFileViewerSelecting([extensionFolder])
        }
        say("In Chrome: chrome://extensions → Developer mode → Load unpacked → choose the selected folder. Then reload ChatGPT.")
    }

    // MARK: add

    @objc private func addContext() {
        guard !busy, let selected = composer, ready else { return }
        busy = true
        let id = UUID()
        operation = id
        say("Adding…", glyph: "waiting")
        render()
        context { [weak self] text, revision, hash in
            guard let self else { return }
            guard self.operation == id, let text else { return self.finish("The conversation changed. Nothing was added.", false) }
            appendToComposer(selected, text: text,
                operationValid: { [weak self] in self?.operation == id && self?.chrome?["revision"] as? String == revision },
                revalidateSource: { [weak self] reply in
                    guard let self else { return reply(false) }
                    self.link.request("check", ["revision": revision, "hash": hash]) { answer in
                        reply(answer?["current"] as? Bool == true)
                    }
                },
                completion: { [weak self] message, success in self?.finish(message, success) })
        }
    }

    private func finish(_ message: String, _ success: Bool) {
        busy = false
        say(message, glyph: success ? "done" : "error")
        render()
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate, NSPopoverDelegate {
    private var item: NSStatusItem!
    private let popover = NSPopover()
    private var controller: HandoffViewController!
    private var link: ChromeLink!

    func applicationDidFinishLaunching(_ notification: Notification) {
        signal(SIGPIPE, SIG_IGN)
        let relay = Bundle.main.bundleURL.appendingPathComponent("Contents/MacOS/gpt-handoff-host").resolvingSymlinksInPath().path
        link = ChromeLink(allowedPeer: relay)
        controller = HandoffViewController(link: link)
        link.onState = { [weak self] state in self?.controller.chromeChanged(state) }
        if !link.start() {
            let alert = NSAlert()
            alert.messageText = "gpt-handoff could not start its Chrome link."
            alert.informativeText = "Quit other copies of gpt-handoff, then open it again."
            alert.runModal()
            NSApp.terminate(nil)
        }

        popover.contentViewController = controller
        popover.behavior = .transient
        popover.animates = false
        popover.delegate = self
        item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        item.button?.image = glyph("add", size: 18)
        item.button?.setAccessibilityLabel("gpt-handoff")
        item.button?.toolTip = "gpt-handoff"
        item.button?.target = self
        item.button?.action = #selector(click)
        item.button?.sendAction(on: [.leftMouseUp, .rightMouseUp])
    }

    @objc private func click() {
        if NSApp.currentEvent?.type == .rightMouseUp {
            let menu = NSMenu()
            menu.addItem(withTitle: "Quit gpt-handoff", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
            item.menu = menu
            item.button?.performClick(nil)
            item.menu = nil
            return
        }
        if popover.isShown { return popover.performClose(nil) }
        guard let button = item.button else { return }
        controller.willShow()
        // Activation makes the popover key; it raises no window, so Chrome and the target stay put.
        NSApp.activate()
        popover.show(relativeTo: button.bounds, of: button, preferredEdge: .minY)
    }

    /// Hand focus back to whatever the user was using.
    func popoverDidClose(_ notification: Notification) {
        if !controller.saving { NSApp.hide(nil) }
    }
}
