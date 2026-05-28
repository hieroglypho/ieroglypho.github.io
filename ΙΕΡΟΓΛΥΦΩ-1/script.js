/*!
 * ===== DO NOT REMOVE COPYRIGHTS =====
 * ===== DO NOT ALTER SCRIPT =====
 *
 * A script for working with Hieroglyphs
 *
 * @author   Massimo Mazzon
 * @version  1.5.0
 * @license  NONE
 * @copyright Copyright (c) 2024 Massimo Mazzon. All rights reserved.
 */

// =============================================================================
// TABLE OF CONTENTS
// =============================================================================
//   1. State (globals + constants)
//   2. Canvas init + grid
//   3. Character table — decode, render, filter
//   4. Gardiner category labels
//   5. Add character to canvas
//   6. Mouse handlers (drag, marquee, pan, zoom)
//   7. Undo
//   8. Delete / cleanup helpers
//   9. Mirror + alignment
//  10. Workspace save / load
//  11. Save as SVG / PDF
//  12. Search / filter dropdown
//  13. Drawing tools (cartouche, circle, line, arrow, bracket, rect, pencil, bubble)
//  14. On-screen keyboard dialog + glyph input dialog
//  15. initKeyboardAndSearch  (DOM-ready)
//  16. initMainMenu           (DOM-ready)
//  17. MdC paste handler
//  19. DOM event wiring
//  20. initCharDragstart      (DOM-ready)
//  21. Background image
//  22. initBackgroundImage    (DOM-ready)
//  23. DOM ready dispatcher
//  24. Background color popup
//  25. Layout & window lifecycle (resize, beforeunload, keybindings)
// =============================================================================

// =============================================================================
// State (module-global mutable state and constants)
// =============================================================================

// Canvas / 2D context
var ctx = c.getContext('2d');
let backgroundImage = null;

// Constants
const gridSize = 10;                 // Grid size in pixels
const scaleSensitivity = 0.1;        // Mouse-wheel zoom sensitivity
const threshold = 5;                 // Minimum angle change for history save
const rotationThreshold = 15;        // Rotation snap threshold (degrees)

// Mouse / drag / pan
var mousePos = { x: 0, y: 0 };
let isDragging = false;
let dragOffsetX = 0;
let dragOffsetY = 0;
let isPanning = false;
let lastPosX, lastPosY;

// Marquee selection
let marqueeStart = { x: 0, y: 0 };
let marqueeEnd = { x: 0, y: 0 };
let isDrawingMarquee = false;

// Text objects + active editing
var texts = [];                      // Array of text objects
let selectedTextIndex = -1;
let currentId = 0;
let activeTextObject = null;         // Text object currently being edited
let textPosition = { x: 100, y: 100 };

// Transform state (captured at gesture start for undo)
let scale = 1;
var initialPosition = null;
let initialRotationState = null;
let initialMoveState = null;
let initialScaleState = null;

// History
let updateHistory = [];
const undoHistory = [];

// Grid + canvas flags
let currentGrid = null;
let canvasModified = false;
let resizeTimeout;

// =============================================================================
// Canvas init
// =============================================================================
function getCanvasDimensions() {
    const searchContainer = document.getElementById('searchContainer');
    const searchWidth = searchContainer ? searchContainer.offsetWidth : 400; // 400 is default width

    return {
        // Calculate width by subtracting search container width and padding
        width: Math.floor(window.innerWidth - searchWidth - 25), // 40 accounts for container padding
        height: Math.floor(window.innerHeight - 20)
    };
}

// Fabric 5.2.4 hardcodes the deprecated CanvasTextBaseline value 'alphabetical'
// (a typo for 'alphabetic') when rendering text, which the browser rejects and
// warns about on every glyph draw. The object-level textBaseline is ignored, so
// we remap the bad token at the context level before the assignment lands.
(function patchTextBaselineTypo() {
    const proto = window.CanvasRenderingContext2D && CanvasRenderingContext2D.prototype;
    const desc = proto && Object.getOwnPropertyDescriptor(proto, 'textBaseline');
    if (!desc || !desc.set || !desc.get) return;
    Object.defineProperty(proto, 'textBaseline', {
        configurable: true,
        enumerable: desc.enumerable,
        get: desc.get,
        set(v) { desc.set.call(this, v === 'alphabetical' ? 'alphabetic' : v); }
    });
})();

// Initialize canvas with viewport dimensions
const initialDimensions = getCanvasDimensions();
var canvas = new fabric.Canvas('c', {
    isDrawingMode: false,
    selection: true,
    preserveObjectStacking: true,  // Use colon, not equals
    width: initialDimensions.width,
    height: initialDimensions.height,
    subTargetCheck: true  // Include this in the initial options
});

function drawGrid() {
    const GRID_SIZE = 20;
    const zoom = canvas.getZoom();
    const vpt = canvas.viewportTransform;

    // Calculate grid dimensions with padding
    const dims = {
        left: Math.floor(-vpt[4] / zoom / GRID_SIZE) * GRID_SIZE - GRID_SIZE * 2,
        right: Math.ceil((canvas.width - vpt[4]) / zoom / GRID_SIZE) * GRID_SIZE + GRID_SIZE * 2,
        top: Math.floor(-vpt[5] / zoom / GRID_SIZE) * GRID_SIZE - GRID_SIZE * 2,
        bottom: Math.ceil((canvas.height - vpt[5]) / zoom / GRID_SIZE) * GRID_SIZE + GRID_SIZE * 2
    };

    // Clear existing grid, if necessary
    canvas.setBackgroundImage(null, canvas.renderAll.bind(canvas));

    // Create grid path
    let pathString = '';

    // Add vertical and horizontal lines
    for (let x = dims.left; x <= dims.right; x += GRID_SIZE) {
        pathString += `M ${x} ${dims.top} L ${x} ${dims.bottom} `;
    }
    for (let y = dims.top; y <= dims.bottom; y += GRID_SIZE) {
        pathString += `M ${dims.left} ${y} L ${dims.right} ${y} `;
    }

    // Create the grid path as a background object
    const gridPath = new fabric.Path(pathString, {
        stroke: 'rgba(200, 200, 200, 0.06)',
        strokeWidth: 1,
        selectable: false,
        evented: false,
        objectCaching: false
    });

    // Add as background
    canvas.setBackgroundImage(gridPath, canvas.renderAll.bind(canvas));
}

drawGrid();

// Hide the full-canvas brand watermark on the first interaction so it doesn't
// clutter the workspace. It still appears in PNG/PDF exports (stamped in
// compositeCanvasWithBg), just as a small corner mark.
(function setupWatermarkAutoHide() {
    const overlay = document.getElementById('fixedTextOverlay');
    if (!overlay) return;
    let hidden = false;
    const hide = () => {
        if (hidden) return;
        hidden = true;
        overlay.style.opacity = '0';
        // Drop it from layout once faded so it can never interfere with the canvas.
        setTimeout(() => { overlay.style.display = 'none'; }, 450);
    };
    canvas.on('mouse:down', hide);
    canvas.on('object:added', hide);
})();

// =============================================================================
// Character table — decode obfuscated chars.js, render rows, filter
// =============================================================================
function loadCharacters(encoded) {
    try {
        const unshifted = encoded.split('').map(char =>
            String.fromCharCode(char.charCodeAt(0) - 1)
        ).join('');

        // Decode base64 back to JSON string
        const jsonStr = decodeURIComponent(escape(atob(unshifted)));
        return JSON.parse(jsonStr);
    } catch (err) {
        console.error('Failed to decode character table:', err);
        alert('Character table failed to load. The app may not work correctly.');
        return [];
    }
}

// Decode and use the data
const characters = loadCharacters(table);
// Indexes for O(1) lookup in hot paths (drag-drop, batch glyph paste).
const charsByCode = new Map(characters.map(entry => [entry[0], entry]));
const charsByGlyph = new Map(characters.map(entry => [entry[1], entry]));

