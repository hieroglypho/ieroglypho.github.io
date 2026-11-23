/*!
 * ΙΕΡΟΓΛΥΦΩ editor — photo tracing
 *
 * A photo loaded with the BG button is a Fabric image on the canvas, sent to
 * the back. This file adds the tools for tracing over it, in a small panel
 * that the BG button opens once a photo is loaded:
 *   • lock      — the photo stops reacting to the mouse, so signs can be placed,
 *                 moved and drag-selected on top of it without grabbing it
 *   • rotate    — slider, ±0.5° nudges, ±90° turns
 *   • straighten — click two points along a line that should be level (a
 *                 register line, a column edge); the photo turns so that line
 *                 lies on the grid, pivoting on the line's middle so the part
 *                 you are tracing stays put
 *   • fit to view, reset angle, hide, replace, remove
 *   • "Include photo in exports" — PNG / PDF / SVG / Copy image with or
 *                 without the photo
 * Share links never carry the photo (workspace.js), JSON saves always do.
 *
 * State lives on the image itself, so it saves, autosaves and undoes with it:
 *   photoLocked (bool), photoExport (bool, default true).
 * Every image object on the canvas is a tracing photo: the editor adds images
 * only through the BG button.
 *
 * Classic <script defer>, loaded just before editor-init.js, whose
 * DOMContentLoaded dispatcher calls initPhotoTrace(). Shares the editor's
 * globals (canvas, pushUndo, undoLastAction, showCanvasToast); export.js and
 * workspace.js call hidePhotosForExport() / photoLoaded() only behind typeof checks.
 *
 * @copyright Copyright (c) 2024 Massimo Mazzon. All rights reserved.
 */

const PHOTO_PROPS = ['photoLocked', 'photoExport'];

function isPhoto(o) { return !!o && o.type === 'image'; }
function getPhotos() { return canvas.getObjects().filter(isPhoto); }

// The photo the panel acts on: the selected one, else the most recently added.
function currentPhoto() {
    const active = canvas.getActiveObject();
    if (isPhoto(active)) return active;
    const photos = getPhotos();
    return photos.length ? photos[photos.length - 1] : null;
}

function photoExportOn(o) { return o.photoExport !== false; }

// Apply the lock flag to Fabric's interaction properties. Called whenever a
// photo arrives on the canvas (upload, workspace load, autosave restore, undo).
function applyPhotoLock(o) {
    const locked = !!o.photoLocked;
    o.set({
        selectable: !locked,
        evented: !locked,
        hoverCursor: locked ? 'default' : null
    });
    if (locked && canvas.getActiveObject() === o) canvas.discardActiveObject();
}

// ---------------------------------------------------------------- exports ---
// Called by export.js (withGridHidden, _scanInkBounds) around every export:
// photos that are hidden or set to "not in exports" are taken out of the
// raster AND the SVG, then put back. Returns the restore function.
function hidePhotosForExport() {
    const changed = [];
    getPhotos().forEach(o => {
        if (!o.visible || !photoExportOn(o)) {
            changed.push([o, o.visible, o.excludeFromExport]);
            o.visible = false;
            o.excludeFromExport = true;
        }
    });
    return () => changed.forEach(([o, vis, excl]) => { o.visible = vis; o.excludeFromExport = excl; });
}

// ------------------------------------------------------------- transforms ---
function photoTransformState(o) {
    return { id: o.id, left: o.left, top: o.top, scaleX: o.scaleX, scaleY: o.scaleY,
             angle: o.angle, flipX: o.flipX, flipY: o.flipY };
}

// One undo step for a photo transform: record the state BEFORE the change.
function pushPhotoUndo(before) {
    if (!before) return;
    pushUndo({ type: 'modify', actionType: 'rotation',
               state: { type: 'snapshot', objects: [before] } });
}

function normAngle(a) {
    a = ((a % 360) + 360) % 360;
    return a > 180 ? a - 360 : a;
}

// Turn the photo to `angle` degrees, pivoting on canvas point `pivot`
// (default: the photo's own centre).
function setPhotoAngle(o, angle, pivot) {
    const center = o.getCenterPoint();
    const p = pivot || center;
    const delta = fabric.util.degreesToRadians(normAngle(angle) - (o.angle || 0));
    const newCenter = fabric.util.rotatePoint(center, p, delta);
    o.set('angle', normAngle(angle));
    o.setPositionByOrigin(newCenter, 'center', 'center');
    o.setCoords();
}

function commitPhotoChange() {
    canvas.requestRenderAll();
    canvas.fire('object:modified', { target: null });   // autosave + "modified" flag
    syncPhotoPanel();
}

