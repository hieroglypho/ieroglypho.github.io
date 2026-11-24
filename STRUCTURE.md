# Repository structure — hieroglyphica.org

A static site hosted on **GitHub Pages** (`CNAME` → hieroglyphica.org). No build step,
no bundler, no server-side logic. Everything is plain HTML/CSS/JS served as-is.

There are **three independent surfaces** in this repo:

1. **Marketing / content site** — the repo root (`/`)
2. **The editor app** — the `ΙΕΡΟΓΛΥΦΩ/` folder (`/ΙΕΡΟΓΛΥΦΩ/`)
3. **The hieroglyphs course** — the `course/` folder (`/course/`), a published copy (see §3)

They share *no* live code. Each marketing page is self-contained (inline `<style>`); the
editor is the only place the JavaScript lives.

---

## 1. Marketing / content site (repo root)

Served at `hieroglyphica.org/<page>.html`. Each page uses an inline `<style>` block plus the
Font Awesome CDN for icons. **None of these pages link `main.css`.**

| File | Role |
|------|------|
| `index.html` | Landing page. Links to the editor via two `<a href>` (≈ lines 372, 379). |
| `about.html` | About + update log. |
| `dictionary.html` | Dictionary page. |
| `research.html` | Research paper page. |
| `tutorials.html` | Tutorials. |
| `TOS.html` | Terms of service / legal. |
| `mobile.html` | "Desktop only" notice. |
| `sitemap.xml` | Sitemap (lists content pages + the editor URL). |
| `CNAME` | Custom domain (`hieroglyphica.org`). |
| `dictionary.txt` | Large (~3.8 MB) dictionary data file. |
| `Hieroglyphica-paper.odt` / `.docx` | Research paper working drafts (gitignored draft excluded). |
| `favicon.*`, `apple-touch-icon.png`, `splashscreen.*`, `screenshot.png` | Shared assets. |

> **No code/CSS at root.** Earlier there were stale duplicates here (`script.js`, `chars.js`,
> `main.css`) left over from an older editor that once lived at the root. They were loaded by
> nothing and have been **removed** (2026-05-29). The live editor lives entirely in
> `ΙΕΡΟΓΛΥΦΩ/`. Don't reintroduce a root copy of editor code.

---

## 2. The editor app (`ΙΕΡΟΓΛΥΦΩ/`)

Entry point: **`index.html`** — public URL `hieroglyphica.org/ΙΕΡΟΓΛΥΦΩ/`.

### Load order (all classic `<script defer>`, order matters)
1. `fabric.min.js` — Fabric.js 5.2.4 from cdnjs (the canvas engine).
2. `chars.js` — glyph data: the encoded `table` (decoded by `loadCharacters`) + the
   `horizontalGlyphs` / `verticalGlyphs` / `smallGlyphs` / `largeGlyphs` category arrays.
