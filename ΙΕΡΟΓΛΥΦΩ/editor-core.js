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
// EDITOR MODULE MAP  (this is part 1 of 7 — see STRUCTURE.md)
// =============================================================================
// The editor was one 3174-line script.js; it is now split into 7 classic
// <script defer> files that share one global scope. Load order is load-bearing
// and is fixed in index.html. Do NOT convert to type="module" (inline onclick=
// handlers require these functions to stay global).
//
//   1. editor-core.js .......... state, canvas + grid, glyph table/catalog,
//                                 add-character-to-canvas              ← THIS FILE
//   2. canvas-interactions.js .. mouse (drag/marquee/pan/zoom), undo,
//                                 delete/cleanup, mirror, alignment
//   3. workspace.js ............ save / load workspace
//   4. export.js ............... SVG / PDF / PNG / copy, watermark, font embed
//   5. drawing-tools.js ........ search-filter dropdown + shape tools
//                                 (cartouche, circle, line, arrow, bracket,
//                                 rect, pencil, bubble)
//   6. glyph-input.js .......... on-screen keyboard, glyph-text dialog,
//                                 three-line linked blocks, MdC paste handler
//   7. editor-init.js .......... main menu, DOM event wiring, background image,
//                                 DOM-ready dispatcher, color popup, lifecycle
//
// Sections within this file:
//   1. State (globals + constants)
//   2. Canvas init + grid
//   3. Character table — decode, render, filter
//   4. Gardiner category labels
//   5. Add character to canvas
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

// =============================================================================
// Page-size guide — a toggleable US-Letter frame drawn on the canvas so the
// user can compose within a printable region (PDF export fits to Letter). The
// button cycles off → portrait → landscape. The frame is excluded from every
// export: flagged `_pageGuide` (skipped by getContentBounds + the PDF text
// layer), `excludeFromExport:true` (SVG/JSON), and hidden in withGridHidden
// (raster). Uses 96 DPI to match the export px→pt assumption (72/96).
// =============================================================================
var PAGE_GUIDE_DPI = 96;
var pageGuideState = 'off';   // 'off' | 'p' | 'l'
var pageGuideObj = null;
// Breathing room (grid squares of 20px) the dashed "compose here" box is pulled
// in past the printable margin so signs never clip in the exported PDF. The inset
// is ASYMMETRIC because glyphs are anchored by their TOP-LEFT corner and you place
// a sign so its head sits on the corner:
//   • top / left  — the head/apex overhangs the anchor only slightly and the body
//     grows *into* the box, so 2 squares is enough; keeping it tight means the
//     top-left corner lands right on the bird's head, where you aim it.
//   • bottom / right — the whole body (~3 squares) extends *out* toward the page
//     edge, so these are pulled in 4 squares to keep the body on the page.
// The full page still exports 1:1 — this box is just a safe-placement guide.
var PAGE_GUIDE_SAFE_INSET = 40;          // top & left      (2 grid squares)
var PAGE_GUIDE_SAFE_INSET_BR = 40;       // bottom & right  (2 grid squares)

function _letterFrameDims(orientation) {
    const wIn = orientation === 'l' ? 11 : 8.5;
    const hIn = orientation === 'l' ? 8.5 : 11;
    const m = 0.5, D = PAGE_GUIDE_DPI;   // 0.5" printable margin
    return {
        pageW: wIn * D, pageH: hIn * D, margin: m * D,
        printW: (wIn - 2 * m) * D, printH: (hIn - 2 * m) * D
    };
}

function _buildPageGuide(orientation) {
    const d = _letterFrameDims(orientation);
    const common = {
        fill: 'transparent', selectable: false, evented: false,
        strokeUniform: true, objectCaching: false
    };
    const paper = new fabric.Rect({
        left: 0, top: 0, width: d.pageW, height: d.pageH,
        stroke: 'rgba(90,150,255,0.7)', strokeWidth: 1.5, ...common
    });
    // Inner dashed "safe zone": the printable area pulled in past its margin by
    // PAGE_GUIDE_SAFE_INSET on the top/left and PAGE_GUIDE_SAFE_INSET_BR on the
    // bottom/right (see those constants). Compose within it and signs always export
    // whole. The full page still exports 1:1.
    const i = PAGE_GUIDE_SAFE_INSET, iBR = PAGE_GUIDE_SAFE_INSET_BR;
    const printable = new fabric.Rect({
        left: d.margin + i, top: d.margin + i,
        width: Math.max(0, d.printW - i - iBR), height: Math.max(0, d.printH - i - iBR),
        stroke: 'rgba(120,180,255,0.95)', strokeWidth: 1.5, strokeDashArray: [5, 4], ...common
    });
    const group = new fabric.Group([paper, printable], {
        left: Math.round((canvas.width - d.pageW) / 2),
        top: Math.round((canvas.height - d.pageH) / 2),
        selectable: false, evented: false, hoverCursor: 'default',
        excludeFromExport: true, objectCaching: false
    });
    group._pageGuide = true;
    return group;
}

// Keep the frame centred when the canvas is resized.
function repositionPageGuide() {
    if (!pageGuideObj) return;
    const b = pageGuideObj.getBoundingRect(true, true);
    pageGuideObj.set({
        left: Math.round((canvas.width - b.width) / 2),
        top: Math.round((canvas.height - b.height) / 2)
    });
    pageGuideObj.setCoords();
    canvas.requestRenderAll();
}

function setPageGuide(state) {
    if (pageGuideObj) { canvas.remove(pageGuideObj); pageGuideObj = null; }
    pageGuideState = state;
    if (state === 'p' || state === 'l') {
        pageGuideObj = _buildPageGuide(state);
        canvas.add(pageGuideObj);
        canvas.sendToBack(pageGuideObj);   // behind content; grid bg sits further back
    }
    canvas.requestRenderAll();
    _updatePageGuideBtn();
}

function cyclePageGuide() {
    setPageGuide(pageGuideState === 'off' ? 'p' : pageGuideState === 'p' ? 'l' : 'off');
}

function _updatePageGuideBtn() {
    const btn = document.getElementById('pageGuideBtn');
    if (!btn) return;
    btn.textContent = pageGuideState === 'p' ? 'Page ▯'
                    : pageGuideState === 'l' ? 'Page ▭' : 'Page';
    btn.classList.toggle('active', pageGuideState !== 'off');
    btn.title = 'Page guide (US-Letter): ' + (
        pageGuideState === 'off' ? 'hidden — click for portrait'
      : pageGuideState === 'p'   ? 'portrait — click for landscape'
      :                            'landscape — click to hide');
}

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
