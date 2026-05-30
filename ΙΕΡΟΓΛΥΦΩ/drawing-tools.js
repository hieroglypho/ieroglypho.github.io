/*!
 * ΙΕΡΟΓΛΥΦΩ editor — drawing-tools (part 5 of 7)
 *
 * Classic <script defer>; shares globals with the other editor scripts via the
 * global lexical environment. Do NOT convert to type="module" (inline onclick=
 * handlers need these functions global). Load order:
 *   editor-core → canvas-interactions → workspace → export → drawing-tools → glyph-input → editor-init
 *
 * @copyright Copyright (c) 2024 Massimo Mazzon. All rights reserved.
 */

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
// Build a single bracket as a fabric.Group at (left, top). `facing` is 'open'
// for '[' (arms point right) or 'close' for ']' (arms point left).
function buildBracketGroup(facing, left, top) {
    const arm = facing === 'close' ? -15 : 15;   // direction the horizontal stubs point
    const lineOpts = { stroke: 'black', strokeWidth: 2, originX: 'center', originY: 'center' };
    const line = new fabric.Line([0, -50, 0, 50], lineOpts);
    const topLine = new fabric.Line([0, -50, arm, -50], lineOpts);
    const bottomLine = new fabric.Line([0, 50, arm, 50], lineOpts);
    return new fabric.Group([line, topLine, bottomLine], {
        left, top, originX: 'center', originY: 'center'
    });
}

// Add a bracket-pair annotation: an opening '[' and a closing ']' facing inward.
// They are placed a short distance apart as two independent objects, so the user
// can drag each to enclose content of any width. Epigraphic brackets are always
// paired and face inward (Leiden conventions), so a single tool drops both.
function addSquareBracket() {
    const off = nextToolOffset();
    const cy = 300 + off.dy;
    const gap = 120;                  // initial space between the two brackets
    const leftX = 400 + off.dx - gap / 2;

    const pair = [
        buildBracketGroup('open', leftX, cy),
        buildBracketGroup('close', leftX + gap, cy),
    ];

    pair.forEach(group => {
        group.id = generateUniqueId();
        canvas.add(group);
        undoHistory.push({ type: 'add', object: group.toJSON(['id']), id: group.id });
    });

    canvas.requestRenderAll();
    return pair;
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
