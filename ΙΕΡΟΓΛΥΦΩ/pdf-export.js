/*!
 * ΙΕΡΟΓΛΥΦΩ editor — PDF export
 *
 * Classic <script defer>; shares globals with the other editor scripts via the
 * global lexical environment. Do NOT convert to type="module" (inline onclick=
 * handlers need these functions global). Load order is fixed in index.html
 * (see STRUCTURE.md). Uses helpers from export.js (getContentBounds,
 * compositeCropForPDF, pageGuidePaperRect, withIdentityViewport, withGridHidden,
 * watermarkRasterDataUrl, triggerDownload, showCanvasToast).
 *
 * @copyright Copyright (c) 2024–2026 Massimo Mazzon. All rights reserved.
 */

// Two exports, both US-Letter, built with pdf-lib + fontkit (vendor/, MIT):
//
//   • Save as PDF (saveToPDF): the canvas as a picture, with an invisible
//     Unicode text layer on top, so signs and transliteration can be selected,
//     copied and searched.
//   • Save as PDF (vector text) (saveToPDFText): every sign and every line of
//     text is real PDF text in an embedded font, and shapes are vector paths,
//     so the page stays sharp at any zoom and the file stays small.
//
// Both draw the canvas by letting Fabric render each object into PdfPainter, a
// small stand-in for a canvas 2D context that writes PDF operators instead of
// pixels. Text is placed exactly where Fabric put it on the canvas.
//
// Why not jsPDF (used until 2026-11-24): its TrueType reader only maps the
// Basic Multilingual Plane, and hieroglyphs live in plane 1 (U+13000–143FF),
// so every hieroglyph came out as an empty string: the "selectable text" layer
// was empty and visible hieroglyph text impossible. It also embedded whole fonts
// (~0.5 MB a file); fontkit embeds only the glyphs used.

// -----------------------------------------------------------------------------
// Libraries and fonts (lazy, cached for the session)
// -----------------------------------------------------------------------------
const pdfScriptPromises = {};
function loadPdfScript(src) {
    if (!pdfScriptPromises[src]) {
        pdfScriptPromises[src] = new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = src;
            s.onload = resolve;
            s.onerror = () => { delete pdfScriptPromises[src]; reject(new Error('Could not load ' + src)); };
            document.head.appendChild(s);
        });
    }
    return pdfScriptPromises[src];
}
async function ensurePdfLibLoaded() {
    if (!window.PDFLib) await loadPdfScript('vendor/pdf-lib.min.js');
    if (!window.fontkit) await loadPdfScript('vendor/fontkit.umd.min.js');
    if (!window.PDFLib || !window.fontkit) throw new Error('PDF library unavailable');
}

// Fonts the PDF can embed (fonts/). All open licence except Hieroglyphica
// Magna (the editor's own font: only the 568 Extended-A signs NewGardiner
// leaves out). Its TTF is written with the woff2 by tools/build-magna-subset.py.
const PDF_FONTS = {
    egy:    'NotoSansEgyptianHieroglyphs-Regular.ttf',   // hieroglyphs U+13000–1345F
    ng:     'HieroglyphicaGardiner-Light.ttf',            // Extended-A U+13460–143FF: NewGardiner, lighter (SIL OFL)
    ext:    'HieroglyphicaExtended-Regular.ttf',          // Magna: the Extended-A signs NewGardiner lacks
    serif:  'GentiumPlus-Regular.ttf',                    // Times etc.; transliteration
    serifI: 'GentiumPlus-Italic.ttf',
    sans:   'NotoSans-Regular.ttf',                       // Arial etc.
    sansI:  'NotoSans-Italic.ttf'
};
const pdfFontCache = {};   // key -> Promise<{ bytes, fk }> (fk: parsed fontkit font)
function loadPdfFont(key) {
    if (!pdfFontCache[key]) {
        pdfFontCache[key] = (async () => {
            const resp = await fetch('fonts/' + PDF_FONTS[key]);
            if (!resp.ok) throw new Error('font ' + PDF_FONTS[key] + ': HTTP ' + resp.status);
            const bytes = new Uint8Array(await resp.arrayBuffer());
            return { bytes, fk: fontkit.create(bytes) };
        })().catch(err => { delete pdfFontCache[key]; throw err; });
    }
    return pdfFontCache[key];
}