3. **The editor, split into 7 parts** (formerly one 3174-line `script.js`). Load order is
   load-bearing — they share one global scope; see the breakdown below.
   1. `editor-core.js` — state/globals, canvas + grid init, glyph table decode +
      catalog rendering, `addCharacterToCanvas`. Runs the load-time bootstrap
      (`drawGrid()`, `displayCharactersInRows()`), so it must stay first.
   2. `canvas-interactions.js` — `canvas.on(...)` mouse handlers (drag, marquee, pan,
      zoom, drop, dblclick, moving/rotating/scaling/modified), undo, delete/cleanup,
      `mirrorTextObject`, `alignObjects`.
   3. `workspace.js` — `saveWorkspace`, `loadWorkspace`, `syncPastedNamesWithCanvas`.
   4. `export.js` — `saveToSVG`, `saveToPNG`, `copyCanvasImage`, watermark stamping, and
      the helpers both PDF exports share (`getContentBounds`, `compositeCropForPDF`,
      `pageGuidePaperRect`, `withIdentityViewport`, `withGridHidden`).
   4b. `pdf-export.js` — `saveToPDF` (picture + invisible Unicode text layer) and
      `saveToPDFText` (real text in embedded fonts + vector shapes), built with pdf-lib +
      fontkit. `PdfPainter` is a canvas-2D stand-in that Fabric renders into, writing PDF
      operators; text runs are placed where Fabric drew them, in the font chosen per
      character (`pdfFontChain`).
   5. `drawing-tools.js` — the search/filter dropdown wiring + shape tools
      (`addCartouche`, `addCircle`, `addLine`, `addArrow`, `addSquareBracket`,
      `addCustomRect`, `addPencilLine`, `addSpeechBubble`).
   6. `glyph-input.js` — on-screen keyboard dialog, glyph-text dialog, three-line
      linked blocks, transliteration palette, MdC paste handler (`parseMdCInput`,
      `handleMdCInput`).
      Also the export side: `mdcLayoutTree` (layout detection on ink boxes,
      `signInkBox`) → `mdcStringForObjs` (MdC) and `unicodeStringForObjs`
      (Unicode with format controls U+13430…, `copySelectionAsUnicode`, key `u`);
      `unicodeLayoutToMdC` turns pasted Unicode-with-layout back into MdC.
   6b. `photo-trace.js` — photo tracing (BG photo panel): lock, rotate, straighten,
      fit, hide, replace, "include photo in exports" (`hidePhotosForExport`, used by
      `export.js`). Its `initPhotoTrace()` is called from editor-init's dispatcher.
   6c. `jsesh-codes.js` (data: JSesh sign codes → Unicode from Unikemet, MdC sound codes,
      composite signs) and `jsesh-import.js` (`jseshToMdC`, `importJSeshText`; ≡ → Open
      JSesh file, or a `.gly` dropped on the canvas). `initJSeshImport()` is called from
      editor-init's dispatcher.
   7. `editor-init.js` — `initMainMenu`, DOM event wiring, background image,
      the single `DOMContentLoaded` dispatcher, color popup, layout/resize/keydown
      lifecycle. Runs last because it wires everything defined above.
4. `dictionary-search.js` — loads the bundled dictionary files and searches them
   (formerly `fjgus.js`). `word-finder.js` — "What does this say?".

`pdf-lib` + `fontkit` (`vendor/`, MIT, see `vendor/LICENSES.md`) are **lazy-loaded** on the
first PDF save (`ensurePdfLibLoaded()` in `pdf-export.js`) — they are not in the page `<head>`.
jsPDF was used until 2026-11-24 and removed: it could not map hieroglyphs (Unicode plane 1).

### Other files in the folder
| File | Role |
|------|------|
| `main.css` | The editor's only stylesheet (linked). |
| `help-content.html` | Loaded in an `<iframe>` for the in-app help overlay. |
| `mobile.html` | Standalone "please visit on desktop" page (loads no app scripts). |
| `mazzon-dictionary.txt` | Bundled dictionary data the user uploads manually via "Upload Dictionary". **Not auto-loaded** by code; referenced by name in `help-content.html`. |
| `fonts/NotoSansEgyptianHieroglyphs-Regular.ttf` | Embedded (subset) in PDFs for hieroglyphs U+13000–1345F. |
| `fonts/HieroglyphicaExtended-Regular.woff2` | Web font (`@font-face` in `main.css`). |
| `fonts/HieroglyphicaExtended-Regular.ttf` | PDF copy of the woff2, made by `tools/build-pdf-fonts.py`. **Re-run it after every edit of the woff2.** |
| `fonts/GentiumPlus-*.ttf`, `fonts/NotoSans-*.ttf` | PDF fonts for serif (transliteration) and sans text, regular + italic (OFL, `fonts/GentiumPlus-NotoSans-OFL.txt`). |
| `favicon.ico`, `robot.txt` | Misc. |
| `MDC-TIERS.md` | Roadmap + status for Manuel de Codage layout support (the `handleMdCInput` engine in `glyph-input.js`). Source of truth for which MdC operators are implemented; update as tiers land. |

