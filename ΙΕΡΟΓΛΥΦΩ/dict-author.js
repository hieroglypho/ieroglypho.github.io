// dict-author.js — LOCALHOST-ONLY authoring tool.
// ---------------------------------------------------------------------------
// Right-click a glyph group on the canvas → "Save to dictionary" → fill in the
// transliteration / gloss / part-of-speech (+ an optional credit/source) → the
// entry is inserted into dict-additions.txt — a SEPARATE file that search and
// the decoder also load, so the 50k-line master (dictionary.txt) stays pristine
// while new entries are instantly searchable. Written via File System Access.
//
// SAFETY (the file is 50k+ lines and must never be corrupted):
//   • Insert-only: we read the file, splice in exactly ONE line, write it back.
//     No existing line is reordered, reformatted, or re-encoded.
//   • A hard invariant runs before every write: the new content must equal the
//     old content with exactly one line inserted — otherwise we abort and write
//     nothing.
//   • The write itself is atomic (createWritable swaps a temp file on close).
//   • The pre-save text is kept in memory so "Undo last save" can restore it,
//     and because it writes your repo file, `git diff` is the ultimate net.
//
// PUBLIC SITE: this whole module no-ops unless served from localhost, and the
// menu item stays hidden. It also pulls in gardiner-map.json only on localhost.
// So nothing here ships to / affects hieroglyphica.org.
// ---------------------------------------------------------------------------