// Trailing-edge throttle: ensures fn runs at most once per `wait` ms.
function throttle(fn, wait) {
    let lastCall = 0;
    let scheduled = null;
    return function (...args) {
        const now = Date.now();
        const remaining = wait - (now - lastCall);
        if (remaining <= 0) {
            if (scheduled) { clearTimeout(scheduled); scheduled = null; }
            lastCall = now;
            fn.apply(this, args);
        } else if (!scheduled) {
            scheduled = setTimeout(() => {
                lastCall = Date.now();
                scheduled = null;
                fn.apply(this, args);
            }, remaining);
        }
    };
}
const drawGridThrottled = throttle(drawGrid, 100);

// =============================================================================
// Gardiner category labels (used by the search dropdown)
// =============================================================================
const sentences = [
    { letter: "A", text: "Man and his occupations" },
    { letter: "B", text: "Woman and her occupations" },
    { letter: "C", text: "Anthropomorphic deities" },
    { letter: "D", text: "Parts of the human body" },
    { letter: "E", text: "Mammals" },
    { letter: "F", text: "Parts of mammals" },
    { letter: "G", text: "Birds" },
    { letter: "H", text: "Parts of birds" },
    { letter: "I", text: "Amphibious animals, reptiles, etc." },
    { letter: "K", text: "Fishes and parts of fishes" },
    { letter: "L", text: "Invertebrata and lesser animals" },
    { letter: "M", text: "Trees and plants" },
    { letter: "N", text: "Sky, earth, water" },
    { letter: "NU", text: "Upper nile" },
    { letter: "NL", text: "Lower nile" },
    { letter: "O", text: "Buildings, parts of buildings, etc." },
    { letter: "P", text: "Ships and parts of ships" },
    { letter: "Q", text: "Domestic and funerary furniture" },
    { letter: "R", text: "Temple furniture and sacred emblems" },
    { letter: "S", text: "Crowns, dress, staves, etc." },
    { letter: "T", text: "Warfare, hunting, butchery" },
    { letter: "U", text: "Agriculture, crafts, and professions" },
    { letter: "V", text: "Rope, fibre, baskets, bags, etc." },
    { letter: "W", text: "Vessels of stone and earthenware" },
    { letter: "X", text: "Loaves and cakes" },
    { letter: "Y", text: "Writings, games, music" },
    { letter: "Z", text: "Strokes, signs derived from Hieratic, geometrical features" },
    { letter: "Aa", text: "Unclassified signs" },
    { letter: "Hrz", text: "Horizontal Signs" },
    { letter: "Vrt", text: "Vertical Signs" },
    { letter: "Sm", text: "Small Signs" },
    { letter: "Lg", text: "Large/composite Signs" }
];
// Add alphabet
// sentences.unshift({ letter: "Alph", text: "Alphabet (A-Z representation)" });
// Add your new horizontal category at the beginning or end

function displayCharactersInRows(charList) {
    let content = '';
    let dividerInserted = false;
    charList.forEach(([code, char], index) => {
        const category = horizontalGlyphs.includes(code) ? 'Hrz' : code.match(/[A-Z]+/)[0];

        const isExt = char && char.codePointAt(0) >= 0x13460;
        if (isExt && !dividerInserted) {
            content += '<div class="section-divider">Extended-A</div>';
            dividerInserted = true;
        }

        content += `
            <div class="char-container${isExt ? ' ext-a' : ''}"
                 draggable="true"
                 id="drag-${category}-${index}"
                 data-category="${category}">
                <div class="char">${char}</div>
                <div class="name">${code}</div>
            </div>`;
    });
    document.getElementById('charList').innerHTML = content;
}
// filters hieros as search happens
function filterAndDisplayCharacters(charList, query) {
    // If the query is "Alph", only show alphabet characters (A-Z)
    if (query === "Alph") {
        displayCharactersInRows(alphabetChars);
        return;
    }

    // If the query is "Horiz", show horizontal characters
    if (query === "Hrz") {
        const horizontalChars = charList.filter(([code]) => horizontalGlyphs.includes(code));
        displayCharactersInRows(horizontalChars);
        return;
    }

    // If the query is "Vert", show vertical characters
    if (query === "Vrt") {
        const verticalChars = charList.filter(([code]) => verticalGlyphs.includes(code));
        displayCharactersInRows(verticalChars);
        return;
    }

    // If the query is "Sm", show small characters
    if (query === "Sm") {
        const smallChars = charList.filter(([code]) => smallGlyphs.includes(code));
        displayCharactersInRows(smallChars);
        return;
    }

    // If the query is "Lg", show large characters
    if (query === "Lg") {
        const largeChars = charList.filter(([code]) => largeGlyphs.includes(code));
        displayCharactersInRows(largeChars);
        return;
    }

    // Otherwise, handle normal filtering (starting with the query)
    const filteredChars = charList.filter(([code, char]) => {
        const lowerQuery = query.toLowerCase();
        return code.toLowerCase().startsWith(lowerQuery) || char.toLowerCase().startsWith(lowerQuery);
    });

    displayCharactersInRows(filteredChars);
}

function addCharacterToCanvas(text, characterKey, x, y) {
    canvasModified = true;

    var textObj = new fabric.Text(text, {
        left: x,
        top: y,
        fontSize: 60,
        fill: 'black',
        originX: 'center',
        originY: 'center',
        selectable: true,
        // Noto covers base block; Hieroglyphica Extended fills Extended-A.
        // Without this, fabric uses a system fallback that often lacks Extended-A.
        fontFamily: '"Noto Sans Egyptian Hieroglyphs", "Hieroglyphica Extended", sans-serif'
    });

    // Generate a unique ID for the text object
    textObj.id = generateUniqueId();
    textObj.characterKey = characterKey;

    // Add the text object to the canvas
    canvas.add(textObj);

    // Update the position of the object (centering)
    textObj.set({
        left: x,
        top: y
    });

    // Add to pastedNamesContainer - using span method
    const pastedNamesDiv = document.getElementById('pastedNames');
    if (pastedNamesDiv) {
        const nameSpan = document.createElement('span');
        nameSpan.id = `name-${textObj.id}`;
        nameSpan.textContent = `${characterKey} - `;
        pastedNamesDiv.appendChild(nameSpan);
    }

    // Record the addition for undo functionality
    undoHistory.push({
        type: 'add',
        object: textObj.toJSON(['id', 'characterKey', 'left', 'top', 'angle']), // Store necessary properties
        id: textObj.id,
        nameSpanId: `name-${textObj.id}`
    });

    // Call renderAll to ensure the canvas is updated
    canvas.renderAll();
    return textObj;
}
displayCharactersInRows(characters);
// Helper function to clear existing grid
function clearExistingGrid() {
    if (currentGrid) {
        canvas.remove(currentGrid);
    }
}
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


