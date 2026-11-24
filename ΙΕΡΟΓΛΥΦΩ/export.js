/*!
 * ΙΕΡΟΓΛΥΦΩ editor — export
 *
 * Classic <script defer>; shares globals with the other editor scripts via the
 * global lexical environment. Do NOT convert to type="module" (inline onclick=
 * handlers need these functions global). Load order is fixed in index.html
 * (see STRUCTURE.md).
 *
 * @copyright Copyright (c) 2024–2026 Massimo Mazzon. All rights reserved.
 */

// =============================================================================
// Save as SVG
// =============================================================================
// Fabric emits text objects as real <text> nodes, so a SVG export is
// selectable and scales losslessly. Extended-A signs need their fonts inside
// the SVG (viewers rarely have them): NewGardiner (SIL OFL, which allows
// embedding in documents) for most, Hieroglyphica Magna for the 568 signs
// NewGardiner leaves out. Each is embedded only when the drawing uses one of
// its signs. The Noto base block is left as a family-name reference (most
// viewers substitute).

// Magna's signs, the same list as its unicode-range in main.css; written by
// tools/build-magna-subset.py (do not edit by hand).
const MAGNA_RANGES = 'U+13460,U+1346E,U+13475,U+13488,U+13495,U+13497,U+1349F,U+134A6,U+134A9,U+134AE,U+134B7,U+134BE,U+134C2,U+134CC,U+134F5,U+13503,U+13506,U+13515,U+1351B,U+13521,U+1352D,U+13532,U+13544-13545,U+1354A,U+1355F,U+1356A,U+1356D,U+1357D,U+13581,U+135A0,U+135A3,U+135BD,U+135C0,U+135CE,U+135D1-135D2,U+135D6,U+135DB,U+135EA,U+135EC,U+1360E,U+1361C,U+13624,U+1362B,U+13631,U+13635,U+1363A,U+13649,U+1364F,U+13658,U+1365A,U+1366A-1366B,U+136A3,U+136A8,U+136AB,U+136AE,U+136B0,U+136B3-136B4,U+136BA,U+136BC,U+136D8,U+136DD,U+136EC,U+136F1,U+136F5,U+136FD,U+13707,U+1370B,U+13712,U+1372A,U+1372D-1372E,U+1373E,U+13741,U+13746,U+1374C,U+13750,U+13755-13757,U+1375E,U+1376A-1376B,U+1376F,U+13775,U+13781-13783,U+13787,U+1378E,U+13792,U+137BB,U+137BE,U+137C0,U+137CA,U+137CF,U+137D9,U+137DD,U+137E1,U+137F1,U+137F4,U+137FB,U+13804,U+13806,U+13814,U+1381F,U+13821-13823,U+13828,U+1382C,U+13832,U+13834,U+13848,U+1384C-1384D,U+13854,U+13869,U+1386E,U+13870,U+13879,U+13887,U+13898,U+1389A,U+138A2-138A3,U+138B1,U+138B3,U+138B5,U+138BC-138BD,U+138DB,U+13901,U+13906,U+13924,U+1393B-1393C,U+13947,U+1394C,U+1394E,U+13953,U+1395C,U+13961,U+13968,U+1396C,U+13981,U+13983,U+13993,U+139A8,U+139BB,U+139BD,U+139D2,U+139D4,U+139D8,U+139E3-139E5,U+13A25,U+13A2C,U+13A2E,U+13A30-13A31,U+13A3A,U+13A46,U+13A48,U+13A4A-13A4B,U+13A4D,U+13A51-13A53,U+13A61,U+13A6F,U+13A79,U+13A90,U+13A96,U+13AA9,U+13AAC-13AAD,U+13AB2,U+13ABC,U+13AC0,U+13AC6,U+13AC9,U+13ADC,U+13AF2-13AF3,U+13AF6,U+13AFC-13AFD,U+13B04,U+13B06,U+13B09,U+13B0B,U+13B10,U+13B1F,U+13B24,U+13B29-13B2A,U+13B3A,U+13B3D,U+13B4B,U+13B52,U+13B55,U+13B5E,U+13B7A,U+13B7E,U+13B80,U+13B84,U+13B8D,U+13B96,U+13B99,U+13B9E,U+13BA7-13BA8,U+13BAC-13BAD,U+13BAF-13BB1,U+13BBA-13BBB,U+13BC1,U+13BD9,U+13BE6,U+13BEB,U+13BED,U+13C06,U+13C0C,U+13C12,U+13C1E,U+13C24,U+13C26,U+13C2C,U+13C32,U+13C35,U+13C39,U+13C3B,U+13C3D-13C3E,U+13C41-13C42,U+13C44,U+13C53,U+13C61,U+13C6B,U+13C7E,U+13C89,U+13C9A,U+13CA8-13CA9,U+13CAE,U+13CB1,U+13CB9,U+13CBB,U+13CBD,U+13CCB,U+13CCD-13CCE,U+13CD2,U+13CD7-13CD8,U+13CDB,U+13CDF,U+13CE4,U+13CE8,U+13CFD,U+13CFF,U+13D01,U+13D0C-13D0D,U+13D20-13D22,U+13D27,U+13D4F-13D50,U+13D60,U+13D66,U+13D80-13D81,U+13D85-13D86,U+13D9C,U+13D9E-13D9F,U+13DA6,U+13DAC,U+13DB0,U+13DB5,U+13DBA,U+13DC2,U+13DC5-13DC9,U+13DDB,U+13DDE,U+13DE0,U+13DE8,U+13DF3,U+13DFC,U+13E04,U+13E0C,U+13E0E,U+13E12,U+13E18,U+13E24-13E25,U+13E28-13E29,U+13E2B-13E2C,U+13E37,U+13E3B,U+13E3D-13E3E,U+13E42,U+13E46,U+13E49,U+13E4D,U+13E50,U+13E56-13E57,U+13E68-13E69,U+13E71-13E72,U+13E7F,U+13E8D,U+13E9C,U+13EA4,U+13EA7,U+13EAD-13EAE,U+13EB6,U+13EBD,U+13EBF,U+13EC1,U+13ED2,U+13EDC,U+13EF4,U+13EF7,U+13F07,U+13F09,U+13F0B,U+13F22,U+13F27,U+13F2B,U+13F35,U+13F3D,U+13F49,U+13F4B,U+13F4E,U+13F55,U+13F58,U+13F68,U+13F77,U+13F7D-13F7E,U+13F97,U+13F9B,U+13FA0,U+13FA4,U+13FAA,U+13FAF-13FB0,U+13FB2,U+13FC2,U+13FC7-13FC8,U+13FCC,U+13FD1,U+13FE3,U+13FE6,U+13FE8-13FE9,U+13FED,U+13FF8-13FF9,U+13FFC,U+14001,U+14004,U+14013,U+14015-14016,U+1402A,U+1402C,U+1402E,U+1403B-1403E,U+14047,U+1404A,U+14053,U+14055,U+1405B,U+14060,U+14064,U+14072,U+1407B,U+1407F,U+14083,U+14087,U+1408E-1408F,U+14091-14092,U+14096,U+14098,U+1409D,U+140A2,U+140A7,U+140AE,U+140BE,U+140C0,U+140C9,U+140D1-140D5,U+140D7,U+140D9,U+140DF-140E0,U+140E8-140E9,U+140EB,U+140F2,U+140F5,U+140F7-140F8,U+140FA-140FB,U+14103,U+14108,U+1410F,U+1411A,U+14123,U+14125,U+14127,U+1412E,U+14130,U+14133-14135,U+14139,U+1413D,U+14143,U+14146,U+14149-1414B,U+14163,U+14167,U+1416A,U+14171-14172,U+14188,U+1418F,U+14193,U+14198,U+1419B,U+141A0,U+141A3,U+141AE,U+141BB-141BC,U+141C4,U+141CA,U+141D1,U+141D3,U+141D9,U+141EF,U+141F8-141FA,U+14212,U+1421A,U+1421E,U+1422C,U+14239,U+14244,U+1424E-1424F,U+14252,U+14254-14255,U+14257-14258,U+14264,U+14266-14267,U+14279,U+14281,U+14284,U+14286,U+14288,U+1428E,U+14295,U+1429B,U+1429E,U+142A0,U+142A5,U+142AD,U+142B6,U+142C0,U+142C3,U+142CC,U+142CF,U+142D2,U+142E1,U+142E6-142E7,U+142ED,U+142F5,U+14301-14302,U+14305,U+14309-1430A,U+1430C,U+1430E,U+14311,U+14316,U+1431E,U+14326,U+14328,U+14330,U+14335,U+1433A,U+14347,U+14351,U+14365,U+14368,U+1437E,U+14382-14383,U+1438A,U+1438D-1438E,U+14394,U+14398,U+143A6,U+143AA,U+143AC-143AD,U+143B1-143B2,U+143B6,U+143BF,U+143C3,U+143CA,U+143CD,U+143D6,U+143DE,U+143EB-143ED,U+143F1-143F2,U+143F9'; // MAGNA-RANGES
const MAGNA_CPS = (() => {
    const set = new Set();
    for (const part of MAGNA_RANGES.split(',')) {
        const m = /U\+([0-9A-F]+)(?:-([0-9A-F]+))?/i.exec(part);
        if (!m) continue;
        const a = parseInt(m[1], 16), b = m[2] ? parseInt(m[2], 16) : a;
        for (let c = a; c <= b; c++) set.add(c);
    }
    return set;
})();

