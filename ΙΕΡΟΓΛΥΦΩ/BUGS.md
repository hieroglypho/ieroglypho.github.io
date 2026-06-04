# Known bugs / deferred fixes

Open issues in the editor, captured so they survive across sessions. Newest
first. Resolve, then move the entry to the "Fixed" section (or delete) with the
commit ref.

---

## Open

_(none)_

---

## TODO

### TODO-1 — Cache-bust the editor's JS/CSS so deploys take effect
**Filed:** 2026-06-04

`index.html` loads `export.js`, `editor-core.js`, … with bare `src="export.js"`
(no version query), so browsers/GitHub-Pages happily serve stale copies after a
deploy. This is what made BUG-1 look unfixed (see Fixed below). Add a version/
hash query string (`?v=…`) to the script + stylesheet tags, or some other
cache-bust, so a new commit reliably reaches users without a manual hard refresh.

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
