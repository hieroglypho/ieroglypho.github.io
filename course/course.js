/* ΙΕΡΟΓΛΥΦΩ course engine — shared by every class page.
 *
 * Plain classic script, no build step (same convention as the main site).
 * Needs signs.js (window.HQ_SIGNS: Gardiner code -> Unicode) loaded first.
 *
 *   HQ.render(root)            draw every [data-m] element (MdC -> hieroglyphs)
 *   HQ.initClass(id, title)    progress bar, TOC ticks, completion banner
 *   HQ.quiz / classify / sprint / direction / order / decipher / rebus /
 *   HQ.flashcards / mission / nameCartouche / match / transcribe / spell /
 *   HQ.worked / compose        — activity engines
 *
 * Every activity calls HQ.done(activityId) when the learner meets its bar.
 * All persistence is localStorage, wrapped so a blocked store never breaks
 * the page (private windows etc.) — progress just isn't remembered then.
 */
(function () {
'use strict';

const EDITOR_URL = 'https://www.hieroglyphica.org/ΙΕΡΟΓΛΥΦΩ/';
const SIGNS = window.HQ_SIGNS || {};
const CFG = window.HQ_CONFIG || {};
// Course root (folder holding course.js), so shared assets resolve from any page depth.
const COURSE_ROOT = new URL('.', (document.currentScript && document.currentScript.src) || location.href);

/* ------------------------------------------------------------ storage -- */
const store = {
    get(key, fallback) {
        try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
        catch (_) { return fallback; }
    },
    set(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch (_) { /* ignore */ } }
};

/* ------------------------------------------------------------ helpers -- */
const $ = (sel, root = document) => root.querySelector(sel);
const el = (tag, attrs = {}, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
        if (k === 'class') n.className = v;
        else if (k === 'html') n.innerHTML = v;
        else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
        else if (v !== false && v != null) n.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) if (kid != null) n.append(kid.nodeType ? kid : document.createTextNode(kid));
    return n;
};
const shuffle = (arr) => { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const sample = (arr, n) => shuffle(arr).slice(0, n);

/* Gardiner code or raw glyph -> glyph. Unknown codes are returned as-is. */
function glyph(token) { return SIGNS[token] || token; }

/* "Q3-X1:V4" -> "𓊪𓏏𓍯" (flat Unicode, for copying / dragging / prompts). */
function glyphs(mdc) {
    return tokenize(mdc).filter(t => t.type === 'sign').map(t => t.v).join('');
}

/* ------------------------------------------------- Allen transliteration -- *
 * Learners type plain ASCII (Manuel de Codage letters, as in the editor and
 * dictionary) and see James P. Allen's European system: ꜣ j y ꜥ w b p f m n r
 * h ḥ ḫ ẖ z s š q k g t ṯ d ḏ.  Allen writes the reed-leaf as plain j.     */
const MDC_TO_ALLEN = { A: 'ꜣ', i: 'j', a: 'ꜥ', H: 'ḥ', x: 'ḫ', X: 'ẖ', S: 'š', T: 'ṯ', D: 'ḏ', q: 'q', Q: 'q', K: 'q' };
function allen(s) {
    return String(s).replace(/[AiaHxXSTDQK]/g, c => MDC_TO_ALLEN[c] || c)
        .replace(/[ỉꞽꞌi̯]/g, 'j');
}
/* Normalise for comparing answers: Allen form, lower-case, no separators. */
function normTr(s) {
    return allen(String(s).trim()).toLowerCase().replace(/[\s.\-=()‹›⸗]/g, '').replace(/i/g, 'j');
}
/* An answer key already written in Allen's letters (Sbk, Jnpw): compare as is,
 * without the MdC conversion (where capital S would mean š).               */
function normKey(s) { return String(s).trim().toLowerCase().replace(/[\s.\-=()‹›⸗]/g, ''); }
/* Does typed input match an Allen answer key? When the key is a name (it
 * starts with a capital: Sbk, Snfrw), a capital first letter typed by the
 * learner is also accepted as the plain letter, except A and X, whose
 * lower-case forms are different letters (ꜥ, ḫ). For ordinary words the
 * capital keeps its code meaning, so "Hrw" (ḥrw) is not taken for hrw.  */
function trMatches(input, key) {
    const k = normKey(key), v = String(input).trim();
    const isName = /^\p{Lu}/u.test(String(key).trim());
    return normTr(v) === k || (isName && /^[B-WYZ]/.test(v) && normTr(v[0].toLowerCase() + v.slice(1)) === k);
}

/* --------------------------------------------------------- MdC render -- *
 * A deliberately small Manuel de Codage subset, enough for teaching:
 *   -  next group     :  stack (top over bottom)     *  side by side
 *   ^  insert: A^B draws B small inside A, by default in A's top-start corner
 *      (U1^D4: the eye in the sickle's crook, as in mꜣꜣ). A position may follow
 *      in brackets: ^[ts] ^[bs] ^[te] ^[be] ^[t] ^[b] ^[m] (top/bottom, start/end,
 *      middle; start = the side the text begins on, so it mirrors in rtl).
 *   ( ) grouping      tokens are Gardiner codes (A1, Aa1, M17) or raw glyphs. */
function tokenize(src) {
    const out = [];
    let i = 0;
    const s = String(src);
    while (i < s.length) {
        const c = s[i];
        if (/\s/.test(c)) { i++; continue; }
        if (c === '^') {
            const pos = /^\^\[(ts|bs|te|be|t|b|m)\]/.exec(s.slice(i));
            out.push({ type: 'op', v: '^', pos: pos ? pos[1] : 'ts' }); i += pos ? pos[0].length : 1; continue;
        }
        if ('-:*()'.includes(c)) { out.push({ type: 'op', v: c }); i++; continue; }
        const m = /^[A-Za-z]{1,2}\d{1,3}[A-Za-z]?/.exec(s.slice(i));
        if (m && SIGNS[m[0]]) { out.push({ type: 'sign', v: SIGNS[m[0]], code: m[0] }); i += m[0].length; continue; }
        const cp = s.codePointAt(i);
        const ch = String.fromCodePoint(cp);
        out.push({ type: 'sign', v: ch, code: ch });
        i += ch.length;
    }
    return out;
}
function parse(tokens) {
    let p = 0;
    const peek = () => tokens[p];
    const isOp = (v) => peek() && peek().type === 'op' && peek().v === v;
    function atom() {
        if (isOp('(')) { p++; const inner = stack(); if (isOp(')')) p++; return inner; }
        const t = tokens[p++];
        return t ? { k: 'g', v: t.v } : { k: 'g', v: '' };
    }
    function ins() {
        const base = atom();
        if (!isOp('^')) return base;
        const pos = peek().pos; p++;
        return { k: 'ins', base, inner: atom(), pos };
    }
    function row() { const kids = [ins()]; while (isOp('*')) { p++; kids.push(ins()); } return kids.length === 1 ? kids[0] : { k: 'row', kids }; }
    function stack() { const kids = [row()]; while (isOp(':')) { p++; kids.push(row()); } return kids.length === 1 ? kids[0] : { k: 'stack', kids }; }
    const groups = [];
    while (p < tokens.length) {
        if (isOp('-')) { p++; continue; }
        const before = p;
        groups.push(stack());
        if (p === before) p++;               // never loop on a stray operator
    }
    return groups;
}
function build(node, scale) {
    if (node.k === 'g') {
        const n = el('span', { class: 'g' }, node.v);
        if (scale !== 1) n.style.fontSize = scale + 'em';
        return n;
    }
    if (node.k === 'ins') {
        const box = el('span', { class: 'ins' }, build(node.base, 1),
            el('span', { class: 'ins-in at-' + node.pos }, build(node.inner, 1)));
        if (scale !== 1) box.style.fontSize = scale + 'em';
        return box;
    }
    const box = el('span', { class: node.k === 'stack' ? 'stack' : 'row' });
    const n = node.kids.length;
    const childScale = node.k === 'stack' ? (n === 2 ? 0.55 : 0.4) : (n === 2 ? 0.72 : 0.55);
    node.kids.forEach(k => box.append(build(k, k.k === 'g' || k.k === 'ins' ? childScale : 1)));
    if (scale !== 1) box.style.fontSize = scale + 'em';
    return box;
}
/* Render one element: data-m="MdC", optional data-dir="rtl", data-cart. */
function renderOne(host) {
    if (host._mdc === host.dataset.m) return;        // already drawn (e.g. by hg()); keep any styling games added
    host._mdc = host.dataset.m;
    const groups = parse(tokenize(host.dataset.m));
    const wrap = el('span', { class: 'hg' + (host.dataset.dir === 'rtl' ? ' rtl' : '') });
    groups.forEach(g => wrap.append(el('span', { class: 'cad' }, build(g, 1))));
    wrap.setAttribute('aria-hidden', 'true');
    host.textContent = '';
    if (host.hasAttribute('data-cart')) {
        const c = el('span', { class: 'cartouche' + (host.dataset.dir === 'rtl' ? ' rtl' : '') }, wrap);
        host.append(c);
    } else host.append(wrap);
    if (host.dataset.label) host.setAttribute('aria-label', host.dataset.label);
    host.setAttribute('role', 'img');
}
function render(root = document) { root.querySelectorAll('[data-m]').forEach(renderOne); }
/* Build a hieroglyph element in JS. */
function hg(mdc, opts = {}) {
    const n = el('span', { 'data-m': mdc, class: opts.cls || '', 'data-dir': opts.dir || false, 'data-cart': opts.cart || false, 'data-label': opts.label || false });
    renderOne(n);
    return n;
}

/* ----------------------------------------------------------- progress -- */
let CLASS_ID = null;
const registered = new Set();
function progressKey() { return 'hq-progress-' + CLASS_ID; }
function doneSet() { return new Set(store.get(progressKey(), [])); }
function done(activityId) {
    if (!CLASS_ID) return;
    const s = doneSet();
    if (!s.has(activityId)) { s.add(activityId); store.set(progressKey(), [...s]); track('done', { a: activityId }); }
    refreshProgress();
}
function register(activityId, card) { registered.add(activityId); card.dataset.activity = activityId; }
function refreshProgress() {
    const s = doneSet();
    const total = registered.size || 1;
    const n = [...registered].filter(a => s.has(a)).length;
    const pct = Math.round(100 * n / total);
    const bar = $('.progress-bar > i'); if (bar) bar.style.width = pct + '%';
    const lab = $('.progress-inner .pct'); if (lab) lab.innerHTML = `${n} / ${registered.size}<span class="pct-w"> activities</span>`;
    document.querySelectorAll('.activity[data-activity]').forEach(card => {
        const ok = s.has(card.dataset.activity);
        card.classList.toggle('complete', ok);
        const st = $('.status', card); if (st) st.textContent = ok ? '✓ complete' : 'not done yet';
    });
    document.querySelectorAll('.toc li[data-step]').forEach(li => {
        const sec = document.getElementById(li.dataset.step);
        const acts = sec ? [...sec.querySelectorAll('.activity[data-activity]')] : [];
        li.classList.toggle('done', acts.length > 0 && acts.every(a => s.has(a.dataset.activity)));
    });
    const summary = store.get('hq-classes', {});
    summary[CLASS_ID] = { done: n, total: registered.size };
    store.set('hq-classes', summary);
    const fin = $('#finish'); if (fin) fin.hidden = n < registered.size;
    refreshParts(s);
}

/* ---------------------------------------------------- parts + resume -- *
 * initClass(id, { parts: { at: 's8', minutes: [35, 45] } }) splits a long
 * class in two: Part 1 "Learn it" (warm-up, concepts, worked examples) and
 * Part 2 "Use it" (from section `at` to the exit check). The outline shows
 * the two parts, and a banner before Part 2 says it is a good place to stop.
 * Every class also gets a "Continue" button at the top once some, but not
 * all, of its activities are done: it jumps to the first section with
 * something left to do. Neither is read aloud.                              */
let PARTS = null;
const stepSections = () => [...document.querySelectorAll('main section.step[id^="s"]')].filter(x => /^s\d+$/.test(x.id));
const sectionTitle = (sec) => { const h = sec.querySelector(':scope > h2'); if (!h) return sec.id; const c = h.cloneNode(true); c.querySelectorAll('.num, .listen, button').forEach(x => x.remove()); return c.textContent.trim(); };
const sectionActs = (sec) => [...sec.querySelectorAll('.activity[data-activity]')].map(a => a.dataset.activity);
function initParts(opts) {
    const main = $('main');
    if (main && !$('#resume')) {
        const start = $('#start');
        const box = el('div', { id: 'resume', class: 'callout resume no-tts', hidden: true });
        if (start) start.prepend(box); else main.prepend(box);
    }
    if (!opts || !opts.at) return;
    const secs = stepSections();
    const at = secs.findIndex(x => x.id === opts.at);
    if (at < 1) return;
    PARTS = { at: opts.at, minutes: opts.minutes || [], one: secs.slice(0, at), two: secs.slice(at) };
    const label = (k) => `<b>Part ${k}</b> · ${k === 1 ? 'Learn it' : 'Use it'}` + (PARTS.minutes[k - 1] ? ` · about ${PARTS.minutes[k - 1]} min` : '');
    // outline: two lists under their own headings
    const ol = $('.toc ol');
    if (ol) {
        const lis = [...ol.children];
        const cut = lis.findIndex(li => li.dataset.step === opts.at);
        if (cut > 0) {
            const second = el('ol', { start: String(cut + 1) });
            lis.slice(cut).forEach(li => second.append(li));
            const wrap = el('div', { class: 'toc-parts' });
            ol.replaceWith(wrap);
            wrap.append(el('div', { class: 'toc-part' }, el('div', { class: 'toc-part-h', html: label(1) }), ol),
                        el('div', { class: 'toc-part' }, el('div', { class: 'toc-part-h', html: label(2) }), second));
        }
    }
    // the break before Part 2
    const two = PARTS.two[0];
    const titles = PARTS.two.map(sectionTitle).map(t => t.replace(/^\d+\s*/, ''));
    const END = /^(Review deck|Exit check|Capstone check)$/i;
    const rest = titles.filter(t => !END.test(t));
    const ends = titles.filter(t => END.test(t)).map(t => 'the ' + t.toLowerCase());
    const brk = el('div', { class: 'part-break no-tts', id: 'part-2' },
        el('div', { class: 'part-break-h' }, 'End of Part 1: a good place to stop'),
        el('p', { class: 'part-break-status' }),
        el('p', { html: 'Your progress is saved in this browser. When you come back, the <b>Continue</b> button at the top of the class brings you straight here.' }),
        el('p', { class: 'part-break-next', html: label(2) + ': ' + rest.join(' · ') + (ends.length ? ', then ' + ends.join(' and ') : '') + '.' }));
    two.before(brk);
}
function refreshParts(s) {
    const box = $('#resume');
    if (box) {
        const secs = stepSections();
        const anyDone = secs.some(sec => sectionActs(sec).some(a => s.has(a)));
        const next = secs.find(sec => sectionActs(sec).some(a => !s.has(a)));
        box.hidden = !(anyDone && next);
        if (anyDone && next) {
            const inTwo = PARTS && PARTS.two.includes(next);
            const target = inTwo && next === PARTS.two[0] ? '#part-2' : '#' + next.id;
            box.innerHTML = '';
            box.append(el('b', {}, 'Welcome back. '), (inTwo ? 'Part 1 is behind you. ' : ''),
                el('a', { class: 'btn', href: target }, `▶ Continue: ${inTwo && next === PARTS.two[0] ? 'Part 2, ' : ''}${sectionTitle(next).replace(/^\d+\s*/, '')}`));
        }
    }
    const st = $('.part-break-status');
    if (st && PARTS) {
        const acts = PARTS.one.flatMap(sectionActs);
        const n = acts.filter(a => s.has(a)).length;
        st.innerHTML = n === acts.length ? `✓ Part 1 complete: all ${n} activities done.`
            : `Part 1: <b>${n} of ${acts.length}</b> activities done. You can go on anyway, or go back for the ones you skipped (they show “not done yet”).`;
    }
}
/* ---------------------------------------------------------- catalogue -- *
 * classes.js (window.HQ_CLASSES) lists every class. A class is "open" (linked)
 * when it is built and the learner can reach it at this address: free classes
 * always; members' classes once HQ_CONFIG.membersOpen is true, or in a local
 * preview. A built members' class that is not open links to the members' page. */
const CAT = window.HQ_CLASSES || { FREE: 5, TOTAL: 30, MODULES: {}, LIST: [] };
const PREVIEW = location.protocol === 'file:' || /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
const MEMBERS_OPEN = !!CFG.membersOpen;
const classIdOf = (no) => 'class-' + String(no).padStart(2, '0');
const courseUrl = (path) => new URL(path, COURSE_ROOT).href;
function classes() {
    const summary = store.get('hq-classes', {});
    return CAT.LIST.map(([mod, no, title, blurb, folder]) => {
        const id = classIdOf(no), s = summary[id], free = no <= CAT.FREE;
        const open = !!folder && (free || MEMBERS_OPEN || PREVIEW);
        return { mod, no, id, title, blurb, folder, free, built: !!folder, open,
            url: open ? courseUrl(folder) : folder ? courseUrl('members/') : null,
            done: s ? s.done : 0, total: s ? s.total : 0,
            pct: s && s.total ? Math.round(100 * s.done / s.total) : 0 };
    });
}
/* Short status for lists: ✓ / 40% / 🔒 / soon. */
function classStatus(c) {
    if (!c.built) return 'soon';
    if (!c.open) return '🔒';
    return c.pct === 100 ? '✓' : c.pct ? c.pct + '%' : '';
}
/* Review cards due now across every class met so far (same rule as the decks). */
function dueCount() {
    const reg = store.get('hq-srs-cards', {});
    return srsDue(Object.keys(reg).map(id => ({ id }))).length;
}

/* The class bar: the sticky progress bar of a class page also carries
 * ← previous · "Class N of 30" menu (every class, the course home, the
 * review deck) · next →, and the search button when search is on.          */
function classBar() {
    const inner = $('.progress-wrap .progress-inner');
    if (!inner || $('.cb', inner)) return;
    const list = classes();
    const i = list.findIndex(c => c.id === CLASS_ID);
    if (i < 0) return;
    const cur = list[i];
    const step = (c, dir) => {
        const cls = 'cb-step' + (dir < 0 ? ' cb-prev' : ' cb-next');
        if (!c) return el('span', { class: cls + ' cb-off', 'aria-hidden': 'true' }, dir < 0 ? '←' : '→');
        const txt = dir < 0 ? `← ${c.no}` : `${c.no} →`;
        if (!c.built) return el('span', { class: cls + ' cb-off', title: `Class ${c.no}: ${c.title} (coming soon)` }, txt);
        return el('a', { class: cls, href: c.url, rel: dir < 0 ? 'prev' : 'next',
            title: `${dir < 0 ? 'Previous' : 'Next'}: Class ${c.no}, ${c.title}${c.open ? '' : ' (members)'}`,
            'aria-label': `${dir < 0 ? 'Previous' : 'Next'} class: Class ${c.no}, ${c.title}` }, c.open ? txt : txt.replace(String(c.no), c.no + ' 🔒'));
    };
    const pop = el('div', { class: 'cb-pop' });
    const due = dueCount();
    pop.append(el('div', { class: 'cb-top' },
        el('a', { href: courseUrl('./') }, '⌂ Course home'),
        el('a', { href: courseUrl('review/') }, '🗂 Review deck' + (due ? ` · ${due} due` : ''))));
    for (const [mod, name] of Object.entries(CAT.MODULES)) {
        const rows = list.filter(c => c.mod === mod);
        if (!rows.length) continue;
        pop.append(el('div', { class: 'cb-mod' }, name),
            el('ol', { class: 'cb-list' }, rows.map(c => {
                const st = classStatus(c);
                const label = [el('span', { class: 'cb-no' }, c.no), el('span', { class: 'cb-t', html: c.title }), st ? el('span', { class: 'cb-st' + (st === '✓' ? ' ok' : '') }, st) : null];
                const here = c.id === CLASS_ID;
                return el('li', { class: (here ? 'here' : '') + (c.open ? '' : ' locked') },
                    c.built && !here ? el('a', { href: c.url, title: c.open ? null : 'Members only' }, label)
                        : el('span', { 'aria-current': here ? 'page' : null }, label));
            })));
    }
    const menu = el('details', { class: 'cb-menu' },
        el('summary', { title: 'All classes' }, el('span', { class: 'cb-long' }, `Class ${cur.no} of ${CAT.TOTAL}`), el('span', { class: 'cb-short' }, `Class ${cur.no}`)), pop);
    const close = () => { menu.open = false; };
    document.addEventListener('click', e => { if (menu.open && !menu.contains(e.target)) close(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && menu.open) { close(); menu.querySelector('summary').focus(); } });
    menu.addEventListener('toggle', () => {
        if (!menu.open) return;
        // phones: the list spans the screen, just under the bar (wherever the bar is now)
        const narrow = innerWidth <= 600, r = menu.getBoundingClientRect();
        // open downwards, or upwards when the bar is low on the screen and there is more room above
        const below = innerHeight - r.bottom - 18, above = r.top - 18, up = below < 300 && above > below;
        const room = Math.max(160, Math.min(560, up ? above : below));
        pop.style.maxHeight = room + 'px';
        pop.style.top = narrow ? (up ? Math.max(12, r.top - 6 - Math.min(room, pop.scrollHeight)) : r.bottom + 6) + 'px' : (up ? 'auto' : '');
        pop.style.bottom = !narrow && up ? 'calc(100% + 6px)' : '';
        // wider screens: hang the list under the button, shifted to stay inside the window
        pop.style.left = '';
        if (!narrow) {
            const p = pop.getBoundingClientRect();
            const dx = Math.max(12 - p.left, Math.min(0, innerWidth - 12 - p.right));
            pop.style.left = dx + 'px';
        }
        // show the current class in the middle of the list (scrolls the list, never the page)
        const h = $('li.here', pop);
        if (h) pop.scrollTop = Math.max(0, h.offsetTop - pop.clientHeight / 2 + h.offsetHeight / 2);
    });
    const nav = el('nav', { class: 'cb', 'aria-label': 'Classes' }, step(list[i - 1], -1), menu, step(list[i + 1], 1));
    inner.prepend(nav);
    const lab = inner.querySelector(':scope > span:not(.pct)');
    if (lab && /progress/i.test(lab.textContent)) lab.classList.add('cb-label');
    searchButton(inner);
}

/* A small # after each section heading copies a link to that section
 * (handy for asking about it on Discord). Headings are not read aloud.      */
function sectionLinks() {
    document.querySelectorAll('main section.step[id] > h2').forEach(h => {
        if ($('.sec-link', h)) return;
        const id = h.parentElement.id;
        h.append(el('button', { class: 'sec-link', type: 'button', title: 'Copy a link to this section', 'aria-label': 'Copy a link to this section',
            onclick: (e) => {
                const b = e.currentTarget, url = location.origin + location.pathname + '#' + id;
                try { history.replaceState(null, '', '#' + id); } catch (_) { /* file:// */ }
                const ok = () => { b.classList.add('copied'); b.textContent = '✓ link copied'; setTimeout(() => { b.classList.remove('copied'); b.textContent = '#'; }, 1400); };
                if (navigator.clipboard) navigator.clipboard.writeText(url).then(ok, () => prompt('Copy this link:', url));
                else prompt('Copy this link:', url);
            } }, '#'));
    });
}

/* The finish banner's main button, when it has data-next: "Continue to
 * Class N" once the next class is built and open here, otherwise "Back to
 * the course". So a new class needs no edit to the previous one.            */
function finishNext() {
    const a = $('#finish a[data-next]');
    if (!a) return;
    const list = classes(), i = list.findIndex(c => c.id === CLASS_ID);
    const next = i >= 0 ? list[i + 1] : null;
    if (next && next.open) { a.href = next.url; a.textContent = `Continue to Class ${next.no} →`; }
    else { a.href = courseUrl('./'); a.textContent = 'Back to the course →'; }
}

/* ------------------------------------------------------------- search -- *
 * Quick search over every class (words, forms, topics, signs): search.js +
 * the index files in search/ (tools/build-search.mjs). Built but not shown
 * yet: it appears only with HQ_CONFIG.search = true, or in a local preview
 * after opening any course page with ?search (?search=0 turns it off).
 * search.js is loaded on first use, so pages without search never load it. */
function searchEnabled() {
    if (CFG.search === true) return true;
    if (!PREVIEW) return false;
    const m = location.search.match(/[?&]search(=([01]))?(&|$)/);
    if (m) { try { m[2] === '0' ? sessionStorage.removeItem('hq-dev-search') : sessionStorage.setItem('hq-dev-search', '1'); } catch (_) { /* ignore */ } }
    try { return sessionStorage.getItem('hq-dev-search') === '1'; } catch (_) { return false; }
}
let searchLoading = null;
function openSearch(q) {
    if (window.HQ && HQ.searchUI) return HQ.searchUI.open(q);
    searchLoading = searchLoading || new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = courseUrl('search.js'); s.onload = res; s.onerror = rej;
        document.head.append(s);
    });
    searchLoading.then(() => HQ.searchUI.open(q), () => { searchLoading = null; });
}
let searchKeys = false;
function searchButton(host) {
    if (!searchEnabled() || !host || $('.search-btn', host)) return;
    host.append(el('button', { class: 'btn ghost search-btn', type: 'button', title: 'Search the course ( / )', 'aria-label': 'Search the course',
        onclick: () => openSearch() }, '🔍', el('span', { class: 'search-btn-t' }, ' Search')));
    if (searchKeys) return;
    searchKeys = true;
    document.addEventListener('keydown', e => {
        if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
        if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable) return;
        e.preventDefault(); openSearch();
    });
}

