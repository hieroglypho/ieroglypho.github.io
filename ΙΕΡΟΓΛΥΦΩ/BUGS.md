# Known bugs / deferred fixes

Open issues in the editor, captured so they survive across sessions. Newest
first. Resolve, then move the entry to the "Fixed" section (or delete) with the
commit ref.

---

## Open

_(none)_

---

## TODO

### TODO-6 — MdC round-trip (BIG BET / later)
**Area:** MdC engine (Tiers 1–5 parse MdC → layout; see `MDC-TIERS.md`).
**Priority:** later.

Add the inverse of the existing parser: **paste an MdC string → auto-build the
layout**, and **export a selection back to MdC code**. High value for scholars
who work in MdC notation.

---

## Fixed

### TODO-5 — touch gestures (pinch-zoom + two-finger pan)
**Fixed:** 2026-06-01. **Area:** `canvas-interactions.js` (`initTouchGestures`,
extracted `panBackgroundImage`). **Needs:** real-device confirmation (no touch
hardware in the dev env). Continuation of [[responsive-track1]] (tablet drawer
already shipped).

Fabric 5's optional gesture module isn't in the CDN build, so the viewport is
driven straight off native touch events, reusing the existing maths: **pinch →
`zoomToPoint`** about the pinch midpoint (same 0.1–5 clamp as the wheel),
**two-finger drag → viewport pan** (same as Alt-drag, via the new shared
`panBackgroundImage` helper that also nudges the bg layer). We act **only** on
two-finger touches — a single finger is left to Fabric so tap-select and
one-finger drag are untouched. The fight between our handlers and Fabric's own
touch handlers is avoided cleanly: listeners sit on `canvas.wrapperEl` in the
**capture phase** and `stopPropagation` on a two-finger event, so Fabric's
handlers (bound to the child upper-canvas) never see it — no
`stopImmediatePropagation`, no listener-order assumptions. Selection handles get
a larger touch hit area (`touchCornerSize` 24→40) without changing desktop
visuals. Gated behind a touch-capability check so desktops pay nothing.

### BUG-2 — group-move undo restored wrong coords / threw
**Fixed:** 2026-06-01. **Area:** `canvas-interactions.js` `applyLegacyModify`
(group branch). **Verified:** Playwright round-trip (move multi-select → undo →
redo) restores exact positions.

A multi-select **drag** records each child flat (`{id, left, top, …}`) while the
mirror/align path nests them under `.state`; the restore only read `obj.state.left`,
so a group-move undo threw on `undefined`. Both shapes actually hold the child's
*group-relative* left/top, and the restore already rebuilds an ActiveSelection at
the saved `groupState` — which converts group-relative back to absolute. So the
whole fix is reading `obj.state || obj`: no coordinate math, undo lands every sign
back in place (confirmed 200,200 / 360,240 round-trip to ±2px, redo re-applies).

### BUG-3 — multi-select delete undid one object at a time
**Fixed:** 2026-06-01. **Area:** `canvas-interactions.js` (`collectDeletion` +
`recordBatch`, new `batch` case in `revertAction`), `editor-init.js` (Delete key).

Deleting a multi-selection pushed one `delete` undo entry **per object**, so each
Ctrl+Z restored only one. Introduced a compound `batch` action: the Delete
handler now collects every sub-deletion (across the selection *and* any swept
three-line block siblings) and records them as a single `batch` via
`recordBatch`. `revertAction` reverts a batch's sub-actions in reverse order and
returns the inverse batch, so undo/redo of a group delete is one symmetric step.
A lone delete still records a flat `delete` (no one-item batch). The dead
`deleteSelectedObjects` (no callers) was left as-is.

Follow-on: restored signs were landing at the top-left because inside an
ActiveSelection each child's `left`/`top` is group-relative; the Delete handler
now calls `canvas.discardActiveObject()` **before** collecting, so Fabric writes
absolute coords back and the snapshot (hence undo) keeps each sign in place.

### TODO-4 — dictionary results: click-to-insert
**Fixed:** 2026-06-01. **Area:** `dictionary-search.js`
(`initializeResultClickInsert`, `processLineSegments`), `main.css` (`.large-text`).

Each glyph run in the results (the `.large-text` spans) is now **clickable to
drop those signs onto the canvas**, routed through the same `handleMdCInput`
pipeline the drag-from-results path already used. Implemented as a single
delegated `click` listener on the persistent `#resultDisplay` container, so it
covers every re-render with no per-span wiring; guarded by a `typeof
handleMdCInput` check so the file stays inert if loaded without the editor.
Discoverability: spans get a pointer cursor + hover tint + a `title` tooltip, and
a brief green flash confirms the insert. Granular by design — clicking one run
inserts just that run, not the whole line.

### TODO-3 — redo (complete the undo pair)
**Fixed:** 2026-06-01. **Area:** `canvas-interactions.js` (undo/redo engine),
`editor-core.js` (`redoHistory` + `pushUndo`), `editor-init.js` (keybinding),
`help-content.html`.

Undo and redo are now **one self-inverting operation**: `revertAction(action)`
reverses `action` on the canvas and *returns the inverse* action. `undo` pops
`undoHistory`, reverts, parks the inverse on `redoHistory`; `redo` is the exact
mirror — so the stacks stay in sync with no per-direction bookkeeping. Recording
any new action clears the redo stack through a single choke point, `pushUndo()`
(all ~26 `undoHistory.push({…})` call sites were routed through it; internal stack
juggling still pushes raw). `add`↔`delete` are natural inverses; `modify` is
normalized to a flat per-object **snapshot** read live off the canvas
(`discardActiveObject` first for absolute coords), which sidesteps the three
inconsistent recorded shapes (single / group / move-group) and is more robust
than the old group restore. Keys: **Ctrl+Z** undo, **Ctrl+Y** / **Ctrl+Shift+Z**
redo. Surfaced a pre-existing group-move undo bug in the process — see BUG-2.

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