// Save and Load
function saveWorkspace() {
    try {
        // Get canvas objects excluding grid
        const objects = canvas.getObjects().filter(obj => !obj.isGridGroup && !obj.grid);

        // Get background image state if it exists
        const bgImage = document.getElementById('bgImage');
        const bgImageState = bgImage ? {
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
        const CUSTOM_PROPS = ['id', 'characterKey', 'isGlyphTextRun', 'blockId', 'blockRow'];

        // Create workspace object with canvas state, names, and background
        const workspace = {
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
function loadWorkspace() {
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.json';

    fileInput.onchange = async (event) => {
        const file = event.target.files[0];
        if (!file) return;

        try {
            // Read and parse file
            const jsonContent = await file.text();
            const workspace = JSON.parse(jsonContent);
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

        } catch (error) {
            console.error('Error loading workspace:', error);
            alert('Error loading workspace file');
        }
    };

    // Trigger file selection
    fileInput.click();
}

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

// =============================================================================
// Search / filter
// =============================================================================
// dropdown logic
const dropdownContent = document.getElementById("dropdownContent");
sentences.forEach(sentence => {
    const link = document.createElement("a");
    link.href = "#";
    link.dataset.letter = sentence.letter;
    link.innerText = sentence.letter + '. ' + sentence.text;
    link.addEventListener("click", (e) => {
        e.preventDefault();
        filterAndDisplayCharacters(characters, sentence.letter);
        // Close dropdownContent when an item is clicked
        dropdownContent.style.display = 'none';
    });
    dropdownContent.appendChild(link);
});
// =============================================================================
// Drawing tools (cartouche, circle, line, arrow, bracket, rect, pencil, bubble)
// =============================================================================
function generateUniqueId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
}
function setupTextSubmission(x, y) {
    var textBox = new fabric.IText('Type here...', {
        left: x,
        top: y,
        fontSize: 20,
        borderColor: '#CCCCCC',
        cornerColor: '#CCCCCC',
        cornerSize: 6,
        transparentCorners: false
    });

    textBox.id = textBox.id || generateUniqueId();
    canvas.add(textBox);
    canvas.setActiveObject(textBox);

    // Show keyboard dialog when entering edit mode
    textBox.on('editing:entered', function () {
        openKeyboard();
        const keyboardInput = document.getElementById('keyboardInput');
        keyboardInput.value = this.text;

        // Update IText content as user types in keyboard dialog
        keyboardInput.addEventListener('input', function () {
            textBox.text = this.value;
            canvas.renderAll();
        });
    });

    textBox.enterEditing();
    textBox.selectAll();

    undoHistory.push({
        type: 'add',
        object: textBox.toJSON(),
        id: textBox.id
    });
}
// Cumulative offset for tool spawns so repeated clicks don't stack on top of
// each other. Steps diagonally and wraps after 10 placements.
let toolSpawnCounter = 0;
function nextToolOffset(step = 25, wrap = 10) {
    const idx = toolSpawnCounter++ % wrap;
    return { dx: idx * step, dy: idx * step };
}

function addCartouche() {
    const off = nextToolOffset();
    var rect = new fabric.Rect({
        left: 0,
        top: 0,
        stroke: 'orange',
        width: 600,
        height: 150,
        fill: 'transparent',
        strokeWidth: 3,
        rx: 30,
        ry: 30,
        originX: 'center',
        originY: 'center'
    });

    var lineOffset = 19;
    var line = new fabric.Line([0 - rect.width / 2 - lineOffset, -rect.height / 2, 0 - rect.width / 2 - lineOffset, rect.height / 2], {
        stroke: 'orange',
        strokeWidth: 20,
        selectable: false,
        originX: 'center',
        originY: 'center'
    });

    var cartouche = new fabric.Group([rect, line], {
        left: 100 + rect.width / 2 + off.dx,
        top: 100 + rect.height / 2 + off.dy,
        originX: 'center',
        originY: 'center'
    });

    // Generate unique ID
    cartouche.id = generateUniqueId();

    // Add to canvas
    canvas.add(cartouche);

    // Push to undoHistory instead of history
    undoHistory.push({
        type: 'add',
        object: cartouche.toJSON(['id']),
        id: cartouche.id
    });

    canvas.renderAll();
    return cartouche;
}
function addCircle() {
    const off = nextToolOffset();
    var circle = new fabric.Circle({
        left: 150 + off.dx,
        top: 150 + off.dy,
        stroke: 'black',
        fill: 'transparent', // No fill color
        // fill: 'green',
        radius: 50
    });
    // Generate unique ID for the line
    circle.id = generateUniqueId();
    canvas.add(circle);

    // Push to history with the generated ID
    undoHistory.push({
        type: 'add',
        object: circle.toJSON(['id']), // Changed from rect to line
        id: circle.id
    });

    canvas.renderAll();
    return circle;
}
function addLine() {
    const off = nextToolOffset();
    var x1 = 50, y1 = 100, x2 = 50, y2 = 400;
    var midX = (x1 + x2) / 2;
    var midY = (y1 + y2) / 2;

    var line = new fabric.Line([x1 - midX, y1 - midY, x2 - midX, y2 - midY], {
        left: 700 + midX + off.dx,
        top: 100 + midY + off.dy,
        stroke: 'black',
        strokeWidth: 3,
        originX: 'center',
        originY: 'center',
        selectable: true
    });

    // Generate unique ID for the line
    line.id = generateUniqueId();

    canvas.add(line);

    // Push to history with the generated ID
    undoHistory.push({
        type: 'add',
        object: line.toJSON(['id']), // Changed from rect to line
        id: line.id
    });

    canvas.renderAll();
    return line; // Changed from rect to line
}
function addArrow() {
    const off = nextToolOffset();
    // Create a line from (100, 200) to (300, 200)
    var line = new fabric.Line([100 - 200, 200 - 200, 300 - 200, 200 - 200], {
        stroke: 'black',
        strokeWidth: 2,
        selectable: true,
        originX: 'center',
        originY: 'center'
    });

    // Create a triangle to use as the arrowhead
    var arrowhead = new fabric.Triangle({
        left: 100,  // Relative to group center
        top: 0,     // Relative to group center
        originX: 'center',
        originY: 'center',
        width: 10,
        height: 30,
        fill: 'black',
        angle: 90
    });

    // Create a group with the line and triangle
    var group = new fabric.Group([line, arrowhead], {
        left: 400 + 200 + off.dx,  // Matching the example's positioning
        top: 100 + 200 + off.dy,   // Matching the example's positioning
        originX: 'center',
        originY: 'center'
    });

    // Generate unique ID for the group
    group.id = generateUniqueId();

    canvas.add(group);

    // Push to history with the generated ID
    undoHistory.push({
        type: 'add',
        object: group.toJSON(['id']),
        id: group.id
    });

    canvas.renderAll();
    return group;
}
function addSquareBracket() {
    const off = nextToolOffset();
    // Create the main vertical line
    const line = new fabric.Line([0, -50, 0, 50], {
        stroke: 'black',
        strokeWidth: 2,
        originX: 'center',
        originY: 'center'
    });

    // Create top horizontal line
    const topLine = new fabric.Line([-15, -50, 0, -50], {
        stroke: 'black',
        strokeWidth: 2,
        originX: 'center',
        originY: 'center'
    });

    // Create bottom horizontal line
    const bottomLine = new fabric.Line([-15, 50, 0, 50], {
        stroke: 'black',
        strokeWidth: 2,
        originX: 'center',
        originY: 'center'
    });

    // Create a group with all lines
    const group = new fabric.Group([line, topLine, bottomLine], {
        left: 400 + off.dx,
        top: 300 + off.dy,
        originX: 'center',
        originY: 'center'
    });

    // Generate unique ID
    group.id = generateUniqueId();

    // Add to canvas
    canvas.add(group);

    // Add to history for undo
    undoHistory.push({
        type: 'add',
        object: group.toJSON(['id']),
        id: group.id
    });

    canvas.requestRenderAll();
    return group;
}
function addCustomRect(options = {}) {
    const off = nextToolOffset();
    const defaults = {
        width: 200,
        height: 100,
        fill: 'transparent',
        stroke: 'orange',
        strokeWidth: 3,
        rx: 10,
        ry: 10,
        left: canvas.width / 2 + off.dx,
        top: canvas.height / 2 + off.dy,
        originX: 'center',
        originY: 'center',
        strokeUniform: true,
        selectable: true,
        hasControls: true
    };

    // Merge defaults with provided options
    const settings = { ...defaults, ...options };
    var rect = new fabric.Rect(settings);

    // Generate unique ID for the rectangle
    rect.id = generateUniqueId(); // Using your existing generateUniqueId function

    rect.setControlsVisibility({
        mt: true,
        mb: true,
        ml: true,
        mr: true,
        tl: true,
        tr: true,
        bl: true,
        br: true
    });

    canvas.add(rect);

    // Push to history with the generated ID
    undoHistory.push({
        type: 'add',
        object: rect.toJSON(['id']), // Include the id in the JSON
        id: rect.id
    });

    canvas.renderAll();
    return rect;
}
function addPencilLine() {
    const originalIsDrawingMode = canvas.isDrawingMode;

    canvas.freeDrawingBrush = new fabric.PencilBrush(canvas);

    // Customize the brush
    canvas.freeDrawingBrush.width = 2;          // Make lines thicker/thinner
    canvas.freeDrawingBrush.color = 'black';    // Change color
    canvas.freeDrawingBrush.strokeLineCap = 'round';    // round end caps
    canvas.freeDrawingBrush.strokeLineJoin = 'round';   // smooth line joins

    canvas.isDrawingMode = true;

    const originalPathCreated = canvas.onPathCreated;

    canvas.on('path:created', function pathCreatedHandler(e) {
        const path = e.path;
        path.id = generateUniqueId();

        undoHistory.push({
            type: 'add',
            object: path.toJSON(['id']),
            id: path.id
        });

        canvas.isDrawingMode = originalIsDrawingMode;
        canvas.off('path:created', pathCreatedHandler);

        if (originalPathCreated) {
            canvas.on('path:created', originalPathCreated);
        }
    });
}
function addSpeechBubble() {
    // Define the path with origin at center (0,0) for better scaling
    const path = 'M 0 -50 ' +             // Start at top center
        'A 50 50 0 1 1 0 50 ' +   // Draw right arc
        'L 0 50 ' +               // Line to bottom
        'L -30 70 ' +             // Tail point
        'L -10 50 ' +             // Back to bubble
        'A 50 50 0 1 1 0 -50 Z';  // Complete left arc and close

    const off = nextToolOffset();
    const bubble = new fabric.Path(path, {
        left: 150 + off.dx,
        top: 150 + off.dy,
        stroke: 'black',
        fill: 'transparent',
        scaleX: 1.5,
        scaleY: 1.5,
        originX: 'center',
        originY: 'center',
        strokeWidth: 2,
        strokeUniform: true,    // Keep stroke width uniform during scaling
        objectCaching: false    // Disable caching for better rendering
    });

    // Add padding to ensure the path doesn't get clipped
    bubble.set({
        strokeWidth: bubble.strokeWidth,
        padding: 20
    });

    bubble.id = generateUniqueId();
    canvas.add(bubble);

    // Update history
    undoHistory.push({
        type: 'add',
        object: bubble.toJSON(['id']),
        id: bubble.id
    });

    canvas.renderAll();
    return bubble;
}
// =============================================================================
// On-screen keyboard dialog
// =============================================================================

function handleKeyboardKeydown(e) {
    if (e.key === 'Backspace') {
        e.stopPropagation(); // Prevent the global backspace handler
    }
    if (e.key === 'Enter') {
        e.preventDefault();
        addKeyboardText();
    }
}

function openKeyboard() {
    document.getElementById('keyboardDialog').style.display = 'block';
    document.getElementById('keyboardOverlay').style.display = 'block';
    const keyboardInput = document.getElementById('keyboardInput');
    keyboardInput.focus();
}

function addKeyboardText() {
    const keyboardInput = document.getElementById('keyboardInput');
    const fontSizeInput = document.getElementById('keyboardFontSize');
    const text = keyboardInput.value;
    const fontSize = parseInt(fontSizeInput.value, 10) || 18; // Parse the input value

    if (text || text === '') {
        if (activeTextObject) {
            const prevState = activeTextObject.toJSON(['text', 'fontSize', 'left', 'top', 'angle', 'scaleX', 'scaleY', 'flipX', 'flipY']);
            activeTextObject.text = text;
            activeTextObject.fontSize = fontSize;
            canvas.renderAll();
            undoHistory.push({
                type: 'modify',
                actionType: 'moving',
                state: {
                    type: 'single',
                    id: activeTextObject.id,
                    state: prevState
                }
            });
        } else {
            var textBox = new fabric.IText(text, {
                left: textPosition.x,
                top: textPosition.y,
                fontSize: fontSize, // Use the parsed fontSize
                borderColor: '#CCCCCC',
                cornerColor: '#CCCCCC',
                cornerSize: 6,
                transparentCorners: false
            });

            textBox.id = textBox.id || generateUniqueId();
            canvas.add(textBox);
            canvas.setActiveObject(textBox);

            undoHistory.push({
                type: 'add',
                object: textBox.toJSON(),
                id: textBox.id
            });
        }
    }
    closeKeyboard();
}

function closeKeyboard() {
    document.getElementById('keyboardDialog').style.display = 'none';
    document.getElementById('keyboardOverlay').style.display = 'none';
    document.getElementById('keyboardInput').value = '';
    activeTextObject = null;
}

// =============================================================================
// Glyph text run (Unicode hieroglyphs as a single selectable IText)
// =============================================================================
// Distinct from addCharacterToCanvas, which creates one fabric.Text per glyph
// for free positioning. A glyph text run keeps multiple glyphs as one editable
// text block — selectable/copyable in the browser, and exported as a single
// text node in SVG (PDF embeds the canvas raster via jsPDF).

function syncThreeLineExtras() {
    const mode = document.querySelector('input[name="glyphMode"]:checked')?.value || 'textRun';
    const extras = document.getElementById('threeLineExtras');
    if (extras) extras.style.display = mode === 'threeLine' ? 'block' : 'none';
}

// Special-chars palette inside the three-line section. Tracks which of
// {translit, translation} was focused last, so palette clicks insert into the
// right field. Bound once on first open via setupOnce flag.
let _translitPaletteTarget = null;
function setupTranslitPalette() {
    const palette = document.getElementById('translitPalette');
    const translit = document.getElementById('threeLineTranslit');
    const translation = document.getElementById('threeLineTranslation');
    if (!palette || !translit || !translation) return;
    if (palette.dataset.wired === '1') return;
    palette.dataset.wired = '1';

    _translitPaletteTarget = translit;
    translit.addEventListener('focus', () => { _translitPaletteTarget = translit; });
    translation.addEventListener('focus', () => { _translitPaletteTarget = translation; });

    // mousedown (not click) so the textarea doesn't lose focus before insertion.
    palette.addEventListener('mousedown', (e) => {
        const key = e.target.closest('.key');
        if (!key) return;
        e.preventDefault();
        const ch = key.textContent;
        const field = _translitPaletteTarget || translit;
        const start = field.selectionStart ?? field.value.length;
        const end = field.selectionEnd ?? field.value.length;
        field.value = field.value.slice(0, start) + ch + field.value.slice(end);
        const caret = start + ch.length;
        field.focus();
        field.setSelectionRange(caret, caret);
    });
}

function openGlyphTextDialog() {
    document.getElementById('glyphTextDialog').style.display = 'block';
    document.getElementById('glyphTextOverlay').style.display = 'block';
    // Restore last-used mode so the toggle is sticky across opens.
    let mode = 'textRun';
    try { mode = localStorage.getItem('glyphMode') || 'textRun'; } catch (_) { }
    const radio = document.querySelector(`input[name="glyphMode"][value="${mode}"]`);
    if (radio) radio.checked = true;
    // Bind once per open via onchange (replaces, so no listener buildup).
    document.querySelectorAll('input[name="glyphMode"]').forEach(r => {
        r.onchange = syncThreeLineExtras;
    });
    syncThreeLineExtras();
    setupTranslitPalette();
    document.getElementById('glyphTextInput').focus();
}

function closeGlyphTextDialog() {
    document.getElementById('glyphTextDialog').style.display = 'none';
    document.getElementById('glyphTextOverlay').style.display = 'none';
    document.getElementById('glyphTextInput').value = '';
    const translit = document.getElementById('threeLineTranslit');
    const translation = document.getElementById('threeLineTranslation');
    if (translit) translit.value = '';
    if (translation) translation.value = '';
}

async function addGlyphsFromDialog() {
    const raw = document.getElementById('glyphTextInput').value;
    const fontSize = parseInt(document.getElementById('glyphTextFontSize').value, 10) || 60;
    const mode = document.querySelector('input[name="glyphMode"]:checked')?.value || 'textRun';
    try { localStorage.setItem('glyphMode', mode); } catch (_) { }

    if (mode === 'individual') {
        // Hand off to the existing flat layout engine (one fabric.Text per sign).
        handleMdCInput(raw);
        closeGlyphTextDialog();
        return;
    }

    if (mode === 'threeLine') {
        const translit = document.getElementById('threeLineTranslit').value;
        const translation = document.getElementById('threeLineTranslation').value;
        await addThreeLineBlock(raw, translit, translation, fontSize);
        closeGlyphTextDialog();
        return;
    }

    // textRun: one selectable fabric.IText holding the whole string.
    const matches = parseMdCInput(raw);
    if (matches.length === 0) {
        alert('No glyphs recognized. Enter Gardiner codes (e.g. A1-D21-N35) or paste Unicode hieroglyphs.');
        return;
    }
    const glyphString = matches.map(m => m[1]).join('');
    try {
        await document.fonts.load(`${fontSize}px "Noto Sans Egyptian Hieroglyphs"`);
    } catch (_) { /* best-effort */ }
    addGlyphTextRun(glyphString, 200, 200, fontSize);
    closeGlyphTextDialog();
}

// =============================================================================
// Three-line linked block: glyphs / transliteration / translation
// =============================================================================
// Custom properties added to fabric.IText instances:
//   blockId  — shared by all three rows of the same block
//   blockRow — 'glyphs' | 'translit' | 'translation'
// Linkage:
//   - object:moving propagates the delta to all siblings with the same blockId
//   - storeAndRemoveCharacter sweeps siblings before removing the target
// Persistence:
//   - saveWorkspace toJSON include list contains blockId + blockRow so reload
//     reconstitutes the linkage automatically (Fabric copies through unknowns).

async function addThreeLineBlock(glyphsRaw, translit, translation, glyphSize) {
    glyphsRaw = (glyphsRaw || '').trim();
    translit = translit || '';
    translation = translation || '';
    glyphSize = glyphSize || 48;

    if (!glyphsRaw && !translit && !translation) return;

    // Resolve hieroglyph input: accept Gardiner codes or raw Unicode.
    let glyphText = '';
    if (glyphsRaw) {
        const matches = parseMdCInput(glyphsRaw);
        glyphText = matches.length ? matches.map(m => m[1]).join('') : glyphsRaw;
    }

    if (glyphText) {
        try { await document.fonts.load(`${glyphSize}px "Noto Sans Egyptian Hieroglyphs"`); }
        catch (_) { /* best-effort */ }
    }

    const translitSize = Math.max(12, Math.round(glyphSize * 0.45));
    const translationSize = Math.max(11, Math.round(glyphSize * 0.38));
    const gap = Math.round(glyphSize * 0.18);

    const blockId = `block_${Date.now()}_${Math.floor(Math.random() * 9999)}`;
    const baseX = 200;
    let y = 200;

    const common = {
        left: baseX,
        fill: 'black',
        originX: 'left',
        originY: 'top',
        borderColor: '#CCCCCC',
        cornerColor: '#CCCCCC',
        cornerSize: 6,
        transparentCorners: false,
        blockId: blockId,
    };

    const rows = [];
    if (glyphText) {
        const row = new fabric.IText(glyphText, {
            ...common,
            top: y,
            fontSize: glyphSize,
            fontFamily: '"Noto Sans Egyptian Hieroglyphs", "Hieroglyphica Extended", sans-serif',
            blockRow: 'glyphs',
        });
        row.id = generateUniqueId();
        rows.push(row);
        y += row.height + gap;
    }
    if (translit) {
        const row = new fabric.IText(translit, {
            ...common,
            top: y,
            fontSize: translitSize,
            fontFamily: 'Times, "Times New Roman", serif',
            fontStyle: 'italic',
            blockRow: 'translit',
        });
        row.id = generateUniqueId();
        rows.push(row);
        y += row.height + gap;
    }
    if (translation) {
        const row = new fabric.IText(translation, {
            ...common,
            top: y,
            fontSize: translationSize,
            fontFamily: 'Arial, sans-serif',
            blockRow: 'translation',
        });
        row.id = generateUniqueId();
        rows.push(row);
    }

    rows.forEach(r => canvas.add(r));
    if (rows.length) canvas.setActiveObject(rows[0]);
    canvasModified = true;
    canvas.requestRenderAll();
}

function getBlockSiblings(obj) {
    if (!obj || !obj.blockId) return [];
    return canvas.getObjects().filter(o => o.blockId === obj.blockId && o !== obj);
}

// Wires drag propagation: moving any row moves all siblings by the same delta.
// Uses _lastLeft/_lastTop on the dragged object as a per-frame anchor; we reset
// these on mouse:down so the first frame of the next drag starts from a clean
// reference point.
function initBlockLinkage() {
    let suppress = false;

    canvas.on('mouse:down', (opt) => {
        const obj = opt.target;
        if (obj && obj.blockId) {
            obj._lastLeft = obj.left;
            obj._lastTop = obj.top;
        }
    });

    canvas.on('object:moving', (e) => {
        const obj = e.target;
        if (!obj || !obj.blockId || suppress) return;
        if (obj._lastLeft == null) {
            obj._lastLeft = obj.left;
            obj._lastTop = obj.top;
            return;
        }
        const dx = obj.left - obj._lastLeft;
        const dy = obj.top - obj._lastTop;
        obj._lastLeft = obj.left;
        obj._lastTop = obj.top;
        if (dx === 0 && dy === 0) return;

        suppress = true;
        getBlockSiblings(obj).forEach(s => {
            s.set({ left: s.left + dx, top: s.top + dy });
            s.setCoords();
        });
        suppress = false;
    });
}

function addGlyphTextRun(text, x, y, fontSize) {
    canvasModified = true;

    const textRun = new fabric.IText(text, {
        left: x,
        top: y,
        fontSize: fontSize,
        fill: 'black',
        originX: 'left',
        originY: 'top',
        selectable: true,
        fontFamily: '"Noto Sans Egyptian Hieroglyphs", "Hieroglyphica Extended", sans-serif',
        textBaseline: 'alphabetic',
        borderColor: '#CCCCCC',
        cornerColor: '#CCCCCC',
        cornerSize: 6,
        transparentCorners: false
    });

    textRun.id = generateUniqueId();
    textRun.isGlyphTextRun = true;

    canvas.add(textRun);
    canvas.setActiveObject(textRun);

    undoHistory.push({
        type: 'add',
        object: textRun.toJSON(['id', 'isGlyphTextRun']),
        id: textRun.id
    });

    canvas.requestRenderAll();
    return textRun;
}
function initKeyboardAndSearch() {
    const keyboardInput = document.getElementById('keyboardInput');
    // Attach the keydown handler once; openKeyboard/closeKeyboard just toggle visibility.
    keyboardInput.addEventListener('keydown', handleKeyboardKeydown);
    // Handle search input filtering
    searchInput.addEventListener('input', e =>
        filterAndDisplayCharacters(characters, e.target.value)
    );
    // Handle clicking keyboard buttons
    document.querySelectorAll('.key').forEach(key => {
        key.addEventListener('click', function () {
            const char = this.textContent;
            const cursorPos = keyboardInput.selectionStart;
            const textBefore = keyboardInput.value.substring(0, cursorPos);
            const textAfter = keyboardInput.value.substring(keyboardInput.selectionEnd);

            keyboardInput.value = textBefore + char + textAfter;
            keyboardInput.focus();
            const newPos = cursorPos + char.length;
            keyboardInput.setSelectionRange(newPos, newPos);
        });
    });

    // Close when clicking overlay
    document.getElementById('keyboardOverlay').addEventListener('click', closeKeyboard);

    // Glyph text run dialog: dismiss on overlay click and on Enter (with Shift
    // for newline, matching common chat UX).
    const glyphOverlay = document.getElementById('glyphTextOverlay');
    if (glyphOverlay) glyphOverlay.addEventListener('click', closeGlyphTextDialog);
    const glyphInput = document.getElementById('glyphTextInput');
    if (glyphInput) {
        glyphInput.addEventListener('keydown', (e) => {
            if (e.key === 'Backspace') e.stopPropagation();
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                addGlyphsFromDialog();
            }
        });
    }
}

// =============================================================================
// Main file menu (Save / Open / Wiki)
// =============================================================================
function initMainMenu() {
    const menuBtn = document.getElementById('mainMenuBtn');
    const menu = document.getElementById('mainMenu');
    const saveAsJsonBtn = document.getElementById('saveAsJsonBtn');
    const saveAsSvgBtn = document.getElementById('saveAsSvgBtn');
    const saveAsPdfBtn = document.getElementById('saveAsPdfBtn');
    const openBtn = document.getElementById('loadWorkspaceBtn');
    const wikiBtn = document.getElementById('wikiBtn');

    menu.classList.add('hidden');

    menuBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        menu.classList.toggle('hidden');
    });

    const close = () => menu.classList.add('hidden');

    const saveAsPngBtn = document.getElementById('saveAsPngBtn');
    saveAsJsonBtn.addEventListener('click', (e) => { e.stopPropagation(); saveWorkspace(); close(); });
    if (saveAsPngBtn) saveAsPngBtn.addEventListener('click', (e) => { e.stopPropagation(); saveToPNG(); close(); });
    saveAsSvgBtn.addEventListener('click', (e) => { e.stopPropagation(); saveToSVG(); close(); });
    saveAsPdfBtn.addEventListener('click', (e) => { e.stopPropagation(); saveToPDF(); close(); });
    openBtn.addEventListener('click', (e) => { e.stopPropagation(); loadWorkspace(); close(); });
    wikiBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        window.open('https://en.wikipedia.org/wiki/List_of_Egyptian_hieroglyphs#Letter_classification_by_Gardiner', '_blank');
        close();
    });

    document.addEventListener('click', close);
}