/* Pages that are not classes (course home, review deck) call this instead of
 * initClass: drawing, Discord boxes, the counter, and the search button.    */
let PAGE_ID = null;
function initPage(id, opts = {}) {
    PAGE_ID = id;
    render();
    community();
    if (opts.searchHost) searchButton(opts.searchHost);
    track('open');
}

/* opts.ttsMaxEgyptian: leave paragraphs with more Egyptian words than this
 * out of the read-aloud (see egyptianWords below).                          */
function initClass(id, opts = {}) {
    CLASS_ID = id;
    TTS_MAX_EG = opts.ttsMaxEgyptian ?? null;
    render();
    initParts(opts.parts);
    refreshProgress();
    classBar();
    sectionLinks();
    finishNext();
    community();
    readAloud();
    track('open');
}

/* Shared card chrome for every activity. */
function card(host, { id, tag, tagClass, title, how }) {
    host.classList.add('activity');
    const head = el('header', {}, el('span', { class: 'tag ' + (tagClass || '') }, tag), el('h3', {}, title), el('span', { class: 'status' }, ''));
    host.prepend(head);
    if (how) head.after(el('p', { class: 'how', html: how }));
    const body = el('div', { class: 'body' });
    host.append(body);
    register(id, host);
    return body;
}
function feedback(ok, html) { return el('div', { class: 'feedback show ' + (ok ? 'ok' : 'no'), html }); }

/* ------------------------------------------------------------- quiz -- *
 * questions: [{ q: html, m?: MdC prompt, dir?, choices: [html], a: index, why: html }]
 * opts.pass: fraction needed (default .8). Order of questions + choices shuffled. */
