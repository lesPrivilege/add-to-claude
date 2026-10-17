import AppKit
import ApplicationServices

/// The strip under the chat: what will be handed off, to which window, and Add.
final class HandoffBar: NSViewController {
    /// Whether this exact preparation is still what the page shows. Checked again just before writing.
    var isCurrent: (Prepared) -> Bool = { _ in false }
    /// The Markdown with each saved file's line pointing at its local copy, and a note on how many.
    var withFiles: (Prepared) -> (String, String) = { ($0.markdown, "") }
    /// The files list: what the conversation refers to and what can be downloaded now.
    var fileRows: () -> [FileRow] = { [] }
    var downloadFiles: ([String], @escaping () -> Void) -> Void = { _, done in done() }
    /// Some turns of a preparation, projected by the compiler in the page's isolated world.
    var project: (Prepared, [TurnInfo], String, @escaping (ProjectionResult) -> Void) -> Void = { _, _, _, done in
        done(.failure("Choosing turns is not available here."))
    }
    /// Whether this app may use Accessibility; replaceable so snapshots can show the trusted bar.
    var isTrusted: () -> Bool = { AXIsProcessTrusted() }
    var log = DeliveryLog.shared
    private var filesPopover: NSPopover?
    private var turnsPopover: NSPopover?
    /// What the scope menu says for the next Add. Not saved; back to Auto after an Add lands and when
    /// the source conversation or the target changes.
    private var scopeChoice = ScopeChoice.auto
    /// Which conversation the chosen window shows, as far as it can be told (see `identify`).
    private(set) var target: TargetIdentity?
    private var sessions: [WindowSession] = []
    private var scopeSignature = ""
    private var sourceKey: String?
    private var source = SourceState.waiting
    private let registry = ComposerRegistry()
    private var targets: [Target] = []
    private var blocked: [(TerminalApp, TerminalAccess)] = []
    /// The chosen destination: a composer window, or a terminal tab. Never both.
    private var composer: Composer?
    private var terminal: TerminalTab?
    private var hasDestination: Bool { composer != nil || terminal != nil }
    private var discovering = false
    private var busy = false
    private var operation = UUID()
    private(set) var panelOpen = false

