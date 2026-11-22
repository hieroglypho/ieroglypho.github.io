/* ΙΕΡΟΓΛΥΦΩ course — quick search. Loaded on first use by course.js
 * (HQ.openSearch), and only when search is switched on (HQ.searchEnabled).
 *
 * Searches three things:
 *   words and forms  the review cards of every class: transliteration (Allen
 *                    letters, ASCII MdC like sDm.f, or plain sdm f), meaning,
 *                    note, Gardiner codes (G17) and pasted hieroglyphs
 *   topics           section and sub-section titles of every class
 *   classes          titles and summaries from classes.js (also the ones to come)
 *
 * Index files (tools/build-search.mjs):
 *   search/free.json      Classes 1..FREE. Public, deployed with the free classes.
 *   search/members.json   the members' classes. Never public: in a local preview it
 *                         is read directly; on the site it comes from the course
 *                         Worker at /course/api/search, for members only.        */
(function () {
'use strict';
const H = window.HQ;
if (!H || H.searchUI) return;
const el = H.el;

/* ---------------------------------------------------------- the index -- */
let INDEX = null;
function loadIndex() {
    if (INDEX) return INDEX;
    const get = (url, opts) => fetch(url, opts).then(r => r.ok ? r.json() : null).catch(() => null);
    const parts = [get(H.courseUrl('search/free.json'), { cache: 'no-cache' })];
    if (H.PREVIEW) parts.push(get(H.courseUrl('search/members.json'), { cache: 'no-cache' }));
    else if (H.MEMBERS_OPEN) parts.push(get('/course/api/search', { credentials: 'same-origin', cache: 'no-cache' }));
    INDEX = Promise.all(parts).then(list => {
        const items = list.filter(Boolean).flatMap(x => x.items || []);
        items.forEach(prep);
        return items;
    });
    return INDEX;
}

/* --------------------------------------------------------- normalising -- */
// Plain letters: diacritics off, ꜣ ꜥ -> a, j -> i, no separators. "sḏm.f" -> "sdmf".
const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[ꜣꜥꜢꜤ]/g, 'a').toLowerCase().replace(/j/g, 'i').replace(/[^a-z0-9]+/g, '');
// Words of an English text, diacritics off.
const words = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[“”‘’"«»]/g, ' ').split(/[^a-z0-9ꜣꜥ]+/).filter(Boolean);
const GARDINER = /^([A-Za-z]{1,2})(\d{1,3})([A-Za-z]?)$/;
const normCode = (q) => { const m = q.match(GARDINER); if (!m) return null;
    const a = m[1].length === 2 ? m[1][0].toUpperCase() + m[1][1].toLowerCase() : m[1].toUpperCase();
    return a + m[2] + m[3].toLowerCase(); };
const HIERO = /[\u{13000}-\u{1345F}]/u;
const codes = (m) => String(m || '').split(/[-:*^\s()[\]]+/).map(t => t.replace(/^\[.*$/, '')).filter(Boolean);

function prep(it) {
    it._tr = it.tr ? H.normKey(it.tr) : '';
    it._trf = it.tr ? fold(it.tr) : '';
    it._g = words(it.g);
    it._t = words(it.t);
    it._d = words([it.d, it.n, it.p].filter(Boolean).join(' '));
    it._codes = it.m ? codes(it.m) : [];
    it._glyphs = it.m ? H.glyphs(it.m) : '';
}

/* ------------------------------------------------------------ scoring -- */
// Every query word must start a word of the text (prefix match); a whole-word match counts more.
function wordScore(qw, ws) {
    if (!qw.length || !ws.length) return 0;
    let s = 0;
    for (const q of qw) {
        if (ws.includes(q)) s += 2;
        else if (ws.some(w => w.startsWith(q))) s += 1;
        else return 0;
    }
    return s / (2 * qw.length);                   // 0..1
}
function score(it, q) {
    let best = 0;
    if (q.glyphs && it._glyphs.includes(q.glyphs)) best = Math.max(best, it._glyphs === q.glyphs ? 100 : 80);
    if (q.code && it._codes.includes(q.code)) best = Math.max(best, it._codes.length === 1 ? 95 : 75);
    if (it._tr && q.tr) {
        if (it._tr === q.tr || it._tr === q.key) best = Math.max(best, 100);
        else if (it._tr.startsWith(q.tr) || it._tr.startsWith(q.key)) best = Math.max(best, 70);
    }
    if (it._trf && q.fold.length >= 2) {
        if (it._trf === q.fold) best = Math.max(best, 90);
        else if (it._trf.startsWith(q.fold)) best = Math.max(best, 60);
        else if (q.fold.length >= 3 && it._trf.includes(q.fold)) best = Math.max(best, q.fold.length >= 4 ? 55 : 35);
    }
    // A query that looks like a transliteration (sḏm.f, sDm.f) is mainly matched as one:
    // English matches then count for less, so "jw sḏm.f" beats a gloss that mentions sḏm.n.f.
    const w = q.translit ? 0.5 : 1;
    const g = wordScore(q.words, it._g), t = wordScore(q.words, it._t), d = wordScore(q.words, it._d);
    if (g) best = Math.max(best, w * (50 + 35 * g));
    if (t) best = Math.max(best, w * (45 + 35 * t));
    if (d) best = Math.max(best, w * (20 + 20 * d));
    return best;
}
function parseQuery(raw) {
    const s = raw.trim();
    const glyphs = HIERO.test(s) ? [...s].filter(ch => HIERO.test(ch)).join('') : '';
    // Transliteration-like: Allen letters, an MdC capital inside a word (sDm), or a dotted suffix (.f, .n).
    const translit = !glyphs && !normCode(s) && (/[ꜣꜥḥḫẖšṯḏ]/.test(s) || /[a-z][ADHSTX]|[ADHSTX][a-z]*\./.test(s) || /\w\.[a-z]{1,3}\b/.test(s));
    return { raw: s, glyphs, code: normCode(s), tr: H.normTr(s), key: H.normKey(s), fold: fold(s), words: words(s), translit };
}

/* Results, grouped: words (cards), topics (sections), classes (catalogue). */
async function search(raw) {
    const q = parseQuery(raw);
    if (!q.raw) return null;
    const items = await loadIndex();
    const cls = new Map(H.classes().map(c => [c.no, c]));
    const ranked = items.map(it => ({ it, s: score(it, q) })).filter(x => x.s > 0)
        .sort((a, b) => b.s - a.s || a.it.c - b.it.c);
    const seen = new Set();
    const pick = (k, n) => ranked.filter(x => x.it.k === k).filter(x => {
        const key = k + '|' + x.it.c + '|' + (x.it.tr || '') + '|' + (x.it.g || x.it.t);
        if (seen.has(key)) return false; seen.add(key); return true;
    }).slice(0, n).map(x => ({ ...x.it, cls: cls.get(x.it.c) }));
    const classes = [...cls.values()].map(c => ({ c, s: Math.max(wordScore(q.words, words(c.title)) * 2, wordScore(q.words, words(c.blurb)), String(c.no) === q.raw ? 2 : 0) }))
        .filter(x => x.s > 0).sort((a, b) => b.s - a.s || a.c.no - b.c.no).slice(0, 5).map(x => x.c);
    return { q, words: pick('w', 10), topics: pick('t', 8), classes };
}

/* -------------------------------------------------------------- the UI -- */
const esc = (s) => String(s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function mark(text, q) {
    const ws = q.words.filter(w => w.length > 1).map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const html = esc(text);
    if (!ws.length) return html;
    return html.replace(new RegExp('\\b(' + ws.join('|') + ')', 'gi'), '<mark class="sr-m">$1</mark>');
}
const linkOf = (c, s) => !c ? '#' : c.open ? c.url + (s ? '#' + s : '') : c.url;
const where = (c, sec) => c ? `Class ${c.no}${sec ? ' · ' + esc(sec) : ''}${c.open ? '' : ' · <span class="sr-lock">🔒 members</span>'}` : '';

let dlg, input, out, hint, timer, sel = -1;
function build() {
    dlg = el('dialog', { class: 'search-dlg', 'aria-label': 'Search the course' });
    input = el('input', { type: 'search', placeholder: 'Search words, forms, topics, signs…', 'aria-label': 'Search the course', autocomplete: 'off', spellcheck: 'false' });
    const form = el('form', { method: 'dialog', onsubmit: (e) => { e.preventDefault(); go(); } },
        input, el('button', { class: 'btn ghost', type: 'button', onclick: () => dlg.close(), 'aria-label': 'Close search' }, 'Esc'));
    hint = el('p', { class: 'search-hint', html: 'Try <span class="tr">sḏm.f</span> (or <code>sDm.f</code>), “may he live”, <i>dual</i>, <i>offering</i>, or a sign code like <code>G17</code>.' });
    out = el('ul', { class: 'search-res', role: 'listbox' });
    dlg.append(form, hint, out);
    document.body.append(dlg);
    input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(run, 90); });
    input.addEventListener('keydown', (e) => {
        const links = [...out.querySelectorAll('a')];
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            if (!links.length) return;
            sel = e.key === 'ArrowDown' ? (sel + 1) % links.length : (sel <= 0 ? links.length - 1 : sel - 1);
            links.forEach((a, i) => a.classList.toggle('sel', i === sel));
            links[sel].scrollIntoView({ block: 'nearest' });
        }
    });
    dlg.addEventListener('click', (e) => {
        if (e.target === dlg) dlg.close();                // the backdrop
        if (e.target.closest('a')) setTimeout(() => dlg.close(), 0);
    });
}
function go() {
    const links = [...out.querySelectorAll('a')];
    const a = links[Math.max(0, sel)];
    if (a) { location.href = a.href; dlg.close(); }
}
let runId = 0;
async function run() {
    const id = ++runId;
    const res = await search(input.value);
    if (id !== runId) return;
    out.textContent = ''; sel = -1;
    hint.hidden = !!res;
    if (!res) return;
    const { q } = res;
    if (!res.words.length && !res.topics.length && !res.classes.length) {
        out.append(el('li', {}, el('p', { class: 'search-empty' }, 'Nothing found. Try a shorter word, or the English meaning.')));
        return;
    }
    if (res.words.length) {
        out.append(el('li', { class: 'search-grp' }, 'Words and forms'));
        res.words.forEach(w => out.append(el('li', {}, el('a', { href: linkOf(w.cls, w.s) },
            el('span', { class: 'sr-g' }, H.hg(w.m)),
            el('span', { class: 'sr-t', html: `<span class="tr">${esc(w.tr)}</span> · ${mark(w.g, q)}` }),
            el('span', { class: 'sr-d', html: where(w.cls, w.p) })))));
    }
    if (res.topics.length) {
        out.append(el('li', { class: 'search-grp' }, 'Topics'));
        res.topics.forEach(t => out.append(el('li', {}, el('a', { href: linkOf(t.cls, t.s), style: 'grid-template-columns:1fr' },
            el('span', { class: 'sr-t', html: mark(t.t, q) }),
            el('span', { class: 'sr-d', html: where(t.cls, t.p) + (t.d ? ' — ' + mark(t.d, q) : '') })))));
    }
    if (res.classes.length) {
        out.append(el('li', { class: 'search-grp' }, 'Classes'));
        res.classes.forEach(c => {
            const body = [el('span', { class: 'sr-t', html: `${c.no} · ${c.title}` + (c.built ? '' : ' <span class="sr-lock">· coming soon</span>') + (c.built && !c.open ? ' <span class="sr-lock">· 🔒 members</span>' : '') }),
                c.blurb ? el('span', { class: 'sr-d', html: mark(c.blurb, q) }) : null];
            out.append(el('li', {}, c.built ? el('a', { href: c.url, style: 'grid-template-columns:1fr' }, body)
                : el('div', { class: 'search-empty', style: 'display:grid;padding:8px 10px' }, body)));
        });
    }
}
function open(q) {
    if (!dlg) build();
    loadIndex();
    if (!dlg.open) dlg.showModal();
    if (q != null) input.value = q;
    input.focus(); input.select();
    run();
    H.track && H.track('search');
}

H.searchUI = { open, search, loadIndex, parseQuery };
})();