// Which fonts to try, in order, for one character drawn with a CSS font.
function pdfFontChain(cp, css) {
    if (cp >= 0x13460 && cp <= 0x143FF) return ['ng', 'ext', 'egy'];
    if (cp >= 0x13000 && cp <= 0x1345F) return ['egy', 'ng'];
    const italic = /(^|\s)(italic|oblique)(\s|$)/i.test(cssFontPrefix(css));
    const serif = cssFontIsSerif(css);
    const i = italic ? 'I' : '';
    return serif ? ['serif' + i, 'sans' + i] : ['sans' + i, 'serif' + i];
}
// "italic normal 24px Times, serif" -> "italic normal" / "Times, serif"
function cssFontPrefix(css) { const m = /^(.*?)[\d.]+px/.exec(css || ''); return m ? m[1] : ''; }
function cssFontFamilies(css) { const m = /[\d.]+px(?:\/\S+)?\s+(.*)$/.exec(css || ''); return m ? m[1] : (css || ''); }
function cssFontIsSerif(css) {
    for (const f of cssFontFamilies(css).split(',')) {
        const n = f.trim().replace(/["']/g, '').toLowerCase();
        if (n === 'sans-serif' || /\b(arial|helvetica|verdana|segoe|roboto|open sans|liberation sans|dejavu sans)\b/.test(n)
            || /^noto sans($| (?!egyptian))/.test(n)) return false;
        if (n === 'serif' || /\b(times|georgia|garamond|gentium|palatino|cambria|book|liberation serif|dejavu serif|noto serif)\b/.test(n)) return true;
    }
    return false;
}
function cssFontPx(css) { const m = /([\d.]+)px/.exec(css || ''); return m ? parseFloat(m[1]) : 16; }

// Every text object on the canvas, groups included.
function collectTextObjects(objs, out = []) {
    for (const o of objs) {
        if (!o) continue;
        if (typeof o.text === 'string' && o._textLines) out.push(o);
        if (o._objects) collectTextObjects(o._objects, out);
    }
    return out;
}

// Load the fonts the canvas's text needs: for each character, the first font
// in its chain that has it (later fonts are fetched only when an earlier one
// lacks a character). Returns the loaded fonts by key.
async function loadFontsForText(textObjects) {
    const loaded = {};
    const get = async key => (loaded[key] = loaded[key] || await loadPdfFont(key));
    const seen = new Set();
    for (const o of textObjects) {
        (o._textLines || []).forEach((line, li) => line.forEach((ch, ci) => {
            let css;
            try { css = o._getFontDeclaration(o.getCompleteStyleDeclaration(li, ci)); }
            catch (_) { css = `${o.fontStyle || ''} ${o.fontSize || 16}px ${o.fontFamily || 'sans-serif'}`; }
            for (const c of ch) {
                const cp = c.codePointAt(0);
                if (cp <= 0x20) continue;
                const chain = pdfFontChain(cp, css);
                seen.add(cp + '|' + chain.join(','));
            }
        }));
    }
    for (const item of seen) {
        const [cpStr, chainStr] = item.split('|');
        const cp = +cpStr;
        for (const key of chainStr.split(',')) {
            const f = await get(key);
            if (f.fk.hasGlyphForCodePoint(cp)) break;
        }
    }
    return loaded;
}

// -----------------------------------------------------------------------------
// 2D affine matrices, Fabric order [a, b, c, d, e, f]
// -----------------------------------------------------------------------------
function pdfMul(m, n) {
    return [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
            m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
            m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
}
function pdfApply(m, x, y) { return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]; }
function pdfInvert(m) {
    const det = m[0] * m[3] - m[1] * m[2];
    if (!det) return null;
    return [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det,
            (m[2] * m[5] - m[3] * m[4]) / det, (m[1] * m[4] - m[0] * m[5]) / det];
}

// -----------------------------------------------------------------------------
// PdfPainter: a canvas-2D-like context that writes PDF operators
// -----------------------------------------------------------------------------
// Fabric draws through the standard canvas API (save/transform/moveTo/fill/
// fillText/drawImage…). This records the same calls as PDF content on a
// pdf-lib page. `toPage` maps canvas px to PDF points (y up). Paths are kept in
// page coordinates as they are built (as a canvas does, the transform at the
// time of each point counts). Options:
//   textOnly: true → only text, drawn invisible (the picture PDF's text layer).
class PdfPainter {
    constructor(doc, page, toPage, fonts, opts = {}) {
        this.doc = doc;
        this.page = page;
        this.toPage = toPage;
        this.fonts = fonts;                 // key -> { pdf: PDFFont, fk: fontkit font }
        this.textOnly = !!opts.textOnly;
        this.canvas = document.createElement('canvas');   // Fabric pokes ctx.canvas now and then
        this._measure = document.createElement('canvas').getContext('2d');
        this._st = {
            m: [1, 0, 0, 1, 0, 0], font: '10px sans-serif', fillStyle: '#000000', strokeStyle: '#000000',
            globalAlpha: 1, lineWidth: 1, lineCap: 'butt', lineJoin: 'miter', miterLimit: 10,
            dash: [], lineDashOffset: 0, textAlign: 'start', textBaseline: 'alphabetic'
        };
        this._stack = [];
        this._path = [];
        this._fontKeys = {};
        this._gsKeys = {};
        this._images = new Map();
        this.rasterChars = 0;               // characters no font had (drawn as pictures)
        this.textRuns = 0;
        this._ctm = toPage.slice();
    }

    // ---- state -------------------------------------------------------------
    _ops(...ops) { this.page.pushOperators(...ops); }
    _op(name, ...args) {
        const { PDFOperator, PDFNumber } = PDFLib;
        this._ops(PDFOperator.of(name, args.map(a => (typeof a === 'number' ? PDFNumber.of(a) : a))));
    }
    _setM(m) { this._st.m = m; this._ctm = pdfMul(this.toPage, m); }
    save() { this._stack.push({ ...this._st, dash: this._st.dash.slice() }); this._ops(PDFLib.pushGraphicsState()); }
    restore() {
        if (!this._stack.length) return;
        this._st = this._stack.pop();
        this._ctm = pdfMul(this.toPage, this._st.m);
        this._ops(PDFLib.popGraphicsState());
    }
    transform(a, b, c, d, e, f) { this._setM(pdfMul(this._st.m, [a, b, c, d, e, f])); }
    setTransform(a, b, c, d, e, f) {
        if (a && typeof a === 'object') ({ a, b, c, d, e, f } = a);
        this._setM([a, b, c, d, e, f]);
    }
    resetTransform() { this._setM([1, 0, 0, 1, 0, 0]); }
    translate(x, y) { this.transform(1, 0, 0, 1, x, y); }
    scale(x, y) { this.transform(x, 0, 0, y, 0, 0); }
    rotate(r) { const c = Math.cos(r), s = Math.sin(r); this.transform(c, s, -s, c, 0, 0); }
    getTransform() { const [a, b, c, d, e, f] = this._st.m; return new DOMMatrix([a, b, c, d, e, f]); }

    get font() { return this._st.font; }               set font(v) { this._st.font = v; }
    get fillStyle() { return this._st.fillStyle; }     set fillStyle(v) { this._st.fillStyle = v; }
    get strokeStyle() { return this._st.strokeStyle; } set strokeStyle(v) { this._st.strokeStyle = v; }
    get globalAlpha() { return this._st.globalAlpha; } set globalAlpha(v) { if (isFinite(v)) this._st.globalAlpha = Math.max(0, Math.min(1, v)); }
    get lineWidth() { return this._st.lineWidth; }     set lineWidth(v) { if (isFinite(v)) this._st.lineWidth = v; }
    get lineCap() { return this._st.lineCap; }         set lineCap(v) { this._st.lineCap = v; }
    get lineJoin() { return this._st.lineJoin; }       set lineJoin(v) { this._st.lineJoin = v; }
    get miterLimit() { return this._st.miterLimit; }   set miterLimit(v) { if (isFinite(v)) this._st.miterLimit = v; }
    get lineDashOffset() { return this._st.lineDashOffset; } set lineDashOffset(v) { if (isFinite(v)) this._st.lineDashOffset = v; }
    get textAlign() { return this._st.textAlign; }     set textAlign(v) { this._st.textAlign = v; }
    get textBaseline() { return this._st.textBaseline; } set textBaseline(v) { this._st.textBaseline = v; }
    setLineDash(a) { this._st.dash = Array.isArray(a) ? a.filter(n => isFinite(n) && n >= 0) : []; }
    getLineDash() { return this._st.dash.slice(); }
    // Not representable here (or not needed for export): accepted and ignored.
    set globalCompositeOperation(v) {} get globalCompositeOperation() { return 'source-over'; }
    set shadowColor(v) {} set shadowBlur(v) {} set shadowOffsetX(v) {} set shadowOffsetY(v) {}
    set imageSmoothingEnabled(v) {} set direction(v) {} set filter(v) {}
    clearRect() {}

    // ---- colours -----------------------------------------------------------
    // Any CSS colour → {r,g,b,a} in 0..1 (the browser normalises it for us).
    // Gradients come back as the first stop's colour.
    _color(style) {
        if (style && typeof style === 'object') style = style._pdfColor || '#000000';
        const c = this._measure;
        c.fillStyle = '#000000';
        c.fillStyle = style || '#000000';
        const s = c.fillStyle;
        let r = 0, g = 0, b = 0, a = 1, m;
        if ((m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(s))) {
            r = parseInt(m[1], 16); g = parseInt(m[2], 16); b = parseInt(m[3], 16);
        } else if ((m = /rgba?\(([^)]+)\)/.exec(s))) {
            const p = m[1].split(',').map(parseFloat);
            [r, g, b] = p; a = p.length > 3 ? p[3] : 1;
        }
        return { r: r / 255, g: g / 255, b: b / 255, a };
    }
    createLinearGradient() { return this._gradient(); }
    createRadialGradient() { return this._gradient(); }
    createConicGradient() { return this._gradient(); }
    _gradient() { const g = { _pdfColor: null, addColorStop(_, c) { if (!this._pdfColor) this._pdfColor = c; } }; return g; }
    createPattern() { return null; }

    // Opacity as an ExtGState, one per alpha value.
    _alphaOp(alpha) {
        if (alpha >= 0.999) return [];
        const k = alpha.toFixed(3);
        if (!this._gsKeys[k]) {
            const dict = this.doc.context.obj({ Type: 'ExtGState', ca: +k, CA: +k });
            this._gsKeys[k] = this.page.node.newExtGState('GS', this.doc.context.register(dict));
        }
        return [PDFLib.setGraphicsState(this._gsKeys[k])];
    }

    // ---- paths (kept in page coordinates) ------------------------------------
    beginPath() { this._path = []; this._cur = null; this._start = null; }
    _pt(x, y) { return pdfApply(this._ctm, x, y); }
    moveTo(x, y) { const p = this._pt(x, y); this._path.push(['m', p]); this._cur = p; this._start = p; this._curUser = [x, y]; }
    lineTo(x, y) {
        if (!this._cur) return this.moveTo(x, y);
        const p = this._pt(x, y); this._path.push(['l', p]); this._cur = p; this._curUser = [x, y];
    }
    bezierCurveTo(x1, y1, x2, y2, x, y) {
        if (!this._cur) this.moveTo(x1, y1);
        const p = this._pt(x, y);
        this._path.push(['c', this._pt(x1, y1), this._pt(x2, y2), p]); this._cur = p; this._curUser = [x, y];
    }
    quadraticCurveTo(cx, cy, x, y) {
        if (!this._cur) this.moveTo(cx, cy);
        const [x0, y0] = this._curUser;
        this.bezierCurveTo(x0 + 2 / 3 * (cx - x0), y0 + 2 / 3 * (cy - y0),
                           x + 2 / 3 * (cx - x), y + 2 / 3 * (cy - y), x, y);
    }
    closePath() {
        if (!this._cur) return;
        this._path.push(['h']); this._cur = this._start;
    }
    rect(x, y, w, h) { this.moveTo(x, y); this.lineTo(x + w, y); this.lineTo(x + w, y + h); this.lineTo(x, y + h); this.closePath(); }
    roundRect(x, y, w, h) { this.rect(x, y, w, h); }
    arc(x, y, r, a0, a1, ccw = false) {
        if (!(r >= 0)) return;
        const TAU = Math.PI * 2;
        let sweep = a1 - a0;
        if (!ccw) { if (sweep < 0 || sweep > TAU) sweep = ((sweep % TAU) + TAU) % TAU || (a1 !== a0 ? TAU : 0); if (a1 - a0 >= TAU) sweep = TAU; }
        else { if (sweep > 0 || sweep < -TAU) sweep = -(((-sweep % TAU) + TAU) % TAU) || (a1 !== a0 ? -TAU : 0); if (a0 - a1 >= TAU) sweep = -TAU; }
        const sx = x + r * Math.cos(a0), sy = y + r * Math.sin(a0);
        if (this._cur) this.lineTo(sx, sy); else this.moveTo(sx, sy);
        const n = Math.max(1, Math.ceil(Math.abs(sweep) / (Math.PI / 2) - 1e-9));
        const step = sweep / n, k = 4 / 3 * Math.tan(step / 4);
        let a = a0;
        for (let i = 0; i < n; i++) {
            const b = a + step;
            const c0 = Math.cos(a), s0 = Math.sin(a), c1 = Math.cos(b), s1 = Math.sin(b);
            this.bezierCurveTo(x + r * (c0 - k * s0), y + r * (s0 + k * c0),
                               x + r * (c1 + k * s1), y + r * (s1 - k * c1),
                               x + r * c1, y + r * s1);
            a = b;
        }
    }
    ellipse(x, y, rx, ry, rot, a0, a1, ccw) {
        const m = this._st.m;
        this.translate(x, y); this.rotate(rot || 0); this.scale(rx || 0, ry || 0);
        this.arc(0, 0, 1, a0, a1, ccw);
        this._setM(m);
    }
    arcTo(x1, y1) { this.lineTo(x1, y1); }

    _pathOps(map) {
        const { moveTo, lineTo, appendBezierCurve, closePath } = PDFLib;
        const ops = [];
        const P = p => (map ? pdfApply(map, p[0], p[1]) : p);
        for (const s of this._path) {
            if (s[0] === 'm') ops.push(moveTo(...P(s[1])));
            else if (s[0] === 'l') ops.push(lineTo(...P(s[1])));
            else if (s[0] === 'c') ops.push(appendBezierCurve(...P(s[1]), ...P(s[2]), ...P(s[3])));
            else ops.push(closePath());
        }
        return ops;
    }
    fill(a, b) {
        if (this.textOnly) return;
        let path = this._path, rule = a;
        if (a && typeof a === 'object') { path = a._pdfPath || []; rule = b; }   // fill(Path2D) not supported
        if (!path.length) return;
        const c = this._color(this._st.fillStyle);
        const alpha = c.a * this._st.globalAlpha;
        if (alpha <= 0) return;
        const saved = this._path; this._path = path;
        this._ops(PDFLib.pushGraphicsState(), ...this._alphaOp(alpha),
                  PDFLib.setFillingRgbColor(c.r, c.g, c.b), ...this._pathOps());
        this._op(rule === 'evenodd' ? 'f*' : 'f');
        this._ops(PDFLib.popGraphicsState());
        this._path = saved;
    }
    stroke() {
        if (this.textOnly || !this._path.length) return;
        const c = this._color(this._st.strokeStyle);
        const alpha = c.a * this._st.globalAlpha;
        const inv = pdfInvert(this._ctm);
        if (alpha <= 0 || !inv || !(this._st.lineWidth > 0)) return;
        // Stroke in the current user space (cm = current transform), so line
        // width and dashes scale as on the canvas.
        const st = this._st;
        const caps = { butt: 0, round: 1, square: 2 }, joins = { miter: 0, round: 1, bevel: 2 };
        this._ops(PDFLib.pushGraphicsState(), ...this._alphaOp(alpha),
                  PDFLib.concatTransformationMatrix(...this._ctm),
                  PDFLib.setLineWidth(st.lineWidth),
                  PDFLib.setLineCap(caps[st.lineCap] || 0),
                  PDFLib.setLineJoin(joins[st.lineJoin] || 0),
                  PDFLib.PDFOperator.of('M', [PDFLib.PDFNumber.of(Math.max(1, st.miterLimit || 10))]),
                  PDFLib.setDashPattern(st.dash.length % 2 ? st.dash.concat(st.dash) : st.dash, st.lineDashOffset || 0),
                  PDFLib.setStrokingRgbColor(c.r, c.g, c.b),
                  ...this._pathOps(inv), PDFLib.stroke(), PDFLib.popGraphicsState());
    }
    fillRect(x, y, w, h) { const p = this._path; this.beginPath(); this.rect(x, y, w, h); this.fill(); this._path = p; }
    strokeRect(x, y, w, h) { const p = this._path; this.beginPath(); this.rect(x, y, w, h); this.stroke(); this._path = p; }
    clip(rule) {
        if (!this._path.length) return;
        this._ops(...this._pathOps());
        this._op(rule === 'evenodd' ? 'W*' : 'W');
        this._ops(PDFLib.endPath());
    }
    isPointInPath() { return false; }

    // ---- images ----------------------------------------------------------------
    _embedImage(img, sx, sy, sw, sh) {
        let byImg = this._images.get(img);
        if (!byImg) { byImg = new Map(); this._images.set(img, byImg); }
        const k = [sx, sy, sw, sh].join(',');
        if (byImg.has(k)) return byImg.get(k);
        const natW = img.naturalWidth || img.videoWidth || img.width;
        const natH = img.naturalHeight || img.videoHeight || img.height;
        let job;
        const src = img.currentSrc || img.src || '';
        if (sx === 0 && sy === 0 && sw === natW && sh === natH && /^data:image\/jpe?g/i.test(src)) {
            job = this.doc.embedJpg(src);
        } else {
            const c = document.createElement('canvas');
            c.width = Math.max(1, Math.round(sw)); c.height = Math.max(1, Math.round(sh));
            c.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height);
            job = this.doc.embedPng(c.toDataURL('image/png'));
        }
        const entry = { job, key: null };
        byImg.set(k, entry);
        return entry;
    }
    drawImage(img, ...a) {
        if (this.textOnly || !img) return;
        const natW = img.naturalWidth || img.videoWidth || img.width;
        const natH = img.naturalHeight || img.videoHeight || img.height;
        let sx = 0, sy = 0, sw = natW, sh = natH, dx, dy, dw, dh;
        if (a.length === 2) { [dx, dy] = a; dw = natW; dh = natH; }
        else if (a.length === 4) { [dx, dy, dw, dh] = a; }
        else { [sx, sy, sw, sh, dx, dy, dw, dh] = a; }
        if (!(sw > 0 && sh > 0 && dw && dh)) return;
        const entry = this._embedImage(img, sx, sy, sw, sh);
        // Image space is the unit square, y up; place it at (dx,dy,dw,dh) y down.
        const m = pdfMul(this._ctm, [dw, 0, 0, -dh, dx, dy + dh]);
        // pdf-lib embeds images asynchronously: remember where the draw
        // operator goes and insert it in finish() (keeps the z-order).
        this._ops(PDFLib.pushGraphicsState(), ...this._alphaOp(this._st.globalAlpha),
                  PDFLib.concatTransformationMatrix(...m));
        this._imageSlots = this._imageSlots || [];
        this._imageSlots.push({ entry, at: this.page.getContentStream().operators.length });
        this._ops(PDFLib.popGraphicsState());
    }

    // ---- text ----------------------------------------------------------------
    measureText(t) { this._measure.font = this._st.font; return this._measure.measureText(t); }
    fillText(text, x, y) { this._text(String(text), x, y, 'fill'); }
    strokeText(text, x, y) { this._text(String(text), x, y, 'stroke'); }

    _fontFor(cp, css) {
        for (const key of pdfFontChain(cp, css)) {
            const f = this.fonts[key];
            if (f && f.fk.hasGlyphForCodePoint(cp)) return key;
        }
        return null;
    }
    _fontKey(key) {
        if (!this._fontKeys[key]) {
            const f = this.fonts[key].pdf;
            this._fontKeys[key] = this.page.node.newFontDictionary(f.name, f.ref);
        }
        return this._fontKeys[key];
    }
    _text(text, x, y, mode) {
        if (!text) return;
        const st = this._st, css = st.font, px = cssFontPx(css);
        const meas = this._measure;
        meas.font = css;
        // Split into runs that share a font. A space stays with the run before
        // when that font has a space (some hieroglyph fonts don't: it would
        // print as a box); runs of spaces alone are not drawn.
        const runs = [];
        let i = 0;
        for (const ch of text) {
            const cp = ch.codePointAt(0);
            const prev = runs[runs.length - 1];
            const space = /\s/.test(ch);
            const key = (space && prev && prev.key && this.fonts[prev.key].fk.hasGlyphForCodePoint(cp))
                ? prev.key : (space ? 'space' : this._fontFor(cp, css));
            if (prev && prev.key === key) prev.text += ch;
            else runs.push({ key, text: ch, start: i });
            i += ch.length;
        }
        // Alignment / baseline as the canvas would apply them.
        const total = meas.measureText(text).width;
        if (st.textAlign === 'center') x -= total / 2;
        else if (st.textAlign === 'right' || st.textAlign === 'end') x -= total;
        if (st.textBaseline !== 'alphabetic') {
            const mm = meas.measureText(text);
            const asc = mm.fontBoundingBoxAscent ?? px * 0.8, desc = mm.fontBoundingBoxDescent ?? px * 0.2;
            if (st.textBaseline === 'top' || st.textBaseline === 'hanging') y += asc;
            else if (st.textBaseline === 'middle') y += (asc - desc) / 2;
            else if (st.textBaseline === 'bottom' || st.textBaseline === 'ideographic') y -= desc;
        }
        const color = this._color(mode === 'stroke' ? st.strokeStyle : st.fillStyle);
        const alpha = color.a * st.globalAlpha;
        if (alpha <= 0 && !this.textOnly) return;

        for (const run of runs) {
            if (!run.text.trim()) continue;                       // spaces alone: nothing to draw
            const off = run.start ? meas.measureText(text.slice(0, run.start)).width : 0;
            const width = meas.measureText(run.text).width;
            if (!run.key) {                                       // no font has it
                if (!this.textOnly) this._rasterText(run.text, x + off, y, css);
                continue;
            }
            const f = this.fonts[run.key].pdf;
            const pdfWidth = f.widthOfTextAtSize(run.text, px);
            // Squeeze/stretch the run to the canvas width, so the PDF keeps the
            // canvas layout even where the PDF font's widths differ a little.
            let hs = pdfWidth > 0 && width > 0 ? width / pdfWidth : 1;
            if (!(hs > 0.5 && hs < 2)) hs = 1;
            // Text space is y up; on the canvas glyphs grow up = −y.
            const tm = pdfMul(this._ctm, [hs, 0, 0, -1, x + off, y]);
            const ops = [PDFLib.pushGraphicsState()];
            if (!this.textOnly) ops.push(...this._alphaOp(alpha));
            ops.push(PDFLib.beginText(), PDFLib.setFontAndSize(this._fontKey(run.key), px),
                     PDFLib.setTextMatrix(...tm));
            if (this.textOnly) ops.push(PDFLib.setTextRenderingMode(PDFLib.TextRenderingMode.Invisible));
            else if (mode === 'stroke') {
                ops.push(PDFLib.setTextRenderingMode(PDFLib.TextRenderingMode.Outline),
                         PDFLib.setStrokingRgbColor(color.r, color.g, color.b),
                         PDFLib.setLineWidth(st.lineWidth * Math.sqrt(Math.abs(this._ctm[0] * this._ctm[3] - this._ctm[1] * this._ctm[2]))));
            } else ops.push(PDFLib.setFillingRgbColor(color.r, color.g, color.b));
            ops.push(PDFLib.showText(f.encodeText(run.text)), PDFLib.endText(), PDFLib.popGraphicsState());
            this._ops(...ops);
            this.textRuns++;
        }
    }
    // Characters no bundled font has (Coptic, emoji…): drawn as a small picture
    // in place, so nothing goes missing.
    _rasterText(text, x, y, css) {
        const meas = this._measure; meas.font = css;
        const mm = meas.measureText(text);
        const pad = 2, SS = 4;
        const left = mm.actualBoundingBoxLeft || 0, right = mm.actualBoundingBoxRight || mm.width;
        const asc = mm.actualBoundingBoxAscent || cssFontPx(css), desc = mm.actualBoundingBoxDescent || 0;
        const w = left + right + 2 * pad, h = asc + desc + 2 * pad;
        if (!(w > 0 && h > 0)) return;
        const c = document.createElement('canvas');
        c.width = Math.ceil(w * SS); c.height = Math.ceil(h * SS);
        const g = c.getContext('2d');
        g.scale(SS, SS); g.font = css; g.fillStyle = this._st.fillStyle;
        g.fillText(text, pad + left, pad + asc);
        this.drawImage(c, x - left - pad, y - asc - pad, w, h);
        this.rasterChars += [...text].length;
    }

    // Embed the images and put their draw operators in place. Call once, after
    // all drawing.
    async finish() {
        if (!this._imageSlots) return;
        const ops = this.page.getContentStream().operators;
        // Insert from the last slot back so earlier indices stay valid.
        for (const entry of new Set(this._imageSlots.map(s => s.entry))) {
            const img = await entry.job;
            entry.key = this.page.node.newXObject('Image', img.ref);
        }
        for (let i = this._imageSlots.length - 1; i >= 0; i--) {
            const s = this._imageSlots[i];
            ops.splice(s.at, 0, PDFLib.drawObject(s.entry.key));
        }
    }
}

