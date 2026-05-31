# Known bugs / deferred fixes

Open issues in the editor, captured so they survive across sessions. Newest
first. Resolve, then move the entry to the "Fixed" section (or delete) with the
commit ref.

---

## Open

_(none)_

---

## TODO

_(none)_

---

## Fixed

### TODO-1 — reorganize the help modal
**Fixed:** 2026-05-31. **Area:** `help-content.html`.

The flat 1–10 scroll was restructured into five collapsible `<details>` buckets
(Getting started · MdC spatial layout · Toolbar · Editing & shortcuts · Saving &
exporting) under a clickable table of contents — pure HTML/CSS, no JS. The
scattered MdC operator/markup bullet lists are now tiered **cheat-sheet tables**
(symbol · meaning · example), one per group, with meanings copied from
`MDC-TIERS.md` so help and engine stay in sync.

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
