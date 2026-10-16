import AppKit

// Optical checks for the WO-02 icon candidates.
// Renders each menu-bar glyph as an NSImage template on simulated menu-bar strips (16/18/20 pt, @1x/@2x,
// light/dark, plain and tinted wallpaper) beside neutral reference glyphs drawn for this project, and each
// app icon at 32/64/128/256 px on Dock-like backgrounds. Usage, from the project root:
//   xcrun swiftc -O scripts/icons/render.swift -o /tmp/icon-render && /tmp/icon-render . [--system-neighbours <out.png>]
// --system-neighbours additionally writes a local-only Dock strip with icons of installed system apps for the
// owner's eye; that file contains Apple artwork and must not be committed.

let root = URL(fileURLWithPath: CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : ".")
let icons = root.appendingPathComponent("docs/design/icons")
// The WO-02 candidates are archived; the neutral reference glyphs stay with the shipped design.
let archive = root.appendingPathComponent("docs/archive/design-icons")
let out = root.appendingPathComponent("artifacts/icons")
try! FileManager.default.createDirectory(at: out.appendingPathComponent("export"), withIntermediateDirectories: true)

struct Candidate { let id: String; let name: String; let glyph: URL; let app: URL }
let candidates = [
    Candidate(id: "P0", name: "P0 · current (rejected)", glyph: root.appendingPathComponent("native/icons/brand.svg"),
              app: root.appendingPathComponent("native/brand/app-icon.svg")),
    Candidate(id: "D1", name: "D1 · Arc Insert", glyph: archive.appendingPathComponent("d1-arc-insert/glyph.svg"),
              app: archive.appendingPathComponent("d1-arc-insert/app-icon.svg")),
    Candidate(id: "D2", name: "D2 · Cursor Arrival", glyph: archive.appendingPathComponent("d2-cursor-arrival/glyph.svg"),
              app: archive.appendingPathComponent("d2-cursor-arrival/app-icon.svg")),
    Candidate(id: "D3", name: "D3 · Negative-space Inlet", glyph: archive.appendingPathComponent("d3-negative-inlet/glyph.svg"),
              app: archive.appendingPathComponent("d3-negative-inlet/app-icon.svg")),
]
let refs = ["magnifier", "clock", "battery", "bell"].map { icons.appendingPathComponent("ref/\($0).svg") }

func load(_ url: URL) -> NSImage {
    guard let image = NSImage(contentsOf: url) else { fatalError("cannot load \(url.path)") }
    return image
}

// A template image as AppKit would tint it: black + alpha, recoloured with the menu-bar foreground.
func template(_ url: URL, points: CGFloat, scale: CGFloat, color: NSColor) -> NSImage {
    let source = load(url)
    source.isTemplate = true
    let px = Int(points * scale)
    let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: px, pixelsHigh: px, bitsPerSample: 8, samplesPerPixel: 4,
                               hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
    let rect = NSRect(x: 0, y: 0, width: px, height: px)
    source.draw(in: rect)
    color.set()
    rect.fill(using: .sourceIn)
    NSGraphicsContext.restoreGraphicsState()
    let image = NSImage(size: NSSize(width: px, height: px))
    image.addRepresentation(rep)
    return image
}

func raster(_ url: URL, px: Int) -> NSBitmapImageRep {
    let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: px, pixelsHigh: px, bitsPerSample: 8, samplesPerPixel: 4,
                               hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
    NSGraphicsContext.current?.imageInterpolation = .high
    load(url).draw(in: NSRect(x: 0, y: 0, width: px, height: px))
    NSGraphicsContext.restoreGraphicsState()
    return rep
}