// Render the given Fabric objects into a painter, in z-order, with Fabric's
// per-object raster caches off (so text and shapes come through as calls,
// not as cached bitmaps).
function renderObjectsToPainter(objs, painter) {
    const prevSkip = canvas.skipOffscreen;
    canvas.skipOffscreen = false;
    const touched = [];
    const noCache = o => {
        touched.push([o, o.objectCaching]);
        o.objectCaching = false;
        (o._objects || []).forEach(noCache);
    };
    objs.forEach(noCache);
    try {
        for (const o of objs) o.render(painter);
    } finally {
        touched.forEach(([o, v]) => { o.objectCaching = v; o.dirty = true; });
        canvas.skipOffscreen = prevSkip;
    }
}

// The objects that belong in an export (no grid, page guide or editing aids).
function exportableObjects() {
    return canvas.getObjects().filter(o => o && o.visible !== false
        && !o._pageGuide && !o.isGridGroup && !o.grid && !o._straightenAid);
}

// -----------------------------------------------------------------------------
// Page layout shared by both exports
// -----------------------------------------------------------------------------
const PDF_PT = 72 / 96;      // canvas px (96 dpi) → points
const PDF_MARGIN = 36;       // 0.5 inch
const LETTER = [612, 792];

// What to export and where it goes on the page:
//   • Page guide ON  → WYSIWYG: exactly the guide's page, 1:1.
//   • Page guide OFF → crop to the content and centre it on the page, scaling
//     down only if the work is larger than the printable area.
// Must run inside withIdentityViewport. Returns null when there is nothing.
function pdfLayout() {
    const pageRect = pageGuidePaperRect();
    const pageMode = !!pageRect;
    let bounds, landscape;
    if (pageMode) {
        bounds = pageRect;
        landscape = (pageGuideState === 'l');
    } else {
        bounds = getContentBounds();
        if (!bounds) return null;
        landscape = bounds.contentWidth > bounds.contentHeight;
    }
    const [pageW, pageH] = landscape ? [LETTER[1], LETTER[0]] : LETTER;
    let fit, cW, cH, imgX, imgY;
    if (pageMode) {
        cW = pageW; cH = pageH; imgX = 0; imgY = 0;
        fit = pageW / (bounds.width * PDF_PT);
    } else {
        // Fit from the true glyph extent (not the padded crop): content inside
        // the printable area exports 1:1, larger work scales down to fit.
        const printW = pageW - 2 * PDF_MARGIN, printH = pageH - 2 * PDF_MARGIN;
        fit = Math.min(printW / (bounds.contentWidth * PDF_PT), printH / (bounds.contentHeight * PDF_PT), 1);
        cW = bounds.width * PDF_PT * fit;
        cH = bounds.height * PDF_PT * fit;
        imgX = (pageW - cW) / 2;
        imgY = (pageH - cH) / 2;
    }
    // canvas px → PDF points, y up (PDF's origin is the bottom-left corner).
    const k = PDF_PT * fit;
    const toPage = [k, 0, 0, -k, imgX - bounds.left * k, pageH - (imgY - bounds.top * k)];
    return { bounds, pageMode, pageW, pageH, fit, cW, cH, imgX, imgY, toPage };
}

