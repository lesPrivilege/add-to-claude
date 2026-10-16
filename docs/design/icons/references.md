# Icon references

Access date for all entries: 2026-10-16. Method: WebFetch (page converted and summarised by a small model; Apple pages via the developer.apple.com/tutorials/data JSON endpoints, except N03b which returned only a title). The research pass could not see image pixels. The images were then viewed (hot-linked, not downloaded) in a browser on the same date, and those observations are in the section "Observed images" at the end. Numeric facts not stated by a page are marked "not stated".

## Apple

### N01 SF Symbols (HIG)
- URL: https://developer.apple.com/design/human-interface-guidelines/sf-symbols (read via .../tutorials/data/design/human-interface-guidelines/sf-symbols.json)
- Owner: Apple. Status: consumed.
- Facts: nine weights (ultralight to black) matched to San Francisco font weights, so a symbol aligns with adjacent text. Three scales (small, medium default, large) defined relative to SF cap height; scale changes emphasis without breaking weight matching at the same point size. Custom symbols: start from an exported template, match detail, optical weight, alignment; keep simple; avoid baking in enclosures/badges.
- Licence: symbols (and confusingly similar images) may not be used in app icons, logos or other trademarked uses. Apple product/feature symbols are copyrighted and cannot be customised.
- Not stated by the fetched page: menu-bar glyph point size, padding.
- Learn: pick weight/scale to match menu-bar text; draw a custom template glyph in the same optical weight. Do not transfer: any SF Symbol shape into the app icon or logo.

