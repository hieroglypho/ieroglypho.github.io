/*!
 * ΙΕΡΟΓΛΥΦΩ editor — canvas-interactions (part 2 of 7)
 *
 * Classic <script defer>; shares globals with the other editor scripts via the
 * global lexical environment. Do NOT convert to type="module" (inline onclick=
 * handlers need these functions global). Load order:
 *   editor-core → canvas-interactions → workspace → export → drawing-tools → glyph-input → editor-init
 *
 * @copyright Copyright (c) 2024 Massimo Mazzon. All rights reserved.
 */

// =============================================================================
// Mouse handlers (drag, marquee, pan, zoom)
// =============================================================================
// Add these variables to your global variables section
let bgOffsetX = 0;
let bgOffsetY = 0;

// Update mouse:down event handler
canvas.on('mouse:down', function (options) {
    // Save the clicked position
    const pointer = canvas.getPointer(options.e);
    textPosition = {
        x: pointer.x,
        y: pointer.y
    };
    if (options.e.altKey) {
        // Start panning if Alt key is held
        isPanning = true;
        lastPosX = options.e.clientX;
        lastPosY = options.e.clientY;
        canvas.selection = false;
        return;
    }
    // Manual hit-test, but only over INTERACTIVE objects. Skip non-selectable /
    // non-evented overlays (the page guide, the grid): the guide sits at the back
    // and spans the whole page, so `containsPoint` is true for it on every
    // interior click — without this filter `find` returns the guide first (it's
    // first in the back-to-front array) and selects the whole "page" instead of
    // the glyph under the cursor.
    const clickedObject = canvas.getObjects().find(obj =>
        obj.selectable && obj.evented !== false && !obj._pageGuide && obj.containsPoint(pointer));
    const activeObject = canvas.getActiveObject();

    if (clickedObject) {
        canvas.setActiveObject(clickedObject);
        initialPosition = { left: clickedObject.left, top: clickedObject.top };
    } else {
        if (activeObject && activeObject.type === 'activeSelection') {
            canvas.setActiveObject(activeObject);
        } else {
            canvas.discardActiveObject().requestRenderAll();
        }
    }
});

// Update mouse:move event handler
canvas.on('mouse:move', function (options) {
    if (isPanning) {
        const vpt = canvas.viewportTransform;
        const deltaX = options.e.clientX - lastPosX;
        const deltaY = options.e.clientY - lastPosY;

        // Update canvas viewport transform
        vpt[4] += deltaX;
        vpt[5] += deltaY;

        // Keep the background image gliding along with the pan.
        panBackgroundImage(deltaX, deltaY);

        lastPosX = options.e.clientX;
        lastPosY = options.e.clientY;
        canvas.requestRenderAll();
        drawGridThrottled();
        return;
    }
});

// Update mouse:up event handler
canvas.on('mouse:up', function (options) {
    isPanning = false;
    canvas.selection = true;

    // Handle move action for both single objects and groups
    if (initialMoveState !== null) {
        const obj = options.target;
        if (obj) {
            pushUndo({
                type: 'modify',  // Changed from 'move' to 'modify' to match switch case
                actionType: 'moving',
                state: initialMoveState
            });
        }
        initialMoveState = null;
    }

    const activeObject = canvas.getActiveObject();
    if (activeObject && activeObject.type === 'activeSelection') {
        activeObject.lockMovementX = false;
        activeObject.lockMovementY = false;
        activeObject.lockScalingX = false;
        activeObject.lockScalingY = false;
        activeObject.lockRotation = false;
    }
});

canvas.on('mouse:wheel', function (opt) {
    var delta = opt.e.deltaY;
    var zoom = canvas.getZoom();
    zoom *= 0.999 ** delta;
    zoom = Math.min(Math.max(0.1, zoom), 5);
    canvas.zoomToPoint({ x: opt.e.offsetX, y: opt.e.offsetY }, zoom);
    requestAnimationFrame(drawGrid);
    opt.e.preventDefault();
    opt.e.stopPropagation();
});

