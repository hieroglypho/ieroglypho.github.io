/*!
 * ΙΕΡΟΓΛΥΦΩ editor — workspace (part 3 of 7)
 *
 * Classic <script defer>; shares globals with the other editor scripts via the
 * global lexical environment. Do NOT convert to type="module" (inline onclick=
 * handlers need these functions global). Load order:
 *   editor-core → canvas-interactions → workspace → export → drawing-tools → glyph-input → editor-init
 *
 * @copyright Copyright (c) 2024 Massimo Mazzon. All rights reserved.
 */


// Build a plain serializable snapshot of the whole workspace (canvas content +
// pasted names + background image). Shared by the JSON download (saveWorkspace)
// and the localStorage autosave so the two can never drift.
function serializeWorkspace() {
    // Get canvas objects excluding grid and the (non-content) page guide
    const objects = canvas.getObjects().filter(obj => !obj.isGridGroup && !obj.grid && !obj._pageGuide);

    // Get background image state if it exists
    const bgImage = document.getElementById('bgImage');
    const bgImageState = bgImage && bgImage.src ? {
        src: bgImage.src,
        opacity: bgImage.style.opacity || 0.5,
        transform: bgImage.style.transform,
        display: bgImage.style.display,
        offsetX: bgImage.offsetLeft || 0,
        offsetY: bgImage.offsetTop || 0,
        // Extract scale from transform string
        scale: (bgImage.style.transform.match(/scale\(([\d.]+)\)/) || [null, 1])[1]
    } : null;

    // Preserve app-level custom properties on each object so reload
    // reconstitutes link state, glyph-run marker, etc.
    const CUSTOM_PROPS = ['id', 'characterKey', 'isGlyphTextRun', 'blockId', 'blockRow', 'enclosureId'];

    return {
        canvas: {
            ...canvas.toJSON(CUSTOM_PROPS),
            objects: objects.map(obj => obj.toJSON(CUSTOM_PROPS))
        },
        pastedNames: Array.from(document.getElementById('pastedNames')?.children || [])
            .map(span => ({
                id: span.id.replace('name-', ''),
                text: span.textContent.replace(', ', '')
            })),
        backgroundImage: bgImageState
    };
}

// Save and Load
function saveWorkspace() {
    try {
        const workspace = serializeWorkspace();

        // Create and trigger download
        const blob = new Blob([JSON.stringify(workspace, null, 2)], {
            type: 'application/json'
        });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = 'workspace.json';
        link.click();
        URL.revokeObjectURL(link.href);

        // Show success message
        const indicator = document.createElement('div');
        indicator.textContent = 'Saved!';
        indicator.style.cssText = `
            position: fixed;
            bottom: 20px;
            right: 20px;
            background: rgba(0,0,0,0.8);
            color: white;
            padding: 8px 16px;
            border-radius: 4px;
            z-index: 1000;
        `;
        document.body.appendChild(indicator);
        setTimeout(() => indicator.remove(), 2000);

    } catch (error) {
        console.error('Error saving workspace:', error);
        alert('Error saving workspace');
    }
}