### N02 App Icons (HIG)
- URL: https://developer.apple.com/design/human-interface-guidelines/app-icons (JSON endpoint). Owner: Apple. Status: consumed.
- Facts: macOS layout 1024 x 1024 px square; system applies the rounded-rectangle mask (no numeric radius given). No numeric safe area given (the 824 px content figure was NOT on the page; take it from Apple's production template instead). Background layer plus foreground layers, square unmasked, vector (SVG/PDF, text outlined) preferred. Liquid Glass supplies specular highlights, refraction, translucency; do not add own highlights, inter-layer drop shadows, bevels, blurs, glows. Appearances: default, dark, clear, tinted; keep core features identical across them; dark = based on light, avoid overly bright imagery. Simplicity: few shapes, solid/gradient background, filled overlapping shapes for depth, avoid outline-only, text, UI components, screenshots, photos, hairlines and sharp corners. Colour spaces sRGB, Gray Gamma 2.2, Display P3.
- Learn: layered, flat, filled, centred glyph. Not transfer: baked-in shadows/gloss.

### N03 Icon Composer
- URLs: https://developer.apple.com/icon-composer/ (consumed); https://developer.apple.com/documentation/xcode/creating-your-app-icon-using-icon-composer (failed: only the page title came back, no body).
- Owner: Apple. Status: partially consumed.
- Facts (product page): layered Liquid Glass icons for iPhone, iPad, Mac, Watch; per-layer specular highlight, refraction, translucency, shadow; one file holds Default, Dark, Mono annotations; specular highlight inside/outside/automatic with a vertical light angle; exports to Xcode as a new icon file type plus flattened marketing export; requires macOS Tahoe 26.4 or later.
- Learn: design as separated opaque layers, let the system light it. Not transfer: pre-rendered lighting.

### N04 NSStatusItem / NSImage.isTemplate
- URLs: https://developer.apple.com/documentation/appkit/nsstatusitem ; https://developer.apple.com/documentation/appkit/nsimage/istemplate (both via tutorials/data JSON). Owner: Apple. Status: consumed.
- Facts: isTemplate: template images should consist only of black and clear colours; alpha adjusts opacity of black; not intended as standalone images, always mixed and processed by the control. NSStatusItem: `button` is the displayed control (image property deprecated); `squareLength` equals the status bar thickness; `variableLength` fits content. The thickness VALUE (22 pt) and menu-bar tinting behaviour are NOT on these pages. Treat 22 pt as unverified from this source; read NSStatusBar.system.thickness at runtime.
- Learn: black+alpha only, isTemplate = true, set on statusItem.button. Not transfer: colour in the menu-bar glyph.

## Competitor / observation samples

### C01 Mac Menubar Apps directory
- URL: https://macmenubar.app/ . Owner: not named on page. Status: consumed (listing only).
- Curated menu-bar apps with cover images; icons hosted at images.macmenubar.app (e.g. https://images.macmenubar.app/dial/icon-1790990548449.png). Page descriptions of looks: none.
- Learn: how peers present. Licence: images belong to each app's developer; link-only.

### C02 CleanShot X
- URLs: https://macmenubar.app/app/cleanshot-x ; https://cleanshot.com/ . Owner: not named on either page (cleanshot.com is the product site). Status: partially consumed.
- Image: https://images.macmenubar.app/cleanshot-x/icon-1776568555899.png (app icon). Appearance: see Observed images.
- Learn: a capture utility living in the menu bar with a distinct app icon. Not transfer: logo, wordmark. Licence: proprietary.

### C03 Raycast
- URLs: https://www.raycast.com/press ; https://www.raycast.com/blog/a-fresh-look-and-feel . Owner: Raycast. Status: consumed.
- Press: brand red #FF6363, dark backgrounds #151515 / #202123; app icon PNG supplied with "do not alter its colors"; Figma community template linked for similar-style icons. Blog: icon set by designer James McDonald, simple outline style with bolder strokes, consistent stroke width and corner radii; app icon redesigned as a keycap (inspired by Apple's Magic Keyboard), replacing a round flat icon. Menu-bar icon not mentioned.
- Image: https://fz1sd71lwhbqy6sh.public.blob.vercel-storage.com/press/images/logo/raycast-appicon.png (macOS). Blog images under /uploads/redesign/ (new-appicon.png, appicons.png); full URLs not confirmed, not recorded.
- Learn: one concrete object metaphor, consistent stroke/radius. Not transfer: keycap, red, any Raycast mark. Licence: press kit, press use, unaltered.

### C04 PopClip
- URLs: https://www.popclip.app/ ; https://macmenubar.app/app/popclip . Owner: Nicholas Moore / Pilotmoon Software (copyright notice on popclip.app). Status: partially consumed.
- Images: https://www.popclip.app/icon128.png (page gives relative /icon128.png; resolved by me) ; https://images.macmenubar.app/popclip/icon-1776251629901.png. Appearance: see Observed images.
- Learn: selection-popup utility; icon should read at 128 px. Not transfer: its mark. Licence: proprietary.

### C05 Bartender
- URL: https://www.macbartender.com/ . Owner: page copyright "Applause Group, Inc." Status: partially consumed.
- Images (relative on page, host resolved by me, unverified): https://www.macbartender.com/Bartender6/img/bartender6icon.png ; https://www.macbartender.com/GoldenGate/carousel/GoldenGate/menu-bar-glyphs/bartender-app.png (despite the path, this file is Bartender's app icon, not a menu-bar glyph). Appearance: see Observed images.
- Learn: how a glyph sits among other menu-bar glyphs. Not transfer: the mark. Licence: proprietary.

### C06 macOSicons
- URL: https://macosicons.com/ . Owner: credited to Elias ("30,000+ free macOS icons", editor, templates, API). Status: consumed (home page listing only).
- Image base: https://s3-new.macosicons.com/macosicons/parse/ ; page base https://macosicons.com
- Entries (title, uploader, page path, image file):
  1. WhatCable (Liquid Glass), jumpmanfr, /icon/whatcable-5F8Nm6Gcyg, low_res_WhatCable__Liquid_Glass__5F8Nm6Gcyg-b1c323f0bc.png
  2. Helium, oSBVXXSFe4nmS4vRXktP9GGzM, /icon/helium-wwT53Wqt8K, low_res_Helium_wwT53Wqt8K-321c921414.png
  3. Ghostty (Darken), xeQQvXOBhz5kXict5LvLYuYlb, /icon/ghostty-darken-sWD3559Els, low_res_Ghostty__Darken__sWD3559Els-875944dc95.png
  4. Strongbox, ffferitkartalll, /icon/strongbox-S9mI1Iu4aD, low_res_Strongbox_S9mI1Iu4aD-cb506377e7.png
  5. Telegram, oSBVXXSFe4nmS4vRXktP9GGzM, /icon/telegram-i477cWWCxQ, low_res_Telegram_i477cWWCxQ-e5b4999eb4.png
  6. Bob, yiwankaashili, /icon/bob-zLnQVtU9DH, low_res_Bob_zLnQVtU9DH-20b553d6f9.png
  Others seen (not used): ChatGPT, Gemini, Gmail, Spotify, Reddit, App Store, Teams.
- Appearance: see Observed images. Entries are community re-skins of third-party brands.
- Learn: current community conventions for Tahoe-era plates. Not transfer: any brand mark (especially chat/AI brands). Licence: per-uploader; site terms not read; link-only.

## Icon libraries (licence only)
- L01 Lucide https://lucide.dev/license : ISC (Lucide Icons and Contributors); a listed subset derived from Feather is MIT (Cole Bemis); keep notices. Consumed.
- L02 Iconoir https://iconoir.com/ : MIT; default stroke 1.5, default size 24; grid not stated. Consumed.
- L03 Phosphor https://github.com/phosphor-icons/core : MIT (Phosphor Icons); SVGs grouped by weight under /assets/<weight>/; grid size not stated. Partially consumed.
- Permissive licences allow use as a starting point for a glyph; verify per-icon notices before shipping.

## Observed images (viewed 2026-10-16 in a browser via the hot-links in reference-board.html; nothing downloaded)

| Image | What is on it | Grammar taken | Not taken |
|---|---|---|---|
| Bartender 6 app icon | A black plate with a white shirt front, black lapels and bow tie; one object fills about 70% of the plate. | One literal, centred object. High value contrast survives 32 px. | The tuxedo, black-tie motif |
| CleanShot X app icon | A dark tile with small colour dots overlaps a bright blue tile that sits top-right, with a white diagonal light. | Depth from two overlapping planes, not from texture. One saturated colour. | Tile pair and colour dots |
| PopClip app icon | A plate split vertically: near-black left, saturated blue right. No glyph. | Radical simplicity. Brand recognition from a two-tone plate alone. | The split plate |
| Raycast app icon | A dark keycap plate with a glowing red rim, a red angular mark top-right and the wordmark on the key. | An everyday object (key) as the plate itself. One accent colour. | Keycap, red, wordmark (press kit says do not alter) |
| WhatCable (macOSicons, jumpmanfr) | A black plate with one blue cable plug, centred and vertical. | One object, one accent, generous empty plate. | Cable motif |
| Helium (macOSicons) | A cream plate with a black geodesic, web-like mark. | A flat dark mark on a warm-light plate reads well in the Dock. | The mark |
| Ghostty Darken (macOSicons) | A black plate with a white ghost whose eyes read as a prompt. | Mono silhouette with one witty inner detail. | Ghost, prompt eyes |
| Strongbox (macOSicons) | A black plate with a blue-gradient padlock. | A single gradient gives the volume; nothing else is lit. | Padlock |
| Telegram (macOSicons) | A cream plate with a black paper plane edged in blue. | Light plate with a dark mark. | Paper plane means **send**, which this product must avoid. |

Menu-bar crops: no source offered a menu-bar screenshot at a fixed scale that could be hot-linked, so the menu-bar comparison uses neutral reference glyphs drawn for this project (docs/design/icons/ref/) at the same 1.6/24 stroke. A crop of the owner's real menu bar is still needed (see README).
