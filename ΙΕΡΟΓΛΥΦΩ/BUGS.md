# Known bugs / deferred fixes

Open issues in the editor, captured so they survive across sessions. Newest
first. Resolve, then move the entry to the "Fixed" section (or delete) with the
commit ref.

---

## Open

### BUG-1 — PDF footer URL not visible in exported PDF
**Reported:** 2026-06-04

Added a footer in `export.js` `saveToPDF` that writes `www.hieroglyphica.org`
centred in the bottom margin as real Helvetica text (`pdf.text(..., pageW/2,
pageH - MARGIN/2, {align:'center', baseline:'middle'})`, line ~570). Verified in
isolation against the app's vendored jsPDF that the string lands in the PDF
stream at y≈774 of a 792pt letter page — yet the user reports not seeing it in an
actual editor export. The brand corner watermark (`ΙΕΡΟΓΛΥΦΩ`, top-right) still
shows correctly.

Most likely a stale-cache / not-yet-reloaded `export.js` (user exported before a
hard refresh) or simply the page-top crop they inspected, but unconfirmed — could
also be something painting over / clipping the bottom margin in the real export
path. Pick up by: hard-refresh + export, scroll to page bottom-centre; if still
missing, instrument `saveToPDF` to confirm the footer branch runs and check the
placed-image height isn't covering the footer (esp. non-page-guide mode).

Related, same session (working, not bugs): raster exports now supersample at 3×
(`EXPORT_SUPERSAMPLE`) via Fabric `toCanvasElement` for crisp glyphs.

---

## TODO

_(none)_

---

## Fixed

_Cleared 2026-06-01 — the backlog (BUG-1…3, TODO-1…6) is all shipped. The full
write-ups live in git history and, for the MdC work, in `MDC-TIERS.md`._
