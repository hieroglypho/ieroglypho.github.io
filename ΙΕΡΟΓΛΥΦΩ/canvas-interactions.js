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
    const clickedObject = canvas.getObjects().find(obj => obj.containsPoint(pointer));
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

        // Update background image position if it exists
        const bgImage = document.getElementById('bgImage');
        if (bgImage && bgImage.style.display !== 'none') {
            // Accumulate the offsets
            bgOffsetX += deltaX;
            bgOffsetY += deltaY;

            // Get current scale
            const currentTransform = bgImage.style.transform;
            const matches = currentTransform.match(/scale\(([\d.]+)\)/);
            const scale = matches ? parseFloat(matches[1]) : 1;

            // Apply accumulated offsets
            bgImage.style.transform = `translate(calc(-50% + ${bgOffsetX}px), calc(-50% + ${bgOffsetY}px)) scale(${scale})`;
        }

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
            undoHistory.push({
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
        undoHistory.push({
            type: 'modify',
            actionType: 'rotation',
            state: initialRotationState
        });
        initialRotationState = null;
    }

    if (initialScaleState !== null) {
        undoHistory.push({
            type: 'modify',
            actionType: 'scaling',
            state: initialScaleState
        });
        initialScaleState = null;
    }

    if (initialMoveState !== null) {
        undoHistory.push({
            type: 'modify',
            actionType: 'moving',
            state: initialMoveState
        });
        initialMoveState = null;
    }
});

// =============================================================================
// Undo
// =============================================================================
function undoLastAction() {
    if (undoHistory.length === 0) return;

    const lastAction = undoHistory.pop();
    console.log('Undoing action:', lastAction);

    switch (lastAction.type) {
        case 'add':
            const objectToRemove = canvas.getObjects().find(obj => obj.id === lastAction.id);
            if (objectToRemove) {
                canvas.remove(objectToRemove);
                const nameSpan = document.getElementById(`name-${lastAction.id}`);
                if (nameSpan) {
                    nameSpan.remove();
                }
            }
            break;

        case 'modify':
            if (['rotation', 'scaling', 'moving'].includes(lastAction.actionType)) {
                if (lastAction.state.type === 'group') {
                    const objectsToGroup = [];

                    // First pass: Reset all objects to their individual states
                    lastAction.state.objects.forEach(obj => {
                        const fabricObj = canvas.getObjects().find(o => o.id === obj.id);
                        if (fabricObj) {
                            fabricObj.set({
                                left: obj.state.left,
                                top: obj.state.top,
                                scaleX: obj.state.scaleX,
                                scaleY: obj.state.scaleY,
                                angle: obj.state.angle,
                                flipX: obj.state.flipX,
                                flipY: obj.state.flipY
                            });
                            fabricObj.setCoords();
                            objectsToGroup.push(fabricObj);
                        }
                    });

                    if (objectsToGroup.length > 0) {
                        canvas.discardActiveObject();

                        // Create new group with objects in their original states
                        const group = new fabric.ActiveSelection(objectsToGroup, {
                            canvas: canvas,
                            ...lastAction.state.groupState  // Apply all group properties at once
                        });

                        canvas.setActiveObject(group);
                        canvas.requestRenderAll();
                    }
                } else if (lastAction.state.type === 'single') {
                    const objectToModify = canvas.getObjects().find(obj => obj.id === lastAction.state.id);
                    if (objectToModify) {
                        objectToModify.set(lastAction.state.state);
                        objectToModify.setCoords();
                    }
                }
            }
            break;

        case 'delete':
            fabric.util.enlivenObjects([lastAction.object], (enlivened) => {
                const restored = enlivened && enlivened[0];
                if (!restored) return;
                restored.id = lastAction.id;
                if (lastAction.object.characterKey) {
                    restored.characterKey = lastAction.object.characterKey;
                }
                canvas.add(restored);

                const pastedNamesDiv = document.getElementById('pastedNames');
                if (pastedNamesDiv && lastAction.object.characterKey) {
                    const nameSpan = document.createElement('span');
                    nameSpan.id = `name-${lastAction.id}`;
                    nameSpan.textContent = lastAction.object.characterKey + ', ';
                    pastedNamesDiv.appendChild(nameSpan);
                }
                canvas.requestRenderAll();
            });
            break;

        default:
            console.warn('Unknown action type:', lastAction.type);
            undoHistory.push(lastAction);
            return;
    }

    canvas.requestRenderAll();
}

