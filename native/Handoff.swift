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
    let attachments: [Attachment]
    /// Whether only missing local files keep it partial.
    let verifiedWithFiles: Bool
}

/// A file the conversation refers to. `key` is unique in the conversation; `id` and `messageId` are how
/// the page fetches it (a file id or sandbox path, and its message); `line` and `check` are the line
/// numbers of its file line and of its "download this file" check (-1 for none) in the Markdown.
struct Attachment {
    let key: String
    let id: String
    let name: String
    let label: String
    let turn: Int
    let messageId: String
    let line: Int
    let check: Int
}

enum SourceState {
    case waiting
    case ready(Prepared)
    case unavailable(String)
}

struct FileRow {
    let id: String
    let name: String
    let turn: Int
    let saved: URL?
}

/// Each saved file's line points at its local copy, and a "download this file" check goes once
/// every file it was about has a copy. When only the files kept it partial, it reads verified.
func linkFiles(_ prepared: Prepared, copies: [String: (path: URL, sha256: String)]) -> (String, String) {
    var lines = prepared.markdown.components(separatedBy: "\n")
    var linked = Set<String>(), dropped = Set<Int>()
    for file in prepared.attachments where lines.indices.contains(file.line) {
        guard let copy = copies[file.key] else { continue }
        let path = copy.path.path.contains("`") ? "`` \(copy.path.path) ``" : "`\(copy.path.path)`"
        lines[file.line] = "- \(file.label) — \(path) · sha256 \(copy.sha256)"
        linked.insert(file.key)
    }
    for check in Set(prepared.attachments.map(\.check)) where check >= 0 {
        if prepared.attachments.filter({ $0.check == check }).allSatisfy({ linked.contains($0.key) }) { dropped.insert(check) }
    }
    lines = lines.enumerated().filter { !dropped.contains($0.offset) }.map(\.element)
    if let header = lines.firstIndex(of: "## Content checks"), header > 0, header + 2 < lines.count,
       lines[header + 1].isEmpty, lines[header + 2].isEmpty {
        lines.removeSubrange(header - 1...header + 1)
    }
    let total = prepared.attachments.count
    if total > 0, linked.count == total, prepared.verifiedWithFiles, let source = lines.firstIndex(where: { $0.hasPrefix("Source: ") }) {
        lines[source] = lines[source].replacingOccurrences(of: " · verification: partial", with: " · verification: verified")
    }
    return (lines.joined(separator: "\n"), total == 0 ? "" : linked.count == total ? "\(total) file\(total == 1 ? "" : "s") linked."
            : "\(linked.count) of \(total) files linked; the rest are references (download them from the Files list).")
}

/// A push button that runs a closure; keeps small popover controls free of selector plumbing.
final class ClosureButton: NSButton {
    private var run: () -> Void = {}
    convenience init(title: String, glyph name: String? = nil, run: @escaping () -> Void) {
        self.init(frame: .zero)
        self.title = title
        if let name {
            image = glyph(name, size: 14)
            imagePosition = .imageLeading
        }
        bezelStyle = .rounded
        self.run = run
        target = self
        action = #selector(fire)
    }
    @objc private func fire() { run() }
}

