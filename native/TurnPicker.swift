import AppKit

/// "Choose turns…": one row per turn with a checkbox, role, number, preview and file count; turns
/// already added to this target are marked. Shift-click checks or clears a run. A table view, so a
/// conversation of thousands of turns scrolls as smoothly as one of ten.
final class TurnPicker: NSViewController, NSTableViewDataSource, NSTableViewDelegate {
    private let turns: [TurnInfo]
    private let added: Set<String>
    private let changed: Set<String>
    private(set) var selected: Set<String>
    private let changedSelection: (Set<String>) -> Void
    private let done: () -> Void
    private let table = NSTableView()
    private let footer = label(size: 11, color: .secondaryLabelColor)
    private var anchor: Int?

    init(turns: [TurnInfo], added: Set<String>, changed: Set<String>, selected: Set<String>,
         changedSelection: @escaping (Set<String>) -> Void, done: @escaping () -> Void) {
        self.turns = turns
        self.added = added
        self.changed = changed
        self.selected = selected
        self.changedSelection = changedSelection
        self.done = done
        super.init(nibName: nil, bundle: nil)
    }
    required init?(coder: NSCoder) { fatalError() }

    override func loadView() {
        let column = NSTableColumn(identifier: .init("turn"))
        column.width = 420
        table.addTableColumn(column)
        table.headerView = nil
        table.rowHeight = 26
        table.intercellSpacing = NSSize(width: 0, height: 0)
        table.style = .plain
        table.usesAlternatingRowBackgroundColors = false
        table.selectionHighlightStyle = .none
        table.dataSource = self
        table.delegate = self
        table.setAccessibilityLabel("Turns")
        let scroll = NSScrollView()
        scroll.documentView = table
        scroll.hasVerticalScroller = true
        scroll.autohidesScrollers = true
        scroll.drawsBackground = false
        scroll.heightAnchor.constraint(equalToConstant: CGFloat(min(max(turns.count, 3), 14)) * 26).isActive = true
        scroll.widthAnchor.constraint(equalToConstant: 432).isActive = true

        let headerIcon = NSImageView(image: glyph("chat", size: 14) ?? NSImage())
        headerIcon.contentTintColor = .secondaryLabelColor
        let header = NSStackView(views: [headerIcon, label("Choose turns to add", size: 12, weight: .semibold), NSView(),
                                         ClosureButton.icon("select-all", "Select all turns") { [weak self] in self?.setAll(true) },
                                         ClosureButton.icon("select-none", "Select no turns") { [weak self] in self?.setAll(false) }])
        header.spacing = 6
        for button in header.arrangedSubviews.compactMap({ $0 as? NSButton }) { button.controlSize = .small }
        let doneButton = ClosureButton(title: "Done") { [weak self] in self?.done() }
        doneButton.keyEquivalent = "\r"
        let bottom = NSStackView(views: [footer, NSView(), doneButton])
        let stack = NSStackView(views: [header, scroll, bottom])
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 8
        stack.edgeInsets = NSEdgeInsets(top: 12, left: 12, bottom: 12, right: 12)
        for row in [header, bottom] { row.widthAnchor.constraint(equalTo: scroll.widthAnchor).isActive = true }
        view = stack
        updateFooter()
        // Open on the first chosen turn, or at the end, where new turns are.
        let first = turns.firstIndex { selected.contains($0.id) } ?? max(turns.count - 1, 0)
        DispatchQueue.main.async { [weak self] in self?.table.scrollRowToVisible(first) }
    }

    func numberOfRows(in tableView: NSTableView) -> Int { turns.count }

    func tableView(_ tableView: NSTableView, viewFor tableColumn: NSTableColumn?, row: Int) -> NSView? {
        let cell = tableView.makeView(withIdentifier: TurnRow.identifier, owner: self) as? TurnRow ?? TurnRow()
        let turn = turns[row]
        cell.show(turn, checked: selected.contains(turn.id),
                  note: changed.contains(turn.id) ? "changed" : added.contains(turn.id) ? "added" : nil)
        cell.toggled = { [weak self] on in self?.toggle(row: row, on: on) }
        return cell
    }