### Orphans removed (2026-05-29)
- `pdf.js` — was a dead standalone PDF snippet; the real export is `saveToPDF()` (now in `pdf-export.js`).
- `keyboard-styles.css` — was unlinked; keyboard styles live in `main.css`.

> The editor's major sections now live in the files listed under **Load order** above.
> `editor-core.js` opens with a module map in its header comment. There is no longer a
> single `script.js`.

---

## 3. The hieroglyphs course (`course/`)

Served at `www.hieroglyphica.org/course/`. **This folder is a published copy: don't edit it
here.** The source lives in the private repo `ieroglypho-courseware` (sibling folder), and
`tools/deploy-free.sh` there copies the free classes into this folder, replacing what is here.

- Contents: course home (`index.html`), shared `course.js` / `course.css` / `signs.js` /
  `config.js`, `alphabet/`, and `class-01/` … `class-05/` (each with its `audio/` recordings).
- **Free classes only (1–5).** This repo is public. Members-only classes (6 onward) must never
  be committed here; the deploy script copies from a fixed list and removes anything else.
- The course has its own stylesheet and scripts and shares no code with the editor. It links
  to the site's pages and the editor with root-relative links (`/about.html`, `/ΙΕΡΟΓΛΥΦΩ/`).
- The six content pages carry a `COURSE` tab in their nav (`<a href="course/">`), and
  `sitemap.xml` lists the course home, the five classes and the alphabet page.

---

## Conventions & gotchas (rules of the road)

- **Classic scripts only.** Top-level `function` / `let` / `const` declarations are shared
  across the separate `<script>` files via the global lexical environment, and `var` /
  implicit globals attach to `window`. This is why the 7 editor parts and
  `dictionary-search.js` call into each other with no imports.
- **Do NOT convert the editor files to `type="module"`.** The editor HTML has ~23 inline
  `onclick="someFn()"` handlers (`addCartouche()`, `openKeyboard()`, `searchDictionary()`, …)
  that require those functions to be **global**. ES modules hide them and every button
  silently breaks. The editor was split into 7 classic files (2026-05-29) precisely so it
  could be modularized *without* going ESM — keep new files classic and keep handler
  functions global.