function rotatePhotoBy(delta) {
    const o = currentPhoto();
    if (!o) return;
    pushPhotoUndo(photoTransformState(o));
    setPhotoAngle(o, (o.angle || 0) + delta);
    commitPhotoChange();
}

function resetPhotoAngle() {
    const o = currentPhoto();
    if (!o || !o.angle) return;
    pushPhotoUndo(photoTransformState(o));
    setPhotoAngle(o, 0);
    commitPhotoChange();
}

// Scale and centre the photo to fill 80% of what is on screen now.
function fitPhotoToView() {
    const o = currentPhoto();
    if (!o) return;
    pushPhotoUndo(photoTransformState(o));
    const inv = fabric.util.invertTransform(canvas.viewportTransform);
    const tl = fabric.util.transformPoint(new fabric.Point(0, 0), inv);
    const br = fabric.util.transformPoint(new fabric.Point(canvas.width, canvas.height), inv);
    const viewW = br.x - tl.x, viewH = br.y - tl.y;
    // Size of the photo's rotated bounding box at scale 1.
    const r = fabric.util.degreesToRadians(o.angle || 0);
    const bw = Math.abs(o.width * Math.cos(r)) + Math.abs(o.height * Math.sin(r));
    const bh = Math.abs(o.width * Math.sin(r)) + Math.abs(o.height * Math.cos(r));
    const s = Math.min(viewW / bw, viewH / bh) * 0.8;
    o.set({ scaleX: s * Math.sign(o.scaleX || 1), scaleY: s * Math.sign(o.scaleY || 1) });
    o.setPositionByOrigin(new fabric.Point(tl.x + viewW / 2, tl.y + viewH / 2), 'center', 'center');
    o.setCoords();
    commitPhotoChange();
}

// ------------------------------------------------------------ straighten ---
let straighten = null;   // { first, line, dot, saved } while picking

function startStraighten() {
    const o = currentPhoto();
    if (!o || straighten) return;
    closePhotoPanel();
    canvas.discardActiveObject();
    straighten = {
        first: null, line: null, dot: null,
        saved: { selection: canvas.selection, skip: canvas.skipTargetFind, cursor: canvas.defaultCursor }
    };
    canvas.selection = false;
    canvas.skipTargetFind = true;          // clicks must not grab or move anything
    canvas.defaultCursor = 'crosshair';
    canvas.on('mouse:down', straightenDown);
    canvas.on('mouse:move', straightenMove);
    document.addEventListener('keydown', straightenKey, true);
    showPhotoHint('Straighten: click two points along a line that should be level or upright ' +
                  '(a register line, a column edge). Esc cancels.');
    canvas.requestRenderAll();
}

function straightenMarker(p) {
    const zoom = canvas.getZoom() || 1;
    return new fabric.Circle({
        left: p.x, top: p.y, radius: 4 / zoom, originX: 'center', originY: 'center',
        fill: '#ff3b30', stroke: '#fff', strokeWidth: 1 / zoom,
        selectable: false, evented: false, excludeFromExport: true, _straightenAid: true
    });
}

function straightenDown(opt) {
    if (!straighten) return;
    const p = canvas.getPointer(opt.e);
    if (!straighten.first) {
        const zoom = canvas.getZoom() || 1;
        straighten.first = p;
        straighten.dot = straightenMarker(p);
        straighten.line = new fabric.Line([p.x, p.y, p.x, p.y], {
            stroke: '#ff3b30', strokeWidth: 2 / zoom, strokeDashArray: [6 / zoom, 4 / zoom],
            selectable: false, evented: false, excludeFromExport: true, _straightenAid: true
        });
        canvas.add(straighten.line, straighten.dot);
        canvas.requestRenderAll();
        return;
    }
    const a = straighten.first;
    const dx = p.x - a.x, dy = p.y - a.y;
    if (Math.hypot(dx, dy) * (canvas.getZoom() || 1) < 10) return;   // too short: wait for a real second point
    const lineAngle = fabric.util.radiansToDegrees(Math.atan2(dy, dx));
    // Turn by the smallest amount that brings the line onto an axis
    // (level or upright): always within ±45°.
    let delta = -lineAngle;
    delta = normAngle(delta);
    delta = ((delta + 45) % 90 + 90) % 90 - 45;
    const o = currentPhoto();
    const pivot = new fabric.Point((a.x + p.x) / 2, (a.y + p.y) / 2);
    endStraighten();
    if (o && Math.abs(delta) > 0.01) {
        pushPhotoUndo(photoTransformState(o));
        setPhotoAngle(o, (o.angle || 0) + delta, pivot);
        commitPhotoChange();
        showCanvasToast(`Photo turned ${delta > 0 ? '+' : ''}${delta.toFixed(1)}°`);
    } else {
        showCanvasToast('Already straight');
    }
}