// Footer URL (real text, Helvetica) and the ΙΕΡΟΓΛΥΦΩ wordmark in the top
// margin (a small picture: the standard PDF fonts have no Greek).
async function addPdfFooterAndWordmark(doc, page, L) {
    try {
        const helv = await doc.embedFont(PDFLib.StandardFonts.Helvetica);
        const text = 'www.hieroglyphica.org', size = 8;
        page.drawText(text, {
            x: (L.pageW - helv.widthOfTextAtSize(text, size)) / 2,
            y: PDF_MARGIN / 2 - size * 0.35,
            size, font: helv, color: PDFLib.rgb(150 / 255, 150 / 255, 150 / 255)
        });
    } catch (e) { console.warn('PDF footer skipped:', e); }
    try {
        const wm = watermarkRasterDataUrl();
        const img = await doc.embedPng(wm.dataUrl);
        const hPt = 9, wPt = hPt * wm.aspect;
        page.drawImage(img, { x: L.pageW - PDF_MARGIN - wPt, y: L.pageH - PDF_MARGIN / 2 - hPt / 2, width: wPt, height: hPt });
    } catch (e) { console.warn('PDF header wordmark skipped:', e); }
}

async function newPdfDoc() {
    await ensurePdfLibLoaded();
    const doc = await PDFLib.PDFDocument.create();
    doc.registerFontkit(fontkit);
    doc.setTitle('ΙΕΡΟΓΛΥΦΩ composition');
    doc.setCreator('ΙΕΡΟΓΛΥΦΩ (www.hieroglyphica.org)');
    return doc;
}