- **Load order is load-bearing:** `chars.js` → the 7 editor parts in the fixed order
  (`editor-core` first, `editor-init` last) → `dictionary-search.js`. `editor-core.js` runs
  the load-time bootstrap and `editor-init.js` holds the sole `DOMContentLoaded` dispatcher,
  so those two anchor the ends. No top-level statement calls forward into a later file at
  load time — preserve that if you move code between parts. Never redeclare the same
  top-level `let`/`const` name in two files (it's a hard SyntaxError that blanks the app).
- **All editor code lives in `ΙΕΡΟΓΛΥΦΩ/`** — there is no longer a root copy. Note the
  glyph table in `ΙΕΡΟΓΛΥΦΩ/chars.js` is the large/complete encoding (~136k chars); the old
  root `chars.js` held a much smaller, superseded set and was removed.

---

## Change log of structural edits

- **2026-05-29** — Renamed `fjgus.js` → `dictionary-search.js`; `searchFygusFile()` →
  `searchDictionary()`; `#fygusSearchInput` → `#dictionarySearchInput`; updated CSS comments
  and the help heading. (Remaining `fjgus` name: the `fjgus.txt` data file — pending decision.)
- **2026-05-29** — Renamed editor folder `ΙΕΡΟΓΛΥΦΩ-1/` → `ΙΕΡΟΓΛΥΦΩ/` and entry file
  `XYjQ5WMMLCY0vy9sT.html` → `index.html`. New public URL: `hieroglyphica.org/ΙΕΡΟΓΛΥΦΩ/`.
  Updated all 8 URL references (sitemap, landing-page links, canonical/og/JSON-LD, help &
  mobile canonicals). No redirect stub left at the old path (static host; old URL will 404
  until re-indexed — internal links already point to the new URL).
- **2026-05-29** — Renamed `fjgus.txt` → `mazzon-dictionary.txt` (updated help text).
- **2026-05-29** — Removed orphans: root `script.js`, `chars.js`, `main.css` (stale older-editor
  duplicates, loaded by nothing) and `ΙΕΡΟΓΛΥΦΩ/pdf.js`, `ΙΕΡΟΓΛΥΦΩ/keyboard-styles.css`
  (dead/unlinked). All recoverable via git history if ever needed.
- **2026-05-29** — Split the editor `ΙΕΡΟΓΛΥΦΩ/script.js` (3174 lines) into 7 classic
  `<script defer>` files along its existing section boundaries: `editor-core.js`,
  `canvas-interactions.js`, `workspace.js`, `export.js`, `drawing-tools.js`,
  `glyph-input.js`, `editor-init.js` (loaded in that order, between `chars.js` and
  `dictionary-search.js`). Byte-for-byte the same code, just partitioned — verified the
  concatenation reproduces the original and each file passes `node --check`. Kept classic
  scripts / global functions (no ESM). `script.js` removed.
- **2026-11-13** — Editor ≡ menu: added "🎓 Learn to read hieroglyphs (course)" (`#courseBtn`,
  inline `onclick` → opens `../course/` in a new tab), above "Gardiner signs (Wiki)". HTML-only;
  no JS changed. The course itself is developed in the sibling `ieroglypho-courseware/` folder
  and is deployed here as `/course/` (see the next entry).
  Note: the bare domain `hieroglyphica.org` is forwarded by Squarespace to the www homepage and
  drops the path, so absolute links must use `https://www.hieroglyphica.org/…`.
- **2026-11-14** — Course published: `course/` added (free Classes 1–5, alphabet page, course
  home; copied from the private `ieroglypho-courseware` repo by its `tools/deploy-free.sh`),
  `COURSE` tab added to the nav of the six content pages, seven course URLs added to
  `sitemap.xml`. See §3: the folder is a copy, and paid classes never go in this repo.
- **2026-11-23** — Editor clean-up after a code review. Clicking now uses Fabric's own
  target (the old manual hit-test picked the bottom object and broke when zoomed). The
  old `#bgImage` photo overlay is gone: tracing photos are Fabric images
  (`photo-trace.js`), and a workspace saved with the old overlay is turned into a locked
  photo on load (`addLegacyBackground` in `workspace.js`). Undo: `groupUndo(fn)`
  (canvas-interactions) makes one step of an MdC layout; `UNDO_PROPS` (editor-core) is the
  one list of custom properties kept by undo snapshots and saved workspaces.
  `canvasModified` is set by any canvas change (workspace.js, `initAutosaveRestore`) and
  cleared by Save as JSON / opening a file. Removed unused globals, the dead "Alph" filter,
  `deleteSelectedObjects`, `clearExistingGrid`, `srcToDataUrl`, the `#saveAsPDF` listener
  and load-time console logging.
- **2026-11-23** — Added `ΙΕΡΟΓΛΥΦΩ/jsesh-codes.js` + `jsesh-import.js` (JSesh `.gly` import),
  loaded after `photo-trace.js`. See MDC-TIERS.md changelog.
- **2026-11-24** — PDF export moved from jsPDF to pdf-lib + fontkit (`pdf-export.js`,
  `vendor/`). jsPDF wrote every hieroglyph as an empty string, so the "selectable text"
  layer was empty; now both PDFs carry real Unicode text, with fonts subset. New ≡ menu
  item "Save as PDF (vector text)". The PDF crop now includes work beyond the visible
  canvas. New fonts (Gentium Plus, Noto Sans; OFL) and `tools/build-pdf-fonts.py`.