function straightenMove(opt) {
    if (!straighten || !straighten.line) return;
    const p = canvas.getPointer(opt.e);
    straighten.line.set({ x2: p.x, y2: p.y });
    canvas.requestRenderAll();
}

function straightenKey(e) {
    if (e.key === 'Escape' && straighten) {
        e.stopPropagation();
        endStraighten();
        showCanvasToast('Straighten cancelled');
    }
}

function endStraighten() {
    if (!straighten) return;
    canvas.off('mouse:down', straightenDown);
    canvas.off('mouse:move', straightenMove);
    document.removeEventListener('keydown', straightenKey, true);
    canvas.getObjects().filter(o => o._straightenAid).forEach(o => canvas.remove(o));
    canvas.selection = straighten.saved.selection;
    canvas.skipTargetFind = straighten.saved.skip;
    canvas.defaultCursor = straighten.saved.cursor;
    straighten = null;
    hidePhotoHint();
    canvas.requestRenderAll();
}

// ----------------------------------------------------------------- toggles ---
function setPhotosLocked(locked) {
    getPhotos().forEach(o => { o.photoLocked = locked; applyPhotoLock(o); });
    canvas.requestRenderAll();
    canvas.fire('object:modified', { target: null });
    syncPhotoPanel();
}

function togglePhotoVisible() {
    const photos = getPhotos();
    const show = photos.some(o => !o.visible);
    photos.forEach(o => { o.visible = show; });
    canvas.requestRenderAll();
    canvas.fire('object:modified', { target: null });
    syncPhotoPanel();
}

function setPhotoExport(on) {
    getPhotos().forEach(o => { o.photoExport = !!on; });
    canvas.fire('object:modified', { target: null });
    syncPhotoPanel();
}

function removePhoto() {
    const o = currentPhoto();
    if (!o) return;
    pushUndo({ type: 'delete', object: o.toJSON(['id', ...PHOTO_PROPS]), id: o.id });
    canvas.remove(o);
    canvas.requestRenderAll();
    if (!getPhotos().length) closePhotoPanel(); else syncPhotoPanel();
}

function replacePhoto() {
    closePhotoPanel();
    pendingPhotoReplace = currentPhoto();
    document.getElementById('bgImageInput').click();
}
// Set by replacePhoto(); editor-init's upload handler calls photoLoaded(img)
// after adding a new photo, which then takes the old one's place.
let pendingPhotoReplace = null;

// Called by editor-init.js once an uploaded photo is on the canvas.
function photoLoaded(img) {
    const old = pendingPhotoReplace;
    pendingPhotoReplace = null;
    if (old && canvas.getObjects().includes(old) && old !== img) {
        // Keep the old photo's place, angle, lock and export choice; size the
        // new one to the same on-canvas width.
        const w = old.getScaledWidth();
        img.set({ angle: old.angle, photoLocked: old.photoLocked, photoExport: old.photoExport,
                  visible: old.visible, opacity: old.opacity });
        img.scaleToWidth(w);
        img.setPositionByOrigin(old.getCenterPoint(), 'center', 'center');
        canvas.remove(old);
        canvas.sendToBack(img);
        img.setCoords();
    } else if (img.photoExport === undefined) {
        img.photoExport = true;
    }
    applyPhotoLock(img);
    canvas.requestRenderAll();
    openPhotoPanel();
}

// ------------------------------------------------------------------- panel ---
function photoPanel() { return document.getElementById('photoPanel'); }

function openPhotoPanel() {
    const panel = photoPanel();
    if (!panel || !getPhotos().length) return;
    panel.hidden = false;
    document.getElementById('bgBtn')?.classList.add('active');
    syncPhotoPanel();
}

function closePhotoPanel() {
    const panel = photoPanel();
    if (panel) panel.hidden = true;
    document.getElementById('bgBtn')?.classList.remove('active');
}

// BG button: no photo yet → choose one; otherwise open/close the panel.
function onBgButton(e) {
    e?.stopPropagation();
    if (!getPhotos().length) { document.getElementById('bgImageInput').click(); return; }
    const panel = photoPanel();
    if (panel && panel.hidden) openPhotoPanel(); else closePhotoPanel();
}

