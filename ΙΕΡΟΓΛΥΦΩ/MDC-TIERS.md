# Manuel de Codage (MdC) support — tiered roadmap

This file is the **source of truth** for how far the editor's MdC layout support
has progressed and what remains. It exists so the plan survives across sessions
(a `/clear` once lost it). Update the **Status** column and the changelog as
tiers land.

The implementation lives in `glyph-input.js`: `handleMdCInput` parses the string
into an expression tree and lays glyphs out on the Fabric canvas. `parseMdCInput`
(flat, unchanged) is a separate, simpler helper kept for the text-run and
three-line dialogs — **do not** repurpose it for spatial layout.

---

## Why these tiers (and not Gemini's section order)

The roadmap was derived by re-tiering a Gemini summary of MdC **by real
implementation difficulty and dependency**, not by the summary's grouping.
Issues found in that summary, worth remembering:

- **`&` (ligature) and overlay are NOT peers of `* : -`.** `* : -` are pure
  bounding-box packing (easy); `&`/overlay need actual glyph *fusion/overlap*
  (hard). Hence they are deliberately the **last** tier, not part of Tier 1.
- **`##` as "overlay" is dubious.** The `#` family is **shading** (`#b`/`#e`);
  the summary conflated shading with overlay. Real overlay/insertion in JSesh is
  the `^`/insertion operators, not `##`. Treat `#` as shading (Tier 4).
- **`-!` / `-!!`** — canonical MdC line/page break is `!` / `!!`; the `-` prefix
  was a summary embellishment. Treat `!` / `!!` as canonical (Tier 2).

---

## Tiers

| Tier | Scope | Operators / codes | Difficulty | Status |
|------|-------|-------------------|------------|--------|
| **1** | Core spatial layout | `*` (side-by-side), `:` (stacked), `-` (cadrat separator), `( )` (grouping) | Easy-to-moderate | ✅ done |
| **2** | Text structure | word end (space / `_`), sentence end (double space / `__`), line break `!`, page/section break `!!` | Easy-to-moderate | ⬜ next |
| **3** | Enclosures | cartouche `< >`, serekh `<S >S`, hwt `<H >H`, frame `<F >F`; begin/middle/end parts (2nd letter b/m/f) | Moderate-to-hard | ⬜ |
| **4** | Flags / toggles | colour `$r` / `$b`, shading `#b` / `#e`, `-#-`, lacuna `?` / `??` | Moderate | ⬜ |
| **5** | Editorial brackets | `[[ ]]` erased, `[{ }]` superfluous, `[" "]` vanished, `[' ']` scribal, `[& &]` editorial | Moderate | ⬜ |
| **6** | Ligatures & overlay | `&` ligature, true sign fusion / overlap | Hard | ⬜ |

---

## Tier details

### Tier 1 — core spatial layout  ✅
Operators with precedence (tightest → loosest): `( )` > `*` > `:` > `-`.
- `*` packs children left-to-right, centred vertically.
- `:` stacks children top-to-bottom, centred horizontally.
- `-` separates cadrats laid out along the row (bottom-aligned, wraps at the
  right edge, placed below existing content).
- Glyphs keep natural metrics (no stretching); each cadrat is uniformly
  downscaled to fit `MDC_MAX_CADRAT` so deep stacks stay sane.
- Any parse error (unbalanced parens, stray operator, nothing recognised) falls
  back to `handleMdCInputFlat` — the original flat row — so a paste never fails.
- Dialog auto-routes input containing `:` `*` `(` `)` to the layout engine even
  when "Single text run" is selected (a linear run can't represent 2D).

### Tier 2 — text structure  ⬜ (next)
Layer onto `layoutMdCRow`:
- **space / `_`** → word boundary: a wider gap between cadrats than the normal
  intra-row gap. (Tier 1 currently treats a space as a plain `-` separator; this
  tier upgrades it to a *word gap*.)
- **double space / `__`** → sentence boundary: a wider gap still.
- **`!`** → line break: force a new row regardless of right-edge wrap.
- **`!!`** → page/section break: a larger vertical jump (the canvas is infinite,
  so render as an extra-large vertical gap rather than a true new page).

### Tier 3 — enclosures  ⬜
Wrap a laid-out group in a drawn frame (Fabric path/rect/ellipse):
cartouche oval `< >`, serekh `<S >S`, hwt box `<H >H`, frame `<F >F`. The
optional begin/middle/end part letter controls which segment of the frame is
drawn (for splitting an enclosure across lines).

### Tier 4 — flags / toggles  ⬜
A small state machine over the token stream: ink colour (`$r`/`$b`), shading for
damaged signs (`#b`/`#e`, `-#-`), lacuna markers (`?`/`??`). State persists until
toggled again.

### Tier 5 — editorial brackets  ⬜
Render bracket pairs around spans with the appropriate glyphs/styling: erased
`[[ ]]`, superfluous `[{ }]`, vanished `[" "]`, scribal `[' ']`, editorial
`[& &]`.

### Tier 6 — ligatures & overlay  ⬜
Hardest: true glyph fusion/overlap (`&`). Requires merging signs into a single
construction rather than packing bounding boxes. Tackle last.

---

## Changelog

- **2026-05-29** — Tier 1 shipped (commit `947b8f2`): core spatial operators
  `* : - ( )` with precedence, cadrat capping, flat-row fallback, and dialog
  auto-routing of spatial input.