// =============================================================================
// MdC paste handler — drop multi-glyph strings onto the canvas
// =============================================================================
// Parse paste input into an ordered list of character entries.
// Accepts: Gardiner codes ("A1-D21-N35", "A1 D21 N35", "A1,D21"),
// raw hieroglyph unicode ("𓂀𓏏𓊵"), or a mix.
function parseMdCInput(input) {
    const matches = [];
    // Split on common separators; whatever remains is either a code
    // token or a run of raw glyph characters.
    const tokens = input.split(/[-\s,;:*]+/).filter(Boolean);
    for (const token of tokens) {
        const codeMatch = charsByCode.get(token.toUpperCase());
        if (codeMatch) {
            matches.push(codeMatch);
            continue;
        }
        // Iterate by codepoint (Egyptian hieroglyphs are surrogate pairs in UTF-16).
        for (const ch of token) {
            const glyphMatch = charsByGlyph.get(ch);
            if (glyphMatch) matches.push(glyphMatch);
        }
    }
    return matches;
}

function handleMdCInput(mdcString) {
    const matches = parseMdCInput(mdcString);
    if (matches.length === 0) {
        alert('No glyphs recognized. Paste Gardiner codes (e.g. A1-D21-N35) or hieroglyph characters.');
        return;
    }

    // Glyphs render at fontSize 60 with center origin. Real glyph widths
    // and heights vary, so step by measured width and bottom-align so the
    // baseline (bottom edge) is shared across the row.
    const hGap = 12;
    const vGap = 18;
    const nominalGlyph = 60;
    const lineHeight = nominalGlyph + vGap;
    const startX = 100;
    const baselineYStart = 100 + nominalGlyph;  // shared bottom edge of first row
    const margin = 50;
    const maxLines = 14;

    const rightEdge = canvas.width - margin;

    const existingObjects = canvas.getObjects();
    let baselineY = baselineYStart;
    if (existingObjects.length > 0) {
        // Lowest bottom edge across existing objects (top is the center for originY:'center').
        const lowestBottom = existingObjects.reduce((maxY, obj) => {
            return Math.max(maxY, obj.top + obj.getScaledHeight() / 2);
        }, 0);
        // New row sits a full lineHeight below — that's vGap of clear space + a nominal glyph height.
        baselineY = Math.max(baselineYStart, lowestBottom + lineHeight);
    }

    let xOffset = startX;

    const usableHeight = canvas.height - margin;
    const availableLines = Math.floor((usableHeight - baselineY) / lineHeight) + 1;
    let currentLine = 1;

    if (availableLines <= 0) {
        alert('Canvas is full. Cannot add more glyphs.');
        return;
    }

    for (const match of matches) {
        if (currentLine > Math.min(maxLines, availableLines)) {
            alert(`Reached line limit of ${Math.min(maxLines, availableLines)}`);
            return;
        }

        // Place provisionally to measure, then re-position so the left edge
        // sits at xOffset and the bottom edge sits on baselineY.
        const obj = addCharacterToCanvas(match[1], match[0], xOffset, baselineY);
        const w = obj.getScaledWidth();
        const h = obj.getScaledHeight();

        // If this glyph would spill past the right edge, wrap to next line.
        if (xOffset + w > rightEdge && xOffset > startX) {
            xOffset = startX;
            baselineY += lineHeight;
            currentLine++;
            if (currentLine > Math.min(maxLines, availableLines)) {
                canvas.remove(obj);
                alert(`Reached line limit of ${Math.min(maxLines, availableLines)}`);
                return;
            }
        }

        obj.set({
            left: xOffset + w / 2,
            top: baselineY - h / 2
        });
        obj.setCoords();
        xOffset += w + hGap;
    }

    canvas.requestRenderAll();
}
// =============================================================================
// DOM event wiring (search, help overlay, dropdown)
// =============================================================================

