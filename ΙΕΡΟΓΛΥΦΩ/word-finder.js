// word-finder.js — local, dictionary-grounded "what does this glyph run mean?"
//
// The reliable, free, offline core of the "What does this say?" feature. Given a
// run of hieroglyphs the user transcribed, it compares the run against every
// dictionary entry and ranks results by how *close* each entry is to what was
// typed — not just substring noise. Four relationships, best-first:
//
//   1. exact     — the run IS a dictionary word.
//   2. contains  — words that CONTAIN the run (your cluster is part of a bigger
//                  word); ranked by least extra glyphs first. This is the case
//                  the old prototype missed: 𓌕𓂡𓀀 lives inside 𓊃𓈖𓈖𓏭𓌕𓂡𓀀
//                  (snny, "Warrior"), which is longer than the query.
//   3. inside    — known multi-glyph words found INSIDE the run; for segmenting a
//                  long, space-less passage. Longest-first, then left-to-right.
//   4. single    — single-glyph readings; many and noisy, so kept separate/last.
//
// No network call and no AI: it reuses the same dictionary the search box already
// loads (the global `processedDictionary` array of raw lines, populated by
// dictionary-search.js from the user's uploaded / IndexedDB-cached file). An
// optional `lines` argument lets the standalone harness page feed its own copy.
//
// Dictionary line format (tab-separated):
//     <glyphs>\t<transliteration + English gloss [<i>pos</i>]>\t<gardiner codes>
// e.g.  𓀀𓆑\tit father <i>noun</i>\tA1-I9

// Parsed-entry cache, keyed by the lines-array identity so we parse the 46k-line
// dictionary at most once per uploaded file rather than on every lookup.
let _wfParsedFor = null;
let _wfParsedEntries = null;

function wfParseDictionary(lines) {
    if (_wfParsedFor === lines && _wfParsedEntries) return _wfParsedEntries;

    const entries = [];
    for (const line of lines) {
        if (!line || line[0] === '#') continue;      // skip header/comment lines
        const tab = line.indexOf('\t');
        if (tab === -1) continue;

        const glyphs = line.slice(0, tab).trim();
        if (!glyphs) continue;

        const rest = line.slice(tab + 1);
        const tab2 = rest.indexOf('\t');
        const gloss = (tab2 === -1 ? rest : rest.slice(0, tab2)).trim();
        const gardiner = tab2 === -1 ? '' : rest.slice(tab2 + 1).trim();

        // Length in codepoints (hieroglyphs are astral, so .length would
        // double-count surrogate pairs and break length-based ranking).
        entries.push({ glyphs, gloss, gardiner, len: Array.from(glyphs).length });
    }

    _wfParsedEntries = entries;
    _wfParsedFor = lines;
    return entries;
}

// codepoint index of a UTF-16 offset within `s`
function _cpIndex(s, utf16idx) {
    return Array.from(s.slice(0, utf16idx)).length;
}

// Compare `run` against the whole dictionary and bucket results by relationship.
// Returns:
//   { query, runCps, exact:[], contains:[], inside:[], single:[] }   or
//   { error: 'no-dictionary' }
// Each match carries { glyphs, gloss, gardiner, len }; `contains` also carries
// `extra` (how many more glyphs the word has than the query); `exact`/`inside`/
// `single` also carry codepoint offsets `start`/`end` (end exclusive).
function findWordsInRun(run, lines) {
    lines = lines || (typeof processedDictionary !== 'undefined' ? processedDictionary : null);
    if (!lines) return { error: 'no-dictionary' };

    const entries = wfParseDictionary(lines);
    const runCps = Array.from(run);
    const rLen = runCps.length;

    const exact = [], contains = [], inside = [], single = [];
    if (!rLen) return { query: run, runCps, exact, contains, inside, single };

    for (const e of entries) {
        const g = e.glyphs;

        if (g === run) {                                   // 1. exact
            exact.push({ ...e, start: 0, end: rLen });
            continue;
        }
        if (g.includes(run)) {                             // 2. word contains the run
            contains.push({ ...e, extra: e.len - rLen });
            continue;
        }
        if (run.includes(g)) {                             // 3/4. run contains the word
            const bucket = e.len === 1 ? single : inside;
            let from = 0, idx;
            while ((idx = run.indexOf(g, from)) !== -1) {
                const start = _cpIndex(run, idx);
                bucket.push({ ...e, start, end: start + e.len });
                from = idx + g.length;
            }
        }
    }

    // Closeness-based ordering within each bucket.
    contains.sort((a, b) => a.extra - b.extra);            // fewest extra glyphs first
    inside.sort((a, b) => b.len - a.len || a.start - b.start);  // longest, then L→R
    single.sort((a, b) => a.start - b.start);

    return { query: run, runCps, exact, contains, inside, single };
}

