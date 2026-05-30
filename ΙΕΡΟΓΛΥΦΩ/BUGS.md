# Known bugs / deferred fixes

Open issues in the editor, captured so they survive across sessions. Newest
first. Resolve, then move the entry to the "Fixed" section (or delete) with the
commit ref.

---

## Open

_(none)_

---

## TODO

### TODO-1 — update & reorganize the help modal for recent upgrades
**Area:** `help-content.html` (loaded into the in-app help overlay).
**Filed:** 2026-05-29.

**Content that is now missing or stale:**
- ~~**MdC Tier 4 — flags/toggles:** colour rubric `$r` / `$g` / `$b`, damaged-sign
  shading `#b … #e` and the destroyed quadrat `-#-`, lacunae `?` / `??`.~~ ✅ added
  to the MdC section 2026-05-30.
- ~~**MdC Tier 5 — editorial brackets:** `[[ ]]` erased, `[{ }]` superfluous,
  `[" "]` vanished, `[' ']` scribal, `[& &]` editorial (with their meanings).~~
  ✅ added 2026-05-30.
- **Toolbar §3 is stale:** the bracket tool now drops an inward-facing `[ ]`
  **pair** (drag each), not a single "Square brackets"; and the `𓂀…`
  hieroglyph-input button (orange-highlighted) is missing from the list.
- (When **Tier 6** ligatures `&` land, document those too.)

**The real problem — organization:** the page is a flat 1–10 numbered list and is
getting crowded; the MdC operator/markup reference especially needs to be
scannable. Figure out a structure before piling more in. Options to weigh:
- Group the ten sections into a few buckets (Getting started · MdC reference ·
  Toolbar · Editing & shortcuts · Save/export) with a clickable table of
  contents or collapsible `<details>` sections.
- Pull all the MdC operators/markup into a single **cheat-sheet table**
  (symbol · meaning · example), tiered, instead of scattered bullet lists.
- Consider tabs or an accordion so the modal isn't one long scroll.

**Note:** MDC-TIERS.md is the authoritative spec for the operator semantics —
copy meanings from there so help and engine stay in sync.

---

## Fixed

### BUG-1 — editorial bracket marks: head-poke / sizing
**Fixed:** 2026-05-30. **Area:** `glyph-input.js` — `measureMdCNode` for the
`brackets` node, `MDC_BRK_VPAD_TOP`/`BOT`.

Filed as "marks scale to the sign, not the line." First attempt clamped the box
to a nominal line height (`MDC_BRK_LINE_H = MDC_BASE`) so a row was uniform — but
on review the user **prefers the proportional, per-sign look** (each bracket
hugging its own sign), so the clamp was reverted. The genuine defect was the
remaining alignment niggle: marks rose only 5px (`MDC_BRK_VPAD_TOP`) above the
sign's apex, so a tall sign's top (e.g. the A1 figure's head) grazed/crossed the
top mark. Bumped `MDC_BRK_VPAD_TOP` 5→10 and `MDC_BRK_VPAD_BOT` 2→3. Brackets are
back to ascent-proportional sizing with comfortable headroom; the earlier
descent-dip fix (size by visible ascent, ignore the font's empty descent) is
retained.