document.getElementById("dropdownButton").addEventListener("click", () => {
    const content = document.getElementById("dropdownContent");
    content.style.display = content.style.display === "block" ? "none" : "block";
});

document.getElementById('help').addEventListener('click', function () {
    var helpOverlay = document.getElementById('helpOverlay');
    helpOverlay.style.display = helpOverlay.style.display === 'flex' ? 'none' : 'flex';
});

// Help content: Click outside iframe to close
document.getElementById('helpOverlay').addEventListener('click', function (e) {
    if (e.target === this) { // Only if clicking outside the iframe
        this.style.display = 'none';
    }
});
document.getElementById('searchInput').addEventListener('input', (e) => {
    // Filter and display characters based on the search query
    filterAndDisplayCharacters(characters, e.target.value);
});
// Save / Open / Wiki are wired up inside the main file menu init above.

//============================ Adds char to Gardiner field ===================
function initCharDragstart() {
    const container = document.getElementById('charListContainer');
    container.addEventListener('dragstart', (event) => {
        // Check if className exists and is a string
        if (event.target.className && typeof event.target.className === 'string' &&
            event.target.className.includes('char-container')) {
            event.dataTransfer.setData('text/plain', event.target.querySelector('.char').textContent);
        }
    }, false);

    // Click-to-select: highlight the clicked palette cell, clearing any prior
    // selection. Selection is purely visual — drag and existing add-to-canvas
    // flows are unaffected.
    container.addEventListener('click', (event) => {
        const cell = event.target.closest('.char-container');
        if (!cell || !container.contains(cell)) return;
        const prev = container.querySelector('.char-container.selected');
        if (prev === cell) return;
        if (prev) prev.classList.remove('selected');
        cell.classList.add('selected');
    });
}
// =============================================================================
// Background image
// =============================================================================
canvas.on('selection:created', function (e) {
    const selectedObject = e.selected && e.selected[0];
    if (selectedObject && selectedObject.type === 'image' && !selectedObject.selectable) {
        canvas.discardActiveObject();
        canvas.sendToBack(selectedObject);
        canvas.requestRenderAll();
    }
});
function initBackgroundImage() {
    const opacitySlider = document.getElementById('bgOpacity');
    const opacityValue = document.getElementById('opacityValue');

    if (opacitySlider && opacityValue) {
        opacitySlider.addEventListener('input', function () {
            const opacity = this.value / 100;
            // Get all image objects from canvas
            const images = canvas.getObjects().filter(obj => obj.type === 'image');

            // Update opacity for all background images
            images.forEach(img => {
                img.set('opacity', opacity);
            });

            // Update the display value
            opacityValue.textContent = `${this.value}%`;

            // Render the canvas to show changes
            canvas.requestRenderAll();
        });
    }
    const bgImageInput = document.getElementById('bgImageInput');

    // Function to handle image loading
    function handleImageLoad(imageUrl) {
    // Create a new fabric Image object from the URL
    fabric.Image.fromURL(imageUrl, function(img) {
        // Get the original image dimensions
        const imgWidth = img.width;
        const imgHeight = img.height;
        
        // Calculate appropriate scaling to fit within the canvas
        // Using 80% of the canvas size to leave some padding
        const scale = Math.min(
            (canvas.width / imgWidth) * 0.8,
            (canvas.height / imgHeight) * 0.8
        );

        // Configure the image properties
        img.set({
            left: canvas.width / 2,
            top: canvas.height / 2,
            originX: 'center',
            originY: 'center',
            scaleX: scale,
            scaleY: scale,
            id: generateUniqueId()
        });

        // Add the image to the canvas
        canvas.add(img);
        
        // Send the image to the back of all other objects
        canvas.sendToBack(img);
        
        // Redraw grid if it exists
        if (typeof drawGrid === 'function') {
            drawGrid();
        }

        // Add to undo history
        undoHistory.push({
            type: 'add',
            object: img.toJSON(['id']),
            id: img.id
        });

        canvas.requestRenderAll();
    });
}
    // Background image handling
// Background image handling with privacy safeguards
bgImageInput.addEventListener('change', function (e) {
    const file = e.target.files[0];
    
    // Validate file type before processing
    if (!file.type.startsWith('image/')) {
        console.error('Please select an image file');
        bgImageInput.value = '';
        return;
    }

    // Use the file directly as an object URL — no FileReader needed.
    const tempUrl = URL.createObjectURL(file);
    handleImageLoad(tempUrl);
    setTimeout(() => URL.revokeObjectURL(tempUrl), 1000);
    bgImageInput.value = '';
});

// Add these attributes to your input element for additional security
bgImageInput.setAttribute('accept', 'image/*');
bgImageInput.setAttribute('capture', 'environment');

    // Modified remove background function
    window.removeBackground = function () {
        const activeObject = canvas.getActiveObject();
        if (activeObject && activeObject.type === 'image') {
            // Store the removal in undo history
            undoHistory.push({
                type: 'delete',
                object: activeObject.toJSON(['id']),
                id: activeObject.id
            });

            // Remove the image
            canvas.remove(activeObject);
            canvas.requestRenderAll();
        }
    };
}