async function embedPdfFonts(doc, loaded) {
    const fonts = {};
    for (const key in loaded) {
        fonts[key] = { pdf: await doc.embedFont(loaded[key].bytes, { subset: true }), fk: loaded[key].fk };
    }
    return fonts;
}

function pdfFilename() {
    return `canvas_${new Date().toISOString().split('.')[0].replace(/[-:T]/g, '_')}.pdf`;
}

function showPdfSaved(msg) {
    document.getElementById('canvasToast')?.classList.remove('visible');   // "Making the PDF…"
    const indicator = document.createElement('div');
    indicator.textContent = msg;
    indicator.style.cssText = 'position:fixed;bottom:20px;right:20px;background:rgba(0,0,0,0.8);color:white;padding:8px 16px;border-radius:4px;z-index:1000;max-width:80vw;';
    document.body.appendChild(indicator);
    setTimeout(() => indicator.remove(), 3500);
}

// -----------------------------------------------------------------------------
// Save as PDF: picture + invisible text layer
// -----------------------------------------------------------------------------
async function saveToPDF() {
    try {
        let result = null;
        await withIdentityViewport(async () => {
            const L = pdfLayout();
            if (!L) { showCanvasToast('Nothing to export'); return; }
            const composite = await compositeCropForPDF(L.bounds);
            const doc = await newPdfDoc();
            const page = doc.addPage([L.pageW, L.pageH]);
            const png = await doc.embedPng(composite.toDataURL('image/png'));
            page.drawImage(png, { x: L.imgX, y: L.pageH - L.imgY - L.cH, width: L.cW, height: L.cH });

            // Invisible text over the picture: signs and transliteration can be
            // selected, copied and searched. Skipped if a font can't be loaded;
            // the picture alone is still a good PDF.
            let textOK = false;
            try {
                await withGridHidden(async () => {
                    const objs = exportableObjects();
                    const fonts = await embedPdfFonts(doc, await loadFontsForText(collectTextObjects(objs)));
                    const painter = new PdfPainter(doc, page, L.toPage, fonts, { textOnly: true });
                    renderObjectsToPainter(objs, painter);
                    textOK = painter.textRuns > 0;
                });
            } catch (e) { console.warn('PDF text layer skipped:', e); }

            await addPdfFooterAndWordmark(doc, page, L);
            result = { bytes: await doc.save(), fit: L.fit, textOK };
        });
        if (!result) return;
        triggerDownload(new Blob([result.bytes], { type: 'application/pdf' }), pdfFilename());
        const scaled = result.fit < 1 ? ` — scaled to ${Math.round(result.fit * 100)}% to fit page` : '';
        showPdfSaved((result.textOK ? 'PDF saved (selectable text)' : 'PDF saved') + scaled);
    } catch (error) {
        console.error('Error saving PDF:', error);
        alert('Error saving PDF: ' + (error.message || error));
    }
}