function syncPastedNamesWithCanvas() {
    const pastedNames = document.getElementById('pastedNames');
    if (!pastedNames) {
        console.error('pastedNames container not found');
        return;
    }

    const canvasObjects = canvas.getObjects();
    console.log('Canvas objects:', canvasObjects);
    console.log('Canvas objects with characterKey:', canvasObjects.filter(obj => obj.characterKey));

    pastedNames.innerHTML = '';

    canvasObjects.forEach(obj => {
        if (obj.characterKey) {
            const span = document.createElement('span');
            span.id = `name-${obj.id}`;
            span.textContent = `${obj.characterKey} - `;
            pastedNames.appendChild(span);
            console.log('Added span for:', obj.characterKey);
        }
    });
}
// Apply a parsed workspace snapshot to the live canvas. Shared by file-open
// (loadWorkspace) and the autosave restore path.
function applyWorkspace(workspace) {
    const canvasData = workspace.canvas || workspace;

    // Clear existing content
    canvas.clear();
    const pastedNames = document.getElementById('pastedNames');
    if (pastedNames) pastedNames.innerHTML = '';

    // Filter out grid objects
    if (canvasData.objects) {
        canvasData.objects = canvasData.objects.filter(obj =>
            !obj.isGridGroup && !obj.grid
        );
    }

    // Load canvas data
    canvas.loadFromJSON(canvasData, () => {
                // Restore viewport transform
                // Restore characterKey for each object
                canvas.getObjects().forEach((obj, index) => {
                    if (workspace.pastedNames[index]) {
                        obj.characterKey = workspace.pastedNames[index].text.replace(' - ', '');
                    }
                });
                if (canvasData.viewportTransform) {
                    canvas.setViewportTransform(canvasData.viewportTransform);
                }

                // loadFromJSON rebuilt the canvas, dropping the page guide;
                // re-apply it if it was showing so the toggle stays in sync.
                if (typeof pageGuideState !== 'undefined' && pageGuideState !== 'off') {
                    pageGuideObj = null;
                    setPageGuide(pageGuideState);
                }

                // Restore background image if it exists
                if (workspace.backgroundImage) {
                    const bgImage = document.getElementById('bgImage');
                    if (bgImage) {
                        bgImage.src = workspace.backgroundImage.src;
                        bgImage.style.opacity = workspace.backgroundImage.opacity;
                        bgImage.style.transform = workspace.backgroundImage.transform;
                        bgImage.style.display = workspace.backgroundImage.display;

                        // Restore global offset variables
                        bgOffsetX = workspace.backgroundImage.offsetX || 0;
                        bgOffsetY = workspace.backgroundImage.offsetY || 0;

                        // // Update zoom slider if it exists
                        // const zoomSlider = document.getElementById('bgZoom');
                        // if (zoomSlider) {
                        //     const scale = parseFloat(workspace.backgroundImage.scale) || 1;
                        //     zoomSlider.value = scale * 100;
                        // }

                        // Update opacity slider if it exists
                        const opacitySlider = document.getElementById('bgOpacity');
                        if (opacitySlider) {
                            const opacity = parseFloat(workspace.backgroundImage.opacity) || 0.5;
                            opacitySlider.value = opacity * 100;
                        }
                    }
                }

                // Restore pasted names
                if (workspace.pastedNames?.length) {
                    workspace.pastedNames.forEach(({ id, text }) => {
                        if (text) {
                            const span = document.createElement('span');
                            span.id = `name-${id || Date.now()}`;
                            span.textContent = text;
                            pastedNames?.appendChild(span);
                        }
                    });
                }

                // Final rendering
                canvas.getObjects()
                    .filter(obj => obj.type === 'group')
                    .forEach(obj => obj.setCoords());

                drawGrid();
                canvas.requestRenderAll();
                console.log('Final canvas objects:', canvas.getObjects());
                console.log('PastedNames content:', pastedNames?.innerHTML);
                syncPastedNamesWithCanvas();
                if (pastedNames && canvas.getObjects().length !== pastedNames.children.length) {
                    console.warn('Mismatch between canvas objects and pasted names');
                }
                canvas.requestRenderAll();
            });
}

function loadWorkspace() {
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.json';

    fileInput.onchange = async (event) => {
        const file = event.target.files[0];
        if (!file) return;

        try {
            const jsonContent = await file.text();
            applyWorkspace(JSON.parse(jsonContent));
        } catch (error) {
            console.error('Error loading workspace:', error);
            alert('Error loading workspace file');
        }
    };

    // Trigger file selection
    fileInput.click();
}

// =============================================================================
// Crash-recovery autosave  (TODO-2)
// =============================================================================
// A quiet background snapshot of the workspace to localStorage so an
// involuntary loss — browser/OS crash, killed tab, power cut — doesn't wipe
// unsaved work. This is NOT a replacement for "Save as JSON" (the durable,
// shareable artefact) nor for the beforeunload nudge (deliberate navigation):
// it only buys back the *current* session if the page dies unexpectedly.
//
// One snapshot, overwritten as you work, offered back once on the next load.
const AUTOSAVE_KEY = 'ieroglypho:autosave';
const AUTOSAVE_DEBOUNCE_MS = 1000;
let autosaveTimer = null;

// Debounced entry point — called on every canvas mutation. Coalesces a burst
// of edits into a single write ~1s after the user pauses.
function scheduleAutosave() {
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(writeAutosave, AUTOSAVE_DEBOUNCE_MS);
}

// Serialize + persist. localStorage has a ~5MB cap, and an image (a big
// data-URL, whether the legacy #bgImage overlay or a Fabric image object)
// can blow it. On QuotaExceededError we retry with every image stripped — the
// actual hieroglyph work is the irreplaceable part and easily fits. If even
// that won't fit, we give up silently: autosave can never break the editor.
function writeAutosave() {
    let snapshot;
    try {
        snapshot = { savedAt: Date.now(), workspace: serializeWorkspace() };
    } catch (err) {
        console.warn('Autosave: serialize failed, skipping', err);
        return;
    }

    try {
        localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(snapshot));
        return;
    } catch (err) {
        if (!isQuotaError(err)) {
            console.warn('Autosave: write failed, skipping', err);
            return;
        }
    }

    // Over quota — drop all image payloads and retry the glyph work alone.
    snapshot.workspace.backgroundImage = null;
    if (snapshot.workspace.canvas?.objects) {
        snapshot.workspace.canvas.objects =
            snapshot.workspace.canvas.objects.filter(obj => obj.type !== 'image');
    }
    try {
        localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(snapshot));
    } catch (err2) {
        console.warn('Autosave: still over quota without images, skipping', err2);
    }
}

