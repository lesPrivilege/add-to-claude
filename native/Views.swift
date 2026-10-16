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