// =============================================================================
// DOM ready dispatcher — single entry point for all init.
// =============================================================================
document.addEventListener('DOMContentLoaded', () => {
    initKeyboardAndSearch();
    initMainMenu();
    initCharDragstart();
    initBackgroundImage();
    initColorPopup();
    initPaletteResizer();
    initResultsResizer();
    initCanvasContextMenu();
    initBlockLinkage();
});

// Replace the browser's default right-click menu on the canvas with one whose
// Save/Copy entries actually capture the composed image (Fabric pixels +
// background image). The browser default only sees Fabric's transparent
// upper-canvas, so its "Save image"/"Copy image" entries are misleading.
function initCanvasContextMenu() {
    const menu = document.getElementById('canvasCtxMenu');
    const workspace = document.getElementById('workspaceContainer');
    if (!menu || !workspace) return;

    const open = (clientX, clientY) => {
        // Show off-screen first so we can measure, then clamp into viewport.
        menu.style.left = '-9999px';
        menu.style.top = '-9999px';
        menu.classList.remove('hidden');
        const rect = menu.getBoundingClientRect();
        const x = Math.min(clientX, window.innerWidth - rect.width - 4);
        const y = Math.min(clientY, window.innerHeight - rect.height - 4);
        menu.style.left = Math.max(4, x) + 'px';
        menu.style.top = Math.max(4, y) + 'px';
    };
    const close = () => menu.classList.add('hidden');

    workspace.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        open(e.clientX, e.clientY);
    });

    menu.addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-action]');
        if (!btn) return;
        e.stopPropagation();
        close();
        switch (btn.dataset.action) {
            case 'copy': copyCanvasImage(); break;
            case 'png':  saveToPNG();       break;
            case 'svg':  saveToSVG();       break;
            case 'pdf':  saveToPDF();       break;
        }
    });

    // Dismiss on outside click, scroll, resize, or Escape.
    document.addEventListener('click', (e) => {
        if (!menu.contains(e.target)) close();
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
}

// Drag the left edge of #searchContainer to widen the Gardiner palette.
// Width is stored on :root as --palette-w and persisted in localStorage.
// The Fabric canvas is resized to fill the remaining space.
function initPaletteResizer() {
    const handle = document.getElementById('paletteResizer');
    const panel = document.getElementById('searchContainer');
    const container = document.querySelector('.container');
    if (!handle || !panel || !container) return;

    const MIN_W = 280;
    const clampW = (w) => {
        const max = Math.max(MIN_W, Math.floor(window.innerWidth * 0.8));
        return Math.min(max, Math.max(MIN_W, w));
    };

    function applyW(w) {
        document.documentElement.style.setProperty('--palette-w', w + 'px');
        if (typeof canvas !== 'undefined' && canvas && canvas.setDimensions) {
            const d = getCanvasDimensions();
            canvas.setDimensions({ width: d.width, height: d.height }, { cssOnly: false });
            try { clearExistingGrid(); drawGrid(); } catch (_) { }
            const zoom = canvas.getZoom();
            const vpt = canvas.viewportTransform;
            canvas.setViewportTransform([zoom, 0, 0, zoom, vpt[4], vpt[5]]);
            canvas.requestRenderAll();
        }
        try { updateDivWidth(); } catch (_) { }
    }

    // Restore + clamp the saved width, then re-run the canvas-resize path so
    // the Fabric pixel buffer (initialized earlier against the default palette
    // width) is brought in line with the restored width. Without this, on
    // reload the canvas stays too wide and pushes the palette off-screen until
    // any subsequent window-resize event fires.
    const saved = parseInt(localStorage.getItem('paletteW'), 10);
    if (saved > 0) applyW(clampW(saved));

    // If the window shrinks below current palette + min canvas room, clamp.
    window.addEventListener('resize', () => {
        const cur = parseInt(getComputedStyle(panel).width, 10);
        if (cur > 0) {
            const clamped = clampW(cur);
            if (clamped !== cur) applyW(clamped);
        }
    });

    let dragging = false;
    let rafPending = false;
    let pendingW = 0;

    handle.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        dragging = true;
        try { handle.setPointerCapture(e.pointerId); } catch (_) { }
        document.body.style.cursor = 'ew-resize';
    });

    handle.addEventListener('pointermove', (e) => {
        if (!dragging) return;
        const rect = container.getBoundingClientRect();
        pendingW = clampW(rect.right - e.clientX);
        if (!rafPending) {
            rafPending = true;
            requestAnimationFrame(() => {
                rafPending = false;
                applyW(pendingW);
            });
        }
    });

    function endDrag(e) {
        if (!dragging) return;
        dragging = false;
        try { handle.releasePointerCapture(e.pointerId); } catch (_) { }
        document.body.style.cursor = '';
        try {
            const cur = parseInt(getComputedStyle(panel).width, 10);
            if (cur > 0) localStorage.setItem('paletteW', String(cur));
        } catch (_) { }
    }
    handle.addEventListener('pointerup', endDrag);
    handle.addEventListener('pointercancel', endDrag);
}