// Slide the background-image DOM layer by (dx, dy) screen px so it tracks a
// viewport pan. Shared by the Alt-drag pan and the two-finger touch pan; reads
// the current scale out of the inline transform so a zoomed bg stays put.
function panBackgroundImage(dx, dy) {
    const bgImage = document.getElementById('bgImage');
    if (!bgImage || bgImage.style.display === 'none') return;
    bgOffsetX += dx;
    bgOffsetY += dy;
    const matches = bgImage.style.transform.match(/scale\(([\d.]+)\)/);
    const scale = matches ? parseFloat(matches[1]) : 1;
    bgImage.style.transform =
        `translate(calc(-50% + ${bgOffsetX}px), calc(-50% + ${bgOffsetY}px)) scale(${scale})`;
}

// =============================================================================
// Touch gestures (tablets): two-finger pinch-zoom + two-finger pan
// =============================================================================
// Fabric 5's optional gesture module isn't in the CDN build, so we drive the
// viewport straight off native touch events, reusing the same maths as the
// wheel-zoom and Alt-drag-pan above. We act ONLY on two-finger touches; a single
// finger is left untouched so Fabric's own tap-to-select and one-finger drag
// keep working. Listeners sit on the wrapper in the CAPTURE phase and
// stopPropagation on a two-finger event, so Fabric's handlers (bound to the
// child upper-canvas) never see it — that's how we avoid two handlers fighting
// over the same gesture without reaching for stopImmediatePropagation.
(function initTouchGestures() {
    if (!('ontouchstart' in window) && !(navigator.maxTouchPoints > 0)) return;
    const wrapper = canvas.wrapperEl;
    const upper = canvas.upperCanvasEl;
    if (!wrapper || !upper) return;

    // Bigger invisible hit area on the selection handles for fingertips (the
    // 24px default is fiddly on glass); desktop corner visuals are unchanged.
    fabric.Object.prototype.touchCornerSize = 40;

    let active = false;       // a two-finger gesture is in progress
    let lastDist = 0;         // finger spread on the previous move (for zoom ratio)
    let lastMid = { x: 0, y: 0 };  // pinch midpoint on the previous move (for pan)

    const spread = (a, b) => Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);
    const midpoint = (a, b) => ({ x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 });

    function onStart(e) {
        if (e.touches.length !== 2) return;   // single touch → hand off to Fabric
        active = true;
        canvas.selection = false;
        lastDist = spread(e.touches[0], e.touches[1]);
        lastMid = midpoint(e.touches[0], e.touches[1]);
        e.preventDefault();
        e.stopPropagation();
    }

    function onMove(e) {
        if (!active || e.touches.length !== 2) return;
        e.preventDefault();
        e.stopPropagation();

        const dist = spread(e.touches[0], e.touches[1]);
        const mid = midpoint(e.touches[0], e.touches[1]);
        const rect = upper.getBoundingClientRect();

        // Pinch → zoom about the midpoint, same clamp as the wheel (0.1–5).
        if (lastDist > 0) {
            let zoom = canvas.getZoom() * (dist / lastDist);
            zoom = Math.min(Math.max(0.1, zoom), 5);
            canvas.zoomToPoint({ x: mid.x - rect.left, y: mid.y - rect.top }, zoom);
        }

        // Two-finger drag → pan the viewport (the midpoint's screen travel).
        const dx = mid.x - lastMid.x;
        const dy = mid.y - lastMid.y;
        if (dx || dy) {
            const vpt = canvas.viewportTransform;
            vpt[4] += dx;
            vpt[5] += dy;
            panBackgroundImage(dx, dy);
        }

        lastDist = dist;
        lastMid = mid;
        canvas.requestRenderAll();
        drawGridThrottled();
    }

    function onEnd(e) {
        if (!active) return;
        // Keep swallowing until both fingers are up so the lifting finger can't
        // kick off a stray Fabric drag mid-gesture.
        e.preventDefault();
        e.stopPropagation();
        if (e.touches.length < 2) {
            active = false;
            lastDist = 0;
            canvas.selection = true;
            requestAnimationFrame(drawGrid);
        }
    }

    const opts = { capture: true, passive: false };
    wrapper.addEventListener('touchstart', onStart, opts);
    wrapper.addEventListener('touchmove', onMove, opts);
    wrapper.addEventListener('touchend', onEnd, opts);
    wrapper.addEventListener('touchcancel', onEnd, opts);
})();