/// The strip under the chat: what will be handed off, to which window, and Add.
final class HandoffBar: NSViewController {
    /// Whether this exact preparation is still what the page shows. Checked again just before writing.
    var isCurrent: (Prepared) -> Bool = { _ in false }
    /// The Markdown with each saved file's line pointing at its local copy, and a note on how many.
    var withFiles: (Prepared) -> (String, String) = { ($0.markdown, "") }
    /// The files list: what the conversation refers to and what can be downloaded now.
    var fileRows: () -> [FileRow] = { [] }
    var downloadFiles: ([String], @escaping () -> Void) -> Void = { _, done in done() }
    private var filesPopover: NSPopover?
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
    private lazy var copy = iconButton("copy", "Copy conversation", #selector(copyMarkdown), self)
    private lazy var filesButton: NSButton = {
        let button = NSButton(title: "", image: glyph("attach") ?? NSImage(), target: self, action: #selector(showFiles))
        button.bezelStyle = .accessoryBarAction
        button.showsBorderOnlyWhileMouseInside = true
        button.imagePosition = .imageLeading
        button.toolTip = "Files in this conversation"
        return button
    }()
    private let picker = NSPopUpButton(frame: .zero, pullsDown: false)
    private let targetRow = NSStackView()
    private lazy var refresh = iconButton("refresh", "Find open windows", #selector(findWindows), self)
    private lazy var add = NSButton(title: "Add", target: self, action: #selector(addContext))
    private lazy var allow = NSButton(title: "Allow…", target: self, action: #selector(allowAccess))
    private let access = NSStackView()
    private let statusGlyph = NSImageView()
    private let statusText = label(size: 11, color: .secondaryLabelColor)
    private let statusRow = NSStackView()
    private var pickerSignature = ""
    private var statusIsResult = false
    private var statusIsAccessHint = false

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
        let sourceRow = NSStackView(views: [chatIcon, text, NSView(), filesButton, preview, copy, save])
        sourceRow.spacing = 2
        sourceRow.setCustomSpacing(8, after: chatIcon)

        picker.setAccessibilityLabel("Composer window")
        picker.target = self
        picker.action = #selector(choose)
        picker.setContentHuggingPriority(.defaultLow, for: .horizontal)
        picker.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        add.bezelStyle = .rounded
        add.setContentCompressionResistancePriority(.required, for: .horizontal)
        add.setContentHuggingPriority(.required, for: .horizontal)
        targetRow.setViews([agentIcon, picker, refresh, add], in: .leading)
        targetRow.spacing = 6
        targetRow.setCustomSpacing(10, after: refresh)
        let lockIcon = NSImageView(image: glyph("lock") ?? NSImage())
        lockIcon.contentTintColor = .systemOrange
        let accessText = label("Accessibility is off. It is needed to add into other apps.", size: 11, color: .secondaryLabelColor)
        allow.bezelStyle = .rounded
        allow.controlSize = .small
        allow.setContentHuggingPriority(.required, for: .horizontal)
        access.setViews([lockIcon, accessText, NSView(), allow], in: .leading)
        access.spacing = 6

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
        for row in [sourceRow, targetRow, access, statusRow] {
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
        // An Add or Save result belongs to the conversation it was about; target problems stay.
        if prepared?.revision != before && !busy && statusIsResult { say("") }
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
        copy.isHidden = prepared == nil
        filesButton.isHidden = (prepared?.attachments.isEmpty ?? true)
        filesButton.title = "\(prepared?.attachments.count ?? 0)"
        filesButton.setAccessibilityLabel("Files: \(prepared?.attachments.count ?? 0)")

        let trusted = AXIsProcessTrusted()
        if trusted && statusIsAccessHint { say("") }
        access.isHidden = trusted
        targetRow.isHidden = !trusted
        renderPicker(trusted: trusted)
        picker.isEnabled = !targets.isEmpty && !busy && !discovering
        refresh.isEnabled = !busy && !discovering
        let destination = composer.map { safeLabel($0.choice.app.localizedName ?? "app", limit: 24) }
        add.title = destination.map { "Add to \($0)" } ?? "Add"
        add.toolTip = composer.map { "Adds this conversation to \($0.choice.displayLabel(limit: 60)) without sending it" }
        add.isEnabled = prepared.map { $0.markdown.utf8.count <= maximumTextBytes } == true && composer != nil && !busy
        // Accent only when it can act; a disabled accent button reads as pale text on blue.
        add.bezelColor = add.isEnabled ? .controlAccentColor : nil
        add.contentTintColor = add.isEnabled ? .white : nil
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

    private func say(_ text: String, glyph name: String? = nil, result: Bool = false) {
        statusIsResult = result
        statusIsAccessHint = false
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
                if self.composer == nil { self.restoreLastTarget() }
                self.render()
            }
        }
    }

    @objc private func choose() {
        guard let id = picker.selectedItem?.representedObject as? String else { return }
        let (chosen, problem) = registry.composer(id)
        composer = chosen
        if let chosen { remember(chosen) }
        if chosen == nil {
            say("Can't use it: \(problem). Click into its message box once, then choose it again.", glyph: "error")
        }
        else { say("") }
        render()
    }

    // The last window used, by app and window title, so the next session starts there if it is open.
    private func remember(_ composer: Composer) {
        UserDefaults.standard.set(["app": composer.choice.app.bundleIdentifier ?? "", "title": composer.choice.title],
                                  forKey: "LastTarget")
    }

    private func restoreLastTarget() {
        guard UserDefaults.standard.bool(forKey: Preferences.restoreLastWindow),
              let last = UserDefaults.standard.dictionary(forKey: "LastTarget") as? [String: String],
              let target = targets.first(where: { target in
                  guard let choice = registry.choice(target.id) else { return false }
                  return choice.app.bundleIdentifier == last["app"] && choice.title == last["title"]
              }) else { return }
        composer = registry.composer(target.id).composer
    }

    @objc private func allowAccess() {
        _ = AXIsProcessTrustedWithOptions([kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary)
        say("Turn on Add to Claude in System Settings → Privacy & Security → Accessibility, then reopen this panel.")
        statusIsAccessHint = true
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

    // MARK: files

    @objc private func showFiles() {
        filesPopover?.close()
        let popover = NSPopover()
        popover.behavior = .transient
        popover.contentViewController = filesList()
        filesPopover = popover
        popover.show(relativeTo: filesButton.bounds, of: filesButton, preferredEdge: .maxY)
    }

    /// One row per file: saved (with its path), downloadable now, or waiting for the chat to fetch it.
    private func filesList() -> NSViewController {
        let rows = fileRows()
        var boxes: [(NSButton, String)] = []
        let list = NSStackView()
        list.orientation = .vertical
        list.alignment = .leading
        list.spacing = 6
        for row in rows {
            let box = NSButton(checkboxWithTitle: "\(row.name) · turn \(row.turn)", target: nil, action: nil)
            box.isEnabled = row.saved == nil
            box.state = box.isEnabled ? .on : .off
            box.lineBreakMode = .byTruncatingMiddle
            let state = label(row.saved != nil ? "Saved" : "Not downloaded", size: 11, color: .secondaryLabelColor)
            state.toolTip = row.saved?.path
            let line = NSStackView(views: [box, NSView(), state])
            line.widthAnchor.constraint(equalToConstant: 380).isActive = true
            list.addArrangedSubview(line)
            if box.isEnabled { boxes.append((box, row.id)) }
        }
        let scroll = NSScrollView()
        scroll.documentView = list
        scroll.hasVerticalScroller = rows.count > 10
        scroll.drawsBackground = false
        list.translatesAutoresizingMaskIntoConstraints = false
        scroll.heightAnchor.constraint(equalToConstant: CGFloat(min(rows.count, 10)) * 26).isActive = true
        scroll.widthAnchor.constraint(equalToConstant: 388).isActive = true
        let note = label("Saved to \(FilesFolder.root.path)", size: 11, color: .secondaryLabelColor)
        let downloadButton = ClosureButton(title: "Download Selected", glyph: "download") { [weak self] in
            let ids = boxes.filter { $0.0.state == .on }.map(\.1)
            guard !ids.isEmpty else { return }
            self?.say("Downloading \(ids.count) file\(ids.count == 1 ? "" : "s")…", glyph: "waiting")
            self?.downloadFiles(ids) { self?.filesPopover?.close(); self?.render() }
        }
        downloadButton.isEnabled = !boxes.isEmpty
        let showFolder = ClosureButton(title: "Show Folder", glyph: "folder") {
            try? FileManager.default.createDirectory(at: FilesFolder.root, withIntermediateDirectories: true)
            NSWorkspace.shared.open(FilesFolder.root)
        }
        let headerIcon = NSImageView(image: glyph("attach", size: 14) ?? NSImage())
        headerIcon.contentTintColor = .secondaryLabelColor
        let header = NSStackView(views: [headerIcon, label("Files in this conversation", size: 12, weight: .semibold)])
        header.spacing = 6
        let column = NSStackView(views: [header, scroll, note,
                                         NSStackView(views: [showFolder, NSView(), downloadButton])])
        column.orientation = .vertical
        column.alignment = .leading
        column.spacing = 8
        column.edgeInsets = NSEdgeInsets(top: 12, left: 12, bottom: 12, right: 12)
        let controller = NSViewController()
        controller.view = column
        return controller
    }

    func filesChanged(_ message: String?) {
        if let message { say(message, glyph: "done", result: true) }
        render()
    }

    @objc private func copyMarkdown() {
        guard let prepared else { return }
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(prepared.markdown, forType: .string)
        say("Copied. Click the target's message box and press ⌘V.", glyph: "done", result: true)
    }

    @objc private func saveMarkdown() {
        guard let prepared else { return }
        let panel = NSSavePanel()
        panel.level = aboveChatPanel
        panel.nameFieldStringValue = safeLabel(prepared.title, limit: 60).replacingOccurrences(of: "/", with: "-") + ".md"
        panel.allowedContentTypes = [.init(filenameExtension: "md")!]
        panelOpen = true
        panel.begin { [weak self] response in
            self?.panelOpen = false
            guard response == .OK, let url = panel.url else { return }
            do {
                try Data(prepared.markdown.utf8).write(to: url, options: .atomic)
                self?.say("Saved \(url.lastPathComponent).", glyph: "done", result: true)
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
        let append = { [weak self] in
            guard let self, valid() else { return self?.finish("The conversation changed. Nothing was added.", false) ?? () }
            self.say("Adding…", glyph: "waiting")
            let (text, filesNote) = self.withFiles(frozen)
            appendToComposer(selected, text: text, operationValid: valid,
                             revalidateSource: { reply in reply(valid()) }) { [weak self] message, success in
                self?.finish(filesNote.isEmpty ? message : message + " " + filesNote, success)
            }
        }
        // Files first, so their lines can point at local copies.
        guard UserDefaults.standard.bool(forKey: Preferences.downloadOnAdd), !frozen.attachments.isEmpty else { return append() }
        say("Downloading files…", glyph: "waiting")
        downloadFiles(frozen.attachments.map(\.key)) { append() }
    }

    private func finish(_ message: String, _ success: Bool) {
        busy = false
        say(message, glyph: success ? "done" : "error", result: true)
        render()
    }
}
