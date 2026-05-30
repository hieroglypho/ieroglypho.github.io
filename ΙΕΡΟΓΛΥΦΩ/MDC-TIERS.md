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
| **3** | Enclosures | serekh `<S >S`, hwt `<H >H`, frame `<F >F` (begin/middle/end parts deferred). **Cartouche `< >` excluded** — covered by the existing `addCartouche` drawing tool; bare `< >` falls back unhandled. | Moderate-to-hard | ✅ done |
| **4** | Flags / toggles | colour `$r` / `$b`, shading `#b` / `#e`, `-#-`, lacuna `?` / `??` | Moderate | ✅ done |
| **5** | Editorial brackets | `[[ ]]` erased, `[{ }]` superfluous, `[" "]` vanished, `[' ']` scribal, `[& &]` editorial | Moderate | ✅ done |
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

### Tier 3 — enclosures  ✅
Wrap a laid-out group in a drawn Fabric frame: frame `<F >F` (plain rect), hwt
`<H >H` (box + small doorway notch), serekh `<S >S` (rect + simplified paneled
facade strip: a divider line + niche uprights). The tokenizer emits
`encOpen`/`encClose` ops (variant letter S/H/F); `parseAtom` collects the
enclosed cadrat sequence into an `{type:'enclosure',variant,children}` node that
behaves as one cadrat in the row. The frame is added to the canvas *before* its
glyphs so they render on top; the frame is a separate selectable object (not
grouped with the glyphs — consistent with how glyphs stay independent). Inner
cadrats are bottom-aligned inside the content box. Builders:
`buildEnclosureFrame` + `addEnclosureFrame` in `glyph-input.js`.

**Cartouche `< >` is intentionally out of scope** — the user creates cartouches
manually via the toolbar's `addCartouche` tool (`drawing-tools.js`), so the MdC
parser does not handle bare `< >` (it falls back unhandled).

Begin/middle/end part letters (for splitting an enclosure across lines) are
**deferred** — rare, and ~40–60 lines of fiddly path math. Whole enclosures
first.

### Tier 4 — flags / toggles  ✅
A small state machine over the token stream: ink colour (`$r`/`$b`), shading for
damaged signs (`#b`/`#e`, `-#-`), lacuna markers (`?`/`??`). State persists until
toggled again.

Implementation — **colour and shade are stream state held in the tokenizer**, not
parse-tree structure: `tokenizeMdC` keeps `curColor` / `curShade` and stamps each
glyph token with its current `color`/`shade` as it is emitted, so a `$r` /`#b`
toggle affects every following glyph (across cadrats) until reset. `parseAtom`
copies those onto glyph nodes; `placeMdCNode` sets the glyph's `fill` for colour
and lays a translucent grey wash (`MDC_SHADE_FILL`) over the ink box for shade.
Colours: `$r` red (`#c0392b`), `$g` green, `$b`/`$k`/unknown → black.

Two new **leaf nodes** (siblings of `glyph`, so they pack as cadrats and can be
`*`/`:` operands): `lacuna` (`?` small / `??` large) → a dashed tinted gap box,
and `shadebox` (lone `#`, e.g. the canonical `-#-`) → a fully-shaded destroyed
quadrat. Both render via `buildLacunaBox` / `buildShadeBox` and register through
`addMdCAuxObject` (the shared id+undo adder that `addEnclosureFrame` now also
delegates to). The dialog auto-route trigger gained `$ # ?` so flag-only input
still reaches the layout engine.

### Tier 5 — editorial brackets  ✅
Wrap a laid-out span in a bracket pair drawn as **distinct line marks** on each
side (Leiden conventions). Parallels Tier 3 enclosures but lighter — just the two
side marks, no full frame. Encoding (open / close): erased `[[` `]]`, superfluous
`[{` `}]`, vanished `["` `"]`, scribal `['` `']`, editorial `[&` `&]`. The
tokenizer reads the second char of `[…` to pick the variant and matches the
close codes by their first char (`]}"'&` followed by `]`); a **bare `[`** with no
variant char falls back to a cadrat break (the toolbar `[ ]` drawing tool is the
separate, manual annotation — unrelated to this typed markup). `parseAtom`
collects the span into `{type:'brackets',variant,children}` (tolerating a
mismatched close variant so a typo can't drop the whole paste to the flat
fallback). `buildBracketMark(variant, side, …)` returns one stroked `fabric.Path`
per side, in absolute coords, drawn so the same formulae mirror left/right:
erased = double square ⟦⟧, superfluous = curly brace {} , vanished = dashed
square (`strokeDashArray`), scribal = corner ticks ⌜⌝, editorial = angle ⟨⟩. Marks
are separate selectable objects added via `addMdCAuxObject`. The dialog
auto-route trigger gained `[ ] { } & " '`.

Part-letters / splitting a bracket across a line break are **not** handled (same
deferral as Tier 3 enclosures).

### Tier 6 — ligatures & overlay  ⬜
Hardest: true glyph fusion/overlap (`&`). Requires merging signs into a single
construction rather than packing bounding boxes. Tackle last. **Note:** a bare
`&` (ligature) is still free — Tier 5 only consumes `&` when it is part of an
editorial bracket code (`[&` / `&]`), so the Tier 6 operator is unaffected.