function quiz(host, questions, opts) {
    const body = card(host, opts);
    const pass = opts.pass ?? 0.8;
    function start() {
        const qs = (opts.keepOrder ? questions.slice() : shuffle(questions)).slice(0, opts.count || questions.length);
        let i = 0, score = 0;
        function show() {
            body.textContent = '';
            if (i >= qs.length) return finish();
            const q = qs[i];
            body.append(el('div', { class: 'qcount' }, `Question ${i + 1} of ${qs.length}`));
            if (q.m) body.append(el('div', { class: 'papyrus', style: 'margin-bottom:10px' }, hg(q.m, { cls: 'hg-big', dir: q.dir, cart: q.cart })));
            body.append(el('p', { html: '<b>' + q.q + '</b>' }));
            const grid = el('div', { class: 'choice-grid' });
            const order = shuffle(q.choices.map((c, idx) => ({ c, idx })));
            order.forEach(({ c, idx }) => {
                const b = el('button', { class: 'choice', html: c, onclick: () => {
                    const ok = idx === q.a;
                    if (ok) score++;
                    grid.querySelectorAll('button').forEach(x => x.disabled = true);
                    b.classList.add(ok ? 'right' : 'wrong');
                    if (!ok) grid.querySelectorAll('button').forEach(x => { if (+x.dataset.idx === q.a) x.classList.add('right'); });
                    body.append(feedback(ok, (ok ? '✓ ' : '✗ ') + (q.why || '')));
                    body.append(el('div', { class: 'row-btns' }, el('button', { class: 'btn', onclick: () => { i++; show(); } }, i + 1 < qs.length ? 'Next →' : 'See score')));
                } });
                b.dataset.idx = idx;
                grid.append(b);
            });
            body.append(grid);
        }
        function finish() {
            const ok = score / qs.length >= pass;
            if (ok) done(opts.id);
            const best = store.get('hq-best-' + opts.id, 0);
            if (score > best) store.set('hq-best-' + opts.id, score);
            body.append(el('p', { html: `<b>${score} / ${qs.length}</b> — ${ok ? 'passed. Well read.' : `you need ${Math.ceil(pass * qs.length)} to pass. Mistakes are where the learning happens: go again.`}` }));
            body.append(el('div', { class: 'row-btns' }, el('button', { class: 'btn ghost', onclick: start }, '↻ Retake (new order)')));
        }
        show();
    }
    start();
}

/* --------------------------------------------------------- classify -- *
 * Sort items into bins, one at a time. items: [{ m, hl: index of highlighted
 * group (or an array of indexes), tr, gloss, a: bin index, why }]. Highlighted
 * signs shown in gold.
 * Without hl the whole word is the question: then give opts.ask (the prompt)
 * and, when the caption would give the answer away, opts.show: 'gloss' (no
 * transliteration until the feedback) or 'none'.                              */
function classify(host, items, opts) {
    const body = card(host, opts);
    function start() {
        const list = shuffle(items);
        let i = 0, score = 0;
        function show() {
            body.textContent = '';
            if (i >= list.length) {
                const ok = score / list.length >= (opts.pass ?? 0.8);
                if (ok) done(opts.id);
                body.append(el('p', { html: `<b>${score} / ${list.length}</b> sorted correctly. ${ok ? 'Sharp eyes.' : 'Try again — the explanations are the lesson.'}` }));
                body.append(el('div', { class: 'row-btns' }, el('button', { class: 'btn ghost', onclick: start }, '↻ Play again')));
                return;
            }
            const it = list[i];
            body.append(el('div', { class: 'qcount' }, `Item ${i + 1} of ${list.length} · score ${score}`));
            const word = hg(it.m, { cls: 'hg-big' });
            const cads = word.querySelectorAll('.cad');
            if (it.hl != null) {
                const gold = [].concat(it.hl);
                cads.forEach((c, k) => { if (gold.includes(k)) c.style.color = 'var(--gold)'; else c.style.opacity = '.55'; });
            }
            const caption = opts.show === 'none' ? null
                : el('div', { html: opts.show === 'gloss' ? `“${it.gloss}”` : `<span class="tr">${it.tr}</span> “${it.gloss}”` });
            body.append(el('div', { class: 'papyrus' }, word, caption));
            body.append(el('p', { html: opts.ask || `What job is the <b style="color:var(--gold)">gold sign</b> doing here?` }));
            const bins = el('div', { class: 'bins' });
            opts.bins.forEach((label, idx) => bins.append(el('button', { class: 'choice', html: label, onclick: (e) => {
                const ok = idx === it.a; if (ok) score++;
                bins.querySelectorAll('button').forEach(b => b.disabled = true);
                e.currentTarget.classList.add(ok ? 'right' : 'wrong');
                if (!ok) bins.children[it.a].classList.add('right');
                body.append(feedback(ok, (ok ? '✓ ' : '✗ ') + it.why));
                body.append(el('div', { class: 'row-btns' }, el('button', { class: 'btn', onclick: () => { i++; show(); } }, 'Next →')));
            } })));
            body.append(bins);
        }
        show();
    }
    start();
}

/* ----------------------------------------------------------- sprint -- *
 * Timed sign-recognition: glyph -> pick its reading from 4. Personal best is
 * kept. deck: [{ m, tr, name }]; opts.seconds, opts.target (score to pass).  */
function sprint(host, deck, opts) {
    const body = card(host, opts);
    const secs = opts.seconds || 60;
    const bestKey = 'hq-best-' + opts.id;
    const byName = opts.answer === 'name';           // answer with the meaning (deck item .name), not the reading
    function lobby(msg) {
        body.textContent = '';
        const best = store.get(bestKey, 0);
        if (msg) body.append(msg);
        body.append(el('div', { class: 'scoreline' }, el('span', { html: `Personal best: <b>${best}</b>` }), el('span', { html: `Target: <b>${opts.target}</b>` }), el('span', { html: `Time: <b>${secs}s</b>` })));
        body.append(el('div', { class: 'row-btns' }, el('button', { class: 'btn', onclick: play }, best ? '▶ Beat your best' : '▶ Start')));
    }
    function play() {
        let score = 0, streak = 0, left = secs, last = null;
        const misses = [];
        body.textContent = '';
        const timer = el('div', { class: 'timer' }, el('i'));
        const line = el('div', { class: 'scoreline' });
        const stage = el('div');
        body.append(timer, line, stage);
        const tick = setInterval(() => {
            left -= 0.25;
            timer.firstChild.style.width = Math.max(0, 100 * left / secs) + '%';
            if (left <= 0) { clearInterval(tick); end(); }
        }, 250);
        function upd() { line.innerHTML = `<span>Score <b>${score}</b></span><span>Streak <b>${streak}</b>${streak >= 5 ? ' 🔥' : ''}</span>`; }
        function next() {
            upd();
            let card;
            do { card = deck[Math.floor(Math.random() * deck.length)]; } while (deck.length > 1 && card === last);
            last = card;
            const ans = (d) => byName ? d.name : d.tr;
            const seen = new Set([ans(card)]), others = [];   // never two buttons with the same answer
            for (const d of shuffle(deck)) { if (others.length === 3) break; if (!seen.has(ans(d))) { seen.add(ans(d)); others.push(d); } }
            const opts4 = shuffle([card, ...others]);
            stage.textContent = '';
            stage.append(el('div', { class: 'prompt-glyph' }, hg(card.m)));
            const grid = el('div', { class: 'choice-grid' });
            opts4.forEach(o => grid.append(el('button', { class: 'choice', style: 'text-align:center;font-size:' + (byName ? '16px' : '20px'), html: byName ? o.name : `<span class="tr">${o.tr}</span>`, onclick: (e) => {
                if (left <= 0) return;
                const ok = ans(o) === ans(card);
                if (ok) { score += streak >= 5 ? 2 : 1; streak++; }
                else { streak = 0; misses.push(card); }
                e.currentTarget.classList.add(ok ? 'right' : 'wrong');
                grid.querySelectorAll('button').forEach(b => b.disabled = true);
                setTimeout(next, ok ? 220 : 700);
            } })));
            stage.append(grid);
        }
        function end() {
            const best = store.get(bestKey, 0);
            const isBest = score > best;
            if (isBest) store.set(bestKey, score);
            if (score >= opts.target) done(opts.id);
            const uniq = [...new Set(misses)];
            const msg = el('div', {},
                el('p', { html: `<b>Time!</b> Score <b>${score}</b>${isBest ? ' — new personal best 🏆' : ''}. ${score >= opts.target ? 'Target reached.' : `Target is ${opts.target}.`}` }),
                uniq.length ? el('p', { class: 'lead', html: 'Review these: ' + uniq.map(c => `<span class="gl">${glyphs(c.m)}</span> <span class="tr">${c.tr}</span>` + (byName ? ` ${c.name}` : '')).join(' · ') }) : null);
            lobby(msg);
        }
        next();
    }
    lobby();
}

/* -------------------------------------------------------- direction -- *
 * "Where do you start?" Groups shown facing left or right at random.        */
function direction(host, groups, opts) {
    const body = card(host, opts);
    const secs = opts.seconds || 40;
    const bestKey = 'hq-best-' + opts.id;
    function lobby(msg) {
        body.textContent = '';
        if (msg) body.append(msg);
        body.append(el('div', { class: 'scoreline' }, el('span', { html: `Personal best: <b>${store.get(bestKey, 0)}</b>` }), el('span', { html: `Target: <b>${opts.target}</b>` }), el('span', { html: `Keys: <b>←</b> / <b>→</b>` })));
        body.append(el('div', { class: 'row-btns' }, el('button', { class: 'btn', onclick: play }, '▶ Start')));
    }
    function play() {
        let score = 0, wrong = 0, left = secs, cur = null, lock = false;
        body.textContent = '';
        const timer = el('div', { class: 'timer' }, el('i'));
        const line = el('div', { class: 'scoreline' });
        const stage = el('div', { class: 'papyrus', style: 'min-height:120px;display:flex;align-items:center;justify-content:center' });
        const L = el('button', { class: 'btn', onclick: () => answer('ltr') }, '← start at the LEFT');
        const R = el('button', { class: 'btn', onclick: () => answer('rtl') }, 'start at the RIGHT →');
        body.append(timer, line, stage, el('div', { class: 'row-btns', style: 'justify-content:center' }, L, R));
        const key = (e) => { if (e.key === 'ArrowLeft') { e.preventDefault(); answer('ltr'); } if (e.key === 'ArrowRight') { e.preventDefault(); answer('rtl'); } };
        document.addEventListener('keydown', key);
        const tick = setInterval(() => { left -= .25; timer.firstChild.style.width = Math.max(0, 100 * left / secs) + '%'; if (left <= 0) end(); }, 250);
        function next() {
            line.innerHTML = `<span>Correct <b>${score}</b></span><span>Wrong <b>${wrong}</b></span>`;
            const g = groups[Math.floor(Math.random() * groups.length)];
            const dir = Math.random() < .5 ? 'ltr' : 'rtl';
            cur = dir; lock = false;
            stage.textContent = '';
            stage.style.background = '';
            stage.append(hg(g, { cls: 'hg-big', dir }));
        }
        function answer(d) {
            if (lock || left <= 0) return;
            lock = true;
            const ok = d === cur;
            ok ? score++ : wrong++;
            stage.style.background = ok ? 'var(--ok-bg)' : 'var(--bad-bg)';
            setTimeout(next, ok ? 180 : 650);
        }
        function end() {
            clearInterval(tick);
            document.removeEventListener('keydown', key);
            const net = score - wrong;
            const isBest = net > store.get(bestKey, 0);
            if (isBest) store.set(bestKey, net);
            if (net >= opts.target) done(opts.id);
            lobby(el('p', { html: `<b>Time!</b> ${score} right, ${wrong} wrong → net <b>${net}</b>${isBest ? ' — new personal best 🏆' : ''}. ${net >= opts.target ? 'Target reached.' : `Target is ${opts.target} (wrong answers cost a point — no guessing!).`}` }));
        }
        next();
    }
    lobby();
}

/* ------------------------------------------------------------ order -- *
 * Tap the signs of a group in reading order. puzzles: [{ m, dir?, order:[codes], tr, gloss }] */
function order(host, puzzles, opts) {
    const body = card(host, opts);
    let i = 0, clean = 0;
    function show() {
        body.textContent = '';
        if (i >= puzzles.length) {
            done(opts.id);
            body.append(el('p', { html: opts.unit ? `All ${puzzles.length} done, <b>${clean}</b> without a slip.` : `All ${puzzles.length} groups read — <b>${clean}</b> without a slip.` }));
            body.append(el('div', { class: 'row-btns' }, el('button', { class: 'btn ghost', onclick: () => { i = 0; clean = 0; show(); } }, '↻ Again')));
            return;
        }
        const pz = puzzles[i];
        let step = 0, slip = false;
        body.append(el('div', { class: 'qcount' }, `${opts.unit || 'Group'} ${i + 1} of ${puzzles.length}`));
        if (pz.m) body.append(el('div', { class: 'papyrus' }, hg(pz.m, { cls: 'hg-big', dir: pz.dir, cart: pz.cart })));
        body.append(el('p', { html: pz.prompt || 'Tap the signs in the order you would <b>read</b> them:' }));
        const pool = el('div', { class: 'order-pool' + (pz.labels ? ' order-labels' : '') });
        const msg = el('div');
        const items = pz.labels || pz.order;              // labels: html shown on the buttons, listed in the right order
        shuffle(items.map((c, k) => ({ c, k }))).forEach(({ c, k }) => {
            const b = el('button', { onclick: () => {
                if (k === step) {
                    step++; b.disabled = true; b.append(el('span', { class: 'n' }, step));
                    if (step === items.length) {
                        if (!slip) clean++;
                        msg.replaceChildren(feedback(true, pz.ok || `✓ <span class="tr">${pz.tr}</span> “${pz.gloss}”. ${pz.why || ''}`),
                            el('div', { class: 'row-btns' }, el('button', { class: 'btn', onclick: () => { i++; show(); } }, 'Next →')));
                    }
                } else {
                    slip = true;
                    b.animate([{ transform: 'translateX(-4px)' }, { transform: 'translateX(4px)' }, { transform: 'none' }], { duration: 200 });
                    msg.replaceChildren(feedback(false, pz.hint || 'Not yet — top before bottom, and start from the side the signs face.'));
                }
            } }, pz.labels ? el('span', { html: c }) : glyph(c));
            if (pz.dir === 'rtl') b.style.transform = 'scaleX(-1)';
            pool.append(b);
        });
        body.append(pool, msg);
    }
    show();
}

/* --------------------------------------------------------- decipher -- *
 * The Champollion game. Stages: [{ title, intro, greek, signs: [{ m, a, fixed? }],
 * tiles: [..decoys..], outro }]. Values the learner proved in an earlier stage
 * pre-fill wherever the same sign recurs (that is the "aha").                 */
