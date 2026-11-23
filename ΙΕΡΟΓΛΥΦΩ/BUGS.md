# Known bugs / deferred fixes

Open issues in the editor, captured so they survive across sessions. Newest
first. Resolve, then move the entry to the "Fixed" section (or delete) with the
commit ref.

---

## Open

_(none)_

---

## TODO

### TODO-7 — autosave quietly stops for very large canvases (e.g. an imported Sinuhe)
**Noted:** 2026-11-23

Symptom: after importing a long JSesh text (Sinuhe, ~10,000 signs) the crash-recovery
autosave no longer saves, and nothing tells the user.

Cause: `writeAutosave` (workspace.js) stores the full Fabric JSON of every object in
localStorage, which holds about 5 MB per site. Each sign is several hundred bytes of
JSON, so ~10,000 signs run past the limit. The fallback (drop photos, retry) doesn't help
when the signs themselves are too big, so it gives up with only a console warning.
Serializing 10,000 objects after every 1 s pause is also slow.

Suggested fix, in order:
1. Write the snapshot to IndexedDB instead of localStorage (quota is a share of free
   disk, typically hundreds of MB; async, so it doesn't freeze the page). Keep the
   localStorage key only as a fallback, and read either on load.
2. Make snapshots smaller: serialize with `includeDefaultValues = false` (Fabric then
   omits every property left at its default, typically halving the size or better),
   and/or compress with the gzip `CompressionStream` the share links already use
   (`packString` / `unpackString`).
3. If a write still fails, say so once: a small "Autosave is off for this canvas, use
   Save as JSON" notice, instead of only a console warning.
4. For big canvases, autosave less often (e.g. every 10 s instead of 1 s after
   the last change once the canvas has more than ~2,000 objects).

Test: import Sinuhe, wait, reload, and the restore banner should offer all ~10,000 signs.

---

_TODO-1 (cache-bust the editor's JS/CSS) shipped in 3d7ef6b:
`tools/cache-bust.mjs` stamps every local script and stylesheet with `?v=<hash>`;
re-run it after editing editor assets, before committing._

---

## Fixed

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