// Wire up the horizontal bar between the char list and the dictionary panel.
// Drag down to grow the char list, up to grow the dictionary results.
function initResultsResizer() {
    const handle = document.getElementById('resultsResizer');
    const list = document.getElementById('charListContainer');
    if (!handle || !list) return;

    const saved = parseInt(localStorage.getItem('charListH'), 10);
    if (saved > 0) {
        list.style.height = saved + 'px';
        list.style.minHeight = '0';
        list.style.flexShrink = '1';
    }

    let dragging = false;
    handle.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        dragging = true;
        try { handle.setPointerCapture(e.pointerId); } catch (_) { }
        document.body.style.cursor = 'ns-resize';
    });
    handle.addEventListener('pointermove', (e) => {
        if (!dragging) return;
        const rect = list.getBoundingClientRect();
        const newH = Math.max(120, e.clientY - rect.top);
        list.style.height = newH + 'px';
        list.style.minHeight = '0';
        list.style.flexShrink = '1';
    });
    function endDrag(e) {
        if (!dragging) return;
        dragging = false;
        try { handle.releasePointerCapture(e.pointerId); } catch (_) { }
        document.body.style.cursor = '';
        try {
            const h = parseInt(list.style.height, 10);
            if (h > 0) localStorage.setItem('charListH', String(h));
        } catch (_) { }
    }
    handle.addEventListener('pointerup', endDrag);
    handle.addEventListener('pointercancel', endDrag);
}

// =============================================================================
// Background color popup
// =============================================================================
function toggleColorPopup(e) {
    e?.stopPropagation();
    const popup = document.getElementById('colorPopup');
    popup.style.display = popup.style.display === 'none' ? 'block' : 'none';
}

