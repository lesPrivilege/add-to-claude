import AppKit
import ApplicationServices

/// The conversation on screen, compiled in the page's isolated content world. Memory only.
struct Prepared {
    let revision: UUID
    let page: String
    let markdown: String
    let title: String
    let turns: Int
    let files: Int
    let verification: String
    let issues: [String]
}

enum SourceState {
    case waiting
    case ready(Prepared)
    case unavailable(String)
}

/// The strip under the chat: what will be handed off, to which window, and Add.
final class HandoffBar: NSViewController {
    /// Whether this exact preparation is still what the page shows. Checked again just before writing.
    var isCurrent: (Prepared) -> Bool = { _ in false }
    private var source = SourceState.waiting
    private let registry = ComposerRegistry()
    private var targets: [Target] = []
    private var composer: Composer?
    private var discovering = false
    private var busy = false
    private var operation = UUID()
    private(set) var panelOpen = false

    private let sourceTitle = label(size: 12, weight: .semibold)
    private let sourceDetail = label(size: 11, color: .secondaryLabelColor)
    private let tag = Tag()
    private lazy var preview = iconButton("preview", "Preview context", #selector(showPreview), self)
    private lazy var save = iconButton("save", "Save Markdown…", #selector(saveMarkdown), self)
    private let picker = NSPopUpButton(frame: .zero, pullsDown: false)
    private let targetRow = NSStackView()
    private lazy var refresh = iconButton("refresh", "Find open windows", #selector(findWindows), self)
    private lazy var add = NSButton(title: "Add", target: self, action: #selector(addContext))
    private lazy var access = NSButton(title: "Allow Accessibility…", target: self, action: #selector(allowAccess))
    private let statusGlyph = NSImageView()
    private let statusText = label(size: 11, color: .secondaryLabelColor)
    private let statusRow = NSStackView()
    private var pickerSignature = ""

    override func loadView() {
        let chatIcon = NSImageView(image: glyph("chat") ?? NSImage())
        let agentIcon = NSImageView(image: glyph("agent") ?? NSImage())
        for icon in [chatIcon, agentIcon, statusGlyph] { icon.contentTintColor = .secondaryLabelColor }

        let facts = NSStackView(views: [sourceDetail, tag, NSView()])
        facts.spacing = 6
        let text = NSStackView(views: [sourceTitle, facts])
        text.orientation = .vertical
        text.alignment = .leading
        text.spacing = 2
        let sourceRow = NSStackView(views: [chatIcon, text, NSView(), preview, save])
        sourceRow.spacing = 8

        picker.setAccessibilityLabel("Composer window")
        picker.target = self
        picker.action = #selector(choose)
        picker.controlSize = .small
        add.image = glyph("add")
        add.imagePosition = .imageLeading
        add.bezelStyle = .rounded
        add.lineBreakMode = .byTruncatingTail
        add.setContentCompressionResistancePriority(.required, for: .horizontal)
        targetRow.setViews([agentIcon, picker, refresh, add], in: .leading)
        targetRow.spacing = 8
        access.image = glyph("lock")
        access.imagePosition = .imageLeading
        access.bezelStyle = .rounded

        statusText.maximumNumberOfLines = 2
        statusText.lineBreakMode = .byWordWrapping
        statusText.cell?.truncatesLastVisibleLine = true
        statusRow.setViews([statusGlyph, statusText], in: .leading)
        statusRow.spacing = 6
        statusRow.isHidden = true

        let separator = NSBox()
        separator.boxType = .separator
        let column = NSStackView(views: [separator, sourceRow, targetRow, access, statusRow])
        column.orientation = .vertical
        column.alignment = .leading
        column.spacing = 8
        column.edgeInsets = NSEdgeInsets(top: 0, left: 12, bottom: 10, right: 12)
        separator.widthAnchor.constraint(equalTo: column.widthAnchor).isActive = true
        for row in [sourceRow, targetRow, statusRow] {
            row.widthAnchor.constraint(equalTo: column.widthAnchor, constant: -24).isActive = true
        }
        view = column
        // The system announces Accessibility list changes; pick up a new grant without a restart.
        DistributedNotificationCenter.default().addObserver(forName: NSNotification.Name("com.apple.accessibility.api"),
                                                            object: nil, queue: .main) { [weak self] _ in
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { self?.findWindows() }
        }
        render()
    }

    // MARK: state

    func show(_ state: SourceState) {
        let before = prepared?.revision
        source = state
        if prepared?.revision != before && !busy { say("") }
        render()
    }

    /// Re-read what can change while the panel is hidden.
    func willShow() { findWindows() }

    private var prepared: Prepared? {
        if case .ready(let prepared) = source { return prepared }
        return nil
    }

    private func render() {
        guard isViewLoaded else { return }
        switch source {
        case .waiting:
            sourceTitle.stringValue = "No conversation yet"
            sourceDetail.stringValue = "Open or start a chat above."
        case .unavailable(let reason):
            sourceTitle.stringValue = "Conversation unavailable"
            sourceDetail.stringValue = reason
        case .ready(let prepared):
            sourceTitle.stringValue = prepared.title
            let tooLong = prepared.markdown.utf8.count > maximumTextBytes
            sourceDetail.stringValue = "\(prepared.turns) turns · \(prepared.files) file\(prepared.files == 1 ? "" : "s")"
                + (tooLong ? " · too long, save instead" : "")
        }
        sourceTitle.toolTip = prepared?.page
        sourceDetail.toolTip = sourceDetail.stringValue
        if let prepared {
            if prepared.verification == "verified" { tag.show("Verified", glyph: "done", dashed: false) }
            else { tag.show("Partial", glyph: "unverified", dashed: true, help: prepared.issues.joined(separator: "\n")) }
        }
        tag.isHidden = prepared == nil
        preview.isHidden = prepared == nil
        save.isHidden = prepared == nil

        let trusted = AXIsProcessTrusted()
        access.isHidden = trusted
        targetRow.isHidden = !trusted
        renderPicker(trusted: trusted)
        picker.isEnabled = !targets.isEmpty && !busy && !discovering
        refresh.isEnabled = !busy && !discovering
        let name = composer.map { safeLabel($0.choice.app.localizedName ?? "Agent", limit: 24) }
        add.title = name.map { "Add to \($0)" } ?? "Add"
        add.isEnabled = prepared.map { $0.markdown.utf8.count <= maximumTextBytes } == true && composer != nil && !busy
    }

    /// Rebuilt only when its rows change, so page updates never disturb an open menu.
    private func renderPicker(trusted: Bool) {
        let selected = composer.flatMap { registry.id(of: $0) }
        let signature = "\(trusted)|\(discovering)|\(selected ?? "")|" + targets.map(\.id).joined(separator: ",")
        guard signature != pickerSignature else { return }
        pickerSignature = signature
        picker.removeAllItems()
        picker.addItem(withTitle: discovering ? "Finding windows…" : targets.isEmpty ? "No open windows" : "Choose a window…")
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
        if let selected, let index = targets.firstIndex(where: { $0.id == selected }) { picker.selectItem(at: index + 1) }
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
        let (chosen, problem) = registry.composer(id)
        composer = chosen
        if chosen == nil { say("Can't use it: \(problem). Click into its message box once, then choose it again.", glyph: "error") }
        else { say("") }
        render()
    }

    @objc private func allowAccess() {
        _ = AXIsProcessTrustedWithOptions([kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary)
        say("Turn on gpt-handoff in System Settings → Privacy & Security → Accessibility. This bar updates by itself.")
    }

    // MARK: context

    @objc private func showPreview() {
        guard let prepared else { return }
        let scroll = NSScrollView(frame: NSRect(x: 0, y: 0, width: 520, height: 420))
        scroll.hasVerticalScroller = true
        let text = NSTextView(frame: scroll.bounds)
        text.isEditable = false
        text.isRichText = false
        text.font = .monospacedSystemFont(ofSize: 11, weight: .regular)
        text.textContainerInset = NSSize(width: 6, height: 8)
        text.autoresizingMask = [.width]
        text.string = prepared.markdown
        scroll.documentView = text
        let content = NSViewController()
        content.view = scroll
        let popover = NSPopover()
        popover.contentViewController = content
        popover.behavior = .transient
        popover.show(relativeTo: preview.bounds, of: preview, preferredEdge: .maxY)
    }

    @objc private func saveMarkdown() {
        guard let prepared else { return }
        let panel = NSSavePanel()
        panel.nameFieldStringValue = safeLabel(prepared.title, limit: 60).replacingOccurrences(of: "/", with: "-") + ".md"
        panel.allowedContentTypes = [.init(filenameExtension: "md")!]
        panelOpen = true
        panel.begin { [weak self] response in
            self?.panelOpen = false
            guard response == .OK, let url = panel.url else { return }
            do {
                try Data(prepared.markdown.utf8).write(to: url, options: .atomic)
                self?.say("Saved \(url.lastPathComponent).", glyph: "done")
            } catch { self?.say("Could not save there. Choose another folder.", glyph: "error") }
        }
    }

    // MARK: add

    @objc private func addContext() {
        guard !busy, let selected = composer, let frozen = prepared else { return }
        busy = true
        operation = UUID()
        let id = operation
        say("Adding…", glyph: "waiting")
        render()
        let valid: () -> Bool = { [weak self] in
            guard let self, self.operation == id, let current = self.prepared else { return false }
            return current.revision == frozen.revision && self.isCurrent(frozen)
        }
        appendToComposer(selected, text: frozen.markdown, operationValid: valid,
                         revalidateSource: { reply in reply(valid()) }) { [weak self] message, success in
            guard let self else { return }
            self.busy = false
            self.say(message, glyph: success ? "done" : "error")
            self.render()
        }
    }
}