// A canvas in pixels, origin top-left.
final class Canvas {
    let rep: NSBitmapImageRep
    let height: CGFloat
    init(_ w: Int, _ h: Int, _ bg: NSColor) {
        rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: w, pixelsHigh: h, bitsPerSample: 8, samplesPerPixel: 4,
                               hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
        height = CGFloat(h)
        draw { bg.setFill(); NSRect(x: 0, y: 0, width: w, height: h).fill() }
    }
    func draw(_ body: () -> Void) {
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
        body()
        NSGraphicsContext.restoreGraphicsState()
    }
    func flip(_ r: NSRect) -> NSRect { NSRect(x: r.minX, y: height - r.maxY, width: r.width, height: r.height) }
    func rect(_ r: NSRect, _ c: NSColor) { draw { c.setFill(); flip(r).fill() } }
    func image(_ i: NSImage, _ r: NSRect, nearest: Bool = false) {
        draw {
            NSGraphicsContext.current?.imageInterpolation = nearest ? .none : .high
            i.draw(in: flip(r), from: .zero, operation: .sourceOver, fraction: 1)
        }
    }
    func rep(_ r2: NSBitmapImageRep, _ r: NSRect, nearest: Bool = false) {
        let i = NSImage(size: r2.size); i.addRepresentation(r2); image(i, r, nearest: nearest)
    }
    func text(_ s: String, _ x: CGFloat, _ y: CGFloat, size: CGFloat, color: NSColor, weight: NSFont.Weight = .regular) {
        draw {
            let attrs: [NSAttributedString.Key: Any] = [.font: NSFont.systemFont(ofSize: size, weight: weight), .foregroundColor: color]
            let str = NSAttributedString(string: s, attributes: attrs)
            str.draw(at: NSPoint(x: x, y: height - y - str.size().height))
        }
    }
    func save(_ url: URL) { try! rep.representation(using: .png, properties: [:])!.write(to: url) }
}

struct Appearance { let name: String; let bar: NSColor; let fg: NSColor }
let appearances = [
    Appearance(name: "light", bar: NSColor(srgbRed: 0.93, green: 0.93, blue: 0.94, alpha: 1), fg: NSColor(white: 0, alpha: 0.85)),
    Appearance(name: "light · tinted wallpaper", bar: NSColor(srgbRed: 0.76, green: 0.81, blue: 0.86, alpha: 1), fg: NSColor(white: 0, alpha: 0.85)),
    Appearance(name: "dark", bar: NSColor(srgbRed: 0.12, green: 0.12, blue: 0.13, alpha: 1), fg: NSColor(white: 1, alpha: 0.92)),
    Appearance(name: "dark · tinted wallpaper", bar: NSColor(srgbRed: 0.20, green: 0.25, blue: 0.32, alpha: 1), fg: NSColor(white: 1, alpha: 0.92)),
]

// One menu-bar strip, 24 pt high: two reference glyphs, the candidate at 16, 18 and 20 pt, two more references, a clock.
let stripWidth: CGFloat = 300
func strip(_ c: Canvas, x: CGFloat, y: CGFloat, scale: CGFloat, glyph: URL, a: Appearance) {
    c.rect(NSRect(x: x, y: y, width: stripWidth * scale, height: 24 * scale), a.bar)
    var cx = x + 10 * scale
    func put(_ url: URL, _ pt: CGFloat) {
        let img = template(url, points: pt, scale: scale, color: a.fg)
        c.image(img, NSRect(x: cx, y: y + (24 - pt) / 2 * scale, width: pt * scale, height: pt * scale), nearest: true)
        cx += (pt + 12) * scale
    }
    put(refs[0], 16); put(refs[1], 16)
    for pt in [16, 18, 20] as [CGFloat] { put(glyph, pt) }
    put(refs[2], 16); put(refs[3], 16)
    c.text("Fri 16 Oct  9:41", cx - 2 * scale, y + 4.5 * scale, size: 13 * scale, color: a.fg, weight: .medium)
}

let ink = NSColor(white: 0.12, alpha: 1), sub = NSColor(white: 0.42, alpha: 1), paper = NSColor(white: 0.985, alpha: 1)

