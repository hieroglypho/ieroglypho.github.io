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
| **2** | Text structure | word end (space / `_`), sentence end (double space / `__`), line break `!`, page/section break `!!` | Easy-to-moderate | ✅ done |
| **3** | Enclosures | cartouche `< >`, serekh `<S >S`, hwt `<H >H`, frame `<F >F`; begin/middle/end parts (2nd letter b/m/f) | Moderate-to-hard | ⬜ next |
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

### Tier 2 — text structure  ✅
Layered onto `layoutMdCRow`; the row is now a list of items
(`{kind:'cadrat',node,gap}` / `{kind:'break',level}`) instead of bare cadrats.
- **space / `_`** → word boundary: gap `MDC_WORD_GAP` (28) between cadrats,
  wider than the `-` separator `MDC_CADRAT_GAP` (10).
- **double space / `__`** → sentence boundary: gap `MDC_SENTENCE_GAP` (50).
- **`!`** → line break: forces a new row regardless of right-edge wrap.
- **`!!`** → page/section break: new row plus an extra `MDC_PAGE_VGAP` (70) of
  vertical space (the canvas is infinite, so this is a large gap, not a real
  page). The tokenizer now indexes by code point so it can look ahead for
  `!!` / `__` / space runs without splitting glyph surrogate pairs.
- The dialog auto-route trigger now also fires on `!` (a linear text run can't
  line-break), in addition to `:` `*` `(` `)`.

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
- **2026-05-29** — Tier 2 shipped: text structure — word/sentence gaps (space /
  `_`, double for sentence), line break `!`, page break `!!`. Row is now an item
  list with per-cadrat gap strength + break items; tokenizer indexes by code
  point for `!!` / `__` / space-run look-ahead; dialog auto-route adds `!`.