canvas.on('drop', function (options) {
    options.e.preventDefault();
    canvasModified = true;
    const droppedData = options.e.dataTransfer.getData('text/plain');
    if (!droppedData) return;

    // Single-glyph drop from the character palette — place at the cursor.
    const single = charsByGlyph.get(droppedData);
    if (single && [...droppedData].length === 1) {
        const characterKey = single.length === 3 ? single[2] : single[0];
        const pointer = canvas.getPointer(options.e);
        addCharacterToCanvas(droppedData, characterKey, pointer.x, pointer.y);
        return;
    }

    // Multi-glyph drop (e.g. text selected from dictionary results, or pasted
    // Gardiner codes). Route through the MdC handler so the row is
    // bottom-aligned and laid out below existing content.
    handleMdCInput(droppedData);
});
canvas.on('mouse:dblclick', function (options) {
    if (options.target && (options.target.type === 'i-text' || options.target.type === 'text')) {
        activeTextObject = options.target;
        openKeyboard();
        const keyboardInput = document.getElementById('keyboardInput');
        keyboardInput.value = activeTextObject.text;
    }
});

// Event handlers for rotation and scaling
canvas.on('object:moving', function (options) {
    const obj = options.target;
    if (obj && initialMoveState === null) {
        if (obj.type !== 'activeSelection') {
            initialMoveState = {
                type: 'single',
                id: obj.id,
                state: obj.toJSON(['left', 'top', 'angle', 'scaleX', 'scaleY'])
            };
        } else {
            // For groups, store the relative positions of objects
            const groupLeft = obj.left;
            const groupTop = obj.top;

            initialMoveState = {
                type: 'group',
                groupState: {
                    left: groupLeft,
                    top: groupTop,
                    angle: obj.angle,
                    scaleX: obj.scaleX,
                    scaleY: obj.scaleY,
                    width: obj.width,
                    height: obj.height
                },
                // Store relative positions to group center
                objects: obj.getObjects().map(o => {
                    const relativeLeft = o.left - groupLeft;
                    const relativeTop = o.top - groupTop;
                    return {
                        id: o.id,
                        relativeLeft: relativeLeft,
                        relativeTop: relativeTop,
                        left: o.left,
                        top: o.top,
                        angle: o.angle,
                        scaleX: o.scaleX,
                        scaleY: o.scaleY
                    };
                })
            };
        }
    }

    // Apply grid snapping
    if (obj.type !== 'activeSelection') {
        obj.set({
            left: snapToGrid(obj.left),
            top: snapToGrid(obj.top)
        });
    } else {
        const snappedLeft = snapToGrid(obj.left);
        const snappedTop = snapToGrid(obj.top);
        const deltaX = snappedLeft - obj.left;
        const deltaY = snappedTop - obj.top;

        obj.getObjects().forEach(o => {
            o.set({
                left: snapToGrid(o.left + deltaX),
                top: snapToGrid(o.top + deltaY)
            });
        });
        obj.set({
            left: snappedLeft,
            top: snappedTop
        });
    }
});
canvas.on('object:rotating', function (options) {
    const obj = options.target;
    if (obj && initialRotationState === null) {
        if (obj.type !== 'activeSelection') {
            initialRotationState = {
                type: 'single',
                id: obj.id,
                state: obj.toJSON(['left', 'top', 'angle', 'scaleX', 'scaleY'])
            };
        } else {
            // For group rotation, store both group and individual states
            initialRotationState = {
                type: 'group',
                groupState: {
                    left: obj.left,
                    top: obj.top,
                    angle: obj.angle,
                    scaleX: obj.scaleX,
                    scaleY: obj.scaleY
                },
                objects: obj.getObjects().map(o => ({
                    id: o.id,
                    state: o.toJSON(['left', 'top', 'angle', 'scaleX', 'scaleY'])
                }))
            };
        }
        // console.log('Rotation started. Initial state:', initialRotationState);
    }
});
canvas.on('object:scaling', function (options) {
    const obj = options.target;
    if (obj && initialScaleState === null) {
        if (obj.type !== 'activeSelection') {
            initialScaleState = {
                type: 'single',
                id: obj.id,
                state: obj.toJSON(['left', 'top', 'angle', 'scaleX', 'scaleY', 'width', 'height'])
            };
        } else {
            initialScaleState = {
                type: 'group',
                groupState: {
                    left: obj.left,
                    top: obj.top,
                    angle: obj.angle,
                    scaleX: obj.scaleX,
                    scaleY: obj.scaleY,
                    width: obj.width,
                    height: obj.height
                },
                objects: obj.getObjects().map(o => ({
                    id: o.id,
                    state: o.toJSON(['left', 'top', 'angle', 'scaleX', 'scaleY', 'width', 'height'])
                }))
            };
        }
    }
});
canvas.on('object:modified', function (options) {
    canvasModified = true;

    if (initialRotationState !== null) {
        pushUndo({
            type: 'modify',
            actionType: 'rotation',
            state: initialRotationState
        });
        initialRotationState = null;
    }

    if (initialScaleState !== null) {
        pushUndo({
            type: 'modify',
            actionType: 'scaling',
            state: initialScaleState
        });
        initialScaleState = null;
    }

    if (initialMoveState !== null) {
        pushUndo({
            type: 'modify',
            actionType: 'moving',
            state: initialMoveState
        });
        initialMoveState = null;
    }
});