function setCanvasColor(color) {
    canvas.setBackgroundColor(color, canvas.renderAll.bind(canvas));
    document.getElementById('colorPopup').style.display = 'none';
}

function initColorPopup() {
    // Close popup when clicking anywhere outside it (matches the main-menu pattern).
    // The 🎨 button's onclick calls stopPropagation, so toggling doesn't trigger this.
    document.addEventListener('click', (e) => {
        const popup = document.getElementById('colorPopup');
        if (popup.style.display !== 'none' && !popup.contains(e.target)) {
            popup.style.display = 'none';
        }
    });
}
// =============================================================================
// Layout & window lifecycle (resize, beforeunload, keybindings)
// =============================================================================
function updateDivWidth() {
    const canvasWidth = getCanvasDimensions().width;
    document.getElementById('pastedNamesContainer').style.width = `${canvasWidth}px`;
}

// Set initial width
updateDivWidth();

// Update on window resize

window.addEventListener('load', () => window.outerWidth < screen.availWidth && alert('Please maximize your window for the best experience'));
window.addEventListener('resize', function () {
    // Clear the timeout if it exists
    if (resizeTimeout) {
        clearTimeout(resizeTimeout);
    }

    // Set a timeout to prevent excessive resizing
    resizeTimeout = setTimeout(function () {
        // Get new dimensions
        const dimensions = getCanvasDimensions();

        // Update canvas dimensions
        canvas.setDimensions({
            width: dimensions.width,
            height: dimensions.height
        }, {
            cssOnly: false
        });

        // Recalculate the grid
        clearExistingGrid();
        drawGrid();

        // Update viewport transform to maintain zoom and pan
        const zoom = canvas.getZoom();
        const vpt = canvas.viewportTransform;
        canvas.setViewportTransform([
            zoom, 0, 0, zoom,
            vpt[4], vpt[5]
        ]);

        // Force a full re-render
        canvas.requestRenderAll();
    }, 200); // 200ms delay to debounce resize events
});

// Add window beforeunload event
window.addEventListener('beforeunload', function (e) {
    if (canvasModified) {
        e.preventDefault();
        // Most modern browsers ignore custom messages and show their own
        return e.returnValue = 'You have unsaved changes. Are you sure you want to leave?';
    }
});
// document.addEventListener('contextmenu', event => event.preventDefault());

window.addEventListener('keydown', function (e) {
    const activeObject = canvas.getActiveObject();
    const activeGroup = canvas.getActiveObjects();
    // Skip delete-from-canvas when focus is in any text field — input,
    // textarea, or contenteditable. Prevents Backspace inside dialog inputs
    // from nuking the selected canvas object.
    const tag = (e.target.tagName || '').toLowerCase();
    const isInTextField = tag === 'input' || tag === 'textarea' || e.target.isContentEditable;

    // Utility to display feedback
    const showIndicator = (message) => {
        const indicator = document.createElement('div');
        indicator.textContent = message;
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
    };

    // Cycle through objects (Ctrl + Arrow Keys)
    if (e.ctrlKey && ['ArrowRight', 'ArrowLeft'].includes(e.key)) {
        e.preventDefault();
        const objects = canvas.getObjects();
        let currentIndex = objects.indexOf(activeObject);

        currentIndex = (e.key === 'ArrowRight')
            ? (currentIndex + 1) % objects.length
            : (currentIndex - 1 + objects.length) % objects.length;

        canvas.setActiveObject(objects[currentIndex]);
        canvas.requestRenderAll();
        return;
    }

    // Lock/unlock objects (Ctrl + L)
    if (e.ctrlKey && (e.key.toLowerCase() === 'l')) {
        e.preventDefault();
        const selectedObjects = canvas.getActiveObjects();
        const objects = canvas.getObjects();

        const lockObject = (obj) => {
            if (!obj.locked) {
                obj._originalProps = {
                    selectable: obj.selectable,
                    evented: obj.evented,
                    hasControls: obj.hasControls,
                    hasBorders: obj.hasBorders,
                    lockMovementX: obj.lockMovementX,
                    lockMovementY: obj.lockMovementY,
                    lockRotation: obj.lockRotation,
                    lockScalingX: obj.lockScalingX,
                    lockScalingY: obj.lockScalingY,
                };
                obj.set({
                    selectable: false,
                    evented: false,
                    hasControls: false,
                    hasBorders: false,
                    lockMovementX: true,
                    lockMovementY: true,
                    lockRotation: true,
                    lockScalingX: true,
                    lockScalingY: true,
                });
                obj.locked = true;
            }
        };

        const unlockObject = (obj) => {
            if (obj.locked && obj._originalProps) {
                obj.set(obj._originalProps);
                delete obj._originalProps;
                obj.locked = false;
            }
        };

        if (!selectedObjects.length) {
            let unlockedCount = 0;
            objects.forEach((obj) => {
                if (obj.locked) {
                    unlockObject(obj);
                    unlockedCount++;
                }
            });
            if (unlockedCount > 0) {
                showIndicator(`Unlocked ${unlockedCount} object${unlockedCount > 1 ? 's' : ''}`);
            }
        } else {
            selectedObjects.forEach((obj) => {
                obj.locked ? unlockObject(obj) : lockObject(obj);
            });
            showIndicator(
                `${selectedObjects.length} object${selectedObjects.length > 1 ? 's' : ''} ${
                    selectedObjects[0].locked ? 'locked' : 'unlocked'
                }`
            );
        }

        canvas.discardActiveObject();
        canvas.requestRenderAll();
        return;
    }

    // Save workspace (Ctrl + S)
    if (e.ctrlKey && (e.key.toLowerCase() === 's')) {
        e.preventDefault();
        saveWorkspace();
        return;
    }

    // Distribute objects equally (Ctrl + D)
    if (e.ctrlKey && (e.key.toLowerCase() === 'd')) {
        e.preventDefault();
        const selectedObjects = canvas.getActiveObjects();
        if (selectedObjects.length < 2) {
            alert("Select at least two objects to distribute them.");
            return;
        }

        // Sort and calculate equal spacing
        selectedObjects.sort((a, b) => a.left - b.left);
        const spacing =
            (selectedObjects[selectedObjects.length - 1].left - selectedObjects[0].left) /
            (selectedObjects.length - 1);

        selectedObjects.forEach((obj, index) => {
            obj.set('left', selectedObjects[0].left + index * spacing);
            obj.setCoords();
        });

        canvas.requestRenderAll();
        return;
    }

    // Delete objects (Delete/Backspace)
    if (!isInTextField && (e.key === 'Delete' || e.key === 'Backspace')) {
        e.preventDefault();
        if (activeGroup.length) {
            activeGroup.forEach(storeAndRemoveCharacter);
        } else if (activeObject) {
            storeAndRemoveCharacter(activeObject);
        }
        canvas.discardActiveObject();
        canvas.requestRenderAll();
        return;
    }

    // Alignment shortcuts
    if (!e.ctrlKey) {
        const alignMap = {
            h: 'horizontal',
            t: 'top',
            b: 'bottom',
            l: 'left',
        };
        if (alignMap[e.key.toLowerCase()]) {
            alignObjects(alignMap[e.key.toLowerCase()]);
            return;
        }
        if (e.key.toLowerCase() === 'r') {
            mirrorTextObject(activeObject);
            return;
        }
    }

    // Move objects with arrow keys
    
    if (!e.ctrlKey && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
        if (activeObject && !activeObject.locked) { // Add check for locked property
            const moveAmount = e.shiftKey ? 1 : 5;
            switch (e.key) {
                case 'ArrowLeft': 
                    activeObject.set('left', activeObject.left - moveAmount); 
                    break;
                case 'ArrowRight': 
                    activeObject.set('left', activeObject.left + moveAmount); 
                    break;
                case 'ArrowUp': 
                    activeObject.set('top', activeObject.top - moveAmount); 
                    break;
                case 'ArrowDown': 
                    activeObject.set('top', activeObject.top + moveAmount); 
                    break;
            }
            activeObject.setCoords();
            canvas.requestRenderAll();
        }
    }
    
    
        // Undo (Ctrl + Z)
        if (e.ctrlKey && e.key.toLowerCase() === 'z') {
            undoLastAction();
            return;
        }
    });
