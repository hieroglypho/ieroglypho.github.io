// =============================================================================
// Gardiner codes bar (the strip above the canvas)
// =============================================================================
// Shows the Gardiner code of every sign on the canvas in READING order (the
// order of →MdC and the Unicode copy: rows top to bottom, cadrat by cadrat),
// linked both ways with the canvas: selected signs light up their codes, and
// clicking a code selects its sign (Shift/Ctrl/Cmd-click adds to the selection).
//
// The old list #pastedNames stays in the page, hidden: it is the ledger that
// workspace JSON, undo and paste still write to. This bar never touches it;
// it is rebuilt from the canvas objects themselves.
//
// The bar can be hidden from the ≡ menu or its own × button; the choice is
// remembered per browser (shown by default).

(function initGardinerBar() {
    const bar = document.getElementById('pastedNamesContainer');
    const list = document.getElementById('gardinerCodes');
    const closeBtn = document.getElementById('gardinerBarClose');
    const menuBtn = document.getElementById('gardinerBarBtn');
    if (!bar || !list || typeof canvas === 'undefined') return;

    const spanObjs = new WeakMap();     // code span → its canvas object
    let objSpans = new Map();           // canvas object → its code span
    let lastPrint = null;               // fingerprint of the last rendered canvas
    let timer = null;                   // pending refresh

    // ---- show / hide -------------------------------------------------------
    const KEY = 'hq_gardiner_bar';
    let shown = true;
    try { shown = localStorage.getItem(KEY) !== 'hidden'; } catch (_) {}

    function setShown(on, remember = true) {
        shown = on;
        bar.hidden = !on;
        if (menuBtn) {
            menuBtn.textContent = on ? 'Hide Gardiner codes' : 'Show Gardiner codes';
            menuBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
        }
        if (remember) {
            try { localStorage.setItem(KEY, on ? 'shown' : 'hidden'); } catch (_) {}
        }
        if (on) refreshSoon(0);
    }
    setShown(shown, false);

    if (closeBtn) closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        setShown(false);
        if (typeof showCanvasToast === 'function') {
            showCanvasToast('Gardiner codes hidden: ≡ menu → Show Gardiner codes brings them back');
        }
    });
    if (menuBtn) menuBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        setShown(!shown);
        document.getElementById('mainMenu')?.classList.add('hidden');
    });

    // ---- codes in reading order -------------------------------------------
    // The code shown for one glyph: the palette's Gardiner code, else the
    // JSesh code, else the sign itself (an Extended-A sign with no code).
    function codeOfGlyph(g) {
        const e = charsByGlyph.get(g);
        if (e) return e.length === 3 ? e[2] : e[0];
        const j = typeof jseshNameOf === 'function' ? jseshNameOf(g) : null;
        return j || g;
    }
    function codesOf(obj) {
        const glyphs = (obj.text || '').match(UNI_SIGN_RE) || [];
        // A single sign keeps the code it was placed with (as the old bar did).
        if (glyphs.length === 1 && obj.characterKey) return [obj.characterKey];
        // A run written mirrored (right to left) reads in the other order.
        return (obj.flipX ? [...glyphs].reverse() : glyphs).map(codeOfGlyph);
    }

    // Sign objects (top level only), the same filter the exports use.
    const isSign = o => o && (o.type === 'text' || o.type === 'i-text') && !o._pageGuide
        && UNI_HAS_SIGN.test(o.text || '');

    // Cheap fingerprint of everything that can change the order or the codes,
    // so a render that changed nothing doesn't trigger a re-layout. Inside a
    // multi-selection the signs keep selection-relative left/top, so the
    // selection's own transform is part of it (the layout maps those boxes
    // back to the canvas: toCanvasRect in glyph-input.js).
    function fingerprint() {
        const a = canvas.getActiveObject();
        let s = a && a.type === 'activeSelection'
            ? `sel|${Math.round(a.left)}|${Math.round(a.top)}|${(a.scaleX || 1).toFixed(3)}|${(a.scaleY || 1).toFixed(3)}|${a.angle || 0}|${a.flipX ? 1 : 0};`
            : '';
        for (const o of canvas.getObjects()) {
            if (o._pageGuide) continue;
            s += `${o.id}|${o.type}|${o.text || ''}|${o.characterKey || ''}|`
               + `${Math.round(o.left)}|${Math.round(o.top)}|${(o.scaleX || 1).toFixed(3)}|`
               + `${(o.scaleY || 1).toFixed(3)}|${o.angle || 0}|${o.flipX ? 1 : 0}|${o.group ? 1 : 0};`;
        }
        return s;
    }

    function render() {
        const signs = canvas.getObjects().filter(isSign);
        let ordered = [];
        if (signs.length) {
            try { ordered = signsInReadingOrder(canvas.getObjects()); }
            catch (err) { console.warn('Gardiner bar: reading order failed, using placement order', err); }
            // Anything the layout left out (should be nothing) goes at the end.
            if (ordered.length !== signs.length) {
                const seen = new Set(ordered);
                ordered = ordered.concat(signs.filter(o => !seen.has(o)));
            }
        }
        const frag = document.createDocumentFragment();
        objSpans = new Map();
        ordered.forEach((obj, i) => {
            const span = document.createElement('span');
            span.className = 'gcode';
            span.textContent = codesOf(obj).join(' ');
            span.title = 'Click to select this sign (Shift-click adds it to the selection)';
            spanObjs.set(span, obj);
            objSpans.set(obj, span);
            frag.appendChild(span);
            if (i < ordered.length - 1) frag.appendChild(document.createTextNode(' - '));
        });
        list.replaceChildren(frag);
        highlight();
    }

    function refreshSoon(delay = 250) {
        if (!shown) return;               // hidden: nothing to keep up to date
        clearTimeout(timer);
        timer = setTimeout(() => {
            timer = null;
            const p = fingerprint();
            if (p === lastPrint) return;
            lastPrint = p;
            render();
        }, delay);
    }
    // Any change shows up as a render; the fingerprint skips the ones that
    // changed nothing (selection, hover, zoom, pan).
    canvas.on('after:render', () => refreshSoon());

    // ---- canvas → bar: light up the selected signs' codes ------------------
    function highlight() {
        list.querySelectorAll('.gcode.selected').forEach(s => s.classList.remove('selected'));
        let first = null;
        for (const o of canvas.getActiveObjects()) {
            const s = objSpans.get(o);
            if (s) { s.classList.add('selected'); first = first || s; }
        }
        // Keep the first selected code in view inside the (scrolling) list.
        if (first) {
            const lr = list.getBoundingClientRect(), sr = first.getBoundingClientRect();
            if (sr.top < lr.top || sr.bottom > lr.bottom) {
                list.scrollTop += sr.top - lr.top - (lr.height - sr.height) / 2;
            }
        }
    }
    canvas.on('selection:created', highlight);
    canvas.on('selection:updated', highlight);
    canvas.on('selection:cleared', highlight);
    canvas.on('selection:cleared', () => refreshSoon(0));

    // ---- bar → canvas: click a code to select its sign ---------------------
    // Shift-click would extend the page's text selection instead.
    list.addEventListener('mousedown', (e) => {
        if ((e.shiftKey || e.ctrlKey || e.metaKey) && e.target.closest && e.target.closest('.gcode')) e.preventDefault();
    });
    list.addEventListener('click', (e) => {
        const span = e.target.closest && e.target.closest('.gcode');
        const obj = span && spanObjs.get(span);
        if (!obj || !canvas.getObjects().includes(obj)) return;
        // A drag that selected text in the bar is a copy, not a click.
        const sel = window.getSelection && window.getSelection();
        if (sel && !sel.isCollapsed && list.contains(sel.anchorNode)) return;
        if (!obj.selectable || !obj.evented) return;   // locked sign
        const adding = e.shiftKey || e.ctrlKey || e.metaKey;
        let objs = [obj];
        if (adding) {
            const cur = canvas.getActiveObjects();
            objs = cur.includes(obj) ? cur.filter(o => o !== obj) : cur.concat(obj);
        }
        canvas.discardActiveObject();
        if (objs.length === 1) canvas.setActiveObject(objs[0]);
        else if (objs.length > 1) canvas.setActiveObject(new fabric.ActiveSelection(objs, { canvas }));
        canvas.requestRenderAll();
        highlight();
        // Keyboard shortcuts (delete, arrows, R…) act on the canvas.
        document.getElementById('c')?.focus({ preventScroll: true });
    });

    refreshSoon(0);
})();