const fontDataUrlPromises = {};
function fontDataUrl(file, mime) {
    if (fontDataUrlPromises[file]) return fontDataUrlPromises[file];
    return (fontDataUrlPromises[file] = (async () => {
        try {
            const resp = await fetch('fonts/' + file);
            if (!resp.ok) return null;
            const buf = await resp.arrayBuffer();
            // Chunked base64 — apply() on a multi-MB Uint8Array can blow the stack.
            const bytes = new Uint8Array(buf);
            let bin = '';
            for (let i = 0; i < bytes.length; i += 0x8000) {
                bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
            }
            return `data:${mime};base64,` + btoa(bin);
        } catch (_) {
            delete fontDataUrlPromises[file];
            return null;
        }
    })());
}

// Which Extended-A fonts the canvas's text needs: { ng, magna }.
function extendedFontsNeeded() {
    const need = { ng: false, magna: false };
    const walk = objs => objs.forEach(o => {
        if (!o) return;
        if (typeof o.text === 'string') for (const ch of o.text) {
            const cp = ch.codePointAt(0);
            if (cp < 0x13460 || cp > 0x143FF) continue;
            if (MAGNA_CPS.has(cp)) need.magna = true; else need.ng = true;
        }
        if (o._objects) walk(o._objects);
    });
    walk(canvas.getObjects());
    return need;
}

function triggerDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// The canvas as a self-contained SVG string (fonts and background embedded).
// Used by Save as SVG and by Copy image (as the clipboard's vector version).
async function buildSVGString() {
    let svg = await withGridHidden(() => canvas.toSVG());

    // @font-face rules embedding the Extended-A fonts the drawing uses, in the
    // same order as main.css (Magna last, so its own signs are tried first).
    const need = extendedFontsNeeded();
    const fontFaces = [];
    const ng = need.ng ? await fontDataUrl('NewGardiner.ttf', 'font/ttf') : null;
    if (ng) fontFaces.push(`@font-face{font-family:'Hieroglyphica Extended';src:url(${ng}) format('truetype');unicode-range:U+13460-143FF;}`);
    const magna = need.magna ? await fontDataUrl('HieroglyphicaExtended-Regular.woff2', 'font/woff2') : null;
    if (magna) fontFaces.push(`@font-face{font-family:'Hieroglyphica Extended';src:url(${magna}) format('woff2');unicode-range:${MAGNA_RANGES};}`);
    const styleBlock = fontFaces.length
        ? `<style type="text/css"><![CDATA[${fontFaces.join('')}]]></style>`
        : '';

    // Inject the font styles right after fabric's <defs></defs>.
    const injection = styleBlock;
    if (injection) {
        if (svg.includes('</defs>')) {
            svg = svg.replace('</defs>', `</defs>${injection}`);
        } else {
            svg = svg.replace(/(<svg[^>]*>)/, `$1${injection}`);
        }
    }

    return svg;
}

