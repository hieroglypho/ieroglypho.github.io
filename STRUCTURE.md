# Repository structure — hieroglyphica.org

A static site hosted on **GitHub Pages** (`CNAME` → hieroglyphica.org). No build step,
no bundler, no server-side logic. Everything is plain HTML/CSS/JS served as-is.

There are **two independent surfaces** in this repo:

1. **Marketing / content site** — the repo root (`/`)
2. **The editor app** — the `ΙΕΡΟΓΛΥΦΩ/` folder (`/ΙΕΡΟΓΛΥΦΩ/`)

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
   4. `export.js` — `saveToSVG`, `saveToPNG`, `saveToPDF`, `copyCanvasImage`, watermark
      stamping, hiero-font embedding (`ensureHieroTtfBase64`, `ensureJsPDFLoaded`).
   5. `drawing-tools.js` — the search/filter dropdown wiring + shape tools
      (`addCartouche`, `addCircle`, `addLine`, `addArrow`, `addSquareBracket`,
      `addCustomRect`, `addPencilLine`, `addSpeechBubble`).
   6. `glyph-input.js` — on-screen keyboard dialog, glyph-text dialog, three-line
      linked blocks, transliteration palette, MdC paste handler (`parseMdCInput`,
      `handleMdCInput`).
   7. `editor-init.js` — `initMainMenu`, DOM event wiring, background image,
      the single `DOMContentLoaded` dispatcher, color popup, layout/resize/keydown
      lifecycle. Runs last because it wires everything defined above.
4. `dictionary-search.js` — dictionary upload + search + IndexedDB caching
   (formerly `fjgus.js`; renamed this session).

`jsPDF` is **lazy-loaded from cdnjs** on the first "Save as PDF" click
(`ensureJsPDFLoaded()` in `script.js`) — it is not in the page `<head>`.

### Other files in the folder
| File | Role |
|------|------|
| `main.css` | The editor's only stylesheet (linked). |
| `help-content.html` | Loaded in an `<iframe>` for the in-app help overlay. |
| `mobile.html` | Standalone "please visit on desktop" page (loads no app scripts). |
| `mazzon-dictionary.txt` | Bundled dictionary data the user uploads manually via "Upload Dictionary". **Not auto-loaded** by code; referenced by name in `help-content.html`. |
| `fonts/NotoSansEgyptianHieroglyphs-Regular.ttf` | Fetched + base64-encoded for jsPDF font embedding. |
| `fonts/HieroglyphicaExtended-Regular.woff2` | Web font (`@font-face` in `main.css`). |
| `favicon.ico`, `robot.txt` | Misc. |
| `MDC-TIERS.md` | Roadmap + status for Manuel de Codage layout support (the `handleMdCInput` engine in `glyph-input.js`). Source of truth for which MdC operators are implemented; update as tiers land. |

### Orphans removed (2026-05-29)
- `pdf.js` — was a dead standalone PDF snippet; the real export is `saveToPDF()` in `export.js`.
- `keyboard-styles.css` — was unlinked; keyboard styles live in `main.css`.

> The editor's major sections now live in the 7 files listed under **Load order** above.
> `editor-core.js` opens with a module map in its header comment. There is no longer a
> single `script.js`.

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