// Which codepoint positions of the run are explained by a whole-word reading:
// an exact match, a word that contains the run (fragment fully accounted for),
// or a multi-glyph word sitting inside the run. Lets the segmentation view flag
// glyphs that no known word covers. Single-glyph readings don't count.
function wfCoverage(result) {
    const covered = new Set();
    const all = i => { for (let k = 0; k < result.runCps.length; k++) covered.add(k); };
    if (result.exact.length || result.contains.length) all();
    for (const m of result.inside) for (let i = m.start; i < m.end; i++) covered.add(i);
    return covered;
}

// =============================================================================
// Editor integration — the "What does this say?" button
// =============================================================================
// Reads the current composition (the active selection, or the whole canvas if
// nothing is selected), linearises it into a reading-order glyph run, and shows
// the dictionary-grounded readings in the existing results panel. Reuses the
// layout engine's ordering (mdcSplitRows / mdcWidestGap from glyph-input.js) so
// stacked cadrats come out in the same order MdC export uses. Inert outside the
// editor — the harness page and Node never call these.

const WF_CAP = 40;   // max rows shown per section before a "+N more" note

// Keep only Egyptian Hieroglyphs (U+13000–U+1342F) so transliteration /
// translation rows and any stray latin in a text object contribute nothing.
function _wfHieros(str) {
    let out = '';
    for (const ch of (str || '')) {
        const cp = ch.codePointAt(0);
        if (cp >= 0x13000 && cp <= 0x1342F) out += ch;
    }
    return out;
}

function _wfIsGlyphObj(o) {
    return o && !o._pageGuide && (o.type === 'text' || o.type === 'i-text') && _wfHieros(o.text).length > 0;
}

// Reading order within a set of sign-boxes: mirror mdcFromBoxes' recursion but
// emit the glyphs themselves instead of MdC codes.
function _wfRunFromBoxes(boxes, avgW, avgH) {
    if (boxes.length === 1) return _wfHieros(boxes[0].obj.text);
    const xGap = mdcWidestGap(boxes, 'x');
    const yGap = mdcWidestGap(boxes, 'y');
    const axis = (xGap.gap >= yGap.gap) ? 'x' : 'y';
    const cut = axis === 'x' ? xGap : yGap;
    if (cut.gap < -(axis === 'x' ? avgW : avgH) * 0.5) {
        return [...boxes].sort((a, b) => (a.top - b.top) || (a.left - b.left))
            .map(b => _wfHieros(b.obj.text)).join('');
    }
    const center = axis === 'x' ? b => b.left + b.width / 2 : b => b.top + b.height / 2;
    const first = boxes.filter(b => center(b) < cut.pos);
    const second = boxes.filter(b => center(b) >= cut.pos);
    return _wfRunFromBoxes(first, avgW, avgH) + _wfRunFromBoxes(second, avgW, avgH);
}