function syncPhotoPanel() {
    const panel = photoPanel();
    if (!panel || panel.hidden) return;
    const o = currentPhoto();
    if (!o) { closePhotoPanel(); return; }
    const photos = getPhotos();
    const locked = photos.every(p => p.photoLocked);
    const hidden = photos.every(p => !p.visible);
    const lockBtn = panel.querySelector('[data-photo="lock"]');
    lockBtn.classList.toggle('active', locked);
    lockBtn.textContent = locked ? '🔒 Locked' : '🔓 Lock';
    lockBtn.title = locked
        ? 'The photo ignores the mouse: place and select signs over it. Click to unlock and move or resize it.'
        : 'Lock the photo so signs can be placed and selected over it without moving it';
    const eyeBtn = panel.querySelector('[data-photo="hide"]');
    eyeBtn.classList.toggle('active', hidden);
    eyeBtn.textContent = hidden ? '🙈 Show' : '👁 Hide';
    const angle = normAngle(o.angle || 0);
    panel.querySelector('#photoAngle').value = String(Math.round(angle * 10) / 10);
    panel.querySelector('#photoAngleValue').textContent = `${angle.toFixed(1)}°`;
    panel.querySelector('#photoExport').checked = photos.every(photoExportOn);
}

let photoSliderBefore = null;   // transform at the start of a slider drag (one undo step)

function initPhotoPanel() {
    const panel = photoPanel();
    if (!panel) return;
    panel.addEventListener('click', (e) => {
        e.stopPropagation();
        const btn = e.target.closest('[data-photo]');
        if (!btn) return;
        switch (btn.dataset.photo) {
            case 'lock': setPhotosLocked(!getPhotos().every(p => p.photoLocked)); break;
            case 'hide': togglePhotoVisible(); break;
            case 'ccw90': rotatePhotoBy(-90); break;
            case 'cw90': rotatePhotoBy(90); break;
            case 'minus': rotatePhotoBy(-0.5); break;
            case 'plus': rotatePhotoBy(0.5); break;
            case 'straighten': startStraighten(); break;
            case 'fit': fitPhotoToView(); break;
            case 'reset': resetPhotoAngle(); break;
            case 'replace': replacePhoto(); break;
            case 'remove': removePhoto(); break;
            case 'close': closePhotoPanel(); break;
        }
    });
    const slider = panel.querySelector('#photoAngle');
    slider.addEventListener('input', () => {
        const o = currentPhoto();
        if (!o) return;
        if (!photoSliderBefore) photoSliderBefore = photoTransformState(o);
        setPhotoAngle(o, parseFloat(slider.value) || 0);
        canvas.requestRenderAll();
        panel.querySelector('#photoAngleValue').textContent = `${normAngle(o.angle).toFixed(1)}°`;
    });
    slider.addEventListener('change', () => {
        if (photoSliderBefore) pushPhotoUndo(photoSliderBefore);
        photoSliderBefore = null;
        commitPhotoChange();
    });
    panel.querySelector('#photoExport').addEventListener('change', (e) => setPhotoExport(e.target.checked));

    // Close when clicking elsewhere (like the colour popup); not while straightening.
    document.addEventListener('click', (e) => {
        if (panel.hidden || panel.contains(e.target)) return;
        if (e.target.closest('#bgBtn')) return;
        closePhotoPanel();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !panel.hidden && !straighten) closePhotoPanel();
    });
}

// A hint bar over the canvas while straightening.
function showPhotoHint(msg) {
    let hint = document.getElementById('photoHint');
    if (!hint) {
        hint = document.createElement('div');
        hint.id = 'photoHint';
        hint.className = 'photo-hint';
        document.body.appendChild(hint);
    }
    hint.textContent = msg;
    // Centre it over the canvas, not the window (the palette is on the right).
    const r = canvas.upperCanvasEl && canvas.upperCanvasEl.getBoundingClientRect();
    if (r && r.width) hint.style.left = `${Math.round(r.left + r.width / 2)}px`;
    hint.hidden = false;
}
function hidePhotoHint() {
    const hint = document.getElementById('photoHint');
    if (hint) hint.hidden = true;
}

// --------------------------------------------------------------- wiring ---
// Called from editor-init.js's DOMContentLoaded dispatcher.
function initPhotoTrace() {
    if (typeof canvas === 'undefined' || !canvas) return;
    initPhotoPanel();
    // Re-apply the lock whenever a photo (re)appears: workspace load, autosave
    // restore, undo of a removal.
    canvas.on('object:added', (e) => {
        const o = e.target;
        if (isPhoto(o)) { applyPhotoLock(o); syncPhotoPanel(); }
    });
    canvas.on('object:removed', (e) => { if (isPhoto(e.target)) syncPhotoPanel(); });
    canvas.on('selection:created', syncPhotoPanel);
    canvas.on('selection:updated', syncPhotoPanel);
    // Undo/redo of a rotation changes the angle without the panel knowing.
    canvas.on('after:render', () => {
        const panel = photoPanel();
        if (!panel || panel.hidden || photoSliderBefore) return;
        const o = currentPhoto();
        const shown = panel.querySelector('#photoAngleValue').textContent;
        if (o && shown !== `${normAngle(o.angle || 0).toFixed(1)}°`) syncPhotoPanel();
    });
}
