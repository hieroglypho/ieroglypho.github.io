/*!
 * ΙΕΡΟΓΛΥΦΩ editor — export (part 4 of 7)
 *
 * Classic <script defer>; shares globals with the other editor scripts via the
 * global lexical environment. Do NOT convert to type="module" (inline onclick=
 * handlers need these functions global). Load order:
 *   editor-core → canvas-interactions → workspace → export → drawing-tools → glyph-input → editor-init
 *
 * @copyright Copyright (c) 2024 Massimo Mazzon. All rights reserved.
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

async function srcToDataUrl(src) {
    if (!src) return null;
    if (src.startsWith('data:')) return src;
    try {
        const resp = await fetch(src, { mode: 'cors' });
        if (!resp.ok) return null;
        const blob = await resp.blob();
        return await new Promise((resolve) => {
            const r = new FileReader();
            r.onload = () => resolve(r.result);
            r.onerror = () => resolve(null);
            r.readAsDataURL(blob);
        });
    } catch (_) {
        return null;
    }
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

async function saveToSVG() {
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

    // Optional background image — embed as base64 <image> so the SVG is
    // self-contained even when the user uploaded a local file.
    const bgImage = document.getElementById('bgImage');
    let bgEl = '';
    if (bgImage && bgImage.style.display !== 'none' && bgImage.src) {
        const dataUrl = await srcToDataUrl(bgImage.src);
        if (dataUrl) {
            const opacity = parseFloat(bgImage.style.opacity) || 0.5;
            bgEl = `<image href="${dataUrl}" x="0" y="0" width="${canvas.width}" height="${canvas.height}" opacity="${opacity}" preserveAspectRatio="xMidYMid meet"/>`;
        }
    }

    // Inject style + background right after fabric's <defs></defs>.
    const injection = `${styleBlock}${bgEl}`;
    if (injection) {
        if (svg.includes('</defs>')) {
            svg = svg.replace('</defs>', `</defs>${injection}`);
        } else {
            svg = svg.replace(/(<svg[^>]*>)/, `$1${injection}`);
        }
    }

    const filename = `canvas_${new Date().toISOString().split('.')[0].replace(/[-:T]/g, '_')}.svg`;
    triggerDownload(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }), filename);
}

// =============================================================================
// Save as PDF
// =============================================================================
let jsPDFPromise = null;
function getJsPDFCtor() {
    // jsPDF's UMD build exposes the constructor at window.jspdf.jsPDF;
    // older builds put it directly at window.jsPDF.
    return (window.jspdf && window.jspdf.jsPDF) || window.jsPDF || null;
}
function ensureJsPDFLoaded() {
    if (getJsPDFCtor()) return Promise.resolve();
    if (jsPDFPromise) return jsPDFPromise;
    jsPDFPromise = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        // Vendored locally (vendor/jspdf.umd.min.js) so PDF export works fully
        // offline — no CDN round-trip. Update the file to bump the version.
        s.src = 'vendor/jspdf.umd.min.js';
        s.onload = resolve;
        s.onerror = () => { jsPDFPromise = null; reject(new Error('Failed to load jsPDF')); };
        document.head.appendChild(s);
    });
    return jsPDFPromise;
}

// Lazy fetch + base64 of the bundled Noto TTF (~1 MB) for jsPDF font embedding.
// Cached after first call so subsequent PDF saves don't re-fetch.
let hieroTtfPromise = null;
function ensureHieroTtfBase64() {
    if (hieroTtfPromise) return hieroTtfPromise;
    hieroTtfPromise = (async () => {
        try {
            const resp = await fetch('fonts/NotoSansEgyptianHieroglyphs-Regular.ttf');
            if (!resp.ok) return null;
            const buf = await resp.arrayBuffer();
            const bytes = new Uint8Array(buf);
            let bin = '';
            for (let i = 0; i < bytes.length; i += 0x8000) {
                bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
            }
            return btoa(bin);
        } catch (_) {
            return null;
        }
    })();
    return hieroTtfPromise;
}

// Hybrid PDF: raster page (preserves all canvas shapes) + an invisible text
// layer (Unicode hieroglyphs and transliteration become selectable/copyable).
// The editing grid is set as Fabric's backgroundImage (see drawGrid). Temporarily
// detach it so exports don't bake in the grid lines, then restore in `finally`.
async function withGridHidden(fn) {
    const gridBg = canvas.backgroundImage;
    // The page-size guide is a visible on-canvas object; hide it too so it never
    // bakes into a raster export (excludeFromExport already covers SVG/JSON).
    const guides = canvas.getObjects().filter(o => o._pageGuide && o.visible);
    if (gridBg) canvas.backgroundImage = null;
    guides.forEach(o => { o.visible = false; });
    if (gridBg || guides.length) canvas.renderAll();
    try {
        return await fn();
    } finally {
        if (gridBg) canvas.backgroundImage = gridBg;
        guides.forEach(o => { o.visible = true; });
        if (gridBg || guides.length) canvas.renderAll();
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

// Render the background image (if visible) and the Fabric canvas pixels onto
// a fresh canvas, so callers get a single flat raster matching what the user
// sees — minus the editing grid. Used by Save-as-PNG, Save-as-PDF, Copy-image.
async function compositeCanvasWithBg() {
    return withGridHidden(async () => {
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = canvas.width;
        tempCanvas.height = canvas.height;
        const ctx = tempCanvas.getContext('2d');

        // Opaque backing: the Fabric canvas is transparent unless a colour was
        // picked (the editor's grey is CSS, not canvas pixels), so without this
        // PNG/PDF exports came out transparent and viewers painted a checkerboard.
        ctx.fillStyle = exportBgColor();
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        const bgImage = document.getElementById('bgImage');
        if (bgImage && bgImage.style.display !== 'none' && bgImage.src) {
            await new Promise((resolve) => {
                const img = new Image();
                img.crossOrigin = 'anonymous';
                img.onload = () => {
                    ctx.globalAlpha = parseFloat(bgImage.style.opacity) || 0.5;
                    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                    ctx.globalAlpha = 1;
                    resolve();
                };
                img.onerror = resolve;  // best-effort; skip bg if it fails
                img.src = bgImage.src;
            });
        }
        // The backing element is retina-scaled (width × devicePixelRatio), so
        // downscale device px -> logical px. Blitting 1:1 kept only the top-left
        // 1/dpr region on HiDPI screens, which dropped off-corner content.
        const el = canvas.getElement();
        ctx.drawImage(el, 0, 0, el.width, el.height, 0, 0, canvas.width, canvas.height);
        stampExportWatermark(ctx, canvas.width, canvas.height);
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
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        showCanvasToast('Image copied to clipboard');
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
    if (gridBg) canvas.backgroundImage = null;
    guides.forEach(o => { o.visible = false; });
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
        if (gridBg) canvas.backgroundImage = gridBg;
        guides.forEach(o => { o.visible = true; });
        canvas.renderAll();
    }
}

// Content bounding box (canvas coords) plus padding, clamped to the canvas.
// Returns null when empty. Call inside an identity viewport so the rect lines
// up with rendered pixels.
function getContentBounds(padding = 8) {
    const objs = canvas.getObjects().filter(o => o && !o._pageGuide);
    if (!objs.length) return null;

    // Prefer the true visible-ink extent; fall back to the metric union of
    // bounding boxes if the pixel scan is unavailable (e.g. a tainted canvas).
    let minX, minY, maxX, maxY;
    let ink = null;
    try { ink = _scanInkBounds(); } catch (e) { console.warn('ink scan failed; using metric bounds', e); }
    if (ink) {
        ({ minX, minY, maxX, maxY } = ink);
    } else {
        minX = Infinity; minY = Infinity; maxX = -Infinity; maxY = -Infinity;
        for (const obj of objs) {
            const r = obj.getBoundingRect(true, true);
            minX = Math.min(minX, r.left);
            minY = Math.min(minY, r.top);
            maxX = Math.max(maxX, r.left + r.width);
            maxY = Math.max(maxY, r.top + r.height);
        }
        if (!isFinite(minX)) return null;
    }

    // True content extent (no padding) — drives the 1:1 fit decision so content
    // inside the printable area exports unscaled, padding spilling into the margin.
    const contentWidth = maxX - minX;
    const contentHeight = maxY - minY;
    minX = Math.max(0, minX - padding);
    minY = Math.max(0, minY - padding);
    maxX = Math.min(canvas.width, maxX + padding);
    maxY = Math.min(canvas.height, maxY + padding);
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
        const out = document.createElement('canvas');
        out.width = w;
        out.height = h;
        const ctx = out.getContext('2d');

        // Opaque background (white) so the PDF isn't transparent — see exportBgColor.
        ctx.fillStyle = exportBgColor();
        ctx.fillRect(0, 0, w, h);

        // Legacy DOM background image (kept for parity with PNG/SVG); offset so
        // the full-canvas placement lines up under the cropped region.
        const bgImage = document.getElementById('bgImage');
        if (bgImage && bgImage.style.display !== 'none' && bgImage.src) {
            await new Promise((resolve) => {
                const img = new Image();
                img.crossOrigin = 'anonymous';
                img.onload = () => {
                    ctx.globalAlpha = parseFloat(bgImage.style.opacity) || 0.5;
                    ctx.drawImage(img, -left, -top, canvas.width, canvas.height);
                    ctx.globalAlpha = 1;
                    resolve();
                };
                img.onerror = resolve;  // best-effort; skip bg if it fails
                img.src = bgImage.src;
            });
        }

        // Fabric pixels. Draw the whole (retina) backing store downscaled to
        // logical size, translated so the crop origin lands at (0,0). This works
        // for any region — including one that extends past the canvas edge (a
        // page-guide rect on a small window); those areas keep the white fill —
        // without source-rectangle clipping.
        const el = canvas.getElement();
        ctx.drawImage(el, 0, 0, el.width, el.height, -left, -top, canvas.width, canvas.height);

        stampExportWatermark(ctx, w, h);
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

// jsPDF: embed the canvas as an image plus an invisible, selectable Unicode text
// overlay, on a US-Letter page. Two modes:
//   • Page guide ON  → WYSIWYG: export exactly the guide's page, 1:1, glyphs in
//     the positions you see (no cropping, no centring).
//   • Page guide OFF → crop tightly to the content and centre it on the page,
//     scaling down only if the work is larger than the printable area.
async function saveToPDF() {
    try {
        await ensureJsPDFLoaded();
        const jsPDFCtor = getJsPDFCtor();
        if (!jsPDFCtor) throw new Error('jsPDF unavailable after load');

        await withIdentityViewport(async () => {
            const PT = 72 / 96;            // 96 DPI canvas px → 72 DPI points
            const MARGIN = 36;             // 0.5 inch

            const pageRect = pageGuidePaperRect();
            const pageMode = !!pageRect;

            // Region of the canvas to export, and the page orientation.
            let bounds, orientation;
            if (pageMode) {
                bounds = pageRect;
                orientation = (pageGuideState === 'l') ? 'l' : 'p';
            } else {
                bounds = getContentBounds();
                if (!bounds) { showCanvasToast('Nothing to export'); return; }
                orientation = bounds.contentWidth > bounds.contentHeight ? 'l' : 'p';
            }

            const composite = await compositeCropForPDF(bounds);
            const pngDataUrl = composite.toDataURL('image/png');

            const pdf = new jsPDFCtor({ unit: 'pt', format: 'letter', orientation });
            const pageW = pdf.internal.pageSize.getWidth();
            const pageH = pdf.internal.pageSize.getHeight();

            let fit, cW, cH, imgX, imgY;
            if (pageMode) {
                // The 8.5×11" paper rectangle maps 1:1 onto the whole page.
                cW = pageW; cH = pageH; imgX = 0; imgY = 0;
                fit = pageW / (bounds.width * PT);   // ≈1; keeps the text overlay aligned
            } else {
                // Fit-to-page from the true glyph extent (not the padded crop):
                // content inside the printable area exports 1:1, the padding
                // spilling into the margin; larger work scales down to fit.
                const printW = pageW - 2 * MARGIN, printH = pageH - 2 * MARGIN;
                const nW = bounds.contentWidth * PT, nH = bounds.contentHeight * PT;
                fit = Math.min(printW / nW, printH / nH, 1);
                cW = bounds.width * PT * fit;
                cH = bounds.height * PT * fit;
                imgX = (pageW - cW) / 2;
                imgY = (pageH - cH) / 2;
            }
            pdf.addImage(pngDataUrl, 'PNG', imgX, imgY, cW, cH);

            // Invisible text overlay so glyphs and transliteration are
            // selectable/copyable as Unicode. Skipped silently if the font
            // fetch failed — the rasterised PDF is still produced. Positions are
            // crop-local (objCoord − cropOrigin) shifted to the placed image and
            // converted px→pt; no fit-scale because nothing is scaled.
            const ttfB64 = await ensureHieroTtfBase64();
            let textLayerOK = false;
            if (ttfB64) {
                try {
                    pdf.addFileToVFS('NotoSansEgyptianHieroglyphs-Regular.ttf', ttfB64);
                    pdf.addFont('NotoSansEgyptianHieroglyphs-Regular.ttf', 'NotoSansEgyptianHieroglyphs', 'normal');
                    pdf.setFont('NotoSansEgyptianHieroglyphs', 'normal');

                    for (const obj of canvas.getObjects()) {
                        if (!obj || !obj.text) continue;
                        if (obj.type !== 'text' && obj.type !== 'i-text' && obj.type !== 'textbox') continue;
                        if (obj._pageGuide) continue;
                        const r = obj.getBoundingRect(true, true);
                        const fs = (obj.fontSize || 16) * (obj.scaleY || 1);
                        // Same px→pt and fit-to-page scale as the raster image.
                        pdf.setFontSize(fs * PT * fit);
                        const lineHeight = fs * (obj.lineHeight || 1.16);
                        const lines = String(obj.text).split('\n');
                        for (let i = 0; i < lines.length; i++) {
                            if (!lines[i]) continue;
                            // Baseline ~85% down the bbox; exact position isn't
                            // critical for invisible text, only selection accuracy.
                            const localX = r.left - bounds.left;
                            const localY = (r.top - bounds.top) + fs * 0.85 + i * lineHeight;
                            try {
                                pdf.text(lines[i], imgX + localX * PT * fit, imgY + localY * PT * fit,
                                         { renderingMode: 'invisible' });
                            } catch (e) {
                                console.warn('PDF text overlay skipped:', lines[i], e);
                            }
                        }
                    }
                    textLayerOK = true;
                } catch (e) {
                    console.warn('PDF text layer disabled:', e);
                }
            }

            const filename = `canvas_${new Date().toISOString().split('.')[0].replace(/[-:T]/g, '_')}.pdf`;
            pdf.save(filename);

            const indicator = document.createElement('div');
            const scaledNote = fit < 1 ? ` — scaled to ${Math.round(fit * 100)}% to fit page` : '';
            indicator.textContent = (textLayerOK ? 'PDF saved (selectable text)' : 'PDF saved') + scaledNote;
            indicator.style.cssText = `position:fixed;bottom:20px;right:20px;background:rgba(0,0,0,0.8);color:white;padding:8px 16px;border-radius:4px;z-index:1000;`;
            document.body.appendChild(indicator);
            setTimeout(() => indicator.remove(), 2000);
        });

    } catch (error) {
        console.error('Error saving PDF:', error);
        alert('Error saving PDF: ' + (error.message || error));
    }
}

// Add click handler
document.getElementById('saveAsPDF')?.addEventListener('click', saveToPDF);