// =============================================================================
// Undo / Redo
// =============================================================================
// Undo and redo are one self-inverting operation: revertAction(action) undoes
// `action` on the canvas and RETURNS the inverse action. Undo pops undoHistory,
// reverts, and parks the inverse on redoHistory; redo does the exact mirror.
// Reverting the inverse re-applies the original, so the two stacks stay in sync
// without any per-direction bookkeeping.

function undoLastAction() {
    if (undoHistory.length === 0) return;
    const inverse = revertAction(undoHistory.pop());
    if (inverse) redoHistory.push(inverse);   // raw push: do NOT clear redo here
    canvas.requestRenderAll();
}

function redoLastAction() {
    if (redoHistory.length === 0) return;
    const inverse = revertAction(redoHistory.pop());
    if (inverse) undoHistory.push(inverse);   // raw push: a replay is not a new action
    canvas.requestRenderAll();
}

// Reverse one action and return the action that reverses *this* reversal.
function revertAction(action) {
    switch (action.type) {
        case 'batch': {
            // A compound step (e.g. a multi-select delete). Revert sub-actions in
            // reverse order; the collected inverses form the batch that re-applies
            // them — reverting it walks reverse again, restoring the original order.
            const inverses = [];
            for (let i = action.actions.length - 1; i >= 0; i--) {
                const inv = revertAction(action.actions[i]);
                if (inv) inverses.push(inv);
            }
            return { type: 'batch', actions: inverses };
        }

        case 'add':
            removeObjectById(action.id);
            // Re-adding it is exactly a 'delete' undo, so hand back a delete.
            return { type: 'delete', id: action.id, object: action.object };

        case 'delete':
            restoreObject(action.object, action.id);
            return { type: 'add', id: action.id, object: action.object };

        case 'modify': {
            if (!['rotation', 'scaling', 'moving'].includes(action.actionType)) return null;
            // Capture where the objects are NOW (before we move them) so the
            // inverse can bring them back, then apply the recorded target state.
            const inverse = snapshotModify(action);
            if (action.state.type === 'snapshot') applySnapshot(action.state.objects);
            else applyLegacyModify(action.state);
            return inverse;
        }

        default:
            console.warn('Unknown action type:', action.type);
            return null;
    }
}