// -----------------------------------------------------------------------------
// Save as PDF (vector text): real text in embedded fonts, vector shapes
// -----------------------------------------------------------------------------
async function saveToPDFText() {
    try {
        let result = null;
        showCanvasToast('Making the PDF…');
        await withIdentityViewport(async () => {
            const L = pdfLayout();
            if (!L) { showCanvasToast('Nothing to export'); return; }
            const doc = await newPdfDoc();
            const page = doc.addPage([L.pageW, L.pageH]);
            let painter;
            await withGridHidden(async () => {
                const objs = exportableObjects();
                const fonts = await embedPdfFonts(doc, await loadFontsForText(collectTextObjects(objs)));
                painter = new PdfPainter(doc, page, L.toPage, fonts);
                // Same opaque page background as the picture exports.
                const bg = exportBgColor();
                if (bg && !/^#?f{3}(f{3})?$/i.test(bg)) {
                    painter.save(); painter.fillStyle = bg;
                    painter.fillRect(L.bounds.left, L.bounds.top, L.bounds.width, L.bounds.height);
                    painter.restore();
                }
                renderObjectsToPainter(objs, painter);
                await painter.finish();
            });
            await addPdfFooterAndWordmark(doc, page, L);
            result = { bytes: await doc.save(), fit: L.fit, raster: painter.rasterChars };
        });
        canvas.requestRenderAll();
        if (!result) return;
        triggerDownload(new Blob([result.bytes], { type: 'application/pdf' }), pdfFilename());
        const scaled = result.fit < 1 ? ` — scaled to ${Math.round(result.fit * 100)}% to fit page` : '';
        const raster = result.raster ? ` (${result.raster} character${result.raster === 1 ? '' : 's'} with no font, drawn as pictures)` : '';
        showPdfSaved('PDF saved (vector, selectable text)' + scaled + raster);
    } catch (error) {
        console.error('Error saving PDF:', error);
        alert('Error saving PDF: ' + (error.message || error));
    }
}