async function saveToSVG() {
    const svg = await buildSVGString();
    const filename = `canvas_${new Date().toISOString().split('.')[0].replace(/[-:T]/g, '_')}.svg`;
    triggerDownload(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }), filename);
}

// =============================================================================
// PDF export lives in pdf-export.js (pdf-lib). The helpers below are shared.
// =============================================================================

// The editing grid is set as Fabric's backgroundImage (see drawGrid). Temporarily
// detach it so exports don't bake in the grid lines, then restore in `finally`.
async function withGridHidden(fn) {
    const gridBg = canvas.backgroundImage;
    // The page-size guide is a visible on-canvas object; hide it too so it never
    // bakes into a raster export (excludeFromExport already covers SVG/JSON).
    const guides = canvas.getObjects().filter(o => o._pageGuide && o.visible);
    // Drop any active selection so its border/handles don't bake into the raster.
    const active = canvas.getActiveObject();
    if (gridBg) canvas.backgroundImage = null;
    guides.forEach(o => { o.visible = false; });
    if (active) canvas.discardActiveObject();
    // Photos that are hidden or set to stay out of exports (photo-trace.js).
    const restorePhotos = typeof hidePhotosForExport === 'function' ? hidePhotosForExport() : () => {};
    canvas.renderAll();
    try {
        return await fn();
    } finally {
        restorePhotos();
        if (gridBg) canvas.backgroundImage = gridBg;
        guides.forEach(o => { o.visible = true; });
        if (active) canvas.setActiveObject(active);
        if (gridBg || guides.length || active) canvas.renderAll();
    }
}

// Opaque export background. The Fabric canvas is transparent by default (the
// editor's grey is CSS + a DOM watermark behind the canvas, not pixels), which
// made PNGs render as a transparency checkerboard. We fill white. If the user
// picked a swatch colour it's already baked into the canvas pixels and paints
// over this fill, so explicit choices still win.
function exportBgColor() {
    return '#ffffff';
}

// Supersample factor for raster exports. The Fabric objects are vector (font
// glyphs + shapes), so re-rendering them at N× — instead of blitting the
// screen-resolution backing store — yields genuinely crisp output. At 1× the
// embedded raster is ~96 DPI and looks soft when zoomed or printed; 3× ≈ 288 DPI
// (near photo-print quality). Raise for sharper output at the cost of file size.
const EXPORT_SUPERSAMPLE = 3;

// Render the Fabric canvas (tracing photos included unless excluded) onto
// a fresh canvas, so callers get a single flat raster matching what the user
// sees — minus the editing grid. Used by Save-as-PNG, Save-as-PDF, Copy-image.
async function compositeCanvasWithBg() {
    return withGridHidden(async () => {
        const SS = EXPORT_SUPERSAMPLE;
        const w = canvas.width, h = canvas.height;
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = w * SS;
        tempCanvas.height = h * SS;
        const ctx = tempCanvas.getContext('2d');
        ctx.scale(SS, SS);   // author in logical px; pixels land at SS resolution

        // Opaque backing: the Fabric canvas is transparent unless a colour was
        // picked (the editor's grey is CSS, not canvas pixels), so without this
        // PNG/PDF exports came out transparent and viewers painted a checkerboard.
        ctx.fillStyle = exportBgColor();
        ctx.fillRect(0, 0, w, h);

        // Re-render the vector objects at SS× (respecting the current viewport,
        // so pan/zoom is preserved as before) rather than blitting the backing
        // store — keeps glyph edges crisp at print DPI. fab is already w·SS×h·SS,
        // so draw it 1:1 into the SS-scaled context.
        const fab = canvas.toCanvasElement(SS);
        ctx.drawImage(fab, 0, 0, w, h);
        stampExportWatermark(ctx, w, h);
        return tempCanvas;
    });
}