// --- shared canvas ops -------------------------------------------------------

function removeObjectById(id) {
    const obj = canvas.getObjects().find(o => o.id === id);
    if (obj) canvas.remove(obj);
    const nameSpan = document.getElementById(`name-${id}`);
    if (nameSpan) nameSpan.remove();
}

function restoreObject(serialized, id) {
    fabric.util.enlivenObjects([serialized], (enlivened) => {
        const restored = enlivened && enlivened[0];
        if (!restored) return;
        restored.id = id;
        if (serialized.characterKey) restored.characterKey = serialized.characterKey;
        canvas.add(restored);

        const pastedNamesDiv = document.getElementById('pastedNames');
        if (pastedNamesDiv && serialized.characterKey) {
            const nameSpan = document.createElement('span');
            nameSpan.id = `name-${id}`;
            nameSpan.textContent = serialized.characterKey + ', ';
            pastedNamesDiv.appendChild(nameSpan);
        }
        canvas.requestRenderAll();
    });
}

// --- modify: normalize every shape to a flat per-object snapshot -------------
// Recorded modify entries come in three shapes (single / group / move-group),
// so rather than re-derive each one we read the live transform straight off the
// canvas. Discard any active selection first so coordinates are canvas-absolute,
// not group-relative.

function modifyActionIds(action) {
    const s = action.state;
    if (s.type === 'single') return [s.id];
    return (s.objects || []).map(o => o.id);
}

function snapshotModify(action) {
    canvas.discardActiveObject();
    const objects = [];
    modifyActionIds(action).forEach(id => {
        const o = canvas.getObjects().find(obj => obj.id === id);
        if (o) objects.push({
            id, left: o.left, top: o.top, scaleX: o.scaleX, scaleY: o.scaleY,
            angle: o.angle, flipX: o.flipX, flipY: o.flipY
        });
    });
    return { type: 'modify', actionType: action.actionType,
             state: { type: 'snapshot', objects } };
}

function applySnapshot(objects) {
    objects.forEach(s => {
        const obj = canvas.getObjects().find(o => o.id === s.id);
        if (!obj) return;
        obj.set({ left: s.left, top: s.top, scaleX: s.scaleX, scaleY: s.scaleY,
                  angle: s.angle, flipX: s.flipX, flipY: s.flipY });
        obj.setCoords();
    });
}

// The original group/single restore, used only on the first undo of a recorded
// action (every subsequent step on either stack is a snapshot).
function applyLegacyModify(state) {
    if (state.type === 'group') {
        const objectsToGroup = [];
        state.objects.forEach(obj => {
            const fabricObj = canvas.getObjects().find(o => o.id === obj.id);
            if (fabricObj) {
                // Two recorded shapes exist: mirror/align nest props under
                // `.state`, group-move stores them flat. Both hold the child's
                // group-relative left/top, which the ActiveSelection-at-groupState
                // reconstruction below converts back to absolute — so tolerating
                // both shapes here is all group-move undo needed (it used to throw
                // on `obj.state.left`). Verified round-trip: see BUG-2 in BUGS.md.
                const s = obj.state || obj;
                fabricObj.set({
                    left: s.left,
                    top: s.top,
                    scaleX: s.scaleX,
                    scaleY: s.scaleY,
                    angle: s.angle,
                    flipX: s.flipX,
                    flipY: s.flipY
                });
                fabricObj.setCoords();
                objectsToGroup.push(fabricObj);
            }
        });

        if (objectsToGroup.length > 0) {
            canvas.discardActiveObject();
            const group = new fabric.ActiveSelection(objectsToGroup, {
                canvas: canvas,
                ...state.groupState
            });
            canvas.setActiveObject(group);
            canvas.requestRenderAll();
        }
    } else if (state.type === 'single') {
        const objectToModify = canvas.getObjects().find(obj => obj.id === state.id);
        if (objectToModify) {
            objectToModify.set(state.state);
            objectToModify.setCoords();
        }
    }
}