function isQuotaError(err) {
    return err && (err.name === 'QuotaExceededError'
        || err.name === 'NS_ERROR_DOM_QUOTA_REACHED'
        || err.code === 22 || err.code === 1014);
}

function readAutosave() {
    try {
        const raw = localStorage.getItem(AUTOSAVE_KEY);
        if (!raw) return null;
        const snapshot = JSON.parse(raw);
        // Treat an empty canvas snapshot as nothing to recover.
        if (!snapshot.workspace?.canvas?.objects?.length) return null;
        return snapshot;
    } catch (_) {
        return null;
    }
}

function clearAutosave() {
    try { localStorage.removeItem(AUTOSAVE_KEY); } catch (_) { }
}

// =============================================================================
// Shareable links — encode the whole composition into the URL hash so a single
// link reopens it live and editable (the thing a desktop tool can't do). The
// background image (a tracing aid, often a large data URL) is dropped to keep
// links short.
// =============================================================================
function bytesToB64url(bytes) {
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlToBytes(s) {
    s = s.replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
}
// Pack a string → base64url, deflated when the browser supports CompressionStream
// (a 1-char tag records which path was taken so unpack can mirror it).
async function packString(str) {
    const bytes = new TextEncoder().encode(str);
    if (typeof CompressionStream === 'function') {
        const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
        const packed = new Uint8Array(await new Response(stream).arrayBuffer());
        return 'd' + bytesToB64url(packed);
    }
    return 'r' + bytesToB64url(bytes);
}
async function unpackString(packed) {
    const tag = packed[0];
    const bytes = b64urlToBytes(packed.slice(1));
    if (tag === 'd' && typeof DecompressionStream === 'function') {
        const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
        const buf = new Uint8Array(await new Response(stream).arrayBuffer());
        return new TextDecoder().decode(buf);
    }
    return new TextDecoder().decode(bytes);
}

// Fabric re-applies these defaults when it loads objects, so any property still
// at its default is pure boilerplate — stripping it shrinks the link several-fold
// without changing a single pixel of what renders. (Share-link only; the Save-as-
// JSON file stays fully verbose.)
const SHARE_DEFAULTS = {
    strokeWidth: 1, stroke: null, strokeDashArray: null, strokeLineCap: 'butt',
    strokeDashOffset: 0, strokeLineJoin: 'miter', strokeUniform: false, strokeMiterLimit: 4,
    scaleX: 1, scaleY: 1, angle: 0, flipX: false, flipY: false, opacity: 1, shadow: null,
    visible: true, backgroundColor: '', fillRule: 'nonzero', paintFirst: 'fill',
    globalCompositeOperation: 'source-over', skewX: 0, skewY: 0,
    fontWeight: 'normal', underline: false, overline: false, linethrough: false,
    textAlign: 'left', fontStyle: 'normal', lineHeight: 1.16, textBackgroundColor: '',
    charSpacing: 0, direction: 'ltr', path: null, pathStartOffset: 0,
    pathSide: 'left', pathAlign: 'baseline'
};
function minifyForShare(snap) {
    const objs = snap.canvas && snap.canvas.objects;
    if (!Array.isArray(objs)) return snap;
    for (const o of objs) {
        delete o.version;   // redundant — the top-level canvas already carries it
        for (const k in SHARE_DEFAULTS) {
            if (k in o && JSON.stringify(o[k]) === JSON.stringify(SHARE_DEFAULTS[k])) delete o[k];
        }
        // Empty per-character style maps add up fast across many glyphs.
        if (o.styles && (Array.isArray(o.styles) ? o.styles.length === 0
            : Object.keys(o.styles).length === 0)) delete o.styles;
    }
    return snap;
}

async function buildShareLink() {
    const snap = serializeWorkspace();
    delete snap.backgroundImage;        // tracing aid, not the artwork — keep links small
    minifyForShare(snap);               // drop Fabric defaults (re-applied on load)
    const packed = await packString(JSON.stringify(snap));
    return location.origin + location.pathname + '#c=' + packed;
}

// A small dark toast (matches the existing "Saved!" indicator styling).
function showToast(msg) {
    const t = document.createElement('div');
    t.textContent = msg;
    t.style.cssText =
        'position:fixed;bottom:20px;right:20px;background:rgba(0,0,0,0.85);color:#fff;'
        + 'padding:9px 16px;border-radius:6px;z-index:3000;font-size:14px;'
        + 'box-shadow:0 2px 10px rgba(0,0,0,0.4);max-width:80vw';
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2600);
}