// Stamps the brand watermark into the top-right corner of an export canvas.
// Used for both PNG and PDF output (the PDF embeds this raster).
function stampExportWatermark(ctx, w, h) {
    const fontSize = Math.max(13, Math.round(Math.min(w, h) * 0.03));
    const pad = Math.round(fontSize * 0.7);
    ctx.save();
    ctx.font = `bold ${fontSize}px Arial, sans-serif`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    ctx.fillStyle = 'rgba(0, 0, 0, 0.22)';
    ctx.fillText('ΙΕΡΟΓΛΥΦΩ', w - pad, pad);
    ctx.restore();
}

// The brand wordmark as a transparent PNG, tight-cropped to the glyphs. Used by
// the PDF, which paints it into the page header *margin* (like the URL footer)
// rather than baking it into the artwork. The standard PDF fonts have no Greek, so
// the "ΙΕΡΟΓΛΥΦΩ" wordmark is rasterised with a
// system font instead. Rendered at hi-res for a crisp result when placed small.
function watermarkRasterDataUrl() {
    const text = 'ΙΕΡΟΓΛΥΦΩ';
    const fontPx = 13 * EXPORT_SUPERSAMPLE;   // supersampled for sharpness
    const c = document.createElement('canvas');
    let ctx = c.getContext('2d');
    ctx.font = `bold ${fontPx}px Arial, sans-serif`;
    const tw = Math.ceil(ctx.measureText(text).width);
    const th = Math.ceil(fontPx * 1.3);
    c.width = tw; c.height = th;             // resizing resets the context
    ctx = c.getContext('2d');
    ctx.font = `bold ${fontPx}px Arial, sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = 'rgba(0, 0, 0, 0.30)';
    ctx.fillText(text, 0, 0);
    return { dataUrl: c.toDataURL('image/png'), aspect: tw / th };
}

async function saveToPNG() {
    try {
        const composite = await compositeCanvasWithBg();
        const blob = await new Promise((res) => composite.toBlob(res, 'image/png'));
        if (!blob) throw new Error('toBlob returned null');
        const filename = `canvas_${new Date().toISOString().split('.')[0].replace(/[-:T]/g, '_')}.png`;
        triggerDownload(blob, filename);
    } catch (err) {
        console.error('Error saving PNG:', err);
        alert('Error saving PNG: ' + (err.message || err));
    }
}

async function copyCanvasImage() {
    try {
        const composite = await compositeCanvasWithBg();
        const blob = await new Promise((res) => composite.toBlob(res, 'image/png'));
        if (!blob) throw new Error('toBlob returned null');
        if (!navigator.clipboard || !window.ClipboardItem) {
            throw new Error('Clipboard image write not supported in this browser');
        }
        // Also offer an SVG (vector) version where the browser can put one on
        // the clipboard (ClipboardItem.supports, Chrome 121+), so vector apps
        // can paste it; other apps keep taking the PNG. If the two-format write
        // fails for any reason, fall back to the PNG alone.
        let wroteSvg = false;
        if (typeof ClipboardItem.supports === 'function' && ClipboardItem.supports('image/svg+xml')) {
            try {
                const svg = await buildSVGString();
                await navigator.clipboard.write([new ClipboardItem({
                    'image/png': blob,
                    'image/svg+xml': new Blob([svg], { type: 'image/svg+xml' })
                })]);
                wroteSvg = true;
            } catch (e) {
                console.warn('SVG clipboard copy failed; copying PNG only', e);
            }
        }
        if (!wroteSvg) await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        showCanvasToast(wroteSvg ? 'Image copied to clipboard (PNG + SVG)' : 'Image copied to clipboard');
    } catch (err) {
        console.error('Error copying image:', err);
        alert('Could not copy image: ' + (err.message || err) + '\nFalling back to download.');
        saveToPNG();
    }
}

function showCanvasToast(msg) {
    let toast = document.getElementById('canvasToast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'canvasToast';
        document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.classList.add('visible');
    clearTimeout(showCanvasToast._t);
    showCanvasToast._t = setTimeout(() => toast.classList.remove('visible'), 1800);
}

// Run `fn` with the canvas viewport reset to identity (no zoom/pan), restoring
// afterwards. Export math maps canvas coordinates straight to rendered pixels,
// so any active zoom/pan would otherwise skew both the crop and the text
// overlay. Renders synchronously so pixels are settled before we read them.
async function withIdentityViewport(fn) {
    const vpt = (canvas.viewportTransform || [1, 0, 0, 1, 0, 0]).slice();
    const changed = vpt[0] !== 1 || vpt[1] !== 0 || vpt[2] !== 0 ||
                    vpt[3] !== 1 || vpt[4] !== 0 || vpt[5] !== 0;
    if (changed) { canvas.setViewportTransform([1, 0, 0, 1, 0, 0]); canvas.renderAll(); }
    try {
        return await fn();
    } finally {
        if (changed) { canvas.setViewportTransform(vpt); canvas.renderAll(); }
    }
}

// Pixel-accurate ink bounding box (logical canvas px) of everything currently
// painted, or null if nothing is drawn / the canvas can't be read. fabric.Text
// reports a metric line-box that often sits well off a hieroglyph's real ink, so
// cropping by getBoundingRect chopped the top/bottom of tall signs. Scanning the
// rendered pixels captures the true visible extent instead. Grid + page guide are
// hidden during the scan. Caller must already be at an identity viewport.
function _scanInkBounds() {
    const gridBg = canvas.backgroundImage;
    const guides = canvas.getObjects().filter(o => o._pageGuide && o.visible);
    const active = canvas.getActiveObject();   // selection handles are ink too
    if (gridBg) canvas.backgroundImage = null;
    guides.forEach(o => { o.visible = false; });
    if (active) canvas.discardActiveObject();
    const restorePhotos = typeof hidePhotosForExport === 'function' ? hidePhotosForExport() : () => {};
    canvas.renderAll();
    try {
        const el = canvas.getElement();
        const w = el.width, h = el.height;                 // device px
        const retina = (w / canvas.width) || 1;
        const data = el.getContext('2d').getImageData(0, 0, w, h).data;
        let minX = w, minY = h, maxX = -1, maxY = -1;
        for (let y = 0; y < h; y++) {
            const row = y * w;
            for (let x = 0; x < w; x++) {
                if (data[(row + x) * 4 + 3] > 8) {          // any non-transparent pixel
                    if (x < minX) minX = x;
                    if (x > maxX) maxX = x;
                    if (y < minY) minY = y;
                    if (y > maxY) maxY = y;
                }
            }
        }
        if (maxX < 0) return null;                          // nothing painted
        return {
            minX: minX / retina, minY: minY / retina,
            maxX: (maxX + 1) / retina, maxY: (maxY + 1) / retina
        };
    } finally {
        restorePhotos();
        if (gridBg) canvas.backgroundImage = gridBg;
        guides.forEach(o => { o.visible = true; });
        if (active) canvas.setActiveObject(active);
        canvas.renderAll();
    }
}

// Content bounding box (canvas coords) plus padding; it may reach beyond the
// visible canvas. Returns null when empty. Call inside an identity viewport so the rect lines
// up with rendered pixels.
function getContentBounds(padding = 8) {
    const objs = canvas.getObjects().filter(o => o && !o._pageGuide
        && !(o.type === 'image' && (!o.visible || o.photoExport === false)));
    if (!objs.length) return null;

    // The pixel scan below only sees the visible canvas. Objects not wholly
    // inside it (panned away, or a long imported text) count with their
    // metric bounding box instead. (Until 2026-11-24 the crop was clamped to
    // the visible canvas, and work beyond it was cut off.)
    const box = () => ({ minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
    const grow = (b, r) => {
        b.minX = Math.min(b.minX, r.left); b.minY = Math.min(b.minY, r.top);
        b.maxX = Math.max(b.maxX, r.left + r.width); b.maxY = Math.max(b.maxY, r.top + r.height);
    };
    const all = box(), outside = box();
    for (const obj of objs) {
        const r = obj.getBoundingRect(true, true);
        grow(all, r);
        if (r.left < 0 || r.top < 0 || r.left + r.width > canvas.width || r.top + r.height > canvas.height) grow(outside, r);
    }
    if (!isFinite(all.minX)) return null;

    // Prefer the true visible-ink extent (a text's metric box sits well off a
    // hieroglyph's real ink); the metric union alone is the fallback if the
    // scan is unavailable (e.g. a tainted canvas).
    let ink = null;
    try { ink = _scanInkBounds(); } catch (e) { console.warn('ink scan failed; using metric bounds', e); }
    let { minX, minY, maxX, maxY } = ink || all;
    if (ink && isFinite(outside.minX)) {
        minX = Math.min(minX, outside.minX); minY = Math.min(minY, outside.minY);
        maxX = Math.max(maxX, outside.maxX); maxY = Math.max(maxY, outside.maxY);
    }

    // True content extent (no padding) — drives the 1:1 fit decision so content
    // inside the printable area exports unscaled, padding spilling into the margin.
    const contentWidth = maxX - minX;
    const contentHeight = maxY - minY;
    minX -= padding;
    minY -= padding;
    maxX += padding;
    maxY += padding;
    const width = maxX - minX, height = maxY - minY;
    if (width <= 0 || height <= 0) return null;
    return { left: minX, top: minY, width, height, contentWidth, contentHeight };
}

// Flat raster of just the cropped region: optional DOM background image, the
// Fabric pixels (bg images are Fabric objects, so they're already in here), and
// the watermark stamped into the crop's own corner (so the crop never clips it).
// Must run inside withIdentityViewport so canvas coords map 1:1 to element px.
async function compositeCropForPDF(bounds) {
    return withGridHidden(async () => {
        const { left, top } = bounds;
        const w = Math.round(bounds.width), h = Math.round(bounds.height);
        // Browsers refuse canvases beyond ~16k px a side or ~268M px in all;
        // a very large work (e.g. an imported Sinuhe) gets a lower supersample.
        const SS = Math.max(0.25, Math.min(EXPORT_SUPERSAMPLE, 14000 / w, 14000 / h, Math.sqrt(120e6 / (w * h))));
        const out = document.createElement('canvas');
        out.width = Math.round(w * SS);
        out.height = Math.round(h * SS);
        const ctx = out.getContext('2d');
        ctx.scale(SS, SS);   // author in logical px; pixels land at SS resolution

        // Opaque background (white) so the PDF isn't transparent — see exportBgColor.
        ctx.fillStyle = exportBgColor();
        ctx.fillRect(0, 0, w, h);

        // Fabric objects, re-rendered as vectors at SS× over the crop region —
        // not a blit of the screen-resolution backing store — so glyph edges
        // stay crisp at print DPI. Re-rendering (vs. the old getElement() blit) is
        // also what lets page-guide margins export at all: a portrait guide is
        // taller than the window, so it hangs off-canvas, and a backing-store blit
        // could only ever capture the visible viewport. toCanvasElement recomputes
        // the viewport boundaries to the full crop, so off-canvas content renders.
        // The caller is at an identity viewport, so crop coords map 1:1. fab is
        // w·SS×h·SS; draw 1:1.
        const fab = canvas.toCanvasElement(SS, { left, top, width: w, height: h });
        ctx.drawImage(fab, 0, 0, w, h);

        // No watermark baked here: the PDF paints the wordmark into the page
        // header margin (see addPdfFooterAndWordmark) so it never lands on the artwork.
        return out;
    });
}

// The guide's paper rectangle in canvas coords (or null when the guide is off).
// Used for WYSIWYG "page mode" export. Relies on the globals defined in
// editor-core.js (pageGuideObj / pageGuideState / _letterFrameDims).
function pageGuidePaperRect() {
    if (typeof pageGuideObj === 'undefined' || !pageGuideObj) return null;
    const d = _letterFrameDims(pageGuideState);
    return {
        left: pageGuideObj.left, top: pageGuideObj.top,
        width: d.pageW, height: d.pageH,
        contentWidth: d.pageW, contentHeight: d.pageH
    };
}