function decipher(host, stages, opts) {
    const body = card(host, opts);
    const known = {};                      // sign mdc -> value, earned so far
    let si = 0;
    function show() {
        body.textContent = '';
        if (si >= stages.length) {
            done(opts.id);
            body.append(el('div', { class: 'feedback show ok', html: opts.finale }));
            body.append(el('div', { class: 'row-btns' }, el('button', { class: 'btn ghost', onclick: () => { si = 0; Object.keys(known).forEach(k => delete known[k]); show(); } }, '↻ Replay the decipherment')));
            return;
        }
        const st = stages[si];
        body.append(el('div', { class: 'qcount' }, `Case ${si + 1} of ${stages.length}: ${st.title}`));
        body.append(el('p', { html: st.intro }));
        if (st.greek) body.append(el('p', { class: 'greek', html: st.greek }));
        const nameRow = el('div', { class: 'decipher-name' });
        const slots = st.signs.map(s => {
            const pre = s.fixed || known[s.m];
            const btn = el('button', { class: 'val' + (pre ? ' locked' : ''), disabled: !!pre }, pre || '?');
            const slot = el('div', { class: 'slot' }, el('div', { class: 'sg' }, hg(s.m)), btn);
            const o = { s, btn, slot, value: pre || null, locked: !!pre };
            btn.addEventListener('click', () => pick(o));
            nameRow.append(slot);
            return o;
        });
        body.append(el('div', { class: 'papyrus' }, nameRow));
        const prefilled = slots.filter(o => o.locked && !o.s.fixed).length;
        if (prefilled) body.append(el('p', { class: 'lead', html: `⚡ <b>${prefilled}</b> sign${prefilled > 1 ? 's' : ''} filled in automatically — you already cracked ${prefilled > 1 ? 'them' : 'it'} in an earlier case.` }));
        let active = null;
        function pick(o) {
            slots.forEach(x => x.slot.classList.remove('picking'));
            if (active === o) { active = null; return; }
            active = o; o.slot.classList.add('picking');
        }
        const needed = slots.filter(o => !o.locked).map(o => o.s.a);
        const tiles = el('div', { class: 'tiles' });
        shuffle([...needed, ...(st.tiles || [])]).forEach(t => tiles.append(el('button', { class: 'tile', onclick: () => {
            const target = active || slots.find(o => !o.locked && !o.value);
            if (!target || target.locked) return;
            target.value = t; target.btn.textContent = t; target.btn.className = 'val filled';
            target.slot.classList.remove('picking'); active = null;
        } }, t)));
        body.append(el('p', { class: 'how', html: 'Tap a tile to fill the next empty slot (or tap a slot first to choose it). Tap again to overwrite.' }), tiles);
        const msg = el('div');
        body.append(el('div', { class: 'row-btns' },
            el('button', { class: 'btn', onclick: check }, 'Check my reading'),
            el('button', { class: 'btn ghost', onclick: () => msg.replaceChildren(feedback(false, '💡 ' + st.hint)) }, 'Hint')), msg);
        function check() {
            let wrong = 0, empty = 0;
            slots.forEach(o => {
                if (o.locked) return;
                if (!o.value) { empty++; return; }
                if (o.value === o.s.a) { o.locked = true; o.btn.className = 'val locked'; o.btn.disabled = true; }
                else { wrong++; o.btn.className = 'val wrong'; }
            });
            if (!wrong && !empty) {
                st.signs.forEach(s => { if (!s.fixed && !s.noLearn) known[s.m] = s.a; });
                msg.replaceChildren(feedback(true, st.outro), el('div', { class: 'row-btns' }, el('button', { class: 'btn', onclick: () => { si++; show(); } }, si + 1 < stages.length ? 'Next case →' : 'Close the file →')));
            } else {
                msg.replaceChildren(feedback(false, wrong ? `${wrong} sign${wrong > 1 ? 's' : ''} marked red don't fit. The correct ones are now locked in — rethink the rest.` : `${empty} slot${empty > 1 ? 's' : ''} still empty.`));
            }
        }
    }
    show();
}

/* ------------------------------------------------------------ rebus -- */
function rebus(host, items, opts) {
    const body = card(host, opts);
    let solved = 0;
    const list = el('div', { style: 'display:grid;gap:10px' });
    items.forEach(it => {
        const inp = el('input', { class: 'txt', placeholder: 'your answer', 'aria-label': 'Answer for ' + it.pic });
        const out = el('span', { class: 'lead', style: 'font-size:14px' });
        let ok = false;
        const tryIt = () => {
            if (ok) return;
            const v = inp.value.trim().toLowerCase().replace(/[^a-z ]/g, '');
            if (it.a.some(a => a === v)) { ok = true; solved++; inp.disabled = true; inp.style.borderColor = 'var(--ok)'; out.innerHTML = '✓ ' + it.why; if (solved === items.length) done(opts.id); }
            else if (v) out.textContent = opts.nudge || 'Say it out loud. Sound, not meaning.';
        };
        inp.addEventListener('keydown', e => { if (e.key === 'Enter') tryIt(); });
        list.append(el('div', { style: 'display:flex;gap:10px;align-items:center;flex-wrap:wrap' },
            el('span', { style: 'font-size:34px;min-width:110px' }, it.pic), inp, el('button', { class: 'btn ghost', onclick: tryIt }, 'Check'), out));
    });
    body.append(list);
}

/* ------------------------------------------------------- flashcards -- *
 * Leitner spaced repetition, shared across all classes (key hq-srs), so the
 * course home can show "cards due". Boxes 0..5 -> 0,1,3,7,16,35 days.        */
const BOX_DAYS = [0, 1, 3, 7, 16, 35];
const today = () => Math.floor(Date.now() / 86400000);
/* Cards never seen enter at most NEW_PER_SESSION at a time, in the order given
 * (a class's own cards come before older ones), so a learner who skipped the
 * deck for a few classes meets a short session, not a pile of 100+ cards.
 * Cards already seen are always due on schedule. srsDue(cards, Infinity) = all. */
const NEW_PER_SESSION = 20;
function srsSplit(allCards) {
    const srs = store.get('hq-srs', {});
    const reviews = allCards.filter(c => srs[c.id] && srs[c.id].due <= today());
    const fresh = allCards.filter(c => !srs[c.id]);
    return { reviews, fresh };
}
function srsDue(allCards, newCap = NEW_PER_SESSION) {
    const { reviews, fresh } = srsSplit(allCards);
    return reviews.concat(fresh.slice(0, newCap));
}
function flashcards(host, cards, opts) {
    const body = card(host, opts);
    // remember this class's cards for the course home
    const reg = store.get('hq-srs-cards', {});
    cards.forEach(c => { reg[c.id] = { m: c.m, tr: c.tr, name: c.name, note: c.note || '', cls: opts.classId }; });
    store.set('hq-srs-cards', reg);
    // opts.carryOver: also review the cards met in earlier classes, so one deck
    // (the latest class's) keeps the whole collection on schedule.
    const own = new Set(cards.map(c => c.id));
    const earlier = opts.carryOver ? Object.entries(reg).filter(([id, c]) => !own.has(id) && c.cls !== opts.classId).map(([id, c]) => ({ id, ...c })) : [];
    const all = cards.concat(earlier);
    function lobby() {
        body.textContent = '';
        const due = srsDue(all);
        const waiting = Math.max(0, srsSplit(all).fresh.length - NEW_PER_SESSION);
        const srs = store.get('hq-srs', {});
        const learned = all.filter(c => srs[c.id] && srs[c.id].box >= 2).length;
        body.append(el('div', { class: 'scoreline' }, el('span', { html: `Due now: <b>${due.length}</b>` }), el('span', { html: `Well known: <b>${learned} / ${all.length}</b>` }),
            earlier.length ? el('span', { html: `incl. <b>${earlier.length}</b> from earlier classes` }) : null));
        if (waiting) body.append(el('p', { class: 'how' }, `New cards come in ${NEW_PER_SESSION} at a time. ${waiting} more wait${waiting > 1 ? '' : 's'} for your next session${waiting > NEW_PER_SESSION ? 's' : ''}.`));
        body.append(el('div', { class: 'row-btns' }, el('button', { class: 'btn', disabled: !due.length, onclick: () => session(due) }, due.length ? `▶ Review ${due.length} card${due.length > 1 ? 's' : ''}` : 'All caught up — come back tomorrow')));
    }
    function session(queue) {
        queue = shuffle(queue);
        let i = 0;
        const again = [];
        function show() {
            body.textContent = '';
            if (i >= queue.length) {
                if (again.length) { queue = shuffle(again.splice(0)); i = 0; return show(); }
                done(opts.id);
                body.append(feedback(true, 'Session complete. Cards you found hard come back sooner, easy ones later — that spacing is what makes them stick.'));
                body.append(el('div', { class: 'row-btns' }, el('button', { class: 'btn ghost', onclick: lobby }, 'Back to deck')));
                return;
            }
            const c = queue[i];
            body.append(el('div', { class: 'qcount' }, `${i + 1} / ${queue.length}`));
            const back = el('div', { class: 'back', hidden: true, html: `<div class="tr">${c.tr}</div><div>${c.name}</div>${c.note ? `<div class="lead" style="font-size:14px;margin-top:6px">${c.note}</div>` : ''}` });
            const cardEl = el('div', { class: 'fc' }, el('div', { class: 'fc-card' }, el('div', { class: 'front' }, hg(c.m)), back));
            const reveal = el('button', { class: 'btn', style: 'margin:0 auto;display:flex', onclick: () => { back.hidden = false; reveal.remove(); body.append(rate); } }, 'Show answer (space)');
            const rate = el('div', { class: 'fc-rate' },
                el('button', { class: 'choice', onclick: () => grade(0) }, '✗ Again'),
                el('button', { class: 'choice', onclick: () => grade(1) }, '≈ Hard'),
                el('button', { class: 'choice', onclick: () => grade(2) }, '✓ Got it'));
            body.append(el('p', { class: 'how', style: 'text-align:center' }, 'Say the sound (and name) out loud before you flip.'), cardEl, reveal);
            function grade(g) {
                const srs = store.get('hq-srs', {});
                const cur = srs[c.id] || { box: 0 };
                const box = g === 0 ? 0 : g === 1 ? Math.max(1, cur.box) : Math.min(BOX_DAYS.length - 1, cur.box + 1);
                srs[c.id] = { box, due: today() + BOX_DAYS[box] };
                store.set('hq-srs', srs);
                if (g === 0) again.push(c);
                i++; show();
            }
        }
        show();
    }
    document.addEventListener('keydown', e => {
        if (e.key !== ' ' || /^(INPUT|TEXTAREA|BUTTON)$/.test(e.target.tagName)) return;
        const btn = [...body.querySelectorAll('button')].find(b => b.textContent.startsWith('Show answer'));
        if (btn) { e.preventDefault(); btn.click(); }
    });
    lobby();
}

/* ---------------------------------------------------------- mission -- *
 * Editor task. The editor needs no special support: it lays out any text
 * dropped onto its canvas, and its 𓂀… dialog accepts Gardiner codes.
 * cfg: { mdc, steps:[html], checks:[text] }                                  */
function copyText(txt, btn) {
    const ok = () => { const o = btn.textContent; btn.textContent = '✓ Copied'; setTimeout(() => btn.textContent = o, 1400); };
    if (navigator.clipboard) navigator.clipboard.writeText(txt).then(ok, () => prompt('Copy this:', txt));
    else prompt('Copy this:', txt);
}
function editorStrip(mdc) {
    const strip = el('div', { class: 'papyrus', draggable: 'true', title: 'Drag me onto the ΙΕΡΟΓΛΥΦΩ canvas', style: 'cursor:grab' }, hg(mdc, { cls: 'hg-med' }));
    strip.addEventListener('dragstart', e => { e.dataTransfer.setData('text/plain', mdc); e.dataTransfer.effectAllowed = 'copy'; });
    const codeBtn = el('button', { class: 'btn ghost', onclick: (e) => copyText(mdc, e.currentTarget) }, '⧉ Copy code');
    return el('div', {}, strip,
        el('div', { class: 'row-btns' },
            el('a', { class: 'btn editor', href: EDITOR_URL, target: 'hieroglypho', rel: 'noopener' }, '✍ Open ΙΕΡΟΓΛΥΦΩ'),
            codeBtn, el('code', { class: 'mdc-code' }, mdc)));
}
function portfolioAdd(title, url) {
    const list = store.get('hq-portfolio', []);
    list.unshift({ title, url, at: Date.now() });
    store.set('hq-portfolio', list.slice(0, 100));
}
function mission(host, cfg, opts) {
    const body = card(host, { ...opts, tag: opts.tag || 'Editor mission', tagClass: 'editor' });
    if (cfg.mdc) body.append(editorStrip(cfg.mdc));
    body.append(el('ol', { class: 'mission-steps', html: cfg.steps.map(s => `<li>${s}</li>`).join('') }));
    body.append(el('p', { class: 'desktop-note' }, '💻 The editor works on a desktop or laptop. On a phone, bookmark this mission for later.'));
    const inp = el('input', { class: 'txt', placeholder: 'Paste your share link here', style: 'max-width:100%' });
    const msg = el('div');
    body.append(el('p', { html: '<b>Hand it in:</b> in the editor, open the <b>≡</b> menu → <b>🔗 Copy share link</b>, then paste it here. It is saved in <a href="../#portfolio">your scroll</a> (this browser only).' }),
        el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' }, inp, el('button', { class: 'btn', onclick: () => {
            const v = inp.value.trim();
            if (!/^https?:\/\/\S+(#c=|\/s\/)\S+/.test(v)) { msg.replaceChildren(feedback(false, 'That doesn’t look like a ΙΕΡΟΓΛΥΦΩ share link (it should contain <code>#c=</code> or <code>/s/</code>).')); return; }
            portfolioAdd(opts.title, v);
            done(opts.id);
            msg.replaceChildren(feedback(true, `Saved to your scroll. ${cfg.after || ''} <a href="${v}" target="_blank" rel="noopener">Open it</a>`));
            inp.value = '';
        } }, 'Save')), msg);
    if (cfg.checks) {
        body.append(el('details', {}, el('summary', {}, 'Self-check before you hand in'),
            el('ul', { html: cfg.checks.map(c => `<li>${c}</li>`).join('') })));
    }
}

