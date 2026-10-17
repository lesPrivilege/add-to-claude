import AppKit

func glyph(_ name: String, size: CGFloat = 16) -> NSImage? {
    guard let url = Bundle.main.url(forResource: name, withExtension: "svg", subdirectory: "icons"),
          let image = NSImage(contentsOf: url) else { return nil }
    image.isTemplate = true
    image.size = NSSize(width: size, height: size)
    return image
}

func label(_ text: String = "", size: CGFloat = 12, weight: NSFont.Weight = .regular,
                   color: NSColor = .labelColor) -> NSTextField {
    let field = NSTextField(labelWithString: text)
    field.font = .systemFont(ofSize: size, weight: weight)
    field.textColor = color
    field.lineBreakMode = .byTruncatingTail
    field.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
    return field
}

func iconButton(_ name: String, _ title: String, _ action: Selector, _ target: AnyObject) -> NSButton {
    let button = NSButton(image: glyph(name) ?? NSImage(), target: target, action: action)
    button.bezelStyle = .accessoryBarAction
    button.isBordered = true
    button.showsBorderOnlyWhileMouseInside = true
    button.toolTip = title
    button.setAccessibilityLabel(title)
    button.widthAnchor.constraint(equalToConstant: 28).isActive = true
    button.heightAnchor.constraint(equalToConstant: 24).isActive = true
    return button
}

/// A one-line note above the chat with a dismiss button; hidden until shown.
final class Notice: NSView {
    private let text = label(size: 11, color: .secondaryLabelColor)
    private var dismissed: () -> Void = {}

    init() {
        super.init(frame: .zero)
        let icon = NSImageView(image: glyph("info", size: 14) ?? NSImage())
        icon.contentTintColor = .secondaryLabelColor
        text.maximumNumberOfLines = 3
        text.lineBreakMode = .byWordWrapping
        text.cell?.truncatesLastVisibleLine = true
        let close = iconButton("close", "Dismiss", #selector(dismiss), self)
        let row = NSStackView(views: [icon, text, close])
        row.alignment = .top
        row.spacing = 8
        row.edgeInsets = NSEdgeInsets(top: 6, left: 12, bottom: 6, right: 8)
        row.translatesAutoresizingMaskIntoConstraints = false
        addSubview(row)
        NSLayoutConstraint.activate([
            row.leadingAnchor.constraint(equalTo: leadingAnchor), row.trailingAnchor.constraint(equalTo: trailingAnchor),
            row.topAnchor.constraint(equalTo: topAnchor), row.bottomAnchor.constraint(equalTo: bottomAnchor),
        ])
        wantsLayer = true
        layer?.backgroundColor = NSColor.quaternaryLabelColor.withAlphaComponent(0.08).cgColor
        isHidden = true
    }
    required init?(coder: NSCoder) { fatalError() }

    func show(_ message: String, onDismiss: @escaping () -> Void = {}) {
        text.stringValue = message
        text.toolTip = message
        dismissed = onDismiss
        isHidden = false
    }

    @objc func dismiss() {
        isHidden = true
        dismissed()
    }
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

    /// A borderless-until-hover glyph button with a tooltip, for actions whose meaning is stable.
    static func icon(_ name: String, _ help: String, run: @escaping () -> Void) -> ClosureButton {
        let button = ClosureButton(title: "", glyph: name, run: run)
        button.bezelStyle = .accessoryBarAction
        button.showsBorderOnlyWhileMouseInside = true
        button.imagePosition = .imageOnly
        button.toolTip = help
        button.setAccessibilityLabel(help)
        return button
    }
}