function deleteSelectedObjects() {
    const selectedObjects = canvas.getActiveObjects();
    if (selectedObjects.length > 0) {
        selectedObjects.forEach(obj => {
            // Store the complete object state before deletion
            const objectState = obj.toObject(['left', 'top', 'angle', 'scaleX', 'scaleY', 'width', 'height', 'flipX', 'flipY']);
            objectState.characterKey = obj.characterKey; // Preserve the character key if it exists

            pushUndo({
                type: 'delete',
                id: obj.id,
                object: objectState
            });

            canvas.remove(obj);
            const nameSpan = document.getElementById(`name-${obj.id}`);
            if (nameSpan) {
                nameSpan.remove();
            }
        });

        canvas.discardActiveObject();
        canvas.renderAll();
    }
}

// Function to snap values to the nearest grid point
function snapToGrid(value) {
    return Math.round(value / gridSize) * gridSize;
}

let lastSavedFilename = null; // Store the last used filename
// Clear references when removing objects
function cleanupObject(obj) {
    if (obj.canvas) {
        obj.canvas = null;
    }
    if (obj._objects) {
        obj._objects.forEach(cleanupObject);
    }
}
function removeCharacterFromCanvas(object) {
    canvas.remove(object);
    cleanupObject(object);
    const nameSpan = document.getElementById(`name-${object.id}`);
    if (nameSpan) {
        nameSpan.remove();
    }
}
// Record a list of sub-actions as ONE undo step (a lone action stays flat, so a
// single delete is a single 'delete' entry — not a one-item batch).
function recordBatch(actions) {
    if (actions.length === 0) return;
    pushUndo(actions.length === 1 ? actions[0] : { type: 'batch', actions });
}

// Remove an object (sweeping any three-line block siblings) and append the
// resulting 'delete' sub-actions to `actions`. Does NOT touch the undo stack —
// the caller coalesces everything into one step via recordBatch, so a
// multi-select delete (or a swept block) undoes in a single Ctrl+Z.
function collectDeletion(obj, actions) {
    if (!obj || obj._pageGuide) return;   // never delete the page guide
    // Soft-linked set (three-line block OR MdC enclosure): deleting any member
    // deletes its siblings too. Guard against re-entry so the sweep doesn't loop
    // forever when called per-sibling.
    if ((obj.blockId || obj.enclosureId) && !obj._blockSweeping) {
        const siblings = getBlockSiblings(obj);
        if (siblings.length) {
            obj._blockSweeping = true;
            siblings.forEach(s => {
                s._blockSweeping = true;
                collectDeletion(s, actions);
            });
        }
    }

    // Store the object state before deletion
    const objectState = obj.toObject(['left', 'top', 'angle', 'scaleX', 'scaleY', 'width', 'height', 'flipX', 'flipY']);
    objectState.characterKey = obj.characterKey; // Preserve the character key

    actions.push({ type: 'delete', id: obj.id, object: objectState });
    removeCharacterFromCanvas(obj);
}

