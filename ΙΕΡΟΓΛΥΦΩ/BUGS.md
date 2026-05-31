# Known bugs / deferred fixes

Open issues in the editor, captured so they survive across sessions. Newest
first. Resolve, then move the entry to the "Fixed" section (or delete) with the
commit ref.

---

## Open

_(none)_

---

## TODO

### TODO-3 — redo (complete the undo pair)
**Area:** `canvas-interactions.js` (`undoLastAction`, `undoHistory`), keybinding
in `editor-init.js` (~L686, the Ctrl+Z handler). **Priority:** medium.

Undo exists (action-based stack, Ctrl+Z) but there is **no redo**. Add a redo
stack: push undone actions onto it, replay on Ctrl+Y / Ctrl+Shift+Z, and clear it
on any new action.

### TODO-4 — dictionary results: click-to-insert
**Area:** `dictionary-search.js` (`renderResults`/`resultDisplay`), glyph-insert
path in `glyph-input.js`. **Priority:** medium.

Dictionary results are read-only — users search, then must re-type the signs in
the keyboard. Make a result (or its Gardiner codes) **clickable to drop those
signs straight onto the canvas**, reusing the existing glyph-insert pipeline.

### TODO-5 — touch gestures ("Track 2", BIG BET / later)
**Area:** `canvas-interactions.js` viewport transform; tablet drawer (already
shipped, see [[responsive-track1]] in memory). **Priority:** later.

Continuation of the responsive work: pinch-to-zoom, two-finger pan onto the
existing `viewportTransform`, and larger touch targets for selection handles.
Needs real-device iteration; not started.

### TODO-6 — MdC round-trip (BIG BET / later)
**Area:** MdC engine (Tiers 1–5 parse MdC → layout; see `MDC-TIERS.md`).
**Priority:** later.

Add the inverse of the existing parser: **paste an MdC string → auto-build the
layout**, and **export a selection back to MdC code**. High value for scholars
who work in MdC notation.

---

## Fixed

### TODO-2 — workspace autosave + save reminder
**Fixed:** 2026-05-31. **Area:** `workspace.js` (autosave layer + extracted
`serializeWorkspace`/`applyWorkspace`), `editor-init.js` (bg-image downscale on
upload). The `beforeunload` reminder already shipped.

Crash-recovery autosave: a debounced (~1s) snapshot of the workspace to
`localStorage` (`ieroglypho:autosave`), streamed off Fabric's
`object:added/modified/removed`. On load a recoverable snapshot is offered via a
non-destructive **"Recovered unsaved work…"** banner (Restore / Dismiss) — never
silently overwrites a fresh start; Dismiss drops the snapshot so it doesn't
re-nag. Quota-safe: on `QuotaExceededError` it retries with all image payloads
stripped so the irreplaceable glyph work always fits. To avoid duplicated logic,
the JSON download (`saveWorkspace`) and file-open (`loadWorkspace`) were
refactored to share `serializeWorkspace()` / `applyWorkspace()` with the
autosave. Background images are also **capped on upload** (downscale to 2000px
longest side, re-encode JPEG q0.82) — keeps a big photo out of the ~5MB budget
and turns the source into a persistent data-URL (so the bg now survives reload
instead of dying with its blob: URL).

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