// menubar-compare.png
do {
    let colW: CGFloat = stripWidth * 2 + 40
    let blockH: CGFloat = 40 + 48 + 12 + 24 + 12 + 96 + 30
    let c = Canvas(Int(40 + colW * 2), Int(70 + blockH * CGFloat(candidates.count)), paper)
    c.text("Menu-bar glyph · template rendering · refs | 16 pt | 18 pt | 20 pt | refs. Rows: @2x, @1x, @1x shown 4× nearest-neighbour.",
           20, 20, size: 18, color: ink, weight: .semibold)
    for (i, cand) in candidates.enumerated() {
        let y0 = 70 + blockH * CGFloat(i)
        c.text(cand.name, 20, y0, size: 20, color: ink, weight: .bold)
        for (j, a) in [appearances[0], appearances[2]].enumerated() {
            let x = 20 + colW * CGFloat(j)
            let tinted = appearances[j == 0 ? 1 : 3]
            c.text("\(a.name) / \(tinted.name)", x + 340, y0 + 6, size: 13, color: sub)
            strip(c, x: x, y: y0 + 40, scale: 2, glyph: cand.glyph, a: a)
            strip(c, x: x, y: y0 + 100, scale: 1, glyph: cand.glyph, a: a)
            strip(c, x: x + stripWidth + 20, y: y0 + 100, scale: 1, glyph: cand.glyph, a: tinted)
            // 4x pixel zoom of the @1x strip (candidate region only)
            let small = Canvas(Int(stripWidth), 24, paper)
            strip(small, x: 0, y: 0, scale: 1, glyph: cand.glyph, a: a)
            let crop = small.rep.cgImage!.cropping(to: CGRect(x: 0, y: 0, width: 150, height: 24))!
            let zoom = NSImage(cgImage: crop, size: NSSize(width: 150, height: 24))
            c.image(zoom, NSRect(x: x, y: y0 + 136, width: 600, height: 96), nearest: true)
        }
    }
    c.save(out.appendingPathComponent("menubar-compare.png"))
}

// appicon-compare.png
let dockLight = NSColor(srgbRed: 0.86, green: 0.87, blue: 0.89, alpha: 1)
let dockDark = NSColor(srgbRed: 0.17, green: 0.17, blue: 0.19, alpha: 1)
do {
    let sizes = [32, 64, 128, 256]
    let half = 20 + sizes.reduce(0) { $0 + $1 + 24 }
    let rowH = 256 + 70
    let c = Canvas(40 + half * 2, 70 + rowH * candidates.count, paper)
    c.text("App icon · actual pixels 32 / 64 / 128 / 256 · Dock-like light and dark grounds", 20, 20, size: 18, color: ink, weight: .semibold)
    for (i, cand) in candidates.enumerated() {
        let y0 = CGFloat(70 + rowH * i)
        c.text(cand.name, 20, y0, size: 20, color: ink, weight: .bold)
        for (j, bg) in [dockLight, dockDark].enumerated() {
            let x0 = CGFloat(20 + half * j)
            c.rect(NSRect(x: x0, y: y0 + 34, width: CGFloat(half - 10), height: 276), bg)
            var x = x0 + 16
            for s in sizes {
                c.rep(raster(cand.app, px: s), NSRect(x: x, y: y0 + 34 + 266 - CGFloat(s), width: CGFloat(s), height: CGFloat(s)))
                x += CGFloat(s + 24)
            }
        }
    }
    c.save(out.appendingPathComponent("appicon-compare.png"))
}

