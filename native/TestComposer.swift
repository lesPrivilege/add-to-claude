import AppKit

// A local synthetic acceptance fixture. There is no submit button or network code.
final class FixtureWindow: NSWindowController {
    private let column = NSStackView()
    private let scroll = NSScrollView()
    private var editor = NSTextView()
    private var changedTitle = false

    init(name: String) {
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 570, height: 440),
                              styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.title = "gpt-handoff test composer — \(name)"
        window.setFrameOrigin(NSPoint(x: name == "A" ? 140 : 740, y: 240))
        super.init(window: window)
        column.orientation = .vertical
        column.alignment = .leading
        column.spacing = 14
        column.edgeInsets = NSEdgeInsets(top: 22, left: 22, bottom: 22, right: 22)
        column.translatesAutoresizingMaskIntoConstraints = false
        window.contentView?.addSubview(column)
        NSLayoutConstraint.activate([
            column.leadingAnchor.constraint(equalTo: window.contentView!.leadingAnchor),
            column.trailingAnchor.constraint(equalTo: window.contentView!.trailingAnchor),
            column.topAnchor.constraint(equalTo: window.contentView!.topAnchor),
            column.bottomAnchor.constraint(equalTo: window.contentView!.bottomAnchor)
        ])
        let title = NSTextField(labelWithString: "Composer \(name)")
        title.font = .systemFont(ofSize: 23, weight: .semibold)
        column.addArrangedSubview(title)
        column.addArrangedSubview(NSTextField(wrappingLabelWithString: "Synthetic local fixture. Nothing is sent or executed. Click the text area before choosing this window in the menu-bar app."))
        scroll.hasVerticalScroller = true
        scroll.borderType = .bezelBorder
        scroll.translatesAutoresizingMaskIntoConstraints = false
        column.addArrangedSubview(scroll)
        scroll.widthAnchor.constraint(equalTo: column.widthAnchor, constant: -44).isActive = true
        scroll.heightAnchor.constraint(greaterThanOrEqualToConstant: 230).isActive = true
        configureEditor("Synthetic draft \(name).")
        let controls = NSStackView()
        controls.spacing = 12
        controls.addArrangedSubview(NSButton(title: "Toggle read-only", target: self, action: #selector(toggleEditable)))
        controls.addArrangedSubview(NSButton(title: "Replace editor", target: self, action: #selector(replaceEditor)))
        controls.addArrangedSubview(NSButton(title: "Change title", target: self, action: #selector(changeTitle)))
        column.addArrangedSubview(controls)
        window.makeFirstResponder(editor)
    }

    required init?(coder: NSCoder) { fatalError("Not used") }

    private func configureEditor(_ value: String) {
        editor = NSTextView(frame: NSRect(x: 0, y: 0, width: 500, height: 230))
        editor.isRichText = false
        editor.isVerticallyResizable = true
        editor.autoresizingMask = [.width]
        editor.textContainer?.widthTracksTextView = true
        editor.font = .monospacedSystemFont(ofSize: 13, weight: .regular)
        editor.textContainerInset = NSSize(width: 12, height: 12)
        editor.string = value
        editor.setAccessibilityLabel("Test composer")
        scroll.documentView = editor
    }

    @objc private func toggleEditable() { editor.isEditable.toggle(); window?.makeFirstResponder(editor) }
    @objc private func replaceEditor() { configureEditor("Replacement synthetic draft."); window?.makeFirstResponder(editor) }
    @objc private func changeTitle() { changedTitle.toggle(); window?.title = changedTitle ? "Changed test window" : "Restored test window"; window?.makeFirstResponder(editor) }
}

final class FixtureDelegate: NSObject, NSApplicationDelegate {
    private var windows: [FixtureWindow] = []
    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)
        let menu = NSMenu()
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "Quit test composer", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        let appItem = NSMenuItem()
        appItem.submenu = appMenu
        menu.addItem(appItem)
        let edit = NSMenu(title: "Edit")
        edit.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        edit.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        edit.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        edit.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        let editItem = NSMenuItem(title: "Edit", action: nil, keyEquivalent: "")
        editItem.submenu = edit
        menu.addItem(editItem)
        NSApp.mainMenu = menu
        windows = [FixtureWindow(name: "A"), FixtureWindow(name: "B")]
        windows.forEach { $0.showWindow(nil) }
        NSApp.activate(ignoringOtherApps: true)
    }
}

let app = NSApplication.shared
let delegate = FixtureDelegate()
app.delegate = delegate
app.run()