// The glyph run to identify. With an explicit `objs` list (e.g. the right-clicked
// sign), read those; otherwise the active selection, else the whole canvas.
// Returns { run, scope: 'selection' | 'canvas' | 'none' }.
function compositionGlyphRun(objs) {
    if (typeof canvas === 'undefined' || !canvas) return { run: '', scope: 'none' };
    let src, scope;
    if (objs && objs.length) {
        src = objs.filter(_wfIsGlyphObj);
        scope = 'selection';
    } else {
        const sel = canvas.getActiveObjects().filter(_wfIsGlyphObj);
        src = sel.length ? sel : canvas.getObjects().filter(_wfIsGlyphObj);
        scope = sel.length ? 'selection' : 'canvas';
    }
    if (!src.length) return { run: '', scope: 'none' };

    const boxes = src.map(o => {
        o.setCoords();
        const r = o.getBoundingRect(true);   // canvas-plane box, zoom-independent
        return { obj: o, left: r.left, top: r.top, width: r.width, height: r.height };
    });
    const avgH = boxes.reduce((s, b) => s + b.height, 0) / boxes.length;
    const avgW = boxes.reduce((s, b) => s + b.width, 0) / boxes.length;

    const run = (typeof mdcSplitRows === 'function')
        ? mdcSplitRows(boxes, avgH).reduce((acc, row) => acc + _wfRunFromBoxes(row, avgW, avgH), '')
        : [...boxes].sort((a, b) => (a.top - b.top) || (a.left - b.left)).map(b => _wfHieros(b.obj.text)).join('');
    return { run, scope };
}

function _wfEsc(s) { return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
// The gloss already carries <i>…</i> from the source; keep only that tag.
function _wfGloss(s) { return _wfEsc(s).replace(/&lt;i&gt;/g, '<em>').replace(/&lt;\/i&gt;/g, '</em>'); }

function _wfEntryRows(list) {
    const rows = list.slice(0, WF_CAP).map(m =>
        `<div class="wf-entry"><span class="large-text" title="Click to add these signs to the canvas">${m.glyphs}</span>` +
        `<span class="wf-gloss">${_wfGloss(m.gloss)}` +
        (m.gardiner ? ` <span class="wf-gard">${_wfEsc(m.gardiner)}</span>` : '') +
        `</span></div>`).join('');
    const more = list.length > WF_CAP ? `<div class="wf-more">+${list.length - WF_CAP} more…</div>` : '';
    return rows + more;
}

function _wfSection(title, list) {
    return list.length ? `<div class="wf-section-title">${title} · ${list.length}</div>${_wfEntryRows(list)}` : '';
}

function renderIdentifyResults(out, run, scope, res) {
    const scopeLabel = scope === 'selection' ? 'selection' : 'whole canvas';
    const total = res.exact.length + res.contains.length + res.inside.length + res.single.length;

    let html = `<div class="result-header"><span class="wf-run">${run}</span><br>` +
        (total
            ? `${total} reading${total === 1 ? '' : 's'} from the dictionary (${scopeLabel})`
            : `No known words in this run (${scopeLabel})`) +
        `</div><div class="result-matches">`;

    html += _wfSection('Exact — the run is this word', res.exact);
    html += _wfSection('Words containing these glyphs — closest first', res.contains);
    html += _wfSection('Known words inside this run — longest first', res.inside);
    if (res.single.length) {
        html += `<details class="wf-single"><summary>Single-glyph readings · ${res.single.length}</summary>${_wfEntryRows(res.single)}</details>`;
    }
    html += `</div>`;
    out.innerHTML = html;
}

function identifySelection(objs) {
    const out = document.getElementById('resultDisplay');
    if (!out) return;
    if (typeof processedDictionary === 'undefined' || !processedDictionary) {
        out.innerHTML = '<div class="result-header">Dictionary is still loading — try again in a moment.</div>';
        return;
    }
    const { run, scope } = compositionGlyphRun(objs);
    if (!run) {
        out.innerHTML = '<div class="result-header">Nothing to read yet. First put some signs on the canvas — ' +
            'click them from the palette, type them, or drag them in from a search result — then click this button. ' +
            'Select just a few signs first to read only those.</div>';
        return;
    }
    renderIdentifyResults(out, run, scope, findWordsInRun(run));
}

// Expose for both the editor (global scope, like the rest of the app) and the
// harness page / future module use.
if (typeof window !== 'undefined') {
    window.findWordsInRun = findWordsInRun;
    window.wfCoverage = wfCoverage;
    window.identifySelection = identifySelection;
    window.compositionGlyphRun = compositionGlyphRun;
}
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { findWordsInRun, wfCoverage, wfParseDictionary };
}
