# Known bugs / deferred fixes

Open issues in the editor, captured so they survive across sessions. Newest
first. Resolve, then move the entry to the "Fixed" section (or delete) with the
commit ref.

---

## Open

_(none)_

---

## TODO

_(none open; TODO-7 fixed, see below)_

---

_TODO-1 (cache-bust the editor's JS/CSS) shipped in 3d7ef6b:
`tools/cache-bust.mjs` stamps every local script and stylesheet with `?v=<hash>`;
re-run it after editing editor assets, before committing._

---

## Fixed

### BUG-9 — R (mirror) scrambled a text with stacks; mirrored signs lost flipX (fixed 2026-11-24)
Owner's report: a line dragged from the course, selected and mirrored with R, came out crowded and
misplaced. Two causes. (1) `mirrorTextObject` gave each sign the place of another in reverse
creation order: fine for one plain row, wrong for stacks and signs of different widths. Now it
mirrors the selection as one picture (`mirrorLaidOutBlock`, by ink centre). (2) Fabric 5: letting
go of a multi-selection rebuilt a mirrored object as flipY + angle 180, so R, right-to-left
detection and the exports saw it as unmirrored and rotated. `normalizeFlip` turns flipY back
into flipX on deselect and on opening a file. Test: pw/mirrorR.mjs (MdC unchanged after R, no
overlaps, R twice and undo restore).

### BUG-8 — reading order overflowed the stack on crowded canvases (fixed 2026-11-24)
mdcLayoutTree recursed forever when overlapping signs put every centre on one side of a cut
(2,000 signs 45 px apart: "Maximum call stack size exceeded" in →MdC, Unicode copy, PDF text
order). Now such a set is kept in plain reading order. Found while building the reading-order
Gardiner bar (gardiner-bar.js); test pw/gbarperf.mjs.

### BUG-7 — narrow windows: signs dragged from the palette drawer were lost (fixed 2026-11-24)
Below 900 px the palette is a slide-in drawer with a scrim over the canvas; a sign dragged out
of it was dropped on the scrim, never on the canvas. Fix (f9e829c, editor-init.js): the drawer
slides away once a drag starts and comes back on dragend. Test: Playwright, 872×841, drag the
first palette cell to the canvas (0 signs placed before, 1 after).

### BUG-5 — "Save as PDF (selectable text)" had no hieroglyph text (fixed 2026-11-24)
Symptom: the PDF's invisible text layer was empty for hieroglyphs: nothing to select,
copy or search, although the save message said "selectable text". Every PDF also
carried the whole Noto font (~0.5 MB a file).

Cause: jsPDF 2.5.1 reads only the Basic Multilingual Plane part of a TrueType cmap;
hieroglyphs are in plane 1 (U+13000–143FF), so each was written as `<> Tj`. Visible
hieroglyph text was impossible for the same reason.

Fix: PDF export rebuilt on pdf-lib + fontkit (`pdf-export.js`): real Unicode text (all
9,875 signs of an imported Sinuhe copy back out), fonts subset. jsPDF removed. Also new:
"Save as PDF (vector text)".

### BUG-6 — PDF crop cut off work beyond the visible canvas (fixed 2026-11-24)
`getContentBounds` clamped the crop to the visible canvas and its pixel scan only saw
the visible canvas, so anything panned out of view (or most of a long imported text)
was left out of the PDF. Objects not wholly inside the visible canvas now count with
their bounding boxes; very large crops get a lower supersample (browser canvas limits).

### Note — Hieroglyphica Extended TTF for PDFs must be padded
`fonts/HieroglyphicaExtended-Regular.ttf` is made from the woff2 by
`tools/build-pdf-fonts.py`. A plain woff2 → ttf conversion leaves glyph records unpadded
(padding 1); fontkit's subsetter then writes a short `loca` with wrong offsets and every
Extended-A sign is blank in the PDF. The script pads to 4. Re-run it after editing the font.

### TODO-7 — autosave quietly stopped for very large canvases (fixed 2026-11-24)
Symptom: after importing a long JSesh text (Sinuhe, 10,257 objects) nothing was
autosaved (10.3 MB of JSON against localStorage's ~5 MB), with only a console warning.

Fix (workspace.js): the snapshot is trimmed like a share link (`minifyForShare`) and
deflated (`packString`), then stored in IndexedDB (database `ieroglypho`, store
`autosave`, record `{ v: 2, savedAt, data }`). Sinuhe: 10.3 MB → 0.48 MB, ~0.1 s.
localStorage is only the fallback (photos dropped there if over quota); old
`{ savedAt, workspace }` snapshots are still read. Reads, writes and clears run in one
queue, so no write can replace the old snapshot before the restore banner reads it.
Canvases over 2,000 objects autosave 5 s (not 1 s) after the last change. If nothing
can be stored, a notice says so once ("use ≡ → Save as JSON").

### BUG-3 — after opening a share link, Save as JSON / share / autosave failed (fixed 2026-11-24)
Symptom: open any share link, then ≡ → Save as JSON → "Error saving workspace";
sharing again and autosave failed too (console: `stylesToArray … reading '0'`).
Live since share links existed.

Cause: `minifyForShare` drops empty `styles`; Fabric 5.2.4 then loads the text with
`styles = undefined`, and its `toObject` throws. Fix: `applyWorkspace` gives text
objects without `styles` an empty one (`addMissingTextStyles`), so links already
shared open correctly too.

### BUG-4 — reopened workspaces showed an extra "N5" in the names bar (fixed 2026-11-24)
Cause: the old index-based `pastedNames` fallback in `applyWorkspace` gave a name to any
non-image object without one, including cartouche frames (groups). Now only text
objects (signs) take a fallback name.

Tests (scratchpad, Chromium + Firefox): Sinuhe import → reload → Restore brings back all
10,257 objects and autosave continues; restored objects identical to the originals
(incl. a photo); Dismiss clears; legacy snapshot; no-IndexedDB fallback; nothing
storable → one notice; share link → Save works.

### BUG-1 — content at the page-edge / footer missing from exported PDF (579140a, stale cache)
**Reported / resolved:** 2026-06-04

Symptom: glyphs/text placed in the page-guide *margins* (outside the dashed safe
zone — near the left/top/right page edges) did not appear in the saved PDF, and
the `www.hieroglyphica.org` footer was absent.

Root cause: the pre-579140a `compositeCropForPDF` built the export by blitting the
live canvas backing store — `ctx.drawImage(canvas.getElement(), …, -left, -top,
…)`. That backing store only holds the visible viewport (`[0,canvas.width] ×
[0,canvas.height]`). The canvas is sized to the window (`editor-core.js:122`), and
a portrait page guide is 1056px tall — taller than most windows — so the guide is
centred with its margins hanging *off-canvas*. Those pixels were never in the
backing store, so the blit couldn't capture them; the dashed safe-zone inset
roughly matched the overhang, so "inside the dashed line" was exactly "still
on-canvas." Diagnosis: the embedded raster in the user's PDF was 816×1056 (no 3×
supersample) — i.e. an old cached `export.js`.

Fix: commit 579140a already replaced the blit with `canvas.toCanvasElement(SS,
{left,top,width,height})`, which **re-renders every object** over the crop and
recomputes the viewport boundaries to the full page (confirmed against Fabric
5.2.4 source) — so off-canvas margin content renders, plus 3× supersampling and
the footer. The user just needed a hard refresh. See TODO-1 for cache-busting so
this doesn't recur. (Added a clarifying comment in `compositeCropForPDF`.)

---

_Cleared 2026-06-01 — the earlier backlog (BUG-1…3, TODO-1…6) is all shipped. The
full write-ups live in git history and, for the MdC work, in `MDC-TIERS.md`._
