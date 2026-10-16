# Icon refinement of D1 Arc Insert (R1–R3)

Status: **candidates only.** native/icons/brand.svg and native/brand/\* are unchanged. Render: [../../../artifacts/icons/refine-compare.png](../../../artifacts/icons/refine-compare.png). It has four columns (D1, R1, R2, R3). The rows are 16/18/22 pt strips in light and dark beside the ref/ glyphs, a 4× pixel zoom of the 16 pt @1x glyph, the app icon at 256/128/64/32 on light and dark Dock grounds, and the glyph drawn large.

The concept is the same in all three: a stream arrives from the upper left and lands at the end of the composer's line. The concept is the same, but the drawing is new. Each app icon is the glyph's 24 grid mapped at 32 px per unit (x' = 512 + 32(x − 12), y' = 522 + 32(y − 12)), so the glyph and the icon are one drawing. None of them uses a taper. The trail has one weight everywhere.

## R1 · Calm Arc — `r1-calm-arc/`

**Glyph.** It has two parts and a dot. The composer (radius 3.8) keeps D1's open top-left corner. One uniform 1.6 arc comes in through the corner, levels onto the line and ends in a round head (r 1.75). The caret is gone; the head is the landing point.

- **Fixes:** D1's thin tail vanished at @1x, and its separate caret competed with the trail. R1's tail is shorter and more diagonal: it rises about 2.6 units above the box, where D1's rises 4.3, so it reads less as a handle or a handset hook.
- **Risk:** at 16 pt it can still read faintly as a tub or a sled, because of the open box with a rising stroke. It is milder than D1.

**App icon.** The plate is deep spruce (#1F5A60 → #0B2328) instead of generic navy, and peach on teal is a complementary pair. The composer outline is pale. The arc fades in from the upper left, so its start fills the upper part of the plate. The peach head is the only warm element, with one soft glow.

## R2 · Line Becomes Text — `r2-line-becomes-text/`

**Glyph.** A closed composer. Inside it, one line sweeps down from the upper-left inner corner, levels off as the text line and stops before a caret.

- **Strength:** nothing sits outside the box, so there is no handle, tail or tub reading. It is the most native glyph beside the reference set.
- **Why a caret and not a head:** a dot at the right end of a closed rounded box reads as a **toggle switch**.
- **Cost:** the arrival "from outside" is only implied. At 16 pt @1x the interior is dense and the curve can read as a checkbox tick.

**App icon.** Two planes: a warm graphite plate and a porcelain slab, with an ink line and a peach caret (#F7924F, the deeper end of the accent family, for contrast on white).

- **Strength:** the highest contrast of the four and unmistakably "a text field with a cursor".
- **Weakness:** the least ownable. It is a generic button or field shape, and the graphite plate is quiet in a dark Dock.

## R3 · Ink on Paper — `r3-ink-on-paper/`

R3 is a palette and material rethink of R1, the strongest drawing. Its glyph is a copy of R1's.

- **Plate:** ivory paper (#FBF6EC → #E8DDCB).
- **Marks:** the composer is an ink-navy outline (#1D2130) and the arc is ink that fades in. The peach head with a soft halo is the only colour.
- **What it fixes:** it drops the dark-plate genre entirely, and the composer finally has strong contrast. It stays calm because there is no glow competition: the trail is not lit, so the head is the one lit point.
- **Distinctiveness:** it stands out in the Dock among dark utility icons. No Anthropic marks or clay-orange plate are used.
- **Risk:** on a light Dock the ivory tile's edge is soft. A 16 % edge line helps, but the real Dock with its system shadow needs the owner's eye.

## Ranking

1. **R3 app icon + R1 glyph (ship this).** It keeps the owner's concept and direction intact. The icon is the calmest and most distinctive of the set, and the glyph is clearly calmer than D1 at 16 pt.
2. **R1 pair.** It has the same drawing, and is the safer choice if the owner wants a dark icon. Teal reads better than navy and holds up at 32 px.
3. **R2 pair.** It has the best menu-bar nativeness and the clearest "text field" icon, but it gives up the outside arrival, which is the concept's identity. Use the R2 glyph only if R1's tub or sled echo is confirmed by a first-glance test.

## Not done

- No independent first-glance review. No real menu bar or Dock check.
- No .icns build.
- The renderer and the app-icon generator were scratch tools and are not in the repo. The SVGs stand alone.

## Adopted (owner, 2026-10-16)

The owner chose **R1 glyph + R3 app icon**, with two tweaks, now in `native/icons/brand.svg` and `native/brand/app-icon.svg` (and `AppIcon.icns`), first shipped in 0.6.0-rc.3:

- **Sled echo.** R1's arc started straight above the composer's left wall, so it read as that wall curling up, like a sled's runner. The arc now starts inside the opening (5.2, 2.4 on the 24 grid) and drops in clear of the wall, and the top edge starts at 9.4 to keep the opening wide. It reads as arriving.
- **Tile edge.** The ivory plate's edge line went from 16 % at 3 px to 30 % at 5 px, so the tile holds on a light Dock.

Comparison: `artifacts/icons/final-tweak.png` (as drawn vs tweaked). The menu-bar mark still needs the owner's eye in the real menu bar.