/* ---------------------------------------------------- name cartouche -- *
 * Spell a modern name with Ptolemaic-style one-sound signs (a game — the
 * Egyptians did exactly this for foreign rulers).                            */
function nameCartouche(host, map, opts) {
    const body = card(host, opts);
    const inp = el('input', { class: 'txt', placeholder: 'Type a name, e.g. Maria or Kevin', maxlength: 24 });
    const out = el('div', { class: 'papyrus', style: 'min-height:110px' });
    const info = el('div', { class: 'lead', style: 'font-size:14px' });
    const tools = el('div');
    const keys = Object.keys(map).sort((a, b) => b.length - a.length);   // digraphs first
    function update() {
        const name = inp.value.toLowerCase().replace(/[^a-z]/g, '');
        const codes = [], used = [];
        let i = 0, prev = null;
        while (i < name.length) {
            const k = keys.find(k => name.startsWith(k, i));
            if (!k) { i++; continue; }
            if (k === prev) { i += k.length; continue; }     // double letters written once
            prev = k;
            codes.push(map[k].c); used.push(`${k.toUpperCase()} → <span class="gl">${glyphs(map[k].c)}</span>${map[k].note ? ` <i>(${map[k].note})</i>` : ''}`);
            i += k.length;
        }
        out.textContent = ''; tools.textContent = ''; info.innerHTML = '';
        if (!codes.length) { out.append(el('span', { class: 'lead' }, 'Your cartouche appears here.')); return; }
        const mdc = codes.join('-');
        out.append(hg(mdc, { cls: 'hg-med', cart: true }));
        info.innerHTML = used.join(' · ');
        tools.append(editorStrip(mdc));
        done(opts.id);
    }
    inp.addEventListener('input', update);
    body.append(inp, out, info, tools);
    update();
}

/* ------------------------------------------------------- sign values -- *
 * Gardiner code -> one-consonant value, taken from the ALPHABET table below
 * (main and alternative signs). Used by transcribe() hints and spell().    */
let SIGN_VALUE = null;
function signValue(code) {
    if (!SIGN_VALUE) {
        SIGN_VALUE = {};
        ALPHABET.forEach(([tr, , main, alt]) => [main, alt].forEach(c => { if (c && !/[-:*]/.test(c)) SIGN_VALUE[c] = tr; }));
    }
    return SIGN_VALUE[code];
}
/* Multi-consonant signs taught so far (Class 4: two- and three-consonant
 * signs). Only signs the course uses for their sound belong here: a sign
 * that the lessons also use as a determinative (N5 in hrw "day") would get
 * the wrong hint.                                                          */
const MULTI = {
    O1: 'pr', Y5: 'mn', V30: 'nb', D2: 'ḥr', D1: 'tp', D4: 'jr', G36: 'wr', G39: 'zꜣ', F31: 'ms', R11: 'ḏd', O29: 'ꜥꜣ', N16: 'tꜣ',
    M18: 'jj', U28: 'ḏꜣ', N28: 'ḫꜥ',
    S34: 'ꜥnḫ', F35: 'nfr', R4: 'ḥtp', L1: 'ḫpr', F21: 'sḏm', R8: 'nṯr',
    // Class 5 (royal signs). The sun N5 stays out: it is also a determinative (hrw "day").
    D28: 'kꜣ', M23: 'sw', L2: 'bjt', X8: 'dj', C10: 'mꜣꜥt', F12: 'wsr',
    // Class 6 (nouns). The town O49 and the hills N25 stay out: both are also determinatives.
    T22: 'sn', S38: 'ḥqꜣ', I6: 'km', W24: 'nw',
    // Class 7 (pronouns). The rush M22 stays out: it is written twice for nn.
    U36: 'ḥm', G40: 'pꜣ',
    // Class 8 (adjectives). The nose D19 and the West emblem R14 stay out: both are also determinatives.
    D45: 'ḏsr', Aa11: 'mꜣꜥ', P8: 'ḫrw', G4: 'tjw',
    // Class 9 (prepositions). The mountain N26 and the offering-list signs (O3, X2, W22, F1, H1) stay out: hints spell them out by hand.
    W19: 'mj', T28: 'ẖr', F39: 'jmꜣḫ',
    // Class 11 (numbers and dates). The numerals, the month, season and year signs and the open arms D35 stay out: hints spell them out by hand.
    T21: 'wꜥ',
    // Class 13 (verbs). The determinatives (legs D54, A14, A55) and the emblem R15 in Ꜣbḏw stay out: hints spell them out by hand.
    U1: 'mꜣ', W25: 'jn', G28: 'gm', P6: 'ꜥḥꜥ', U7: 'mr', N40: 'šm', D37: 'dj', U15: 'tm', V24: 'wḏ', S43: 'mdw',
    // Class 14 (pseudo-verbal). The star N14 is only dwꜣ so far; if a later class uses it as a determinative (time words), drop it here.
    E34: 'wn', T18: 'šms', N14: 'dwꜣ',
    // Class 15 (imperative and particles). The determinative A7 (weariness) stays out.
    Y3: 'zẖꜣ', N41: 'ḥm',
    // Aa13 is jm in jmj "give!"; it is also read gs in other words, so drop it here if a class uses that value.
    Aa13: 'jm',
    // Class 16 (stative). The pestle U33 (tj in the ending .tj) stays out: hints spell the stative endings out by hand.
    F42: 'spr',
    // Class 19 (sḏm.f II). The papyrus clump M16 in the particle ḥꜣ.
    M16: 'ḥꜣ',
    // Class 21 (other suffix forms). The flax bundle M36 in the preposition ḏr "before".
    M36: 'ḏr'
};
/* Split an MdC spelling into readable parts: [{ g: glyphs, v: value | null }].
 * Two reed leaves in a row are read together as y. One-consonant signs that
 * repeat sounds of the multi-consonant sign before them, in order, are
 * phonetic complements (comp: true): read once, not twice. Usually they echo
 * the last sound or two (nfr + f + r), sometimes all of them (ꜥꜣ + ꜥ + ꜣ). Unknown signs
 * (determinatives, strokes) come back with v = null: they are not pronounced. */
function soundParts(mdc) {
    const codes = tokenize(mdc).filter(t => t.type === 'sign').map(t => t.code);
    const out = [];
    let rest = [];                                   // sounds of the last multi sign still open to an echo
    for (let i = 0; i < codes.length; i++) {
        if (codes[i] === 'M17' && codes[i + 1] === 'M17') { out.push({ g: glyphs('M17-M17'), v: 'y' }); i++; rest = []; continue; }
        if (MULTI[codes[i]]) { const v = MULTI[codes[i]]; out.push({ g: glyph(codes[i]), v, code: codes[i], multi: true }); rest = [...v]; continue; }
        const v = signValue(codes[i]) || null;
        const at = v ? rest.indexOf(v) : -1;
        if (at >= 0) { out.push({ g: glyph(codes[i]), v, code: codes[i], comp: true }); rest = rest.slice(at + 1); continue; }
        rest = [];
        out.push({ g: glyph(codes[i]), v, code: codes[i] });
    }
    return out;
}
function partsHtml(parts) {
    return parts.map(p => `<span class="gl">${p.g}</span> ` + (p.comp ? `<i>(<span class="tr">${p.v}</span> again: a complement, not read twice)</i>`
        : p.v ? `<span class="tr">${p.v}</span>` : `<i>${/^Z[123]/.test(p.code || '') ? 'stroke(s), silent' : 'silent determinative'}</i>`)).join(' · ');
}

/* ------------------------------------------------------------ match -- *
 * Pair each sign with its reading. pairs: [{ m, tr }], or [{ m, label }] to
 * pair a sign with plain words (a determinative with what it tags). Tap a
 * sign, then its partner (either order). opts.maxMiss: mistakes allowed to
 * pass (default 2); the best clean time is kept.                            */
function match(host, pairs, opts) {
    const body = card(host, opts);
    const maxMiss = opts.maxMiss ?? 2;
    const bestKey = 'hq-best-' + opts.id;
    const keyOf = (p) => p.tr || p.label;
    if (opts.sentences) host.classList.add('sentence-match');   // whole sentences: smaller signs that wrap
    function play() {
        body.textContent = '';
        let misses = 0, left = pairs.length, sel = null;
        const t0 = Date.now();
        const line = el('div', { class: 'scoreline' });
        const upd = () => { line.innerHTML = `<span>Matched <b>${pairs.length - left} / ${pairs.length}</b></span><span>Mistakes <b>${misses}</b></span>` + (store.get(bestKey, 0) ? `<span>Best time <b>${store.get(bestKey, 0)}s</b></span>` : ''); };
        const colA = el('div', { class: 'match-col' }), colB = el('div', { class: 'match-col' });
        const mk = (side, p) => {
            const b = el('button', { class: 'match-btn ' + side, onclick: () => pick(b) });
            if (side === 'sign') b.append(hg(p.m));
            else b.innerHTML = p.label ? `<span class="match-label">${p.label}</span>` : `<span class="tr">${p.tr}</span>`;
            b._p = p; b._side = side;
            return b;
        };
        shuffle(pairs).forEach(p => colA.append(mk('sign', p)));
        // one button per distinct reading would make duplicates ambiguous, so keep one per pair
        shuffle(pairs).forEach(p => colB.append(mk('sound', p)));
        const msg = el('div');
        body.append(line, el('div', { class: 'match-board' }, colA, colB), msg);
        upd();
        function pick(b) {
            if (b.disabled) return;
            if (!sel || sel._side === b._side) {
                if (sel) sel.classList.remove('sel');
                sel = sel === b ? null : b;
                if (sel) sel.classList.add('sel');
                return;
            }
            const a = sel; sel = null; a.classList.remove('sel');
            if (keyOf(a._p) === keyOf(b._p)) {
                [a, b].forEach(x => { x.disabled = true; x.classList.add('right'); });
                left--; upd();
                if (!left) finish();
            } else {
                misses++; upd();
                [a, b].forEach(x => { x.classList.add('wrong'); setTimeout(() => x.classList.remove('wrong'), 600); });
            }
        }
        function finish() {
            const secs = Math.round((Date.now() - t0) / 1000);
            const ok = misses <= maxMiss;
            if (ok) {
                done(opts.id);
                const best = store.get(bestKey, 0);
                if (!best || secs < best) store.set(bestKey, secs);
            }
            msg.replaceChildren(feedback(ok, ok ? `All matched in <b>${secs}s</b> with ${misses} mistake${misses === 1 ? '' : 's'}. Play again and beat your time.`
                : `${misses} mistakes: you need ${maxMiss} or fewer. The second round is always faster.`),
                el('div', { class: 'row-btns' }, el('button', { class: 'btn ghost', onclick: play }, '↻ New board')));
        }
    }
    play();
}

/* ------------------------------------------------------- transcribe -- *
 * Read a written word and type its transliteration (plain-keyboard codes are
 * fine: A i a H x X S T D). items: [{ m, tr, gloss, alt?: [..], why?, cart?,
 * parts?, say? }]. Two tries per word, then the answer is shown. opts.pass
 * (default .75) of the words must be right first time.
 * parts: html that replaces the automatic sign-by-sign breakdown, for
 * spellings soundParts() can't follow (a god written first in a cartouche,
 * word-signs such as the sun for Rꜥ). say: how the feedback spells the
 * pronunciation. opts.retry: the advice shown after a first wrong try.     */
const SPECIAL_LETTERS = ['ꜣ', 'ꜥ', 'ḥ', 'ḫ', 'ẖ', 'š', 'ṯ', 'ḏ'];
function letterPad(inp, letters) {
    return el('div', { class: 'letter-pad' }, letters.map(ch => el('button', { type: 'button', class: 'tile', onclick: () => {
        const s = inp.selectionStart ?? inp.value.length, e = inp.selectionEnd ?? s;
        inp.value = inp.value.slice(0, s) + ch + inp.value.slice(e);
        inp.focus(); inp.setSelectionRange(s + ch.length, s + ch.length);
        inp.dispatchEvent(new Event('input'));
    } }, ch)));
}
function transcribe(host, items, opts) {
    const body = card(host, opts);
    const pass = opts.pass ?? 0.75;
    function start() {
        const list = opts.keepOrder ? items.slice() : shuffle(items);
        let i = 0, clean = 0;
        function show() {
            body.textContent = '';
            if (i >= list.length) {
                const ok = clean >= Math.ceil(pass * list.length);
                if (ok) done(opts.id);
                body.append(el('p', { html: `<b>${clean} / ${list.length}</b> read right first time. ${ok ? 'You are reading by sound.' : `You need ${Math.ceil(pass * list.length)}. Go again: the words come back in a new order.`}` }));
                body.append(el('div', { class: 'row-btns' }, el('button', { class: 'btn ghost', onclick: start }, '↻ Again')));
                return;
            }
            const it = list[i];
            let tries = 0, finished = false;
            body.append(el('div', { class: 'qcount' }, `Word ${i + 1} of ${list.length} · ${clean} right first time`));
            body.append(el('div', { class: 'papyrus' }, hg(it.m, { cls: 'hg-big', cart: it.cart }), el('div', { class: 'lead', style: 'margin:6px 0 0' }, it.gloss ? `means “${it.gloss}”` : '')));
            const inp = el('input', { class: 'txt', placeholder: 'transliteration, e.g. rn', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', 'aria-label': 'Transliteration' });
            const prev = el('span', { class: 'tr-preview' });
            inp.addEventListener('input', () => { prev.textContent = inp.value.trim() ? '→ ' + allen(inp.value.trim()) : ''; });
            inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); finished ? next() : check(); } });
            const msg = el('div');
            const breakdown = it.parts || partsHtml(soundParts(it.m));
            const hintBtn = el('button', { class: 'btn ghost', onclick: () => msg.replaceChildren(feedback(false, '💡 Sign by sign: ' + breakdown)) }, 'Hint');
            body.append(el('div', { class: 'tr-row' }, inp, prev), letterPad(inp, opts.letters || ['ꜣ', 'ꜥ']),
                el('div', { class: 'row-btns' }, el('button', { class: 'btn', onclick: () => finished ? next() : check() }, 'Check'), hintBtn), msg);
            setTimeout(() => inp.focus({ preventScroll: true }), 0);
            function next() { i++; show(); }
            function check() {
                const v = normTr(inp.value);
                if (!v) return;
                const ok = [it.tr, ...(it.alt || [])].some(a => trMatches(inp.value, a));
                tries++;
                if (ok || tries >= 2) {
                    finished = true;
                    if (ok && tries === 1) clean++;
                    inp.disabled = true; hintBtn.disabled = true;
                    msg.replaceChildren(feedback(ok, `${ok ? '✓' : '✗ It reads'} <span class="tr">${it.tr}</span>, said “${it.say || sayTr(it.tr)}”. ${breakdown}${it.why ? '<br>' + it.why : ''}`),
                        el('div', { class: 'row-btns' }, el('button', { class: 'btn', onclick: next }, i + 1 < list.length ? 'Next →' : 'See score')));
                } else {
                    msg.replaceChildren(feedback(false, `Not quite: you typed <span class="tr">${allen(inp.value.trim())}</span>. ${opts.retry || 'Give every sound-sign its letter, and leave out the silent sign at the end.'} One more try.`));
                }
            }
        }
        show();
    }
    start();
}