function deleteSelectedObjects() {
    const selectedObjects = canvas.getActiveObjects();
    if (selectedObjects.length > 0) {
        selectedObjects.forEach(obj => {
            // Store the complete object state before deletion
            const objectState = obj.toObject(['left', 'top', 'angle', 'scaleX', 'scaleY', 'width', 'height', 'flipX', 'flipY']);
            objectState.characterKey = obj.characterKey; // Preserve the character key if it exists

            undoHistory.push({
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
function storeAndRemoveCharacter(obj) {
    // Three-line block: deleting any row deletes its siblings too. Guard against
    // re-entry so the sweep doesn't loop forever when called per-sibling.
    if (obj && obj.blockId && !obj._blockSweeping) {
        const siblings = getBlockSiblings(obj);
        if (siblings.length) {
            obj._blockSweeping = true;
            siblings.forEach(s => {
                s._blockSweeping = true;
                storeAndRemoveCharacter(s);
            });
        }
    }

    // Store the object state before deletion
    const objectState = obj.toObject(['left', 'top', 'angle', 'scaleX', 'scaleY', 'width', 'height', 'flipX', 'flipY']);
    objectState.characterKey = obj.characterKey; // Preserve the character key

    // Add to undo history
    undoHistory.push({
        type: 'delete',
        id: obj.id,
        object: objectState
    });

    // Call the existing remove function
    removeCharacterFromCanvas(obj);
}
// =============================================================================
// Mirror + alignment
// =============================================================================
function mirrorTextObject() {
    const activeObject = canvas.getActiveObject();
    if (!activeObject) return;

    try {
        const objects = activeObject.type === 'activeSelection'
            ? activeObject.getObjects()
            : [activeObject];

        // Snapshot every involved object before mutation so undo can restore.
        const capturedObjects = objects.map(o => ({
            id: o.id,
            state: o.toJSON(['left', 'top', 'angle', 'scaleX', 'scaleY', 'flipX', 'flipY'])
        }));
        const capturedGroupState = activeObject.type === 'activeSelection' ? {
            left: activeObject.left,
            top: activeObject.top,
            angle: activeObject.angle,
            scaleX: activeObject.scaleX,
            scaleY: activeObject.scaleY,
            width: activeObject.width,
            height: activeObject.height
        } : null;

        if (objects.length > 1) {
            // Determine if the text is arranged vertically
            const isVertical = isArrangedVertically(objects);

            if (isVertical) {
                // For vertical text, just mirror in place
                objects.forEach(obj => {
                    obj.set('flipX', !obj.flipX);
                    obj.setCoords();
                });
            } else {
                // For horizontal text, mirror and reverse positions
                const originalPositions = objects.map(obj => ({
                    left: obj.left,
                    top: obj.top
                }));

                const reversedObjects = [...objects].reverse();

                reversedObjects.forEach((obj, i) => {
                    obj.set({
                        left: originalPositions[i].left,
                        top: originalPositions[i].top,
                        flipX: !obj.flipX
                    });
                    obj.setCoords();
                });
            }

            undoHistory.push({
                type: 'modify',
                actionType: 'moving',
                state: {
                    type: 'group',
                    groupState: capturedGroupState,
                    objects: capturedObjects
                }
            });
        } else {
            // Single object handling
            const obj = objects[0];
            obj.set('flipX', !obj.flipX);
            obj.setCoords();

            undoHistory.push({
                type: 'modify',
                actionType: 'moving',
                state: {
                    type: 'single',
                    id: obj.id,
                    state: capturedObjects[0].state
                }
            });
        }

        if (activeObject.type === 'activeSelection') activeObject.setCoords();
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
        undoHistory.push({
            type: 'modify',
            actionType: 'moving',
            state: {
                type: 'group',
                groupState: capturedGroupState,
                objects: capturedObjects
            }
        });
    } else {
        undoHistory.push({
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