// Remove one object as a single undo step (keeps existing single-object callers).
function storeAndRemoveCharacter(obj) {
    const actions = [];
    collectDeletion(obj, actions);
    recordBatch(actions);
}
// =============================================================================
// Mirror + alignment
// =============================================================================
function mirrorTextObject() {
    const initialSelection = canvas.getActiveObjects();
    if (initialSelection.length === 0) return;

    try {
        // Read ABSOLUTE coordinates: inside an ActiveSelection each child's
        // left/top is group-relative, so drop the selection first and let Fabric
        // write canvas coords back. (This is what the old code missed — it
        // reversed positions across a mix of frame + glyphs and scrambled them.)
        canvas.discardActiveObject();

        // Expand to whole soft-linked enclosures so mirroring any member — even
        // just the frame — mirrors the unit. Three-line blocks are left alone
        // (flipping Latin transliteration would be wrong).
        const set = new Set(initialSelection);
        initialSelection.forEach(o => {
            if (o.enclosureId) getBlockSiblings(o).forEach(s => set.add(s));
        });
        const objects = [...set];

        // Snapshot each object's absolute pre-mirror state as a per-object undo
        // (a batch of single 'modify's — no fragile group reconstruction).
        const undoActions = objects.map(o => ({
            type: 'modify', actionType: 'moving',
            state: {
                type: 'single', id: o.id,
                state: o.toJSON(['left', 'top', 'angle', 'scaleX', 'scaleY', 'flipX', 'flipY'])
            }
        }));

        // Only the GLYPHS reverse order among themselves; the enclosure frame,
        // bracket marks and any shapes mirror in place (they are not part of the
        // sign sequence). Splitting on type is what keeps the frame still.
        const glyphs = objects.filter(o => o.type === 'text');
        const others = objects.filter(o => o.type !== 'text');

        if (glyphs.length > 1 && !isArrangedVertically(glyphs)) {
            // Horizontal row: swap the glyphs into reversed positions (G5↔G6) and
            // flip each, so the row reads mirror-image.
            const positions = glyphs.map(o => ({ left: o.left, top: o.top }));
            [...glyphs].reverse().forEach((o, i) => {
                o.set({ left: positions[i].left, top: positions[i].top, flipX: !o.flipX });
                o.setCoords();
            });
        } else {
            // Vertical column (or a lone glyph): just flip each in place.
            glyphs.forEach(o => { o.set('flipX', !o.flipX); o.setCoords(); });
        }
        others.forEach(o => { o.set('flipX', !o.flipX); o.setCoords(); });

        recordBatch(undoActions);

        // Restore a selection of everything we touched.
        canvas.setActiveObject(objects.length === 1
            ? objects[0]
            : new fabric.ActiveSelection(objects, { canvas }));
        canvas.requestRenderAll();
    } catch (error) {
        console.error('Error mirroring object(s):', error);
    }
}

// Helper function to determine if objects are arranged vertically
function isArrangedVertically(objects) {
    if (objects.length < 2) return false;

    // Calculate average horizontal and vertical distances between objects
    let totalHorizDist = 0;
    let totalVertDist = 0;
    let count = 0;

    for (let i = 0; i < objects.length - 1; i++) {
        const currObj = objects[i];
        const nextObj = objects[i + 1];
        
        totalHorizDist += Math.abs(nextObj.left - currObj.left);
        totalVertDist += Math.abs(nextObj.top - currObj.top);
        count++;
    }

    const avgHorizDist = totalHorizDist / count;
    const avgVertDist = totalVertDist / count;

    // If vertical distance is significantly larger than horizontal distance,
    // consider it a vertical arrangement
    return avgVertDist > avgHorizDist * 1.5;
}
function alignObjects(direction = 'horizontal') {
    const activeObjects = canvas.getActiveObjects();
    if (activeObjects.length === 0) return;

    // Cache scaled heights once — getScaledHeight() can be expensive on groups.
    const scaledHeights = activeObjects.map(obj => obj.getScaledHeight());

    // Snapshot pre-align state for undo, shaped to match the 'moving' undo branch.
    const capturedObjects = activeObjects.map(obj => ({
        id: obj.id,
        state: obj.toJSON(['left', 'top', 'angle', 'scaleX', 'scaleY', 'flipX', 'flipY'])
    }));
    const activeSel = canvas.getActiveObject();
    const capturedGroupState = (activeSel && activeSel.type === 'activeSelection') ? {
        left: activeSel.left,
        top: activeSel.top,
        angle: activeSel.angle,
        scaleX: activeSel.scaleX,
        scaleY: activeSel.scaleY,
        width: activeSel.width,
        height: activeSel.height
    } : null;

    const getRefPoint = {
        horizontal: () => {
            const center = activeObjects.reduce((sum, obj, i) =>
                sum + (obj.top + scaledHeights[i] / 2), 0);
            return center / activeObjects.length;
        },
        top: () => Math.min(...activeObjects.map(obj => obj.top)),
        bottom: () => Math.max(...activeObjects.map((obj, i) =>
            obj.top + scaledHeights[i])),
        left: () => Math.min(...activeObjects.map(obj => obj.left))
    };

    const alignTo = getRefPoint[direction]();

    // Apply alignment
    activeObjects.forEach((obj, i) => {
        const props = {
            horizontal: { top: alignTo - scaledHeights[i] / 2 },
            top: { top: alignTo },
            bottom: { top: alignTo - scaledHeights[i] },
            left: { left: alignTo }
        };
        obj.set(props[direction]);
        obj.setCoords();
    });

    if (activeObjects.length > 1 || capturedGroupState) {
        pushUndo({
            type: 'modify',
            actionType: 'moving',
            state: {
                type: 'group',
                groupState: capturedGroupState,
                objects: capturedObjects
            }
        });
    } else {
        pushUndo({
            type: 'modify',
            actionType: 'moving',
            state: {
                type: 'single',
                id: activeObjects[0].id,
                state: capturedObjects[0].state
            }
        });
    }

    canvas.requestRenderAll();
}

