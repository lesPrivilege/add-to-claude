> Archived 2026-10-16: superseded by [design/icons/README.md](../../design/icons/README.md) (shipped R1 glyph + R3 app icon).

# WO-02 · Dual-track icon candidates

Status: **candidates only.** The production icons (native/icons/brand.svg, native/brand/\*) are unchanged. The owner decides first.

## Brief

The product puts a chat conversation into the composer (text box) of a local agent app the user chooses. **It never sends.** The icons carry only _composer + taking in_. The menu-bar glyph and the app icon are designed separately and share a metaphor, not an SVG.

- **Glyph:** native next to SF Symbols. Monochrome template, no gradients, nothing fragile.
- **App icon:** colour and depth are allowed, but it must be refined and memorable.

Already rejected, and not resubmitted:

- two symmetric rays over a pill (handbag or radio, the current P0)
- waisted or merged throats (flask)
- a trapezoid through the frame (printer)
- a four-point sparkle
- lightning

The shared metaphor of all three pairs is **a line that arrives and settles in the composer, stopping at a caret**. In every app icon the landing point is the one warm accent (#FFB27A).

## Files

| What                                                                              | Path                                                                                                                                            |
| --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Reference sources, with access dates, licence notes and observed images           | [references.md](references.md)                                                                                                                  |
| Reference board: links to third-party images, does not copy them                  | [reference-board.html](reference-board.html) (open locally)                                                                                     |
| One-page distilled grammar                                                        | [grammar.md](../../design/icons/grammar.md)                                                                                                     |
| D1 sources                                                                        | [d1-arc-insert/glyph.svg](d1-arc-insert/glyph.svg) · [d1-arc-insert/app-icon.svg](d1-arc-insert/app-icon.svg)                                   |
| D2 sources                                                                        | [d2-cursor-arrival/glyph.svg](d2-cursor-arrival/glyph.svg) · [d2-cursor-arrival/app-icon.svg](d2-cursor-arrival/app-icon.svg)                   |
| D3 sources                                                                        | [d3-negative-inlet/glyph.svg](d3-negative-inlet/glyph.svg) · [d3-negative-inlet/app-icon.svg](d3-negative-inlet/app-icon.svg)                   |
| Neutral reference glyphs (original, SF-like weight)                               | [ref/](../../design/icons/ref/)                                                                                                                 |
| Menu-bar check: 16/18/20 pt, @1x/@2x, light/dark, plain/tinted, P0 for comparison | [../../../artifacts/icons/menubar-compare.png](../../../artifacts/icons/menubar-compare.png)                                                    |
| App-icon check: 32/64/128/256 px on Dock-like light and dark                      | [../../../artifacts/icons/appicon-compare.png](../../../artifacts/icons/appicon-compare.png)                                                    |
| 3 × 2 board                                                                       | [../../../artifacts/icons/board.png](../../../artifacts/icons/board.png)                                                                        |
| Template exports (18 pt @1x/@2x) and 1024 px app-icon previews                    | [../../../artifacts/icons/export/](../../../artifacts/icons/export/)                                                                            |
| Renderer and trail helper                                                         | [../../../scripts/icons/render.swift](../../../scripts/icons/render.swift) · [../../../scripts/icons/trail.py](../../../scripts/icons/trail.py) |

All geometry is original. No SF Symbols or library glyphs were used for any mark. The trail outlines come from a quadratic centreline with a growing width (`trail.py`); the printed path data is pasted into each SVG, so every SVG stands alone.

### Regenerating the previews

```bash
xcrun swiftc -O scripts/icons/render.swift -o /tmp/icon-render && /tmp/icon-render .
```

`--system-neighbours <out.png>` also writes a Dock strip that places each app icon between installed system app icons (Notes, Mail, Terminal, System Settings, Calendar). That file contains Apple artwork and is **not committed**. It was produced and looked at during this work.

## The three directions

### D1 · Arc Insert (the owner's lead; superseded on 2026-10-16 by R1 + R3, see [refine.md](../../design/icons/refine.md))

**Glyph.** The composer's top-left corner is left open. One trail, thin to thick, sweeps in from the upper left, flattens into the composer's line of text and stops short of a caret.

**App icon.** A night-blue plate with a frosted composer. A cool trail brightens to white and lands next to a warm, glowing caret.

**Strengths**

- The most distinctive motion of the three, and the clearest one-gesture story.
- The app icon is the most memorable: at 32 px it is still "blue tile, white swoosh, orange spark".

**Iterations and misreadings found and fixed**

- **v1 (trail diving vertically into the box through a top gap):** read as a box with a _handle_ or _plug_. It was too close to the handbag. The app icon version read as a **tadpole or sperm** (round head on a thin tail). Dropped.
- **v2 (trail through the corner into a flat tray):** read as a **spoon in a bowl**, a **straw in a box**, or a **sled or bathtub**. Fixed by making the composer taller (window, not tray) and adding the caret, so the trail ends as text.

**Remaining risks**

- **Hard misreading confirmed by the independent review:** at 16 pt the glyph reads as a **handle lifted off a tray**, which is close to the rejected handbag, or as a **sled, bathtub or slipper**. The owner's lead works in the app icon but **not as a menu-bar glyph** at this size. Not recommended for the menu bar.
- The app-icon trail has a **Nike-swoosh or comet** echo. Keep the swoosh restrained; do not make it bolder.

**Checks**

- **16 pt:** fails the first-glance test (see above). At @1x what is left is "a box with a bent stick".
- **32 px:** recognisable.

### D2 · Cursor Arrival

**Glyph.** A closed composer with one settled line. A second line arrives, thin to thick, and stops at a tall caret.

**App icon.** A pearl plate with a dark glass composer. The arriving line goes from cool to white and stops at a warm, glowing caret.

**Strengths**

- The most native glyph. It sits with the reference set in weight and rhythm and has no parts outside the frame.
- Unambiguously "text being put into a field". It is the calmest option for the menu bar.

**Iterations and misreadings found and fixed**

- **v1:** a single bar plus caret in a wide box read as a **battery**, right next to the battery reference.
- **v2:** a full-width first line over the caret formed a **"T" (text tool)**.
- Both were fixed: the box is taller and the first line is shortened.
- **After review (rev. 3):** the arriving line's head was thickened from 2.2 to 2.8 units and the gap before the caret widened to about 3 units, so "arrival" survives at @1x.

**Remaining risks**

- The glyph is generic. It could be a **captions or subtitles** symbol, or "a text field".
- The arrival is carried by the taper alone. Rev. 3 strengthened it, but it is still the subtlest cue at @1x.
- The app icon: I had worried it sits close to **Terminal**. The reviewer found the white tile separates it well, but the icon is anonymous and could pass as a card or small screen.

**Checks**

- **16 pt:** the best of the three.
- **32 px:** readable, but less ownable.

### D3 · Negative-space Inlet (alternative to "Negative-space Insert")

**Glyph.** A solid composer. A settled line, the arriving line and the caret are _cut into_ it: the arriving line opens through the left edge, widens as it travels in and stops before the caret. Nothing is drawn outside the composer, so there is no handle or antenna.

**App icon.** A warm terracotta plate with a single porcelain slab. The channel and caret are cut through the slab and show the plate.

**Why the change from the brief.** The first polarity version, in which a trail outside the slab turns negative inside it, read as a **whistle** (lateral entry) and as a **bitten box or tadpole** (top entry). The app icon of that version read as a **shoe or Nike swoosh**. Keeping the whole gesture inside the slab removed those readings and makes the opening itself the "taking in". This is the reading of the brief's negative-space idea that held at 16 pt.

**Strengths**

- The strongest presence in the menu bar.
- The warmest app icon.
- Very simple, just two layers.

**Remaining risks**

- The glyph is about one step heavier than outline neighbours.
- **Hard misreading found by the review:** rev. 1 was a wide filled capsule that read as a **battery**, right beside the system battery. Rev. 2, now committed, uses window proportions and an extra cut line, so it no longer shares the battery silhouette. My own read of rev. 2 at 16 pt: a filled box with a slot, which could pass for a **printer or toaster**. It has not been re-reviewed independently.
- **Brand colour:** the terracotta plate sits near Anthropic's Claude palette. For a third-party utility that risks brand confusion or implied endorsement. If D3 is kept, move the plate off that orange.
- The app icon can read as a **mouth or smile**, or as a **band-aid**.
- The inlet's opening at the left edge is subtle at 32 px.

**Checks**

- **16 pt:** silhouette solid, but the meaning is the weakest of the three.
- **32 px:** recognisable by colour.

## Recommended order (after independent review)

1. **D1 app icon + D2 glyph (rev. 3).**
   - Same metaphor: a line arrives in the composer and stops at the caret, and the warm caret is the brand accent.
   - Each half is the strongest of its track: D1 is the most memorable and refined app icon at 32 px, D2 the only glyph that sits natively beside SF-style symbols.
   - WO-02 allows this, because the tracks share only the metaphor.
   - The reviewer agrees.
2. **D2 pair.** Safe and coherent, but the least ownable app icon.
3. **D1 pair.** The glyph reads as a handle, sled or bathtub at 16 pt. Use it only if the owner wants the swept trail in the menu bar despite that.
4. **D3 pair.** Not recommended. The glyph reads as a battery (rev. 1) or possibly a printer (rev. 2), and the plate colour raises the brand concern.

On colour: the warm caret accent (#FFB27A) continues the current icon's peach. Keep it a small accent, not a plate colour, so no candidate imitates the Claude brand palette.

## Adopting a chosen pair

1. **Glyph:** copy the chosen `glyph.svg` over `native/icons/brand.svg`. It is loaded as a template at 18 pt by `glyph("brand", size: 18)` in native/App.swift. No code change is needed.
2. **App icon:** copy the chosen `app-icon.svg` over `native/brand/app-icon.svg`, then run `bash scripts/make-app-icon.sh`. That regenerates `native/brand/AppIcon.icns` and `artifacts/app-icon.png`, using NSImage's SVG renderer, which handles everything these files use: `<use>`, linear and radial gradients, even-odd fill.
3. **Optional, Tahoe 26.4+:** for Icon Composer, import the top-level `<g>` groups as layers and drop the baked top light, glow and shadow groups.
4. Rebuild (`bash scripts/build-macos.sh`) and check the real menu bar and Dock. The project README's header image is `artifacts/app-icon.png`, which step 2 regenerates.

## Still needs the owner's eye

- The real menu bar on the owner's Mac, notch or no notch, with their wallpaper and neighbour icons. The strips here are simulated, with project-drawn reference glyphs and not SF Symbols.
- The real Dock, Launchpad, Finder and System Settings. Only a local strip with system icons was checked.
- The independent first-glance test asked for in WO-02: someone who did not design these, at 16 pt, with the text covered.

## Independent review

A fresh reviewer (Claude Opus, separate context) looked only at menubar-compare.png, appicon-compare.png, board.png and the local Dock strip. They recorded first-glance readings before reading this README.

**Readings at real size, before reading the brief**

| Artifact          | Reading                                                              | Severity              |
| ----------------- | -------------------------------------------------------------------- | --------------------- |
| D1 glyph          | Bathtub, sled or slipper; a handle lifted off a tray                 | Moderate hard misread |
| D1 app icon       | A comet or shooting star landing in a frosted tray; Nike-swoosh echo | Mild to moderate      |
| D2 glyph          | A text field, form or captions box                                   | None                  |
| D2 app icon       | A dark card or screen with a glowing cursor                          | None                  |
| D3 glyph (rev. 1) | Battery, USB stick, pill or cassette                                 | Severe                |
| D3 app icon       | Mouth or smile, band-aid, mail slot                                  | Moderate              |

**Other findings**

- **Licence:** no concerns beyond the brand-colour point. The geometry is original, third-party images are only linked, and the Dock strip with Apple artwork is uncommitted.

**Verdict summary (verbatim):**

> Independent first-glance review at real size: D2's glyph is the only menu-bar mark that sits natively beside SF-style symbols and reads as a text field without misreadings, though its "arrival" taper is lost at @1x and should be strengthened. D1's glyph reads as a handle, sled or bathtub at 16 pt; D3's filled capsule reads as a battery beside the system battery. D1's app icon is the most memorable and refined at 32 px; keep its swoosh restrained to avoid a Nike echo. D3's orange should not be pitched as "Claude-adjacent" (brand-confusion risk). Recommendation: D1 app icon with D2 glyph, then the D2 pair, then the D1 pair, then D3.

**Changes made after the review**

- D2 glyph rev. 3: a stronger arrival head and a wider gap before the caret.
- D3 glyph rev. 2: window proportions instead of a capsule, to get away from the battery silhouette.
- The "Claude-adjacent" framing was removed, and the brand-colour caution was added.
- D1 glyph: marked as not recommended for the menu bar. Not redrawn.
- The previews were re-rendered. The revised D2 and D3 glyphs have **not** been re-reviewed.