/* ------------------------------------------------------------ spell -- *
 * The reverse: given a transliteration, build the word from a palette of
 * signs (shown without their values, so it's recall, not recognition).
 * items: [{ tr, gloss, m: the scribe's real spelling incl. determinative }].
 * opts.palette: Gardiner codes. Any correct sound spelling is accepted.    */
function spell(host, items, opts) {
    const body = card(host, opts);
    const pass = opts.pass ?? 0.75;
    const target = (tr) => normKey(tr);
    // read the built spelling the way soundParts does: big signs count, their complements don't
    const valueOf = (codes) => soundParts(codes.join('-')).filter(p => !p.comp).map(p => p.v || '?').join('');
    function start() {
        const list = opts.keepOrder ? items.slice() : shuffle(items);
        let i = 0, clean = 0;
        function show() {
            body.textContent = '';
            if (i >= list.length) {
                const ok = clean >= Math.ceil(pass * list.length);
                if (ok) done(opts.id);
                body.append(el('p', { html: `<b>${clean} / ${list.length}</b> spelled right first time. ${ok ? 'A scribe in the making.' : `You need ${Math.ceil(pass * list.length)}. Go again.`}` }));
                body.append(el('div', { class: 'row-btns' }, el('button', { class: 'btn ghost', onclick: start }, '↻ Again')));
                return;
            }
            const it = list[i];
            let tries = 0, codes = [], finished = false;
            body.append(el('div', { class: 'qcount' }, `Word ${i + 1} of ${list.length} · ${clean} right first time`));
            body.append(el('p', { class: 'spell-target', html: `Spell <span class="tr">${it.tr}</span> <span class="lead">“${it.gloss}”</span>` }));
            const out = el('div', { class: 'papyrus spell-out' });
            const draw = () => { out.textContent = ''; out.append(codes.length ? hg(codes.join('-'), { cls: 'hg-big' }) : el('span', { class: 'lead' }, 'Tap the signs below, in reading order.')); };
            draw();
            const pal = el('div', { class: 'order-pool spell-pal' });
            opts.palette.forEach(c => pal.append(el('button', { type: 'button', 'aria-label': 'sign ' + c, onclick: () => { if (finished || codes.length >= 8) return; codes.push(c); draw(); } }, glyph(c))));
            const msg = el('div');
            body.append(out, pal, el('div', { class: 'row-btns' },
                el('button', { class: 'btn', onclick: check }, 'Check'),
                el('button', { class: 'btn ghost', onclick: () => { if (!finished) { codes.pop(); draw(); } } }, '⌫ Undo'),
                el('button', { class: 'btn ghost', onclick: () => { if (!finished) { codes = []; draw(); } } }, 'Clear')), msg);
            function check() {
                if (finished || !codes.length) return;
                const got = valueOf(codes);
                const ok = got === target(it.tr);
                tries++;
                if (ok || tries >= 2) {
                    finished = true;
                    if (ok && tries === 1) clean++;
                    const silent = soundParts(it.m).some(p => !p.v);
                    msg.replaceChildren(feedback(ok, `${ok ? '✓ Right.' : '✗ Here it is.'} A scribe would write it like this${silent ? ', with silent signs added at the end' : ''}:`),
                        el('div', { class: 'papyrus', style: 'margin-top:8px' }, hg(it.m, { cls: 'hg-med' }), el('div', { class: 'lead', style: 'font-size:14px;margin-top:4px', html: partsHtml(soundParts(it.m)) })),
                        el('div', { class: 'row-btns' }, el('button', { class: 'btn', onclick: () => { i++; show(); } }, i + 1 < list.length ? 'Next →' : 'See score')));
                } else {
                    msg.replaceChildren(feedback(false, `Your signs read <span class="tr">${got.replace(/\?/g, '…')}</span>, but you need <span class="tr">${it.tr}</span>. Fix it and check again.`));
                }
            }
        }
        show();
    }
    start();
}

/* ----------------------------------------------------------- worked -- *
 * Worked → faded examples, for the grammar classes. Every item is a phrase
 * taken apart in the same few steps. A step with `show` is given (worked);
 * a step with `choices` is asked. The first item gives every step, the last
 * ones ask them all. items: [{ m, cart?, intro?: html, result: html, steps:
 * [{ label, show: html } | { label, q?: html, choices: [html], a: index,
 * why?: html }] }]. Items stay in the order written (that is the fading).
 * opts.pass (default .75): share of the asked steps right first time.      */
function worked(host, items, opts) {
    const body = card(host, opts);
    const pass = opts.pass ?? 0.75;
    function start() {
        let i = 0, asked = 0, right = 0;
        function show() {
            body.textContent = '';
            if (i >= items.length) {
                const ok = !asked || right >= Math.ceil(pass * asked);
                if (ok) done(opts.id);
                body.append(el('p', { html: `<b>${right} / ${asked}</b> steps right first time. ${ok ? 'You can take a phrase apart.' : `You need ${Math.ceil(pass * asked)}. Go through the examples again: the steps are always the same.`}` }));
                body.append(el('div', { class: 'row-btns' }, el('button', { class: 'btn ghost', onclick: start }, '↻ Again')));
                return;
            }
            const it = items[i];
            const worked = it.steps.every(s => s.show != null);
            body.append(el('div', { class: 'qcount' }, `Example ${i + 1} of ${items.length}` + (worked ? ' · worked for you' : '')));
            body.append(el('div', { class: 'papyrus' }, hg(it.m, { cls: 'hg-big', cart: it.cart })));
            if (it.intro) body.append(el('p', { html: it.intro }));
            const list = el('ol', { class: 'parse-steps' });
            const foot = el('div');
            body.append(list, foot);
            let k = 0;
            function step() {
                if (k >= it.steps.length) {
                    foot.replaceChildren(feedback(true, it.result),
                        el('div', { class: 'row-btns' }, el('button', { class: 'btn', onclick: () => { i++; show(); } }, i + 1 < items.length ? 'Next example →' : 'See score')));
                    return;
                }
                const s = it.steps[k++];
                const li = el('li', {}, el('b', {}, s.label + ': '));
                list.append(li);
                if (s.show != null) { li.append(el('span', { html: s.show })); return step(); }
                asked++;
                if (s.q) li.append(el('span', { html: s.q }));
                const grid = el('div', { class: 'choice-grid' });
                shuffle(s.choices.map((c, idx) => ({ c, idx }))).forEach(({ c, idx }) => grid.append(el('button', { class: 'choice', html: c, onclick: () => {
                    const ok = idx === s.a;
                    if (ok) right++;
                    li.classList.add(ok ? 'ok' : 'no');
                    li.replaceChildren(el('b', {}, s.label + ': '), el('span', { html: (ok ? '✓ ' : '✗ ') + s.choices[s.a] + (s.why ? ` <span class="lead">${s.why}</span>` : '') }));
                    step();
                } })));
                li.append(grid);
            }
            step();
        }
        show();
    }
    start();
}

/* ---------------------------------------------------------- compose -- *
 * Build a phrase from word tiles (production, the reverse of worked()).
 * opts.words is the word bank: { key: { m, tr } }. items: [{ en, note?: html,
 * tiles: [keys, decoys included], a: [[keys in order], ...every accepted
 * answer, the model answer first], why?: html, hint?: html }]. Two tries,
 * then the model answer is shown. opts.pass (default .7) right first time. */
function compose(host, items, opts) {
    const body = card(host, opts);
    const pass = opts.pass ?? 0.7;
    const W = opts.words;
    const joinTr = (keys) => keys.map(k => W[k].tr).reduce((a, t) => a + (a && !/^[.=]/.test(t) ? ' ' : '') + t, '');
    const wordEl = (k, cls) => el('span', { class: 'compose-word' }, hg(W[k].m, { cls }), el('span', { class: 'tr' }, W[k].tr));
    function start() {
        const list = opts.keepOrder ? items.slice() : shuffle(items);
        let i = 0, clean = 0;
        function show() {
            body.textContent = '';
            if (i >= list.length) {
                const ok = clean >= Math.ceil(pass * list.length);
                if (ok) done(opts.id);
                body.append(el('p', { html: `<b>${clean} / ${list.length}</b> built right first time. ${ok ? 'You are writing Egyptian.' : `You need ${Math.ceil(pass * list.length)}. Go again: the phrases come back in a new order.`}` }));
                body.append(el('div', { class: 'row-btns' }, el('button', { class: 'btn ghost', onclick: start }, '↻ Again')));
                return;
            }
            const it = list[i];
            let tries = 0, picked = [], finished = false;
            body.append(el('div', { class: 'qcount' }, `Phrase ${i + 1} of ${list.length} · ${clean} right first time`));
            body.append(el('p', { class: 'spell-target', html: `Write <b>“${it.en}”</b>${it.note ? ` <span class="lead">${it.note}</span>` : ''}` }));
            const out = el('div', { class: 'papyrus spell-out compose-out' });
            const draw = () => {
                out.textContent = '';
                if (!picked.length) out.append(el('span', { class: 'lead' }, 'Tap the words below, in the order they are spoken.'));
                picked.forEach(k => out.append(wordEl(k, 'hg-med')));
            };
            draw();
            const pal = el('div', { class: 'compose-pal' });
            shuffle(it.tiles).forEach(k => pal.append(el('button', { type: 'button', class: 'compose-tile', 'aria-label': W[k].tr,
                onclick: () => { if (finished || picked.length >= 6) return; picked.push(k); draw(); } }, wordEl(k, ''))));
            const msg = el('div');
            body.append(out, pal, el('div', { class: 'row-btns' },
                el('button', { class: 'btn', onclick: check }, 'Check'),
                el('button', { class: 'btn ghost', onclick: () => { if (!finished) { picked.pop(); draw(); } } }, '⌫ Undo'),
                el('button', { class: 'btn ghost', onclick: () => { if (!finished) { picked = []; draw(); } } }, 'Clear')), msg);
            function check() {
                if (finished || !picked.length) return;
                const ok = it.a.some(a => a.join(' ') === picked.join(' '));
                tries++;
                if (ok || tries >= 2) {
                    finished = true;
                    if (ok && tries === 1) clean++;
                    const model = ok ? picked : it.a[0];
                    const answer = el('div', { class: 'papyrus compose-out', style: 'margin-top:8px' }, model.map(k => wordEl(k, 'hg-med')));
                    const fb = feedback(ok, `${ok ? '✓' : '✗ It is'} <span class="tr">${joinTr(model)}</span>. ${it.why || ''}`);
                    const nextBtn = el('div', { class: 'row-btns' }, el('button', { class: 'btn', onclick: () => { i++; show(); } }, i + 1 < list.length ? 'Next →' : 'See score'));
                    msg.replaceChildren(...(ok ? [fb, nextBtn] : [fb, answer, nextBtn]));
                } else {
                    msg.replaceChildren(feedback(false, (it.hint || 'Not yet. Check the order of the words and their endings.') + ' One more try.'));
                }
            }
        }
        show();
    }
    start();
}

/* ------------------------------------------------------------- spot -- *
 * Find the scribe's mistake. The learner sees what the scribe meant (English)
 * and the sentence as the scribe wrote it, one button per word, and taps the
 * word that is wrong. items: [{ en, words: [MdC per word], bad: index of the
 * wrong word, fix: MdC of the right word, tr: the correct transliteration,
 * why: html }]. One try per sentence; opts.pass (default .7) right.         */
function spot(host, items, opts) {
    const body = card(host, opts);
    const pass = opts.pass ?? 0.7;
    function start() {
        const list = opts.keepOrder ? items.slice() : shuffle(items);
        let i = 0, score = 0;
        function show() {
            body.textContent = '';
            if (i >= list.length) {
                const ok = score >= Math.ceil(pass * list.length);
                if (ok) done(opts.id);
                body.append(el('p', { html: `<b>${score} / ${list.length}</b> mistakes found. ${ok ? 'A scribe’s teacher would hire you.' : `You need ${Math.ceil(pass * list.length)}. Go again: the sentences come back in a new order.`}` }));
                body.append(el('div', { class: 'row-btns' }, el('button', { class: 'btn ghost', onclick: start }, '↻ Again')));
                return;
            }
            const it = list[i];
            body.append(el('div', { class: 'qcount' }, `Sentence ${i + 1} of ${list.length} · score ${score}`));
            body.append(el('p', { class: 'spell-target', html: `The scribe meant: <b>“${it.en}”</b>` }));
            const row = el('div', { class: 'spot-row' });
            const msg = el('div');
            const btns = it.words.map((w, k) => el('button', { type: 'button', class: 'spot-word', 'aria-label': `word ${k + 1}`, onclick: () => {
                const ok = k === it.bad;
                if (ok) score++;
                btns.forEach(b => b.disabled = true);
                btns[k].classList.add(ok ? 'right' : 'wrong');
                if (!ok) btns[it.bad].classList.add('right');
                const fixed = el('div', { class: 'papyrus spell-out compose-out', style: 'margin-top:8px' },
                    it.words.map((x, j) => el('span', { class: 'compose-word' + (j === it.bad ? ' spot-fixed' : '') }, hg(j === it.bad ? it.fix : x, { cls: 'hg-med' }))));
                msg.replaceChildren(feedback(ok, `${ok ? '✓' : '✗ The slip is the word marked green.'} ${it.why} Corrected: <span class="tr">${it.tr}</span>`), fixed,
                    el('div', { class: 'row-btns' }, el('button', { class: 'btn', onclick: () => { i++; show(); } }, i + 1 < list.length ? 'Next →' : 'See score')));
            } }, hg(w, { cls: 'hg-med' })));
            row.append(...btns);
            body.append(el('div', { class: 'papyrus' }, row), el('p', { html: 'Tap the word the scribe got wrong.' }), msg);
        }
        show();
    }
    start();
}