// board.png: 3 x 2 (D1–D3 x glyph / app icon), in context and isolated on white and dark.
do {
    let d = Array(candidates.dropFirst())
    let colW = 640, rowH = 420
    let c = Canvas(40 + colW * 3, 90 + rowH * 2, paper)
    c.text("WO-02 · three paired concepts · top: menu-bar glyph (template) · bottom: app icon", 20, 24, size: 22, color: ink, weight: .semibold)
    for (i, cand) in d.enumerated() {
        let x = CGFloat(20 + colW * i)
        c.text(cand.name, x, 62, size: 20, color: ink, weight: .bold)
        // glyph row
        let y1: CGFloat = 100
        c.rect(NSRect(x: x, y: y1, width: 140, height: 140), .white)
        c.image(template(cand.glyph, points: 96, scale: 1, color: .black), NSRect(x: x + 22, y: y1 + 22, width: 96, height: 96))
        c.rect(NSRect(x: x + 150, y: y1, width: 140, height: 140), dockDark)
        c.image(template(cand.glyph, points: 96, scale: 1, color: .white), NSRect(x: x + 172, y: y1 + 22, width: 96, height: 96))
        c.rect(NSRect(x: x + 300, y: y1, width: 140, height: 140), .white)
        c.image(template(cand.glyph, points: 18, scale: 2, color: .black), NSRect(x: x + 352, y: y1 + 52, width: 36, height: 36))
        c.text("18 pt @2x", x + 340, y1 + 112, size: 12, color: sub)
        strip(c, x: x, y: y1 + 160, scale: 2, glyph: cand.glyph, a: appearances[0])
        strip(c, x: x, y: y1 + 220, scale: 2, glyph: cand.glyph, a: appearances[2])
        c.text("strips: refs | 16 | 18 | 20 pt | refs (@2x)", x, y1 + 280, size: 12, color: sub)
        // app row
        let y2 = CGFloat(90 + rowH)
        c.rect(NSRect(x: x, y: y2, width: 300, height: 300), .white)
        c.rep(raster(cand.app, px: 256), NSRect(x: x + 22, y: y2 + 22, width: 256, height: 256))
        c.rect(NSRect(x: x + 310, y: y2, width: 290, height: 300), dockDark)
        c.rep(raster(cand.app, px: 128), NSRect(x: x + 330, y: y2 + 20, width: 128, height: 128))
        c.rep(raster(cand.app, px: 64), NSRect(x: x + 480, y: y2 + 52, width: 64, height: 64))
        c.rep(raster(cand.app, px: 32), NSRect(x: x + 560, y: y2 + 68, width: 32, height: 32))
        c.rect(NSRect(x: x + 310, y: y2 + 170, width: 290, height: 130), dockLight)
        c.rep(raster(cand.app, px: 64), NSRect(x: x + 330, y: y2 + 200, width: 64, height: 64))
        c.rep(raster(cand.app, px: 32), NSRect(x: x + 420, y: y2 + 216, width: 32, height: 32))
    }
    c.save(out.appendingPathComponent("board.png"))
}

// Template exports at the shipping size (18 pt @1x/@2x) and app icon previews.
for cand in candidates.dropFirst() {
    for scale in [1, 2] as [CGFloat] {
        let img = template(cand.glyph, points: 18, scale: scale, color: .black)
        let rep = img.representations[0] as! NSBitmapImageRep
        try! rep.representation(using: .png, properties: [:])!.write(
            to: out.appendingPathComponent("export/\(cand.id)-glyph-18pt\(scale == 2 ? "@2x" : "").png"))
    }
    try! raster(cand.app, px: 1024).representation(using: .png, properties: [:])!.write(
        to: out.appendingPathComponent("export/\(cand.id)-app-icon-1024.png"))
}

// Optional local-only Dock context with installed system app icons (never committed).
if let flag = CommandLine.arguments.firstIndex(of: "--system-neighbours"), CommandLine.arguments.count > flag + 1 {
    let apps = ["/System/Applications/Notes.app", "/System/Applications/Mail.app", "/System/Applications/Utilities/Terminal.app",
                "/System/Applications/System Settings.app", "/System/Applications/Calendar.app"]
    let c = Canvas(1200, 40 + 3 * 200, paper)
    for (i, cand) in candidates.enumerated() where i > 0 {
        let y = CGFloat(20 + 200 * (i - 1))
        for (j, bg) in [dockLight, dockDark].enumerated() {
            let x0 = CGFloat(20 + 590 * j)
            c.rect(NSRect(x: x0, y: y, width: 570, height: 180), bg)
            var x = x0 + 14
            for (k, p) in apps.enumerated() {
                if k == 2 { c.rep(raster(cand.app, px: 64), NSRect(x: x, y: y + 20, width: 64, height: 64)); x += 76 }
                let ic = NSWorkspace.shared.icon(forFile: p)
                c.image(ic, NSRect(x: x, y: y + 20, width: 64, height: 64)); x += 76
            }
            x = x0 + 14
            for (k, p) in apps.enumerated() {
                if k == 2 { c.rep(raster(cand.app, px: 32), NSRect(x: x, y: y + 120, width: 32, height: 32)); x += 40 }
                c.image(NSWorkspace.shared.icon(forFile: p), NSRect(x: x, y: y + 120, width: 32, height: 32)); x += 40
            }
        }
    }
    c.save(URL(fileURLWithPath: CommandLine.arguments[flag + 1]))
}
print("Wrote artifacts/icons/{menubar-compare,appicon-compare,board}.png and export/")