// Center the selection on a common vertical axis (the selection's own overall
// horizontal midpoint). Objects are first clustered into ROWS by vertical
// overlap, so a multi-glyph row slides over as a unit with its internal spacing
// intact — instead of every glyph piling up on the centerline. The four single
// text lines and the five-glyph row in a typical word card each become one row.
function centerObjectsHorizontally() {
    const selection = canvas.getActiveObjects();
    if (selection.length < 2) return;

    // Flush absolute coords: inside an ActiveSelection each child's left/top is
    // group-relative. Dropping the selection (as mirrorTextObject does) lets
    // Fabric write canvas coords back, so a plain `left += delta` translates
    // correctly regardless of the object's originX ('center' vs 'left').
    canvas.discardActiveObject();

    // Per-object absolute pre-move snapshot — one undo batch, like mirroring.
    const undoActions = selection.map(o => ({
        type: 'modify', actionType: 'moving',
        state: {
            type: 'single', id: o.id,
            state: o.toJSON(['left', 'top', 'angle', 'scaleX', 'scaleY', 'flipX', 'flipY'])
        }
    }));

    // Measure each object's absolute, zoom-independent box once.
    const items = selection.map(o => {
        const b = o.getBoundingRect(true, true);
        return {
            obj: o,
            left: b.left, right: b.left + b.width,
            top: b.top, bottom: b.top + b.height,
            cy: b.top + b.height / 2
        };
    });

    // Axis = horizontal center of the whole selection's bounding box.
    const axis = (Math.min(...items.map(i => i.left)) +
                  Math.max(...items.map(i => i.right))) / 2;

    // Cluster into rows: walk top-to-bottom; an object joins the current row
    // when its vertical center still falls inside the row's running band, and
    // starts a new row otherwise. Glyphs in a row overlap heavily; separate
    // lines sit in clearly distinct bands.
    const rows = [];
    let cur = null;
    [...items].sort((a, b) => a.top - b.top).forEach(it => {
        if (cur && it.cy < cur.bottom) {
            cur.items.push(it);
            cur.bottom = Math.max(cur.bottom, it.bottom);
        } else {
            cur = { items: [it], bottom: it.bottom };
            rows.push(cur);
        }
    });

    // Slide each row so its bounding-box center lands on the axis.
    rows.forEach(r => {
        const rowCenter = (Math.min(...r.items.map(i => i.left)) +
                           Math.max(...r.items.map(i => i.right))) / 2;
        const delta = axis - rowCenter;
        if (!delta) return;
        r.items.forEach(i => { i.obj.set('left', i.obj.left + delta); i.obj.setCoords(); });
    });

    recordBatch(undoActions);

    canvas.setActiveObject(new fabric.ActiveSelection(selection, { canvas }));
    canvas.requestRenderAll();
}

