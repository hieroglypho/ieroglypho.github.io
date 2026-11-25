/*!
 * ΙΕΡΟΓΛΥΦΩ editor — workspace
 *
 * Classic <script defer>; shares globals with the other editor scripts via the
 * global lexical environment. Do NOT convert to type="module" (inline onclick=
 * handlers need these functions global). Load order is fixed in index.html
 * (see STRUCTURE.md).
 *
 * @copyright Copyright (c) 2024–2026 Massimo Mazzon. All rights reserved.
 */


// Build a plain serializable snapshot of the whole workspace (canvas content +
// pasted names; tracing photos are ordinary Fabric image objects). Shared by the JSON download (saveWorkspace)
// and the localStorage autosave so the two can never drift.
function serializeWorkspace() {
    // Get canvas objects excluding grid and the (non-content) page guide
    const objects = canvas.getObjects().filter(obj => !obj.isGridGroup && !obj.grid && !obj._pageGuide);

    // App-level custom properties (link state, glyph-run marker, photo lock…)
    // travel with each object; the same list the undo snapshots use.
    const CUSTOM_PROPS = UNDO_PROPS;

    return {
        canvas: {
            ...canvas.toJSON(CUSTOM_PROPS),
            objects: objects.map(obj => obj.toJSON(CUSTOM_PROPS))
        },
        pastedNames: Array.from(document.getElementById('pastedNames')?.children || [])
            .map(span => ({
                id: span.id.replace('name-', ''),
                text: span.textContent.replace(', ', '')
            }))
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
        setTimeout(() => URL.revokeObjectURL(link.href), 1000);
        canvasModified = false;

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

    pastedNames.innerHTML = '';

    canvasObjects.forEach(obj => {
        if (obj.characterKey) {
            const span = document.createElement('span');
            span.id = `name-${obj.id}`;
            span.textContent = `${obj.characterKey} - `;
            pastedNames.appendChild(span);
        }
    });
}
// Apply a parsed workspace snapshot to the live canvas. Shared by file-open
// (loadWorkspace), share links and the autosave restore path. `unsaved` says
// whether the result counts as unsaved work (true only for a restored autosave).
function applyWorkspace(workspace, unsaved = false) {
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
        addMissingTextStyles(canvasData.objects);
    }

    // Load canvas data
    canvas.loadFromJSON(canvasData, () => {
                // Files saved before the flip fix can hold mirrored signs as
                // flipY + 180° (normalizeFlip, canvas-interactions.js).
                canvas.getObjects().forEach(normalizeFlip);
                // Restore viewport transform
                // Restore characterKey for each object
                // characterKey is saved on each object (CUSTOM_PROPS), so the
                // pasted-names list is only a fallback for objects that lack one.
                // Matching by index used to shift every key by one when the
                // canvas also held a photo or a shape (they have no name entry).
                // Only signs (text objects) take a name: a cartouche frame (a
                // group) used to pick one up and show as an extra "N5".
                canvas.getObjects().forEach((obj, index) => {
                    if (!obj.characterKey && typeof obj.text === 'string' && workspace.pastedNames?.[index]) {
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

                // Workspaces saved before photo tracing kept the photo in a
                // separate overlay (workspace.backgroundImage); bring it back
                // as a tracing photo on the canvas.
                if (workspace.backgroundImage?.src && workspace.backgroundImage.display !== 'none') {
                    addLegacyBackground(workspace.backgroundImage);
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
                syncPastedNamesWithCanvas();
                canvas.requestRenderAll();
                canvasModified = unsaved;
            });
}

// Share links and autosaves leave out empty `styles` (minifyForShare). Fabric
// 5 then loads the text with styles = undefined, and every later toJSON of it
// throws, so Save as JSON, sharing again and autosave all failed after opening
// a share link. Give such text objects (and any inside groups) an empty one.
function addMissingTextStyles(objects) {
    for (const o of objects || []) {
        if (!o) continue;
        if (typeof o.text === 'string' && o.styles == null) o.styles = [];
        if (Array.isArray(o.objects)) addMissingTextStyles(o.objects);
    }
}

// Old-format tracing photo -> a locked photo at the back of the canvas, sized
// to fit the window as the overlay was.
function addLegacyBackground(bg) {
    fabric.Image.fromURL(bg.src, img => {
        if (!img || !img.width) return;
        const vpt = canvas.viewportTransform;
        const z = canvas.getZoom();
        const scale = Math.min(canvas.width / img.width, canvas.height / img.height) * (parseFloat(bg.scale) || 1);
        img.set({
            originX: 'center', originY: 'center',
            left: (canvas.width / 2 + (bg.offsetX || 0) - vpt[4]) / z,
            top: (canvas.height / 2 + (bg.offsetY || 0) - vpt[5]) / z,
            scaleX: scale / z, scaleY: scale / z,
            opacity: parseFloat(bg.opacity) || 0.5,
            id: generateUniqueId(), photoLocked: true, photoExport: true
        });
        const wasModified = canvasModified;   // loading isn't an edit
        canvas.add(img);
        canvas.sendToBack(img);
        applyPhotoLock(img);
        canvas.requestRenderAll();
        canvasModified = wasModified;
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
// A quiet background snapshot of the workspace so an involuntary loss —
// browser/OS crash, killed tab, power cut — doesn't wipe unsaved work. This is
// NOT a replacement for "Save as JSON" (the durable, shareable artefact) nor
// for the beforeunload nudge (deliberate navigation): it only buys back the
// *current* session if the page dies unexpectedly.
//
// One snapshot, overwritten as you work, offered back once on the next load.
//
// Storage (TODO-7): the snapshot is trimmed like a share link (Fabric defaults
// dropped) and deflated with packString, then kept in IndexedDB, whose quota
// is a share of free disk. An imported Sinuhe (~10,000 signs) goes from 10 MB
// of raw JSON to under 0.5 MB. localStorage (~5 MB per site) is only the
// fallback when IndexedDB can't be opened; there, photos are dropped if the
// snapshot doesn't fit. Stored record: { v: 2, savedAt, data: <packed JSON> }.
// Snapshots from before TODO-7 ({ savedAt, workspace } in localStorage) are
// still read once.
const AUTOSAVE_KEY = 'ieroglypho:autosave';
const AUTOSAVE_DEBOUNCE_MS = 1000;
const AUTOSAVE_BIG_DEBOUNCE_MS = 5000;   // canvases over AUTOSAVE_BIG_OBJECTS
const AUTOSAVE_BIG_OBJECTS = 2000;
let autosaveTimer = null;

// Reads, writes and clears run one after another in this queue, so a clear
// followed by a write (Dismiss) lands in that order, and no write can replace
// the old snapshot before the restore banner has read it.
let autosaveQueue = Promise.resolve();
let autosaveWriteQueued = false;
let autosaveFailShown = false;
function queueAutosave(task) {
    const run = autosaveQueue.then(task);
    autosaveQueue = run.catch(err => console.warn('Autosave:', err));
    return run;
}

// ---- IndexedDB: one record in store 'autosave' of database 'ieroglypho' ----
let autosaveDbPromise = null;
function autosaveDb() {
    if (!autosaveDbPromise) {
        autosaveDbPromise = new Promise(resolve => {
            try {
                const open = indexedDB.open('ieroglypho', 1);
                open.onupgradeneeded = () => open.result.createObjectStore('autosave');
                open.onsuccess = () => resolve(open.result);
                open.onerror = () => resolve(null);
                open.onblocked = () => resolve(null);
            } catch (_) {
                resolve(null);   // no IndexedDB (very old or locked-down browser)
            }
        });
    }
    return autosaveDbPromise;
}
function idbAutosave(mode, op) {
    return autosaveDb().then(db => {
        if (!db) throw new Error('IndexedDB unavailable');
        return new Promise((resolve, reject) => {
            const tx = db.transaction('autosave', mode);
            const req = op(tx.objectStore('autosave'));
            tx.oncomplete = () => resolve(req.result);
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error);
        });
    });
}

// Debounced entry point — called on every canvas mutation. Coalesces a burst
// of edits into a single write after the user pauses: 1 s, or 5 s on a big
// canvas, where each snapshot costs ~0.1 s of serializing.
function scheduleAutosave() {
    clearTimeout(autosaveTimer);
    const big = canvas.getObjects().length > AUTOSAVE_BIG_OBJECTS;
    autosaveTimer = setTimeout(writeAutosave, big ? AUTOSAVE_BIG_DEBOUNCE_MS : AUTOSAVE_DEBOUNCE_MS);
}

function writeAutosave() {
    if (autosaveWriteQueued) return;    // the queued write will pick up this state too
    autosaveWriteQueued = true;
    queueAutosave(async () => {
        autosaveWriteQueued = false;
        const ok = await saveSnapshotNow();
        if (!ok && !autosaveFailShown) {
            autosaveFailShown = true;
            showToast('Autosave could not save this canvas. Use ≡ → Save as JSON to keep your work.', 8000);
        }
    });
}

// Serialize, trim, pack, store. Returns false when nothing could be saved;
// never throws, so autosave can never break the editor.
async function saveSnapshotNow() {
    let snap;
    try {
        snap = minifyForShare(serializeWorkspace());
    } catch (err) {
        console.warn('Autosave: serialize failed', err);
        return false;
    }
    const savedAt = Date.now();
    try {
        const record = { v: 2, savedAt, data: await packString(JSON.stringify(snap)) };
        await idbAutosave('readwrite', s => s.put(record, 'snapshot'));
        try { localStorage.removeItem(AUTOSAVE_KEY); } catch (_) { }   // drop any older copy
        return true;
    } catch (err) {
        console.warn('Autosave: IndexedDB write failed, trying localStorage', err);
    }
    // Fallback: localStorage. Over quota, retry without photos (the hieroglyph
    // work is the irreplaceable part).
    for (const dropPhotos of [false, true]) {
        try {
            if (dropPhotos) {
                if (!snap.canvas?.objects?.some(o => o.type === 'image')) break;
                snap.canvas.objects = snap.canvas.objects.filter(o => o.type !== 'image');
            }
            const record = { v: 2, savedAt, data: await packString(JSON.stringify(snap)) };
            localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(record));
            return true;
        } catch (err) {
            if (!isQuotaError(err)) { console.warn('Autosave: write failed', err); return false; }
        }
    }
    console.warn('Autosave: over the storage quota, skipped');
    return false;
}

function isQuotaError(err) {
    return err && (err.name === 'QuotaExceededError'
        || err.name === 'NS_ERROR_DOM_QUOTA_REACHED'
        || err.code === 22 || err.code === 1014);
}

// The saved snapshot as { savedAt, workspace }, or null when there is nothing
// to recover. IndexedDB first, then localStorage (fallback or pre-TODO-7).
async function readAutosave() {
    let record = null;
    try { record = await idbAutosave('readonly', s => s.get('snapshot')); } catch (_) { }
    if (!record) {
        try {
            const raw = localStorage.getItem(AUTOSAVE_KEY);
            if (raw) record = JSON.parse(raw);
        } catch (_) { }
    }
    if (!record) return null;
    try {
        const workspace = record.v === 2
            ? JSON.parse(await unpackString(record.data))
            : record.workspace;
        // Treat an empty canvas snapshot as nothing to recover.
        if (!workspace?.canvas?.objects?.length) return null;
        return { savedAt: record.savedAt, workspace };
    } catch (err) {
        console.warn('Autosave: could not read the saved snapshot', err);
        return null;
    }
}

function clearAutosave() {
    return queueAutosave(async () => {
        try { localStorage.removeItem(AUTOSAVE_KEY); } catch (_) { }
        try { await idbAutosave('readwrite', s => s.delete('snapshot')); } catch (_) { }
    });
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
    // Same for tracing photos on the canvas (Fabric images): a photo's data-URL
    // would make the link hundreds of KB long.
    if (snap.canvas && Array.isArray(snap.canvas.objects)) {
        snap.canvas.objects = snap.canvas.objects.filter(o => o.type !== 'image');
    }
    minifyForShare(snap);               // drop Fabric defaults (re-applied on load)
    const packed = await packString(JSON.stringify(snap));
    return location.origin + location.pathname + '#c=' + packed;
}

// A small dark toast (matches the existing "Saved!" indicator styling).
function showToast(msg, ms = 2600) {
    const t = document.createElement('div');
    t.textContent = msg;
    t.style.cssText =
        'position:fixed;bottom:20px;right:20px;background:rgba(0,0,0,0.85);color:#fff;'
        + 'padding:9px 16px;border-radius:6px;z-index:3000;font-size:14px;'
        + 'box-shadow:0 2px 10px rgba(0,0,0,0.4);max-width:80vw';
    document.body.appendChild(t);
    setTimeout(() => t.remove(), ms);
}

// Ask the share-shortener Worker (configured via window.SHARE_API) to turn the
// long #c= link into a short, permanent one. Returns null on any failure so the
// caller falls back to the full in-URL link — the feature is inert until a
// SHARE_API endpoint is set (see share-worker/README.md).
async function shortenLink(longUrl) {
    const api = ((typeof window !== 'undefined' && window.SHARE_API) || '').replace(/\/+$/, '');
    if (!api) return null;
    try {
        const res = await fetch(api + '/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: longUrl })
        });
        if (!res.ok) return null;
        const data = await res.json();
        return (data && data.url) || null;
    } catch (_) {
        return null;
    }
}

// The Share action: native share sheet on touch devices, clipboard copy on
// desktop. Uses the short link when the shortener is reachable, otherwise the
// full self-contained link. Never invokes a mail client.
async function shareWorkspace() {
    try {
        const objs = canvas.getObjects().filter(o => !o.isGridGroup && !o.grid && !o._pageGuide);
        if (!objs.length) { showToast('Nothing to share yet — add some signs first.'); return; }

        const longUrl = await buildShareLink();
        const url = (await shortenLink(longUrl)) || longUrl;
        const isShort = url !== longUrl;

        const touch = navigator.share && /Mobi|Android|iP(hone|ad|od)/i.test(navigator.userAgent);
        if (touch) {
            try { await navigator.share({ title: 'ΙΕΡΟΓΛΥΦΩ composition', url }); return; }
            catch (e) { if (e && e.name === 'AbortError') return; }   // user dismissed → fall through to copy
        }
        if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(url);
            showToast((isShort ? 'Short link' : 'Share link') + ' copied — paste it anywhere.');
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
            applyWorkspace(JSON.parse(json));     // a freshly opened share is clean until edited
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
    // Every real canvas change (not the page guide or the straighten line) marks
    // the work unsaved and streams into the debounced writer.
    const onChange = e => {
        const t = e && e.target;
        if (t && (t._pageGuide || t._straightenAid || t.isGridGroup || t.grid)) return;
        canvasModified = true;
        scheduleAutosave();
    };
    canvas.on('object:added', onChange);
    canvas.on('object:modified', onChange);
    canvas.on('object:removed', onChange);

    // Read the old snapshot first: it is the queue's first task, so no write
    // made meanwhile can replace it before the banner holds it.
    const reading = queueAutosave(readAutosave);
    if (loadFromShareLink()) return;    // opened a shared link → don't also nag with restore

    reading.then(snapshot => { if (snapshot) showRestoreBanner(snapshot); });
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

    // Autosave keeps running while the banner is up, so new work is protected;
    // Restore uses the snapshot held here, so it still works after new edits.
    restoreBtn.addEventListener('click', () => {
        const hasWork = canvas.getObjects().some(o => !o._pageGuide);
        if (hasWork && !confirm('Replace what is on the canvas now with the recovered work?')) return;
        try {
            applyWorkspace(snapshot.workspace, true);   // restored work is unsaved until saved
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
        if (canvasModified) scheduleAutosave();   // keep what was made meanwhile
    });

    banner.append(msg, restoreBtn, dismissBtn);
    document.body.appendChild(banner);
}

// Canvas exists by the time this script runs (editor-core created it), but the
// DOM body / restore target is safest after load.
window.addEventListener('load', initAutosaveRestore);