/* ----------------------------------------------------------- tracking -- *
 * Anonymous usage counters: which classes are opened, which activities get
 * finished. No cookies, no IDs, no personal data — just {event, class,
 * activity}. Off unless HQ_CONFIG.analytics is set; skipped entirely when
 * the browser sends Do-Not-Track or Global Privacy Control.                 */
function track(event, data = {}) {
    const url = CFG.analytics;
    if (!url) return;
    if (navigator.doNotTrack === '1' || navigator.globalPrivacyControl) return;
    if (location.protocol !== 'https:' || location.hostname === 'localhost') return;   // local preview
    const body = JSON.stringify({ e: event, c: CLASS_ID || PAGE_ID || 'home', ...data });
    try {
        if (navigator.sendBeacon) navigator.sendBeacon(url, new Blob([body], { type: 'text/plain' }));
        else fetch(url, { method: 'POST', body, keepalive: true, mode: 'no-cors' });
    } catch (_) { /* never let analytics break a lesson */ }
}

/* ---------------------------------------------------------- community -- *
 * Elements with [data-discord] are shown only when an invite is configured;
 * any <a data-discord> gets the invite as its href.                          */
function community() {
    document.querySelectorAll('[data-discord]').forEach(n => {
        if (!CFG.discord) { n.hidden = true; return; }
        n.hidden = false;
        n.querySelectorAll('a[data-discord-link]').forEach(a => {
            a.href = CFG.discord; a.target = '_blank'; a.rel = 'noopener';
            a.addEventListener('click', () => track('discord'));
        });
    });
}

/* --------------------------------------------------------- read aloud -- *
 * Free text-to-speech via the browser's built-in voices (Web Speech API):
 * no server, no cost. Adds a "Listen" button to every lesson section; reads
 * the lesson prose (never the games), highlights the paragraph being read.
 * Transliterations are spoken the way Egyptologists say them aloud
 * (ḥtp → "hetep", mdw-nṯr → "medu-netjer"), not spelled letter by letter.   */
const SAY_OVERRIDE = { 'ꜥnḫ': 'ankh', 'jmn': 'imen', 'Jmn': 'Amun', 'Ptwlmys': 'Ptolemy', 'Rꜥ': 'Ra', 'rꜥ': 'ra', 'sꜣ': 'sa', 'Ḏḥwtj': 'Djehuti',
    'Jnpw': 'Inpu', 'Ppy': 'Pepi', 'Ttj': 'Teti', 'Sbk': 'Sobek', 'wbn': 'weben', 'hbny': 'hebeny',
    'zꜣ': 'sa', 'Snfrw': 'Sneferu', 'Ptḥ': 'Ptah', 'wḥꜣt': 'wehat', 'zj': 'zi',
    'wr': 'wer', 'wḏꜣ': 'wedja', 'jj': 'ii', 'Jj': 'Ii', 'Mn': 'Men', 'Ḫprj': 'Khepri',
    'ḥjmt': 'hemet', 'ḥjmwt': 'hemut', 'mjwt': 'mut', 'njwt': 'niut' };
const SAY_LETTER = { 'ꜣ': 'aleph', 'ꜥ': 'ayin', 'j': 'yod', 'y': 'y', 'w': 'w', 'ḥ': 'dotted h', 'ḫ': 'kh', 'ẖ': 'kh', 'š': 'sh', 'ṯ': 'tj', 'ḏ': 'dj', 'z': 'z', 'q': 'q' };
const SAY_UNIT = { 'ꜣ': ['a', 1], 'ꜥ': ['a', 1], 'j': ['i', 1], 'ḥ': ['h', 0], 'ḫ': ['kh', 0], 'ẖ': ['kh', 0], 'š': ['sh', 0], 'ṯ': ['tj', 0], 'ḏ': ['dj', 0], 'z': ['s', 0], 'q': ['k', 0] };
function sayWord(w) {
    if (SAY_OVERRIDE[w]) return SAY_OVERRIDE[w];
    const cap = w[0] !== w[0].toLowerCase();
    const chars = [...w.toLowerCase()].filter(c => /[a-zꜣꜥḥḫẖšṯḏ]/.test(c));
    if (chars.length === 1) return SAY_LETTER[chars[0]] || chars[0];
    const u = chars.map(c => { const m = SAY_UNIT[c]; return m ? { s: m[0], v: !!m[1], c } : { s: c, v: false, c }; });
    u.forEach((x, i) => {                                   // w is "u" between consonants
        if (x.c !== 'w') return;
        const prevC = !u[i - 1] || !u[i - 1].v, nextC = !u[i + 1] || !u[i + 1].v;
        if (prevC && nextC) { x.s = 'u'; x.v = true; }
    });
    let out = '';
    u.forEach((x, i) => { if (i && !x.v && !u[i - 1].v) out += 'e'; out += x.s; });
    return cap ? out[0].toUpperCase() + out.slice(1) : out;
}
/* Suffix pronouns after a dot or = (pr.f, zꜣ.j) are spoken joined to their
 * word, the classroom way: pr.f "per-ef", ḥm.s "hem-es".                     */
const SAY_SUFFIX = { j: 'i', k: 'ek', ṯ: 'tjet', t: 'et', f: 'ef', s: 'es', n: 'en', ṯn: 'tjen', tn: 'ten', sn: 'sen' };
function sayTr(text) {
    let suffix = false;
    return text.split(/([\s\-.=]+)/).map(part => {
        if (/[\s\-.=]/.test(part)) { suffix = /^[.=]$/.test(part.trim()); return suffix ? '-' : part.includes('-') ? '-' : ' '; }
        if (!part) return '';
        const bare = part.replace(/[()]/g, '');
        return suffix && SAY_SUFFIX[bare] ? SAY_SUFFIX[bare] : sayWord(part);
    }).join('');
}
function speakableText(node) {
    const c = node.cloneNode(true);
    c.querySelectorAll('.activity, script, style, button, .cite').forEach(n => n.remove());
    c.querySelectorAll('[data-say]').forEach(n => n.replaceWith(n.dataset.say));   // page says what to speak
    c.querySelectorAll('[data-m]').forEach(n => n.replaceWith(n.dataset.label ? ' ' + n.dataset.label + ' ' : ' '));
    c.querySelectorAll('.tr').forEach(n => n.replaceWith(sayTr(n.textContent)));
    return c.textContent
        .replace(/[\u{13000}-\u{1345F}]/gu, ' ')            // stray hieroglyphs
        .replace(/ΙΕΡΟΓΛΥΦΩ/g, 'ieroglypho')
        .replace(/[→←★▸⌨]/g, ' ')
        .replace(/\bBC\b/g, 'B.C.').replace(/\bAD\b/g, 'A.D.').replace(/\bca\./g, 'circa')
        .replace(/§§?/g, 'section ')
        .replace(/\s+/g, ' ').trim();
}
/* A synthetic English voice can only guess at Egyptian words, so a paragraph
 * that is mostly transliteration sounds artificial. A class can leave such
 * paragraphs out of the read-aloud altogether (not recorded, not spoken):
 * HQ.initClass(id, { ttsMaxEgyptian: 3 }) skips every block with more than
 * three Egyptian words. Not counted: single letters (spoken by their names)
 * and any transliteration the page gives its own spoken form (data-say).
 * To drop one particular block by hand, give it class="no-tts".            */
let TTS_MAX_EG = null;
function egyptianWords(node) {
    return [...node.querySelectorAll('.tr')].filter(t => !t.closest('.activity, [data-say], button')
        && (t.textContent.match(/\p{L}/gu) || []).length > 1).length;
}
/* Which blocks of a lesson section get read (shared by the player and by
 * HQ.ttsScript(), which tools/extract-tts.mjs uses to pre-record audio).   */
function ttsBlocks(section) {
    const sel = 'h3, p, li, .callout, .timeline > div';
    return [...section.querySelectorAll(sel)].filter(n =>
        !n.closest('.activity, .toc, table, .finish, [data-discord], .no-tts') &&
        !(n.matches('p') && n.closest('.callout, li')) &&            // avoid reading twice
        !(n.matches('li') && n.closest('.callout')) &&
        !(TTS_MAX_EG != null && egyptianWords(n) > TTS_MAX_EG) &&
        speakableText(n).length > 1);
}
function ttsSections() {
    return [...document.querySelectorAll('main section.step[id]')].filter(s => s.querySelector(':scope > h2') && ttsBlocks(s).length);
}
/* Stable key for matching a block to its pre-recorded file (whitespace and
 * punctuation-insensitive, so cosmetic edits don't orphan the audio).       */
