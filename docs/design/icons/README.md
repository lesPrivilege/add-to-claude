# Icons

Add to Claude ships two icons that share one metaphor and no SVG: **a line arrives and settles at the end of the composer's text.** It never sends, so nothing in either icon points away. Both were adopted by the owner on 2026-10-16 and first shipped in 0.6.0-rc.3.

| Icon           | Source                                                    | Drawn from                                                                   |
| -------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Menu-bar glyph | `native/icons/brand.svg`                                  | [R1 · Calm Arc](r1-calm-arc/glyph.svg), with the arc moved off the left wall |
| App icon       | `native/brand/app-icon.svg` → `native/brand/AppIcon.icns` | [R3 · Ink on Paper](r3-ink-on-paper/app-icon.svg), with a stronger tile edge |

- **Glyph.** A template image (black and alpha only) on a 24 grid with a 1.6 stroke, drawn at 18 pt by `glyph("brand", size: 18)` in `native/App.swift`. The composer is open along its top-left; one uniform arc drops in through the opening, levels onto the line of text and ends in a round head.
- **App icon.** An ivory paper tile with an ink-navy composer and an ink arc. The peach head (#FFB27A family) is the only colour. No Anthropic marks and no clay-orange plate.

## Changing them

1. Edit `native/icons/brand.svg` for the glyph; no code change is needed.
2. Edit `native/brand/app-icon.svg` for the app icon, then run `bash scripts/make-app-icon.sh`. It regenerates `native/brand/AppIcon.icns` and `artifacts/app-icon.png` (the README's header image).
3. Rebuild (`bash scripts/build-macos.sh`) and look at the real menu bar, light and dark, and the Dock.

## Further reading

- [grammar.md](grammar.md): the rules both icons follow (stroke, canvas, corners, colour, light, small-size tests).
- [refine.md](refine.md): the R1–R3 refinement round, the ranking and the two tweaks made on adoption.
- [ref/](ref/): neutral reference glyphs drawn for this project, used to match the glyph's weight.
- Renders: `artifacts/icons/refine-compare.png` and `artifacts/icons/final-tweak.png`.
- History: the first round (D1–D3), R2, the reference sources and the reference board are in [../../archive/design-icons/](../../archive/design-icons/README.md).