(function () {
    'use strict';

    const isLocal = ['localhost', '127.0.0.1', '[::1]', ''].includes(location.hostname);
    if (!isLocal) return;   // never active on the live site

    // ---- module state -----------------------------------------------------
    // We write ONLY to this file — a separate, also-searched additions file —
    // never the master dictionary.txt. The name is enforced when picking the
    // handle, so a stray earlier pick of the wrong file can't be reused.
    const TARGET_NAME = 'dict-additions.txt';

    let GMAP = null;            // glyph (string) -> Gardiner code
    let fileHandle = null;      // FileSystemFileHandle for dict-additions.txt
    let undoText = null;        // full text before the last successful save
    let lastAddedLine = null;   // the line appended on the last save (in-memory undo)
    let undoCount = 0;          // entries added this session (for the counter)
    let modal = null;           // built lazily

    // Standard Gardiner category order (Unicode convention: "Aa" after Z, no "J").
    const CAT_ORDER = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'K', 'L', 'M',
        'N', 'NL', 'NU', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z', 'Aa'];

    const POS_OPTIONS = ['noun', 'verb', 'adjective', 'adverb', 'preposition',
        'pronoun', 'particle', 'interjection', 'conjunction', 'numeral',
        'interrogative', 'demonstrative', 'negation',
        'causative verb', 'verb transitive', 'verb intransitive',
        'plural noun', 'noun-prop.', 'noun-title', 'noun-div.', 'noun-loc.', 'noun-ani.',
        'noun-bird', 'noun-fish', 'noun-flora', 'noun-food', 'noun-bod.', 'noun-arch.',
        'noun-furn.', 'noun-clo.', 'noun-boat', 'noun-min.', 'noun-astro.'];

    const DIACRITICS = ['ꜣ', 'ꜥ', 'ï', 'Ꞽ', 'ꞽ', 'ḥ', 'ḫ', 'ẖ', 'š', 'ḳ', 'ṯ', 'ṱ', 'ḏ',
        'ḍ', 'ṣ', 'ṭ', 'ꜥ', 'ā', 'ī', 'ū', '∼', '.', '='];

    // ---- tiny IndexedDB store for the file handle --------------------------
    function idb(mode, fn) {
        return new Promise((resolve, reject) => {
            const open = indexedDB.open('dict-author', 1);
            open.onupgradeneeded = () => open.result.createObjectStore('kv');
            open.onerror = () => reject(open.error);
            open.onsuccess = () => {
                const tx = open.result.transaction('kv', mode);
                const store = tx.objectStore('kv');
                const req = fn(store);
                tx.oncomplete = () => resolve(req && req.result);
                tx.onerror = () => reject(tx.error);
            };
        });
    }
    const idbGet = (k) => idb('readonly', (s) => s.get(k));
    const idbSet = (k, v) => idb('readwrite', (s) => s.put(v, k));

    // ---- glyph helpers -----------------------------------------------------
    const firstGlyph = (s) => { for (const ch of s) return ch; return ''; };

    function gardinerFor(run) {
        // Returns { codes:[...], unmapped:[...glyph] }
        const codes = [], unmapped = [];
        for (const ch of run) {
            const c = GMAP[ch];
            if (c) codes.push(c); else { codes.push('?'); unmapped.push(ch); }
        }
        return { codes, unmapped };
    }

    function parseCode(code) {
        const m = /^([A-Za-z]+)(\d+)([A-Za-z]*)$/.exec(code || '');
        return m ? { cat: m[1], num: +m[2], suf: m[3] || '' } : null;
    }
    function codeKey(code) {
        const p = parseCode(code);
        if (!p) return [999, 0, ''];
        const r = CAT_ORDER.indexOf(p.cat);
        return [r < 0 ? 900 : r, p.num, p.suf];
    }
    function cmpKey(a, b) {
        if (a[0] !== b[0]) return a[0] - b[0];
        if (a[1] !== b[1]) return a[1] - b[1];
        return a[2] < b[2] ? -1 : a[2] > b[2] ? 1 : 0;
    }

    // ---- File System Access plumbing --------------------------------------
    async function verifyPerm(h) {
        const opts = { mode: 'readwrite' };
        if ((await h.queryPermission(opts)) === 'granted') return true;
        if ((await h.requestPermission(opts)) === 'granted') return true;
        return false;
    }
    async function getHandle() {
        // Only ever reuse a handle that points at the additions file — this is
        // what stops an earlier wrong-file pick (the "lost file") from lingering.
        const named = (h) => h && h.name === TARGET_NAME;
        if (named(fileHandle) && (await verifyPerm(fileHandle))) return fileHandle;
        const stored = await idbGet('handle').catch(() => null);
        if (named(stored) && (await verifyPerm(stored))) { fileHandle = stored; return fileHandle; }
        if (!window.showOpenFilePicker) throw new Error('no-fsaccess');
        const [h] = await window.showOpenFilePicker({
            id: 'dict-additions',
            multiple: false,
            types: [{ description: 'Dictionary additions', accept: { 'text/plain': ['.txt'] } }]
        });
        if (h.name !== TARGET_NAME) throw new Error('wrong-file');
        if (!(await verifyPerm(h))) throw new Error('permission-denied');
        fileHandle = h;
        await idbSet('handle', h).catch(() => { });
        return fileHandle;
    }
    async function readFile() {
        const f = await (await getHandle()).getFile();
        return f.text();
    }
    async function writeFile(text) {
        const w = await fileHandle.createWritable();
        await w.write(text);
        await w.close();
    }

    // ---- insertion ---------------------------------------------------------
    // Find the boundary index where the trailing transliteration-only worklist
    // (and its comment block) begins; new glyphed entries must go before it.
    function worklistBoundary(lines) {
        let idx = lines.findIndex(l => l[0] === '#' && /TRANSLITERATION-ONLY/.test(l));
        if (idx < 0) return lines.length;
        while (idx > 0 && (lines[idx - 1] === '' || lines[idx - 1][0] === '#')) idx--;
        return idx;
    }

    // Decide where the new line goes. Cluster-first: if the leading glyph already
    // heads existing entries, append to that cluster (guaranteed-correct
    // neighbourhood). Otherwise fall back to the Gardiner comparator. Both stay
    // strictly inside the main body (before the worklist).
    function findInsertIndex(lines, run) {
        const boundary = worklistBoundary(lines);
        const lead = firstGlyph(run);
        const newCode = GMAP[lead];
        const newKey = newCode ? codeKey(newCode) : null;
        let lastSameLead = -1, firstGreater = -1;
        for (let i = 0; i < boundary; i++) {
            const line = lines[i];
            if (!line || line[0] === '#') continue;
            const tab = line.indexOf('\t');
            if (tab <= 0) continue;                 // empty glyph col (worklist-style) or none
            const col1 = line.slice(0, tab);
            const l = firstGlyph(col1);
            if (l === lead) { lastSameLead = i; continue; }
            if (firstGreater === -1 && newKey) {
                const c = GMAP[l];
                if (c && cmpKey(codeKey(c), newKey) > 0) firstGreater = i;
            }
        }
        if (lastSameLead >= 0) return lastSameLead + 1;   // append within the cluster
        if (firstGreater >= 0) return firstGreater;
        return boundary;                                   // end of the body
    }

    // Strip anything that would break the tab-separated column structure: a
    // stray TAB or newline pasted into a field would split or merge columns.
    // Collapse internal whitespace runs and trim.
    const cleanField = (s) => String(s || '').replace(/[\t\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();

    function buildLine({ glyphs, translit, gloss, pos, codes, credit }) {
        const col2 = `${cleanField(translit)} ${cleanField(gloss)} <i> ${cleanField(pos)} </i>`;
        const base = `${glyphs}\t${col2}\t ${cleanField(codes)}`;
        const cr = cleanField(credit);
        return cr ? `${base}\t ${cr}` : base;   // optional 4th column
    }

    // The single safety gate: returns the new full text, or throws.
    function spliceChecked(oldLines, insertAt, newLine) {
        // Format: exactly two tabs, three non-empty fields.
        const parts = newLine.split('\t');
        const okCount = parts.length === 3 || parts.length === 4;
        if (!okCount || !parts[0].trim() || !parts[1].trim() || !parts[2].trim()
            || (parts.length === 4 && !parts[3].trim()))
            throw new Error('Refusing to save: need glyphs ⇥ gloss ⇥ codes (3 fields), plus an optional non-empty 4th credit field.');
        // Glyph column must be only Egyptian-Hieroglyph code points.
        for (const ch of parts[0]) {
            const cp = ch.codePointAt(0);
            const ok = (cp >= 0x13000 && cp <= 0x1342F) || (cp >= 0x13460 && cp <= 0x143FA);
            if (!ok) throw new Error('Refusing to save: glyph column has a non-hieroglyph character.');
        }
        const next = oldLines.slice();
        next.splice(insertAt, 0, newLine);
        // Invariant: next === oldLines with exactly one line inserted at insertAt.
        if (next.length !== oldLines.length + 1)
            throw new Error('Safety check failed (length).');
        const check = next.slice();
        check.splice(insertAt, 1);
        if (check.length !== oldLines.length || check.some((l, i) => l !== oldLines[i]))
            throw new Error('Safety check failed (existing lines changed).');
        return next.join('\n');
    }

    // ---- UI ----------------------------------------------------------------
    function injectStyle() {
        if (document.getElementById('dictAuthorStyle')) return;
        const s = document.createElement('style');
        s.id = 'dictAuthorStyle';
        s.textContent = `
        #dictAuthorModal{position:fixed;inset:0;z-index:100000;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,.55)}
        #dictAuthorModal.show{display:flex}
        #dictAuthorModal .da-card{background:#2d2d2d;color:#e0e0e0;border:1px solid #3c4e60;border-radius:10px;padding:18px 20px;width:min(600px,92vw);font:15.5px system-ui,sans-serif;box-shadow:0 12px 40px rgba(0,0,0,.5)}
        #dictAuthorModal h3{margin:0 0 6px;font-size:15px;color:#1abc9c;display:flex;justify-content:space-between;align-items:baseline}
        #dictAuthorModal .da-count{font-size:11px;color:#9aa7b0;font-weight:400}
        #dictAuthorModal label{display:block;margin:10px 0 3px;font-size:13px;color:#9aa7b0}
        #dictAuthorModal input{width:100%;box-sizing:border-box;background:#1a1a1a;color:#e0e0e0;border:1px solid #3c4e60;border-radius:6px;padding:8px 10px;font-size:15.5px}
        #dictAuthorModal .da-glyphs{font-family:'Noto Sans Egyptian Hieroglyphs',serif;font-size:30px;line-height:1.3;padding:4px 2px;word-break:break-word}
        #dictAuthorModal .da-codes{font-family:ui-monospace,monospace;color:#9aa7b0;font-size:12px}
        #dictAuthorModal .da-dia{display:flex;flex-wrap:wrap;gap:4px;margin:5px 0}
        #dictAuthorModal .da-dia button{background:#1a1a1a;border:1px solid #3c4e60;color:#e0e0e0;border-radius:5px;padding:3px 8px;cursor:pointer;font-size:14px}
        #dictAuthorModal .da-dia button:hover{border-color:#1abc9c}
        #dictAuthorModal .da-preview{background:#1a1a1a;border:1px dashed #3c4e60;border-radius:6px;padding:8px;margin-top:10px;font-family:ui-monospace,monospace;font-size:11px;white-space:pre-wrap;word-break:break-word;max-height:150px;overflow:auto}
        #dictAuthorModal .da-preview .da-ctx{color:#6b7785}
        /* one colour per field — shared by the legend, the field labels and the preview */
        #dictAuthorModal .c-glyphs{color:#e7c84b}
        #dictAuthorModal .c-translit{color:#1abc9c}
        #dictAuthorModal .c-gloss{color:#d7dde2}
        #dictAuthorModal .c-pos{color:#b388e6}
        #dictAuthorModal .c-codes{color:#6fa8dc}
        #dictAuthorModal .c-credit{color:#e08fb0}
        #dictAuthorModal .c-tag{color:#6b7785}
        #dictAuthorModal label.c-glyphs,#dictAuthorModal label.c-translit,#dictAuthorModal label.c-gloss,#dictAuthorModal label.c-pos,#dictAuthorModal label.c-codes,#dictAuthorModal label.c-credit{font-weight:600;opacity:.95}
        #dictAuthorModal .da-legend{background:#1a1a1a;border:1px solid #3c4e60;border-radius:6px;padding:8px 10px;margin:4px 0 2px;font-family:ui-monospace,monospace;font-size:12px;line-height:1.7}
        #dictAuthorModal .da-legend .da-legrow{white-space:nowrap;overflow-x:auto}
        #dictAuthorModal .da-legend .lbl{font:11px system-ui,sans-serif;color:#6b7785;margin-right:6px}
        #dictAuthorModal .da-legend .sep{color:#46586b}
        #dictAuthorModal .da-warn{color:#e67e22;font-size:12px;margin-top:8px}
        #dictAuthorModal .da-row{display:flex;gap:8px;align-items:center;margin-top:14px;justify-content:flex-end}
        #dictAuthorModal .da-row label.da-dry{margin:0;display:flex;gap:5px;align-items:center;margin-right:auto;color:#9aa7b0}
        #dictAuthorModal .da-btn{background:#1abc9c;color:#0c2a25;border:0;border-radius:6px;padding:8px 16px;font-weight:600;cursor:pointer}
        #dictAuthorModal .da-btn.ghost{background:transparent;color:#9aa7b0;border:1px solid #3c4e60}
        #dictAuthorModal .da-btn:disabled{opacity:.5;cursor:not-allowed}
        `;
        document.head.appendChild(s);
    }

    function buildModal() {
        if (modal) return modal;
        injectStyle();
        modal = document.createElement('div');
        modal.id = 'dictAuthorModal';
        modal.innerHTML = `
          <div class="da-card" role="dialog" aria-modal="true">
            <h3>💾 Save to dictionary <span class="da-count"></span></h3>
            <div class="da-legend">
              <div class="da-legrow"><span class="lbl">format</span><span class="c-glyphs">glyphs</span><span class="sep"> ⇥ </span><span class="c-translit">translit</span> <span class="c-gloss">gloss</span> <span class="c-tag">&lt;i&gt;</span> <span class="c-pos">pos</span> <span class="c-tag">&lt;/i&gt;</span><span class="sep"> ⇥ </span><span class="c-codes">codes</span><span class="sep"> ⇥ </span><span class="c-credit">credit?</span></div>
              <div class="da-legrow"><span class="lbl">e.g.</span><span class="c-glyphs">𓊪𓏏𓇯</span><span class="sep"> ⇥ </span><span class="c-translit">p.t</span> <span class="c-gloss">sky</span> <span class="c-tag">&lt;i&gt;</span> <span class="c-pos">noun</span> <span class="c-tag">&lt;/i&gt;</span><span class="sep"> ⇥ </span><span class="c-codes">Q3-X1-N1</span><span class="sep"> ⇥ </span><span class="c-credit">PT §1</span></div>
            </div>
            <label class="c-glyphs">Glyphs (from canvas)</label>
            <div class="da-glyphs"></div>
            <label class="c-codes">Gardiner codes <span style="color:#6b7785">(auto — editable)</span></label>
            <input class="da-codes-in" spellcheck="false">
            <label class="c-translit">Transliteration (Leiden)</label>
            <div class="da-dia"></div>
            <input class="da-translit" spellcheck="false" placeholder="e.g. pr.t-ḫrw">
            <label class="c-gloss">Gloss (English — your own words)</label>
            <input class="da-gloss" placeholder="e.g. invocation offering">
            <label class="c-pos">Part of speech</label>
            <input class="da-pos" list="daPosList" placeholder="noun">
            <datalist id="daPosList">${POS_OPTIONS.map(p => `<option value="${p}">`).join('')}</datalist>
            <label class="c-credit">Credit / source <span style="color:#6b7785">(optional)</span></label>
            <input class="da-credit" placeholder="e.g. Pyramid Texts §1 — or whoever composed the phrase">
            <div class="da-preview"></div>
            <div class="da-warn" hidden></div>
            <div class="da-row">
              <label class="da-dry"><input type="checkbox" class="da-dryrun"> dry run (don't write)</label>
              <button class="da-btn ghost da-undo" hidden>Undo last save</button>
              <button class="da-btn ghost da-cancel">Cancel</button>
              <button class="da-btn da-save">Save entry</button>
            </div>
          </div>`;
        document.body.appendChild(modal);

        const q = (s) => modal.querySelector(s);
        const translit = q('.da-translit');

        // diacritic quick-insert
        const dia = q('.da-dia');
        [...new Set(DIACRITICS)].forEach(d => {
            const b = document.createElement('button');
            b.type = 'button'; b.textContent = d;
            b.addEventListener('click', () => {
                const i = translit.selectionStart ?? translit.value.length;
                translit.value = translit.value.slice(0, i) + d + translit.value.slice(translit.selectionEnd ?? i);
                translit.focus();
                translit.selectionStart = translit.selectionEnd = i + d.length;
                refreshPreview();
            });
            dia.appendChild(b);
        });

        ['.da-codes-in', '.da-translit', '.da-gloss', '.da-pos', '.da-credit'].forEach(sel =>
            q(sel).addEventListener('input', refreshPreview));
        q('.da-cancel').addEventListener('click', closeModal);
        q('.da-save').addEventListener('click', onSave);
        q('.da-undo').addEventListener('click', onUndo);
        modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
        document.addEventListener('keydown', (e) => {
            if (modal.classList.contains('show') && e.key === 'Escape') closeModal();
        });
        return modal;
    }

    let _ctx = null;   // { lines, glyphs }

    function refreshPreview() {
        if (!_ctx) return;
        const q = (s) => modal.querySelector(s);
        const translit = q('.da-translit').value.trim();
        const gloss = q('.da-gloss').value.trim();
        const pos = q('.da-pos').value.trim() || 'noun';
        const codes = q('.da-codes-in').value.trim();
        const credit = q('.da-credit').value.trim();
        const pre = q('.da-preview');
        const saveBtn = q('.da-save');
        if (!translit || !gloss || !codes) {
            pre.textContent = 'Fill transliteration, gloss and codes to preview…';
            saveBtn.disabled = true;
            return;
        }
        saveBtn.disabled = false;
        const at = findInsertIndex(_ctx.lines, _ctx.glyphs);
        const above = _ctx.lines[at - 1] ?? '(top of body)';
        const below = _ctx.lines[at] ?? '(end)';
        // Colour-coded assembly of the exact line that will be written, each
        // segment tinted to match its field label and the legend above.
        const e = escapeHtml;
        const coloured =
            `<span class="c-glyphs">${e(_ctx.glyphs)}</span>` +
            `<span class="sep">⇥</span>` +
            `<span class="c-translit">${e(translit)}</span> ` +
            `<span class="c-gloss">${e(gloss)}</span> ` +
            `<span class="c-tag">&lt;i&gt;</span> <span class="c-pos">${e(pos)}</span> <span class="c-tag">&lt;/i&gt;</span>` +
            `<span class="sep">⇥</span> ` +
            `<span class="c-codes">${e(codes)}</span>` +
            (credit ? `<span class="sep"> ⇥ </span><span class="c-credit">${e(credit)}</span>` : '');
        pre.innerHTML =
            `<span class="da-ctx">… ${e(trunc(above))}</span>\n` +
            `▶ ${coloured}\n` +
            `<span class="da-ctx">… ${e(trunc(below))}</span>\n\n` +
            `<span class="da-ctx">inserts at body line ${at + 1}</span>`;
    }
    const trunc = (s) => (s && s.length > 90) ? s.slice(0, 90) + '…' : (s || '');
    const escapeHtml = (s) => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

    async function openModal(run) {
        buildModal();
        const q = (s) => modal.querySelector(s);
        q('.da-glyphs').textContent = run;
        const { codes, unmapped } = gardinerFor(run);
        q('.da-codes-in').value = codes.join('-');
        q('.da-translit').value = '';
        q('.da-gloss').value = '';
        q('.da-pos').value = '';
        q('.da-credit').value = '';
        q('.da-undo').hidden = (undoText === null);
        updateCount();
        const warn = q('.da-warn');
        warn.hidden = unmapped.length === 0;
        if (unmapped.length) warn.textContent =
            `⚠ ${unmapped.length} sign(s) had no auto Gardiner code (shown as "?") — please fix the codes field by hand.`;

        // read the live file so the preview neighbours and the eventual write
        // both operate on the real on-disk content.
        q('.da-preview').textContent = 'Opening dictionary.txt…';
        modal.classList.add('show');
        try {
            const text = await readFile();
            _ctx = { lines: text.split('\n'), glyphs: run, text };
            refreshPreview();
            q('.da-translit').focus();
        } catch (e) {
            _ctx = null;
            q('.da-preview').textContent = fsError(e);
        }
    }
    function closeModal() { if (modal) modal.classList.remove('show'); _ctx = null; }

    function updateCount() {
        const el = modal.querySelector('.da-count');
        el.textContent = undoCount ? `${undoCount} added this session (unpushed)` : '';
    }

    function fsError(e) {
        if (e && e.message === 'no-fsaccess')
            return 'This browser has no File System Access API. Use Chrome/Edge/Brave for direct save.';
        if (e && (e.name === 'AbortError')) return 'File pick cancelled.';
        if (e && e.message === 'wrong-file')
            return `Please pick the file named "${TARGET_NAME}" (not the master dictionary.txt). New entries go there and are merged in later.`;
        if (e && e.message === 'permission-denied') return 'Permission to write the file was denied.';
        return 'Could not open the file: ' + (e && e.message || e);
    }

    async function onSave() {
        const q = (s) => modal.querySelector(s);
        const saveBtn = q('.da-save');
        const translit = q('.da-translit').value.trim();
        const gloss = q('.da-gloss').value.trim();
        const pos = q('.da-pos').value.trim() || 'noun';
        const codes = q('.da-codes-in').value.trim();
        const credit = q('.da-credit').value.trim();
        if (!translit || !gloss || !codes) return;

        saveBtn.disabled = true;
        try {
            // Re-read fresh to be the source of truth at write time.
            const text = await readFile();
            const oldLines = text.split('\n');
            const newLine = buildLine({ glyphs: _ctx.glyphs, translit, gloss, pos, codes, credit });

            // dedup warning (non-blocking, but ask)
            if (oldLines.includes(newLine)) {
                if (!confirm('An identical line already exists. Add it anyway?')) { saveBtn.disabled = false; return; }
            }
            const at = findInsertIndex(oldLines, _ctx.glyphs);
            const newText = spliceChecked(oldLines, at, newLine);   // throws if unsafe

            if (q('.da-dryrun').checked) {
                alert(`DRY RUN — would insert at body line ${at + 1}:\n\n${newLine}\n\n(nothing written)`);
                saveBtn.disabled = false;
                return;
            }

            undoText = text;                 // remember pre-save state
            lastAddedLine = newLine;
            await writeFile(newText);

            // Keep search + decoder live without a reload by appending just the
            // new line. processedDictionary holds master + additions, so we must
            // NOT replace it with the additions file alone (that drops the master).
            if (typeof processedDictionary !== 'undefined' && Array.isArray(processedDictionary)) {
                processedDictionary.push(newLine);
            }
            undoCount++;
            closeModal();
            flash(`✓ Added at body line ${at + 1} — ${undoCount} this session`);
        } catch (e) {
            const warn = q('.da-warn');
            warn.hidden = false;
            warn.textContent = '⚠ ' + (e && e.message || e);
            saveBtn.disabled = false;
        }
    }

    async function onUndo() {
        if (undoText === null) return;
        if (!confirm('Restore the dictionary to before the last save?')) return;
        try {
            await writeFile(undoText);
            // Remove just the line we appended on the last save (don't rebuild the
            // array, which would drop the master dictionary from memory).
            if (lastAddedLine && typeof processedDictionary !== 'undefined' && Array.isArray(processedDictionary)) {
                const i = processedDictionary.lastIndexOf(lastAddedLine);
                if (i !== -1) processedDictionary.splice(i, 1);
            }
            lastAddedLine = null;
            undoText = null;
            undoCount = Math.max(0, undoCount - 1);
            closeModal();
            flash('↩ Reverted last save');
        } catch (e) {
            alert('Undo failed: ' + (e && e.message || e));
        }
    }

    function flash(msg) {
        const d = document.createElement('div');
        d.textContent = msg;
        d.style.cssText = 'position:fixed;left:50%;bottom:28px;transform:translateX(-50%);background:#1abc9c;color:#0c2a25;padding:9px 16px;border-radius:8px;font:600 13px system-ui;z-index:100001;box-shadow:0 6px 20px rgba(0,0,0,.4)';
        document.body.appendChild(d);
        setTimeout(() => d.remove(), 2600);
    }

    // ---- entry point (called from the canvas context menu) -----------------
    async function startSave(objs) {
        if (!GMAP) { alert('Gardiner map still loading — try again in a moment.'); return; }
        if (typeof compositionGlyphRun !== 'function') { alert('Editor not ready.'); return; }
        const { run } = compositionGlyphRun(objs);
        if (!run) { alert('No glyphs to save. Select some signs on the canvas first.'); return; }
        openModal(run);
    }
    window.dictAuthorStart = startSave;

    // ---- init --------------------------------------------------------------
    function init() {
        // reveal the (otherwise hidden) context-menu item
        const btn = document.getElementById('ctxDictAdd');
        if (btn) btn.hidden = false;
        const hr = document.getElementById('ctxDictAddHr');
        if (hr) hr.hidden = false;
        // load the map (localhost only, so it never ships to the public site)
        fetch('gardiner-map.json')
            .then(r => r.ok ? r.json() : Promise.reject(r.status))
            .then(m => { GMAP = m; })
            .catch(e => console.warn('[dict-author] could not load gardiner-map.json:', e));
    }
    if (document.readyState === 'loading')
        document.addEventListener('DOMContentLoaded', init);
    else init();
})();
