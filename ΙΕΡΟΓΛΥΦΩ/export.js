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
        s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
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
    if (gridBg) {
        canvas.backgroundImage = null;
        canvas.renderAll();
    }
    try {
        return await fn();
    } finally {
        if (gridBg) {
            canvas.backgroundImage = gridBg;
            canvas.renderAll();
        }
    }
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
        ctx.drawImage(canvas.getElement(), 0, 0);
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

// We use jsPDF directly to embed the canvas as an image plus an invisible,
// selectable Unicode text overlay.
async function saveToPDF() {
    try {
        await ensureJsPDFLoaded();
        const jsPDFCtor = getJsPDFCtor();
        if (!jsPDFCtor) throw new Error('jsPDF unavailable after load');

        const composite = await compositeCanvasWithBg();
        const pngDataUrl = composite.toDataURL('image/png');

        // 2. Build the PDF.
        const pdf = new jsPDFCtor({
            unit: 'px',
            format: [canvas.width, canvas.height],
            orientation: canvas.width >= canvas.height ? 'l' : 'p'
        });
        pdf.addImage(pngDataUrl, 'PNG', 0, 0, canvas.width, canvas.height);

        // 3. Invisible text overlay so glyphs and transliteration are
        //    selectable/copyable as Unicode. Skipped silently if the font
        //    fetch failed — the rasterised PDF is still produced.
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
                    const r = obj.getBoundingRect(true, true);
                    const fs = (obj.fontSize || 16) * (obj.scaleY || 1);
                    pdf.setFontSize(fs);
                    const lineHeight = fs * (obj.lineHeight || 1.16);
                    const lines = String(obj.text).split('\n');
                    for (let i = 0; i < lines.length; i++) {
                        if (!lines[i]) continue;
                        // Approximate baseline at ~85% down the bbox; exact
                        // position isn't critical for invisible text, only
                        // selection-region accuracy.
                        const baseline = r.top + fs * 0.85 + i * lineHeight;
                        try {
                            pdf.text(lines[i], r.left, baseline, { renderingMode: 'invisible' });
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

        // 4. Save.
        const filename = `canvas_${new Date().toISOString().split('.')[0].replace(/[-:T]/g, '_')}.pdf`;
        pdf.save(filename);

        // 5. Indicator.
        const indicator = document.createElement('div');
        indicator.textContent = textLayerOK ? 'PDF saved (selectable text)' : 'PDF saved';
        indicator.style.cssText = `position:fixed;bottom:20px;right:20px;background:rgba(0,0,0,0.8);color:white;padding:8px 16px;border-radius:4px;z-index:1000;`;
        document.body.appendChild(indicator);
        setTimeout(() => indicator.remove(), 2000);

    } catch (error) {
        console.error('Error saving PDF:', error);
        alert('Error saving PDF: ' + (error.message || error));
    }
}

// Add click handler
document.getElementById('saveAsPDF')?.addEventListener('click', saveToPDF);

