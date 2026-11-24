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
// selectable and scales losslessly. We inject an @font-face for the
// bundled Hieroglyphica Extended woff2 so Extended-A glyphs survive when
// the SVG is opened on a machine without the font installed; the Noto
// base block is left as a family-name reference (most viewers substitute).

let hieroFontDataUrlPromise = null;
function ensureHieroFontDataUrl() {
    if (hieroFontDataUrlPromise) return hieroFontDataUrlPromise;
    hieroFontDataUrlPromise = (async () => {
        try {
            const resp = await fetch('fonts/HieroglyphicaExtended-Regular.woff2');
            if (!resp.ok) return null;
            const buf = await resp.arrayBuffer();
            // Chunked base64 — apply() on a multi-MB Uint8Array can blow the stack.
            const bytes = new Uint8Array(buf);
            let bin = '';
            for (let i = 0; i < bytes.length; i += 0x8000) {
                bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
            }
            return 'data:font/woff2;base64,' + btoa(bin);
        } catch (_) {
            return null;
        }
    })();
    return hieroFontDataUrlPromise;
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

    // Build an @font-face block to embed the local woff2.
    const hieroDataUrl = await ensureHieroFontDataUrl();
    const fontFaces = [];
    if (hieroDataUrl) {
        fontFaces.push(`@font-face{font-family:'Hieroglyphica Extended';src:url(${hieroDataUrl}) format('woff2');unicode-range:U+13460-143FF;}`);
    }
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