function ttsKey(text) { return text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
function ttsScript() {
    return ttsSections().map(s => ({ section: s.id, blocks: ttsBlocks(s).map(n => speakableText(n)) }));
}

/* The player. Prefers pre-recorded audio (audio/manifest.json next to the
 * class page: { blocks: { <ttsKey>: "file.mp3" } }); falls back to the
 * browser's own voices; says so plainly when neither exists (e.g. Chrome /
 * Chromium on Linux ship without voices).                                   */
function readAloud() {
    if (CFG.readAloud === false) return;
    const synth = window.speechSynthesis || null;
    let voice = null;
    const pickVoice = () => {
        if (!synth) return;
        const vs = synth.getVoices().filter(v => /^en(-|_|$)/i.test(v.lang));
        voice = vs.find(v => /natural|neural|online/i.test(v.name)) || vs.find(v => /google/i.test(v.name))
            || vs.find(v => /^en-(GB|US)/i.test(v.lang)) || vs[0] || null;
    };
    if (synth) { pickVoice(); synth.addEventListener && synth.addEventListener('voiceschanged', pickVoice); }
    const hasVoices = () => new Promise(res => {
        if (!synth) return res(false);
        if (synth.getVoices().length) return res(true);
        const t = setTimeout(() => res(synth.getVoices().length > 0), 1500);
        synth.addEventListener && synth.addEventListener('voiceschanged', () => { clearTimeout(t); res(synth.getVoices().length > 0); }, { once: true });
    });

    let manifest = null;
    const manifestReady = fetch('audio/manifest.json', { cache: 'no-cache' })
        .then(r => r.ok ? r.json() : null).then(m => { manifest = m; }).catch(() => {});
    const audio = new Audio();
    audio.preload = 'auto';

    let rate = store.get('hq-tts-rate', 1);
    let queue = [], idx = 0, playing = false, current = null, sectionBtn = null, gen = 0, mode = null;

    const bar = el('div', { class: 'tts-bar', hidden: true, role: 'region', 'aria-label': 'Read-aloud player' });
    const label = el('span', { class: 'tts-label' });
    const msg = el('div', { class: 'tts-msg', hidden: true });
    const pauseBtn = el('button', { class: 'btn ghost', onclick: togglePause }, '⏸ Pause');
    const speedBtn = el('button', { class: 'btn ghost', title: 'Reading speed', onclick: () => {
        rate = rate >= 1.2 ? 0.8 : Math.round((rate + 0.2) * 10) / 10;
        store.set('hq-tts-rate', rate); speedBtn.textContent = rate + '×';
        if (mode === 'file') audio.playbackRate = rate;
        else if (playing) restartBlock();
    } }, rate + '×');
    const controls = el('span', { class: 'tts-controls' },
        el('button', { class: 'btn ghost', onclick: () => step(-1), title: 'Previous paragraph' }, '⏮'),
        pauseBtn, el('button', { class: 'btn ghost', onclick: () => step(1), title: 'Next paragraph' }, '⏭'), speedBtn);
    bar.append(el('span', {}, '🔊'), label, controls, el('button', { class: 'btn ghost', onclick: stop, title: 'Stop' }, '⏹'), msg);
    document.body.append(bar);

    function mark(n) { document.querySelectorAll('.tts-now').forEach(x => x.classList.remove('tts-now')); if (n) n.classList.add('tts-now'); }
    function haltOutput() { audio.pause(); audio.removeAttribute('src'); if (synth) synth.cancel(); }

    async function speakCurrent() {
        const my = ++gen;
        if (idx < 0) idx = 0;
        if (idx >= queue.length) { stop(); return; }
        current = queue[idx];
        mark(current);
        current.scrollIntoView({ block: 'center', behavior: 'smooth' });
        const text = speakableText(current);
        await manifestReady;
        if (my !== gen) return;
        const file = manifest && manifest.blocks && manifest.blocks[ttsKey(text)];
        if (file) {
            mode = 'file';
            audio.src = 'audio/' + file;
            audio.playbackRate = rate;
            audio.onended = () => { if (my === gen && playing) { idx++; speakCurrent(); } };
            try { await audio.play(); return; } catch (_) { /* fall through to the browser voice */ }
        }
        if (!(await hasVoices())) { if (my === gen) noVoice(); return; }
        if (my !== gen) return;
        mode = 'tts';
        // Chrome drops long utterances after ~15 s, so speak sentence by sentence.
        const chunks = text.match(/[^.!?;:]+[.!?;:]*\s*/g) || [text];
        let k = 0;
        const sayNext = () => {
            if (my !== gen || !playing) return;
            if (k >= chunks.length) { idx++; speakCurrent(); return; }
            const u = new SpeechSynthesisUtterance(chunks[k++].trim());
            if (voice) { u.voice = voice; u.lang = voice.lang; } else u.lang = 'en-GB';
            u.rate = rate;
            u.onend = sayNext;
            u.onerror = (e) => { if (e.error !== 'interrupted' && e.error !== 'canceled') sayNext(); };
            synth.speak(u);
        };
        setTimeout(sayNext, 60);                 // Chrome ignores speak() right after cancel()
    }
    function restartBlock() { haltOutput(); speakCurrent(); }
    function noVoice() {
        haltOutput(); mark(null);
        controls.hidden = true;
        msg.hidden = false;
        msg.innerHTML = 'This browser has no reading voice installed, so nothing can be read aloud. '
            + (/Linux/.test(navigator.userAgent) && !/Android/.test(navigator.userAgent)
                ? 'On Linux, <b>Firefox</b> reads aloud out of the box; Chrome/Chromium need to be started with <code>--enable-speech-dispatcher</code>.'
                : 'Try another browser, or check your system’s text-to-speech settings.');
        track('listen_novoice');
    }
    function start(section, btn) {
        stop();
        queue = ttsBlocks(section); idx = 0; playing = true; sectionBtn = btn;
        btn.textContent = '■ Stop';
        const h2 = section.querySelector('h2');
        label.textContent = h2 ? [...h2.childNodes].filter(n => !(n.nodeType === 1 && n.matches('.num, button'))).map(n => n.textContent).join('').trim() : 'Lesson';
        controls.hidden = false; msg.hidden = true;
        bar.hidden = false; pauseBtn.textContent = '⏸ Pause';
        track('listen', { s: section.id });
        speakCurrent();
    }
    function stop() {
        playing = false; gen++; haltOutput(); mark(null); bar.hidden = true; mode = null;
        if (sectionBtn) sectionBtn.textContent = '🔊 Listen';
        sectionBtn = null;
    }
    function togglePause() {
        const paused = mode === 'file' ? audio.paused : (synth && synth.paused);
        if (mode === 'file') paused ? audio.play() : audio.pause();
        else if (synth) paused ? synth.resume() : synth.pause();
        pauseBtn.textContent = paused ? '⏸ Pause' : '▶ Resume';
    }
    function step(d) { if (!playing) return; haltOutput(); idx += d; speakCurrent(); }

    ttsSections().forEach(section => {
        const h = section.querySelector(':scope > h2');
        const btn = el('button', { class: 'tts-btn', type: 'button', 'aria-label': 'Listen to this section' }, '🔊 Listen');
        btn.addEventListener('click', () => sectionBtn === btn ? stop() : start(section, btn));
        h.append(btn);
    });
    window.addEventListener('pagehide', haltOutput);
}


/* ----------------------------------------------------------- alphabet -- *
 * The 25 one-consonant signs in Allen's (dictionary) order, each with a play
 * button for the teacher's own recording: course/audio/alphabet/<file>.mp3
 * (see the RECORDING.md there). Missing recordings show as "not recorded
 * yet" instead of failing, so files can be added one at a time.            */
const ALPHABET = [
    // [transliteration, file, main sign(s), alternative sign or '', picture, letter name, classroom sound]
    ['ꜣ', 'aleph', 'G1', '', 'vulture', 'aleph', 'said “a”; a consonant, not a vowel'],
    ['j', 'yod', 'M17', '', 'reed leaf', 'yod', 'said “i” / “ee”'],
    ['y', 'y', 'M17-M17', 'Z4', 'two reed leaves · two strokes', 'y', '“y”, or “ee” at the end of a word'],
    ['ꜥ', 'ayin', 'D36', '', 'forearm', 'ayin', 'said “a”; really a throat sound, like Arabic ʿayn'],
    ['w', 'w', 'G43', 'Z7', 'quail chick · coil of rope', 'w', '“w”, or “u” between consonants'],
    ['b', 'b', 'D58', '', 'foot', 'b', '“b”'],
    ['p', 'p', 'Q3', '', 'stool', 'p', '“p”'],
    ['f', 'f', 'I9', '', 'horned viper', 'f', '“f”'],
    ['m', 'm', 'G17', '', 'owl', 'm', '“m”'],
    ['n', 'n', 'N35', 'S3', 'water · red crown', 'n', '“n”'],
    ['r', 'r', 'D21', '', 'mouth', 'r', '“r”'],
    ['h', 'h', 'O4', '', 'courtyard', 'h', '“h” as in house'],
    ['ḥ', 'h-dot', 'V28', '', 'twisted wick', 'dotted h', 'a stronger, breathier h (Arabic ḥ)'],
    ['ḫ', 'kh', 'Aa1', '', 'sieve (or placenta)', 'kh · third h', '“kh”, as ch in Scottish loch'],
    ['ẖ', 'kh-under', 'F32', '', 'belly and udder', 'fourth h', 'a softer kh, as ch in German ich'],
    ['z', 'z', 'O34', '', 'door bolt', 'z · first s', '“s” (originally “z”)'],
    ['s', 's', 'S29', '', 'folded cloth', 's · second s', '“s”'],
    ['š', 'sh', 'N37', '', 'pool', 'sh', '“sh”'],
    ['q', 'q', 'N29', '', 'hill slope', 'q · dotted k', 'a “k” made further back in the throat'],
    ['k', 'k', 'V31', '', 'basket', 'k', '“k”'],
    ['g', 'g', 'W11', '', 'jar stand', 'g', '“g” as in go'],
    ['t', 't', 'X1', '', 'bread loaf', 't', '“t”'],
    ['ṯ', 'tj', 'V13', '', 'tethering rope', 'tj · second t', '“tj”, as ch in church'],
    ['d', 'd', 'D46', '', 'hand', 'd', '“d”'],
    ['ḏ', 'dj', 'I10', '', 'cobra', 'dj · second d', '“dj”, as j in jam']
];
function alphabetUrl(file) { return new URL('audio/alphabet/' + file + '.mp3', COURSE_ROOT).href; }
function alphabet(host, opts = {}) {
    host.classList.add('alpha');
    // HQ_CONFIG.alphabetAudio = false: no play buttons and no requests until the recordings exist.
    // The page marks its audio-only sentences data-alpha-audio and their stand-ins data-alpha-noaudio.
    const withAudio = CFG.alphabetAudio !== false;
    document.querySelectorAll(withAudio ? '[data-alpha-noaudio]' : '[data-alpha-audio]').forEach(n => n.remove());
    const player = new Audio();
    let playingBtn = null, playAllRun = 0;
    const status = new Map();                  // file -> true (exists) | false (missing) | undefined (unknown)
    const buttons = [];
    const resetBtn = () => { if (playingBtn) { playingBtn.classList.remove('on'); playingBtn.textContent = '▶'; } playingBtn = null; };
    function play(row, btn) {
        return new Promise(res => {
            player.pause(); resetBtn();
            if (status.get(row[1]) === false) { flash(btn); return res(false); }
            player.src = alphabetUrl(row[1]);
            playingBtn = btn; btn.classList.add('on'); btn.textContent = '■';
            player.onended = () => { resetBtn(); res(true); };
            player.onerror = () => { status.set(row[1], false); markMissing(btn); resetBtn(); flash(btn); res(false); };
            player.play().catch(() => { resetBtn(); res(false); });
        });
    }
    function flash(btn) {
        const tile = btn.closest('.alpha-tile');
        tile.classList.add('nudge'); setTimeout(() => tile.classList.remove('nudge'), 900);
    }
    function markMissing(btn) {
        btn.closest('.alpha-tile').classList.add('missing');
        btn.title = 'Not recorded yet';
        btn.setAttribute('aria-label', btn.getAttribute('aria-label') + ' (not recorded yet)');
    }
    const head = el('div', { class: 'alpha-head' });
    const allBtn = el('button', { class: 'btn', onclick: async () => {
        const run = ++playAllRun;
        if (allBtn.dataset.on) { delete allBtn.dataset.on; allBtn.textContent = '▶ Play all, in order'; player.pause(); resetBtn(); return; }
        allBtn.dataset.on = 1; allBtn.textContent = '■ Stop';
        for (const [row, btn] of buttons) {
            if (run !== playAllRun) return;
            if (status.get(row[1]) === false) continue;
            btn.closest('.alpha-tile').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            await play(row, btn);
            await new Promise(r => setTimeout(r, 350));
        }
        delete allBtn.dataset.on; allBtn.textContent = '▶ Play all, in order';
    } }, '▶ Play all, in order');
    const recNote = el('span', { class: 'lead', style: 'font-size:14px' });
    head.append(allBtn, recNote);
    const grid = el('div', { class: 'alpha-grid' });
    ALPHABET.forEach((row, i) => {
        const [tr, file, main, alt, pic, name, sound] = row;
        const btn = withAudio ? el('button', { class: 'alpha-play', type: 'button', 'aria-label': `Play ${name}` }, '▶') : null;
        if (btn) {
            btn.addEventListener('click', () => (playingBtn === btn ? (player.pause(), resetBtn()) : play(row, btn)));
            buttons.push([row, btn]);
        }
        grid.append(el('div', { class: 'alpha-tile' },
            el('span', { class: 'alpha-no' }, i + 1),
            el('div', { class: 'alpha-signs' }, hg(main, { cls: 'hg-med' }), alt ? el('span', { class: 'alpha-alt', title: 'also written' }, hg(alt)) : null),
            el('div', { class: 'alpha-tr' }, tr),
            el('div', { class: 'alpha-name' }, name),
            opts.compact ? null : el('div', { class: 'alpha-pic' }, pic),
            opts.compact ? null : el('div', { class: 'alpha-sound' }, sound),
            btn,
            withAudio ? el('div', { class: 'alpha-missing' }, 'not recorded yet') : null));
    });
    if (withAudio) host.append(head);
    host.append(grid);
    // Find which recordings exist (HEAD is cheap); unknown on file:// — then we find out on click.
    if (withAudio && location.protocol.startsWith('http')) {
        Promise.all(ALPHABET.map(row => fetch(alphabetUrl(row[1]), { method: 'HEAD', cache: 'no-cache' })
            .then(r => status.set(row[1], r.ok)).catch(() => {}))).then(() => {
            buttons.forEach(([row, btn]) => { if (status.get(row[1]) === false) markMissing(btn); });
            const have = [...status.values()].filter(Boolean).length;
            recNote.textContent = have === ALPHABET.length ? '' : `${have} of ${ALPHABET.length} sounds recorded so far.`;
            allBtn.disabled = have === 0;
        });
    }
}

/* Pages mark what to show before the members' course opens (data-members-soon) and after
 * (data-members-open, written with the hidden attribute so it stays hidden without JS).
 * HQ_CONFIG.membersOpen picks one. course.js loads at the end of <body>, so the DOM is here. */
document.querySelectorAll('[data-members-open], [data-members-soon]').forEach(n => {
    n.hidden = n.hasAttribute('data-members-open') ? !CFG.membersOpen : !!CFG.membersOpen;
});

/* Early-access list: <div data-early-access="home" hidden></div> becomes a sign-up box while
 * HQ_CONFIG.earlyAccess is on and the members' course is not open yet. The value names the page
 * in the list (home | class-05 | members). The Worker sends a confirmation link first. */
document.querySelectorAll('[data-early-access]').forEach(n => {
    n.hidden = !(CFG.earlyAccess && !CFG.membersOpen);
    if (n.hidden) return;
    n.className = 'callout tip early-box';
    n.innerHTML = `<b>Get early access</b>
        <p>Leave your email address and we'll write to you <b>once</b>, when the members' course opens,
        with a personal <b>early-bird price</b> for the people on this list. When the offer ends, we
        delete your address.</p>
        <form class="email-row" novalidate>
            <input type="email" name="email" required autocomplete="email" placeholder="you@example.com" aria-label="Email address">
            <input type="text" name="website" tabindex="-1" autocomplete="off" aria-hidden="true" class="hp">
            <button class="btn" type="submit">Tell me when it opens</button>
        </form>
        <div class="early-msg" role="status"></div>
        <p class="cite" style="white-space:normal">We send a confirmation link first. No newsletter, no sharing:
        see <a href="/TOS.html#early-access">Privacy</a>.</p>`;
    const form = n.querySelector('form'), msg = n.querySelector('.early-msg');
    const say = (ok, html) => msg.replaceChildren(el('div', { class: 'feedback show ' + (ok ? 'ok' : 'no'), html }));
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = form.email.value.trim();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return say(false, 'That doesn’t look like an email address.');
        const btn = form.querySelector('button');
        btn.disabled = true;
        try {
            const r = await fetch('/course/api/early', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, from: n.dataset.earlyAccess || '', website: form.website.value }) });
            const d = await r.json().catch(() => ({}));
            if (d.ok) {
                say(true, `Almost done: we’ve sent a confirmation link to <b>${el('span', {}, email).innerHTML}</b>. Open it to join the list. Check your spam folder if it doesn’t arrive in a few minutes.`);
                form.hidden = true;
            } else say(false, d.error === 'email' ? 'That doesn’t look like an email address.'
                : d.error === 'busy' ? 'Lots of sign-ups today: please try again tomorrow.'
                : 'Sign-up isn’t available right now. Please try again later.');
        } catch (_) {
            say(false, 'Couldn’t reach the server. Check your connection and try again.');
        }
        btn.disabled = false;
    });
});

/* --------------------------------------------------------------- API -- */
window.HQ = { store, render, hg, glyph, glyphs, allen, normTr, normKey, trMatches, initClass, initPage, done,
    classes, classStatus, dueCount, courseUrl, openSearch, searchEnabled, PREVIEW, MEMBERS_OPEN, CAT,
    quiz, classify, sprint, direction, order, decipher, rebus, flashcards, mission,
    nameCartouche, match, transcribe, spell, worked, compose, spot, soundParts, srsDue, EDITOR_URL, el, track, community, sayTr, ttsScript, ttsKey, egyptianWords, alphabet, ALPHABET };
})();