    private let sourceTitle = label(size: 12, weight: .semibold)
    private let sourceDetail = label(size: 11, color: .secondaryLabelColor)
    private let tag = Tag()
    private lazy var preview = iconButton("preview", "Preview the whole conversation as read", #selector(showPreview), self)
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
    private lazy var add = NSButton(title: "Add", target: self, action: #selector(addContext))
    private lazy var allow = NSButton(title: "Allow…", target: self, action: #selector(allowAccess))
    private let access = NSStackView()
    private let statusGlyph = NSImageView()
    private let statusText = label(size: 11, color: .secondaryLabelColor)
    private let statusRow = NSStackView()
    private let statusActions = NSStackView()
    private let scopeButton = NSPopUpButton(frame: .zero, pullsDown: true)
    private let scopeDetail = label(size: 11, color: .secondaryLabelColor)
    private lazy var bindButton = NSButton(title: "Continue in this conversation", target: self, action: #selector(toggleBinding))
    private let scopeRow = NSStackView()
    private var pickerSignature = ""
    private var statusIsResult = false
    private var statusIsAccessHint = false

    override func loadView() {
        let chatIcon = NSImageView(image: glyph("chat") ?? NSImage())
        for icon in [chatIcon, statusGlyph] { icon.contentTintColor = .secondaryLabelColor }

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
        scopeButton.setAccessibilityLabel("Turns to add")
        scopeButton.toolTip = "Which turns Add puts into the draft"
        scopeButton.setContentHuggingPriority(.required, for: .horizontal)
        scopeButton.setContentCompressionResistancePriority(.required, for: .horizontal)
        targetRow.setViews([picker, scopeButton, add], in: .leading)
        targetRow.spacing = 6
        targetRow.setCustomSpacing(8, after: picker)
        targetRow.setCustomSpacing(4, after: scopeButton)
        bindButton.bezelStyle = .accessoryBarAction
        bindButton.controlSize = .small
        bindButton.font = .systemFont(ofSize: 11)
        bindButton.setContentHuggingPriority(.required, for: .horizontal)
        bindButton.setContentCompressionResistancePriority(.required, for: .horizontal)
        scopeDetail.toolTip = nil
        scopeRow.setViews([scopeDetail, NSView(), bindButton], in: .leading)
        scopeRow.spacing = 6
        scopeRow.edgeInsets = NSEdgeInsets(top: 0, left: 22, bottom: 0, right: 0)
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
        statusActions.spacing = 4
        statusActions.setContentHuggingPriority(.required, for: .horizontal)
        statusText.setContentHuggingPriority(.defaultLow, for: .horizontal)
        statusText.preferredMaxLayoutWidth = 250 // Wraps beside a question's buttons; the row widens it when there are none.
        statusRow.setViews([statusGlyph, statusText, statusActions], in: .leading)
        statusRow.spacing = 6
        statusRow.isHidden = true

        let separator = NSBox()
        separator.boxType = .separator
        let column = NSStackView(views: [separator, sourceRow, targetRow, scopeRow, access, statusRow])
        column.orientation = .vertical
        column.alignment = .leading
        column.spacing = 8
        column.setCustomSpacing(4, after: targetRow)
        column.edgeInsets = NSEdgeInsets(top: 0, left: 12, bottom: 10, right: 12)
        separator.widthAnchor.constraint(equalTo: column.widthAnchor).isActive = true
        for row in [sourceRow, targetRow, scopeRow, access, statusRow] {
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
        // A manual scope is for this conversation only.
        let key = prepared.map { $0.sourceId ?? $0.page }
        if key != nil && key != sourceKey {
            sourceKey = key
            scopeChoice = .auto
            turnsPopover?.close()
        }
        render()
    }

    /// Re-read what can change while the panel is hidden.
    func willShow() {
        HandoffFiles.shared.remove(olderThan: 24 * 3600)
        findWindows()
    }

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
        case .replying:
            sourceTitle.stringValue = "Reply in progress"
            sourceDetail.stringValue = "Add when it finishes. If it stops partway, open the conversation again once it is complete."
        case .unavailable(let reason):
            sourceTitle.stringValue = "Conversation unavailable"
            sourceDetail.stringValue = reason
        case .ready(let prepared):
            sourceTitle.stringValue = prepared.title
            let tooLong = prepared.markdown.utf8.count > maximumTextBytes
            sourceDetail.stringValue = "\(prepared.turns) turns · \(prepared.files) file\(prepared.files == 1 ? "" : "s")"
                + (tooLong ? " · too long for one Add: choose turns or save" : "")
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

        let trusted = isTrusted()
        if trusted && statusIsAccessHint { say("") }
        access.isHidden = trusted
        targetRow.isHidden = !trusted
        renderPicker(trusted: trusted)
        picker.isEnabled = !targets.isEmpty && !busy && !discovering
        let destination = composer.map { safeLabel($0.choice.app.localizedName ?? "app", limit: 24) } ?? terminal?.app.name
        add.title = destination.map { "Add to \($0)" } ?? "Add"
        let scope = currentScope
        renderScope(scope, trusted: trusted)
        let what = scope.map { $0.everything ? "this conversation" : $0.detail.lowercased() } ?? "this conversation"
        add.toolTip = composer.map { "Adds \(what) to \($0.choice.displayLabel(limit: 60)) without sending it" }
            ?? terminal.map { "Saves \(what) as a hand-off file and puts a one-line mention of it in \($0.label) without running it" }
        // A terminal gets a file, so only a composer is held to the 2 MB a message box takes.
        let limit = terminal != nil ? maximumMarkdownBytes : maximumTextBytes
        let addable = scope.map { scope in
            scope.everything ? prepared.map { $0.markdown.utf8.count <= limit } == true
                : !scope.turns.isEmpty || (scope.mode == "new" && !(analysis?.lastBatch.isEmpty ?? true))
        } ?? false
        add.isEnabled = addable && hasDestination && !busy
        // Accent only when it can act; a disabled accent button reads as pale text on blue.
        add.bezelColor = add.isEnabled ? .controlAccentColor : nil
        add.contentTintColor = add.isEnabled ? .white : nil
    }

    // MARK: scope

    /// What the log knows about this conversation in the chosen target.
    private var analysis: ScopeAnalysis? {
        guard let prepared else { return nil }
        return analyzeScope(turns: prepared.turnList, source: prepared.sourceId, target: target, records: log.records)
    }

    private var currentScope: ResolvedScope? {
        guard let prepared, let analysis else { return nil }
        return resolveScope(scopeChoice, turns: prepared.turnList, analysis: analysis)
    }

    /// The pull-down left of Add, and the line under it. The menu is rebuilt only when it would change.
    private func renderScope(_ scope: ResolvedScope?, trusted: Bool) {
        scopeButton.isHidden = scope == nil
        scopeButton.isEnabled = !busy
        let analysis = analysis
        let canBind = target?.confidence == .unconfirmed && !(analysis?.added.isEmpty ?? true)
        let bound = target?.confidence == .confirmed
        bindButton.isHidden = !(canBind || bound) || busy
        bindButton.title = bound ? "Stop continuing" : "Continue in this conversation"
        bindButton.toolTip = bound
            ? "Add stops treating this window as the conversation you added to, and offers all turns again"
            : "This app does not say which conversation the window shows. Confirm it is still the one you added to, so Add offers only what is new"
        var detail = scope?.detail ?? ""
        if bound { detail = "Same conversation (your choice) · " + detail }
        else if canBind && scope?.mode == "all" { detail += " · target not identified" }
        // Adding everything again still says how much of it this target already has, for review.
        if let scope, let analysis, scope.mode == "all" || scope.mode == "chosen", !analysis.added.isEmpty {
            let already = scope.turns.filter { analysis.added.contains($0.id) }.count
            if already > 0 { detail += " · \(already) already added" }
        }
        scopeDetail.stringValue = detail
        scopeDetail.toolTip = detail
        scopeRow.isHidden = !trusted || scope == nil || !hasDestination
            || (scope?.mode == "all" && scope?.automatic == true && !canBind && !bound)

        guard let scope, let analysis, let prepared else { return }
        let signature = [scope.label, "\(scopeChoice)", "\(analysis.newApplicable)", "\(analysis.newTurns.count)",
                         "\(analysis.changedTurns.count)", "\(prepared.turnList.count)"].joined(separator: "|")
        guard signature != scopeSignature else { return }
        scopeSignature = signature
        let menu = NSMenu()
        // Items say themselves whether they apply; autoenabling would show an inapplicable one as clickable.
        menu.autoenablesItems = false
        // Each scope keeps one glyph wherever it appears: the button, its menu, the picker.
        let scopeGlyph = { (mode: String) in glyph(mode.hasPrefix("new") ? "scope-new" : mode == "all" ? "scope-all" : "scope-choose", size: 14) }
        menu.addItem(withTitle: scope.label, action: nil, keyEquivalent: "") // A pull-down's title item.
        menu.items[0].image = scopeGlyph(scope.mode)
        let auto = resolveScope(.auto, turns: prepared.turnList, analysis: analysis)
        let item = { (title: String, choice: ScopeChoice?, enabled: Bool, action: Selector) in
            let entry = NSMenuItem(title: title, action: enabled ? action : nil, keyEquivalent: "")
            entry.image = choice.map { choice -> String in
                switch choice { case .new, .newAndChanged: return "new"; case .all: return "all"; case .chosen, .again: return "chosen"; case .auto: return "" }
            }.flatMap { $0.isEmpty ? nil : scopeGlyph($0) }
            entry.target = self
            entry.isEnabled = enabled
            entry.representedObject = choice.map { ScopeBox($0) }
            if let choice { entry.state = self.scopeChoice == choice ? .on : .off }
            menu.addItem(entry)
        }
        item("Auto: \(auto.mode == "new" ? "New since last add" : "All turns")", .auto, true, #selector(pickScope(_:)))
        menu.addItem(.separator())
        if analysis.newApplicable {
            item("New since last add · \(analysis.newTurns.count)", .new, true, #selector(pickScope(_:)))
        } else {
            // Say why rather than offer a count that clicking cannot give.
            item("New since last add", .new, false, #selector(pickScope(_:)))
            menu.items.last?.toolTip = target?.confidence == .unconfirmed
                ? "This window does not say which conversation it shows. After an Add, choose Continue in this conversation."
                : "Offered once this conversation has been added to this target."
            let why = NSMenuItem(title: target?.confidence == .unconfirmed ? "After an Add, Continue in this conversation enables it"
                                 : "Available after the first Add here", action: nil, keyEquivalent: "")
            why.isEnabled = false
            why.indentationLevel = 1
            why.attributedTitle = NSAttributedString(string: why.title, attributes: [.font: NSFont.systemFont(ofSize: 11),
                                                                                     .foregroundColor: NSColor.tertiaryLabelColor])
            menu.addItem(why)
        }
        if analysis.newApplicable && !analysis.changedTurns.isEmpty {
            item("New and changed · \(analysis.newTurns.count + analysis.changedTurns.count)", .newAndChanged, true, #selector(pickScope(_:)))
        }
        item("All turns · \(prepared.turnList.count)", .all, true, #selector(pickScope(_:)))
        let chosen: Bool = { if case .chosen = scopeChoice { return true }; return false }()
        let choose = NSMenuItem(title: "Choose turns…", action: #selector(chooseTurns), keyEquivalent: "")
        choose.image = scopeGlyph("chosen")
        choose.target = self
        choose.state = chosen ? .on : .off
        menu.addItem(choose)
        scopeButton.menu = menu
        scopeButton.setTitle(scope.label)
    }

    @objc private func pickScope(_ sender: NSMenuItem) {
        guard let choice = (sender.representedObject as? ScopeBox)?.choice else { return }
        scopeChoice = choice
        if statusIsResult { say("") }
        render()
    }

    @objc private func chooseTurns() {
        guard let prepared, let analysis else { return }
        turnsPopover?.close()
        // Start from what the scope offers now, plus the earlier turns whose text changed since added.
        let start: Set<String> = {
            if case .chosen(let ids) = scopeChoice { return Set(ids) }
            return Set((currentScope?.turns ?? []).map(\.id)).union(analysis.changedTurns.map(\.id))
        }()
        let popover = NSPopover()
        popover.behavior = .transient
        let picker = TurnPicker(turns: prepared.turnList, added: analysis.added, lastAdd: Set(analysis.lastBatch.map(\.id)),
                                changed: Set(analysis.changedTurns.map(\.id)),
                                selected: start,
                                changedSelection: { [weak self] ids in
                                    guard let self, let turns = self.prepared?.turnList else { return }
                                    self.scopeChoice = .chosen(turns.filter { ids.contains($0.id) }.map(\.id))
                                    self.render()
                                },
                                done: { [weak popover] in popover?.close() })
        popover.contentViewController = picker
        turnsPopover = popover
        scopeChoice = .chosen(prepared.turnList.filter { start.contains($0.id) }.map(\.id))
        render()
        popover.show(relativeTo: scopeButton.bounds, of: scopeButton, preferredEdge: .maxY)
    }

    // MARK: target identity

    /// One chosen window or terminal tab, from when it was chosen until it closes (or a window changes its
    /// title). Ids name it in the log; `bound` is the user's "Continue in this conversation".
    private final class WindowSession {
        /// The app instance and, for a tab, its session.
        let slot: String
        let window: AXUIElement?
        let title: String
        let id = UUID().uuidString.lowercased()
        var bound = false
        init(slot: String, window: AXUIElement?, title: String) {
            self.slot = slot
            self.window = window
            self.title = title
        }
        func sameSlot(_ slot: String, _ window: AXUIElement?) -> Bool {
            guard self.slot == slot else { return false }
            switch (self.window, window) {
            case (nil, nil): return true
            case let (mine?, theirs?): return CFEqual(mine, theirs)
            default: return false
            }
        }
    }

    private func session(slot: String, window: AXUIElement?, title: String) -> WindowSession {
        let session = sessions.first { $0.sameSlot(slot, window) && $0.title == title } ?? {
            let session = WindowSession(slot: slot, window: window, title: title)
            sessions.append(session)
            return session
        }()
        sessions.removeAll { $0 !== session && $0.sameSlot(slot, window) }
        return session
    }

    private func session(for composer: Composer) -> WindowSession {
        session(slot: "\(composer.choice.app.processIdentifier)|\(composer.choice.launchDate.timeIntervalSince1970)",
                window: composer.choice.window, title: composer.choice.title)
    }

    /// A tab's session lasts while it lives and runs the same process: a tty number reused by a new tab,
    /// or an agent restarted in the same tab, is a new session.
    private func session(for tab: TerminalTab) -> WindowSession {
        session(slot: "\(tab.key)|\(tab.launchDate.timeIntervalSince1970)", window: nil, title: "\(tab.tty)|\(tab.processID)")
    }

    /// Which conversation the window shows: verified when the window names it (its page URL), else this
    /// window session, confirmed only if the user said so. App, pid, window and title never decide sameness.
    private func identify(_ composer: Composer) -> TargetIdentity {
        let app = composer.choice.app.bundleIdentifier ?? "pid-\(composer.choice.app.processIdentifier)"
        if let id = conversationIdentity(in: composer.choice.window) {
            return TargetIdentity(app: app, conversation: id, confidence: .verified)
        }
        let session = session(for: composer)
        return TargetIdentity(app: app, conversation: "window:\(session.id)", confidence: session.bound ? .confirmed : .unconfirmed)
    }

    /// A terminal never says which conversation an agent in it holds: always this tab's session.
    private func identify(_ tab: TerminalTab) -> TargetIdentity {
        let session = session(for: tab)
        return TargetIdentity(app: tab.app.rawValue, conversation: "window:\(session.id)", confidence: session.bound ? .confirmed : .unconfirmed)
    }

    private func identifyDestination() -> TargetIdentity? { composer.map(identify) ?? terminal.map(identify) }

    /// Uses this composer as the target, with its identity read now (or as given, for snapshots).
    func select(_ chosen: Composer?, identity: TargetIdentity? = nil) {
        let before = target
        composer = chosen
        if chosen != nil { terminal = nil }
        target = identity ?? identifyDestination()
        if target != before { scopeChoice = .auto; turnsPopover?.close() }
        render()
    }

    /// Uses this terminal tab as the target.
    func select(_ tab: TerminalTab) {
        composer = nil
        terminal = tab
        select(nil)
    }

    @objc private func toggleBinding() {
        guard let session = composer.map({ session(for: $0) }) ?? terminal.map({ session(for: $0) }) else { return }
        session.bound.toggle()
        target = identifyDestination()
        scopeChoice = .auto
        render()
    }

    /// Rebuilt only when its rows change, so page updates never disturb an open menu.
    private func renderPicker(trusted: Bool) {
        let selected = composer.flatMap { registry.id(of: $0) } ?? terminal.flatMap { registry.id(of: $0) }
        let signature = "\(trusted)|\(discovering)|\(selected ?? "")|" + targets.map(\.id).joined(separator: ",")
            + "|" + blocked.map { "\($0.0.rawValue):\($0.1)" }.joined(separator: ",")
        guard signature != pickerSignature else { return }
        pickerSignature = signature
        picker.removeAllItems()
        picker.addItem(withTitle: discovering ? "Finding windows…" : targets.isEmpty ? "No open windows" : "Choose a window…")
        picker.item(at: 0)?.isEnabled = false
        // Added as menu items: `addItem(withTitle:)` drops an earlier item with the same title.
        let row = { (target: Target) in
            let item = NSMenuItem(title: target.window.isEmpty ? target.app : "\(target.app) · \(target.window)", action: nil, keyEquivalent: "")
            item.representedObject = target.id
            item.image = target.icon.map { icon in
                let copy = icon.copy() as! NSImage
                copy.size = NSSize(width: 16, height: 16)
                return copy
            }
            self.picker.menu?.addItem(item)
        }
        targets.filter { !$0.terminal }.forEach(row)
        // Terminal tabs get a one-line mention of a hand-off file; the header says so before one is chosen.
        let tabs = targets.filter(\.terminal)
        if !tabs.isEmpty || !blocked.isEmpty {
            picker.menu?.addItem(.separator())
            picker.addItem(withTitle: "Terminal tabs · a one-line file mention, never run")
            picker.lastItem?.isEnabled = false
            tabs.forEach(row)
            for (app, access) in blocked {
                picker.addItem(withTitle: access == .notAsked ? "Allow Listing \(app.name) Tabs…" : "\(app.name) Tabs: Allow in System Settings…")
                picker.lastItem?.representedObject = (access == .notAsked ? "allow:" : "settings:") + app.rawValue
                picker.lastItem?.image = glyph("lock", size: 14)
            }
        }
        picker.menu?.addItem(.separator())
        picker.addItem(withTitle: "Refresh Window List")
        picker.lastItem?.representedObject = "refresh"
        picker.lastItem?.image = glyph("refresh", size: 14)
        if let selected, let index = picker.itemArray.firstIndex(where: { $0.representedObject as? String == selected }) {
            picker.selectItem(at: index)
        } else { picker.selectItem(at: 0) }
    }

    /// The status line, with up to two small buttons for a question it asks.
    private func say(_ text: String, glyph name: String? = nil, result: Bool = false, actions: [(String, () -> Void)] = []) {
        statusIsResult = result
        statusIsAccessHint = false
        statusText.stringValue = text
        statusText.toolTip = text
        statusGlyph.image = name.flatMap { glyph($0, size: 14) }
        statusGlyph.isHidden = name == nil
        statusRow.isHidden = text.isEmpty
        statusActions.setViews(actions.map { title, run in
            let button = ClosureButton(title: title, run: run)
            button.controlSize = .small
            button.font = .systemFont(ofSize: 11)
            button.setContentCompressionResistancePriority(.required, for: .horizontal)
            return button
        }, in: .leading)
        statusActions.isHidden = actions.isEmpty
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
                self.discovering = false
                self.apply(found)
            }
        }
    }

    /// Takes a discovery as the picker's rows. Internal so snapshots can show rows without real windows.
    func apply(_ found: Discovery) {
        registry.apply(found)
        targets = found.targets
        blocked = found.blocked
        if let composer, registry.id(of: composer) == nil { self.composer = nil }
        // A tab that still runs the very process it ran when chosen stays chosen; anything else is chosen again.
        if let tab = terminal {
            let now = registry.id(of: tab).flatMap(registry.tab)
            terminal = now.flatMap { $0.processID == tab.processID && $0.process == tab.process ? $0 : nil }
            if terminal == nil && !busy {
                say(now.map { "The \(tab.app.name) tab now runs \($0.process.isEmpty ? "something else" : $0.process). Choose it again." }
                        ?? "The \(tab.app.name) tab closed.", glyph: "info")
            }
        }
        if !hasDestination { restoreLastTarget() }
        // The target may show another conversation by now; read it again.
        if !busy { select(composer) } else { render() }
    }

    @objc private func choose() {
        guard let id = picker.selectedItem?.representedObject as? String else { return }
        if id == "refresh" {
            pickerSignature = "" // Re-render restores the selection the refresh item displaced.
            return findWindows()
        }
        if id.hasPrefix("allow:") || id.hasPrefix("settings:") {
            pickerSignature = ""
            return allowTerminal(id)
        }
        if let tab = registry.tab(id) {
            say("")
            return select(tab)
        }
        let (chosen, problem) = registry.composer(id)
        if let chosen { remember(chosen) }
        if chosen == nil {
            say("Can't use it: \(problem). Click into its message box once, then choose it again.", glyph: "error")
        }
        else { say("") }
        select(chosen)
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

    /// macOS asks once whether Add may control a terminal; after a refusal only System Settings can change it.
    private func allowTerminal(_ choice: String) {
        guard let app = TerminalApp(rawValue: String(choice.split(separator: ":", maxSplits: 1)[1])) else { return }
        if choice.hasPrefix("settings:") {
            NSWorkspace.shared.open(URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Automation")!)
            say("Turn on \(app.name) under Add to Claude in Privacy & Security → Automation, then refresh the window list.")
            return render()
        }
        // The prompt is an ordinary window; the floating panel would cover it.
        view.window?.orderOut(nil)
        say("Answer macOS's question about \(app.name), then reopen this panel; its tabs are listed once allowed.")
        TerminalScripting.queue.async { [weak self] in
            _ = TerminalScripting.access(app, ask: true)
            DispatchQueue.main.async { self?.findWindows() }
        }
    }

    @objc private func allowAccess() {
        // macOS shows its prompt in an ordinary window; the floating panel would cover it.
        view.window?.orderOut(nil)
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
        // A popover takes its size from here; without it the insets can be clipped.
        column.layoutSubtreeIfNeeded()
        controller.preferredContentSize = column.fittingSize
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

    /// Add: the scope shown, unless it is exactly what was just added (then it asks first), or there is
    /// nothing new (then it offers the last batch again).
    @objc private func addContext() {
        guard !busy, hasDestination, prepared != nil, let scope = currentScope, let analysis else { return }
        if scope.mode == "new" && scope.turns.isEmpty {
            guard !analysis.lastBatch.isEmpty else { return }
            let again = resolveScope(.again, turns: prepared!.turnList, analysis: analysis)
            return say("Nothing new since last add. Add the last \(again.turns.count == 1 ? "turn" : "\(again.turns.count) turns") again?",
                       glyph: "info", actions: [("Add Again", { [weak self] in self?.run(again) }), ("Cancel", { [weak self] in self?.say("") })])
        }
        if isAlreadyAdded(scope, analysis: analysis) {
            let again = ResolvedScope(mode: "again", turns: scope.turns, note: "added again", everything: scope.everything,
                                      label: scope.label, detail: scope.detail, automatic: false)
            return say("Already added — Add again?", glyph: "info",
                       actions: [("Add Again", { [weak self] in self?.run(again) }), ("Cancel", { [weak self] in self?.say("") })])
        }
        run(scope)
    }

    /// Prepares the text for these turns, downloads their files, appends to the draft, and records each
    /// step: prepared → insertion_attempted → composer_inserted, failed or unknown.
    private func run(_ scope: ResolvedScope, anyProcess: Bool = false) {
        guard !busy, hasDestination, let frozen = prepared, !scope.turns.isEmpty else { return }
        // Shells and agent CLIs edit a typed line until Return; another program may act on each character.
        if let tab = terminal, !anyProcess, !editsLines(tab.process) {
            let running = tab.process.isEmpty ? "a program Add cannot name" : tab.process
            return say("This tab runs \(running), which may act on typed characters rather than edit a line. Add the line anyway?",
                       glyph: "info", actions: [("Add Anyway", { [weak self] in self?.run(scope, anyProcess: true) }),
                                                ("Cancel", { [weak self] in self?.say("") })])
        }
        // Web editors (Claude's among them) rebuild their message box. Only when the chosen one is gone,
        // take the window's current one, checked exactly as choosing the window again would check it;
        // a box that still exists is never swapped for another, such as an open edit field.
        var role: CFTypeRef?
        if let current = composer, AXUIElementCopyAttributeValue(current.editor, kAXRoleAttribute as CFString, &role) == .invalidUIElement {
            let (field, problem) = inspectComposer(current.choice)
            guard let field else {
                say("Can't use it: \(problem). Click into its message box once, then choose it again.", glyph: "error", result: true)
                return render()
            }
            composer = Composer(choice: current.choice, editor: field)
        }
        let selected = composer, tab = terminal
        // The target is read again right before writing: a window that now shows another conversation is
        // not the one the scope was worked out for.
        let identity = identifyDestination()
        guard let identity, identity == target else {
            target = identity
            scopeChoice = .auto
            say("The target conversation changed. Check the turns to add, then Add again.", glyph: "error", result: true)
            return render()
        }
        busy = true
        operation = UUID()
        let id = operation
        let trace = HandoffTrace()
        trace.record(.started, turns: scope.turns.count, scope: scope.mode, target: selected?.choice.app.bundleIdentifier ?? tab?.app.rawValue)
        let receipt = frozen.sourceId.map {
            log.begin(source: $0, target: identity, mode: scope.mode, turns: scope.turns, attachments: scope.turns.flatMap(\.files))
        }
        let valid: () -> Bool = { [weak self] in
            guard let self, self.operation == id, let current = self.prepared else { return false }
            // Files can take a while: the target window may show another conversation by the time we write.
            return current.revision == frozen.revision && self.isCurrent(frozen) && self.identifyDestination() == identity
        }
        let app = selected.map { safeLabel($0.choice.app.localizedName ?? "the app", limit: 24) } ?? tab?.app.name ?? "the app"
        let what = scope.everything ? "all \(scope.turns.count) turn\(scope.turns.count == 1 ? "" : "s")"
            : "\(scope.turns.count) turn\(scope.turns.count == 1 ? "" : "s")"
        say("Preparing \(what)…", glyph: "waiting")
        render()

        // For a tab, the line can always be copied by hand once the file is written.
        var mention = ""
        let copyLine = { [weak self] in
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(mention, forType: .string)
            self?.say("The line is on the clipboard: click the tab and paste it. Nothing was run.", glyph: "done", result: true)
        }
        let fail = { [weak self] (message: String) in
            trace.record(.failed)
            if let receipt { self?.log.move(receipt, to: .failed) }
            self?.finish("Failed: \(message)", glyph: "error", actions: mention.isEmpty ? [] : [("Copy Line", copyLine)])
        }
        let append = { [weak self] (text: Prepared) in
            guard let self, valid() else { return fail("The conversation changed. Nothing was added.") }
            let (markdown, filesNote) = self.withFiles(text)
            guard tab != nil || markdown.utf8.count <= maximumTextBytes else {
                return fail("\(what.prefix(1).uppercased() + what.dropFirst()) come to \(ByteCountFormatter.string(fromByteCount: Int64(markdown.utf8.count), countStyle: .file)), over the 2 MB a message box takes. Choose fewer turns, or Save.")
            }
            // A terminal tab gets the text as a file and a one-line mention of it.
            var fileName = ""
            if tab != nil {
                switch HandoffFiles.shared.write(markdown, title: frozen.title, conversation: frozen.sourceId) {
                case .failure(let problem): return fail(problem.message)
                case .success(let path):
                    guard let line = handoffMention(path.path) else {
                        return fail("The files folder's path holds a character a shell acts on (\" $ ` \\ !) or a control character, so a one-line mention could run something. Choose another folder in Settings.")
                    }
                    mention = line
                    fileName = path.lastPathComponent
                }
            }
            trace.record(.insertAttempted, files: text.attachments.count, bytes: markdown.utf8.count, checks: text.checks)
            if let receipt { self.log.move(receipt, to: .insertionAttempted) }
            self.say("Adding \(what) to \(app)…", glyph: "waiting")
            let deliver = { (done: @escaping (String, AddOutcome) -> Void) in
                if let selected {
                    appendToComposer(selected, text: markdown, operationValid: valid, revalidateSource: { reply in reply(valid()) }, completion: done)
                } else if let tab {
                    appendToTerminal(tab, line: mention, operationValid: valid, completion: done)
                }
            }
            deliver { [weak self] message, outcome in
                guard let self else { return }
                let files = filesNote.isEmpty ? "" : " " + filesNote
                switch outcome {
                case .inserted:
                    trace.record(.inserted)
                    if let receipt { self.log.move(receipt, to: .composerInserted) }
                    self.scopeChoice = .auto
                    self.finish(tab != nil ? "Saved \(what) as \(fileName) and put a mention of it in the \(app) tab. Nothing was run.\(files)"
                                : "Added \(what) to the draft in \(app). Nothing was sent.\(files)", glyph: "done")
                case .unconfirmed:
                    trace.record(.unconfirmed)
                    if let receipt { self.log.move(receipt, to: .unknown) }
                    self.finish("Could not confirm. \(message)\(files)", glyph: "unverified", actions: receipt.map { receipt in
                        [("It's There", { [weak self] in trace.record(.confirmedByUser); self?.settle(receipt, inserted: true) }),
                         ("It's Not", { [weak self] in
                             trace.record(.declinedByUser)
                             self?.settle(receipt, inserted: false)
                             if tab != nil { copyLine() } // So it can be pasted by hand.
                         })]
                    } ?? [])
                case .failed:
                    fail(message)
                }
            }
        }
        let withFiles = { [weak self] (text: Prepared) in
            // Files first, so their lines can point at local copies.
            guard let self, UserDefaults.standard.bool(forKey: Preferences.downloadOnAdd), !text.attachments.isEmpty else { return append(text) }
            self.say("Preparing \(text.attachments.count) file\(text.attachments.count == 1 ? "" : "s")…", glyph: "waiting")
            self.downloadFiles(text.attachments.map(\.key)) {
                trace.record(.filesFetched, files: text.attachments.count)
                append(text)
            }
        }
        if scope.everything { return withFiles(frozen) }
        project(frozen, scope.turns, scope.note) { result in
            switch result {
            case .success(let text):
                trace.record(.projected, turns: scope.turns.count, bytes: text.markdown.utf8.count)
                withFiles(frozen.projected(text))
            case .failure(let message): fail(message)
            }
        }
    }

    /// The user's answer to "Could not confirm": it is in the draft, or it is not.
    private func settle(_ receipt: String, inserted: Bool) {
        log.move(receipt, to: inserted ? .composerInserted : .failed, byUser: true)
        if inserted { scopeChoice = .auto }
        say(inserted ? "Marked as added. Nothing was sent." : "Marked as not added. Add again when ready.",
            glyph: inserted ? "done" : "info", result: true)
        render()
    }

    private func finish(_ message: String, glyph name: String, actions: [(String, () -> Void)] = []) {
        busy = false
        say(message, glyph: name, result: true, actions: actions)
        render()
    }
}

/// A scope choice carried by a menu item.
private final class ScopeBox: NSObject {
    let choice: ScopeChoice
    init(_ choice: ScopeChoice) { self.choice = choice }
}