### Tier 6 — ligatures & overlay  ⬜
Hardest: true glyph fusion/overlap (`&`). Requires merging signs into a single
construction rather than packing bounding boxes. Tackle last.

---

## Changelog

- **2026-05-29** — Tier 5 shipped: editorial brackets. Five bracket-pair codes
  (`[[ ]]` erased, `[{ }]` superfluous, `[" "]` vanished, `[' ']` scribal,
  `[& &]` editorial) parse into a `brackets` node and render as distinct
  line-drawn marks per side (double square / curly brace / dashed / corner ticks
  / angle) via `buildBracketMark`. Bare `[` → cadrat break; mismatched close
  tolerated; auto-route extended with `[ ] { } & " '`. Bare `&` left free for
  Tier 6. Tokenize/parse verified in Node across all five variants plus stacks,
  enclosure nesting, mismatch, and the bare-`[` fallback.
- **2026-05-29** — Fix (Tier 5): editorial brackets sat low, worst on signs like
  N35 whose font metrics carry a large empty descent below the visible glyph.
  The marks were sized from the full ink box (incl. that descent), so they ran
  well below the sign. Now brackets are sized and placed by the signs' **ascent**
  (visible height above the baseline) via `mdcNodeAscent`: each sign is
  baseline-aligned and the marks rise `MDC_BRK_VPAD_TOP` (5) above the tallest
  ascent and drop only `MDC_BRK_VPAD_BOT` (2) below the baseline — tight to the
  visible signs regardless of descent. Also: the individual/spatial dialog route
  now awaits the hieroglyph font before layout, so ink measurement no longer
  risks a fallback-font (wrong-metrics) read.
- **2026-05-29** — Tier 1 shipped (commit `947b8f2`): core spatial operators
  `* : - ( )` with precedence, cadrat capping, flat-row fallback, and dialog
  auto-routing of spatial input.
- **2026-05-29** — Tier 2 shipped: text structure — word/sentence gaps (space /
  `_`, double for sentence), line break `!`, page break `!!`. Row is now an item
  list with per-cadrat gap strength + break items; tokenizer indexes by code
  point for `!!` / `__` / space-run look-ahead; dialog auto-route adds `!`.
- **2026-05-29** — Tier 3 shipped: enclosures `<F >F` (rect), `<H >H` (box +
  doorway notch), `<S >S` (serekh, simplified paneled facade). Cartouche `< >`
  excluded by design (manual tool); part-letters deferred. Enclosure parses as
  one cadrat; frame drawn behind glyphs as a separate selectable object.
- **2026-05-29** — Fix: enclosed figure crowded the top frame (head touching).
  Inner padding is now **asymmetric** — `MDC_ENC_PAD_TOP` (30) above the content,
  `MDC_ENC_PAD` (14) on the sides and below — so the figure clears the top frame
  and stands on the base/panel, as a serekh reads. Symmetric padding couldn't fix
  it (it scaled top and bottom gaps together). Verified with `<S-G5>S-F-R8`.
- **2026-05-29** — Fix: serekh/hwt frames floated ~half their height above the
  baseline (misaligned with neighbouring signs). They were built as a top-origin
  `fabric.Group`, which fabric positions from the centre. Rebuilt with the
  centre-origin pattern (as `addCartouche` does); frame bottom now sits on the
  shared baseline. **Verified in browser** with `<S-G5>S-F-R8`: serekh base sits
  level with the viper (F) and flag (R8).
- **2026-05-29** — Fix: a second paste overlapped an existing enclosure. The
  "place below existing content" math assumed centre origin (`top+h/2`), but
  frames use top origin, so their bottom was underestimated. Now computes each
  object's true bottom by origin and reserves the tallest block's height.
- **2026-05-29** — Tier 4 shipped: flags / toggles. Colour (`$r`/`$g`/`$b`) and
  damaged-sign shading (`#b`…`#e`) are stream state in the tokenizer, stamped
  onto each glyph token (persist until re-toggled); colour sets the glyph `fill`,
  shade lays a translucent grey wash over the ink box. New leaf nodes `lacuna`
  (`?`/`??`, dashed gap box) and `shadebox` (lone `#` / `-#-`, destroyed quadrat)
  pack as cadrats. Shared `addMdCAuxObject` adder (enclosure/shade/lacuna);
  dialog auto-route extended with `$ # ?`. Tokenize/parse verified in Node
  across colour toggles, shade runs, `-#-`, lacunae, and composition with
  stacks/enclosures/juxtaposition.
- **2026-05-29** — Ink-box measurement (refinement to Tiers 1–2): glyphs are now
  measured by their real ink box via Canvas `measureText()` (actualBoundingBox*)
  instead of fabric's uniform line-box height, and placed by that box. Fixes
  gappy vertical stacks (short signs like sun/water now pack tight) and aligns
  all non-stacked cadrats on a true ink baseline. NOT yet full proportional
  cadrat fitting (scaling sub-glyphs to fill a square quadrat) — still pending.