// The Share action: native share sheet on touch devices, clipboard copy on
// desktop. Never invokes a mail client.
async function shareWorkspace() {
    try {
        const objs = canvas.getObjects().filter(o => !o.isGridGroup && !o.grid && !o._pageGuide);
        if (!objs.length) { showToast('Nothing to share yet — add some signs first.'); return; }

        const url = await buildShareLink();

        const touch = navigator.share && /Mobi|Android|iP(hone|ad|od)/i.test(navigator.userAgent);
        if (touch) {
            try { await navigator.share({ title: 'ΙΕΡΟΓΛΥΦΩ composition', url }); return; }
            catch (e) { if (e && e.name === 'AbortError') return; }   // user dismissed the sheet
        }
        if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(url);
            showToast('Share link copied — paste it anywhere.');
        } else {
            // Last-resort fallback: drop it in the address bar to copy manually.
            history.replaceState(null, '', url);
            showToast('Share link is in the address bar — copy it.');
        }
    } catch (err) {
        console.error('Share failed', err);
        showToast('Could not create a share link.');
    }
}

// On load: if the URL carries a #c=… composition, open it (and strip the hash so
// a later reload falls back to normal autosave behaviour). Returns true if it
// handled a link, so the caller can skip the autosave-restore banner.
function loadFromShareLink() {
    const m = (location.hash || '').match(/[#&]c=([^&]+)/);
    if (!m) return false;
    unpackString(decodeURIComponent(m[1]))
        .then(json => {
            applyWorkspace(JSON.parse(json));
            canvasModified = false;     // a freshly opened share is clean until edited
            history.replaceState(null, '', location.pathname);
            showToast('Opened a shared composition — edit away.');
        })
        .catch(err => { console.error('Bad share link', err); showToast('That share link could not be opened.'); });
    return true;
}

// On load: if a recoverable snapshot exists, offer it via a small, dismissible
// banner. Non-destructive — restore only happens if the user clicks Restore, so
// a deliberate fresh start is never silently overwritten.
function initAutosaveRestore() {
    // Stream every canvas mutation into the debounced writer.
    canvas.on('object:added', scheduleAutosave);
    canvas.on('object:modified', scheduleAutosave);
    canvas.on('object:removed', scheduleAutosave);

    if (loadFromShareLink()) return;    // opened a shared link → don't also nag with restore

    const snapshot = readAutosave();
    if (!snapshot) return;
    showRestoreBanner(snapshot);
}

function showRestoreBanner(snapshot) {
    const when = snapshot.savedAt
        ? new Date(snapshot.savedAt).toLocaleString()
        : 'your last session';

    const banner = document.createElement('div');
    banner.style.cssText = `
        position: fixed;
        top: 12px;
        left: 50%;
        transform: translateX(-50%);
        background: rgba(0,0,0,0.88);
        color: #fff;
        padding: 10px 14px;
        border-radius: 6px;
        z-index: 2000;
        display: flex;
        align-items: center;
        gap: 12px;
        font-size: 14px;
        box-shadow: 0 2px 10px rgba(0,0,0,0.4);
        max-width: 92vw;
    `;

    const msg = document.createElement('span');
    msg.textContent = `Recovered unsaved work from ${when}.`;

    const restoreBtn = document.createElement('button');
    restoreBtn.textContent = 'Restore';
    const dismissBtn = document.createElement('button');
    dismissBtn.textContent = 'Dismiss';
    for (const b of [restoreBtn, dismissBtn]) {
        b.style.cssText = `
            cursor: pointer;
            border: 1px solid rgba(255,255,255,0.4);
            background: transparent;
            color: #fff;
            padding: 4px 10px;
            border-radius: 4px;
            font-size: 13px;
        `;
    }
    restoreBtn.style.background = '#2e7d32';
    restoreBtn.style.borderColor = '#2e7d32';

    restoreBtn.addEventListener('click', () => {
        try {
            applyWorkspace(snapshot.workspace);
            canvasModified = true; // restored work is unsaved until exported
        } catch (err) {
            console.error('Restore failed', err);
            alert('Could not restore the recovered session.');
        }
        banner.remove();
    });
    dismissBtn.addEventListener('click', () => {
        // User acknowledged they don't want this snapshot — drop it so it
        // doesn't re-nag on every future reload. (A fresh crash will simply
        // write a new snapshot as they work.)
        clearAutosave();
        banner.remove();
    });

    banner.append(msg, restoreBtn, dismissBtn);
    document.body.appendChild(banner);
}

// Canvas exists by the time this script runs (editor-core created it), but the
// DOM body / restore target is safest after load.
window.addEventListener('load', initAutosaveRestore);