    private func toggle(row: Int, on: Bool) {
        // Shift-click: the run from the last clicked row to this one takes this row's new state.
        let range = NSEvent.modifierFlags.contains(.shift) && anchor != nil ? min(anchor!, row)...max(anchor!, row) : row...row
        for index in range where turns.indices.contains(index) {
            if on { selected.insert(turns[index].id) } else { selected.remove(turns[index].id) }
        }
        anchor = row
        table.reloadData(forRowIndexes: IndexSet(integersIn: range), columnIndexes: [0])
        updateFooter()
        changedSelection(selected)
    }

    private func setAll(_ on: Bool) {
        selected = on ? Set(turns.map(\.id)) : []
        anchor = nil
        table.reloadData()
        updateFooter()
        changedSelection(selected)
    }

    private func updateFooter() {
        let chosen = turns.filter { selected.contains($0.id) }
        let files = chosen.reduce(0) { $0 + $1.files.count }
        footer.stringValue = "\(chosen.count) of \(turns.count) selected" + (files > 0 ? " · \(files) file\(files == 1 ? "" : "s")" : "")
    }
}

/// One turn: checkbox, role glyph, number, preview, and its file count or added mark.
final class TurnRow: NSTableCellView {
    static let identifier = NSUserInterfaceItemIdentifier("TurnRow")
    var toggled: (Bool) -> Void = { _ in }
    private let box = NSButton(checkboxWithTitle: "", target: nil, action: nil)
    private let role = NSImageView()
    private let number = label(size: 11, color: .secondaryLabelColor)
    private let preview = label(size: 12)
    private let files = NSButton()
    private let note = label(size: 11, color: .secondaryLabelColor)
    private let mark = NSImageView()

    init() {
        super.init(frame: .zero)
        identifier = Self.identifier
        box.target = self
        box.action = #selector(flip)
        role.contentTintColor = .secondaryLabelColor
        mark.contentTintColor = .secondaryLabelColor
        mark.image = glyph("done", size: 12)
        number.alignment = .right
        number.widthAnchor.constraint(equalToConstant: 30).isActive = true
        number.font = .monospacedDigitSystemFont(ofSize: 11, weight: .regular)
        preview.lineBreakMode = .byTruncatingTail
        files.isBordered = false
        files.imagePosition = .imageLeading
        files.font = .systemFont(ofSize: 11)
        files.contentTintColor = .secondaryLabelColor
        files.isEnabled = false
        for view in [note, files, mark] as [NSView] { view.setContentCompressionResistancePriority(.required, for: .horizontal) }
        let row = NSStackView(views: [box, role, number, preview, NSView(), files, mark, note])
        row.spacing = 6
        row.edgeInsets = NSEdgeInsets(top: 0, left: 2, bottom: 0, right: 4)
        row.translatesAutoresizingMaskIntoConstraints = false
        addSubview(row)
        NSLayoutConstraint.activate([row.leadingAnchor.constraint(equalTo: leadingAnchor), row.trailingAnchor.constraint(equalTo: trailingAnchor),
                                     row.centerYAnchor.constraint(equalTo: centerYAnchor)])
    }
    required init?(coder: NSCoder) { fatalError() }

    func show(_ turn: TurnInfo, checked: Bool, note text: String?) {
        box.state = checked ? .on : .off
        box.setAccessibilityLabel("Turn \(turn.position), \(turn.role == "user" ? "you" : "ChatGPT")")
        role.image = glyph(turn.role == "user" ? "person" : "chat", size: 14)
        role.setAccessibilityLabel(turn.role == "user" ? "You" : "ChatGPT")
        number.stringValue = "\(turn.position)"
        preview.stringValue = turn.preview.isEmpty ? "(no text)" : turn.preview
        preview.textColor = turn.preview.isEmpty ? .tertiaryLabelColor : .labelColor
        preview.toolTip = turn.preview
        files.isHidden = turn.files.isEmpty
        files.title = "\(turn.files.count)"
        files.image = glyph("attach", size: 12)
        files.toolTip = "\(turn.files.count) file\(turn.files.count == 1 ? "" : "s")"
        note.stringValue = text ?? ""
        note.isHidden = text == nil
        note.textColor = text == "changed" ? .systemOrange : .secondaryLabelColor
        mark.isHidden = text != "added"
    }

    @objc private func flip() { toggled(box.state == .on) }
}
