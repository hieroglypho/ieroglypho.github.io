/*!
 * ΙΕΡΟΓΛΥΦΩ editor — glyph-input (part 6 of 7)
 *
 * Classic <script defer>; shares globals with the other editor scripts via the
 * global lexical environment. Do NOT convert to type="module" (inline onclick=
 * handlers need these functions global). Load order:
 *   editor-core → canvas-interactions → workspace → export → drawing-tools → glyph-input → editor-init
 *
 * @copyright Copyright (c) 2024 Massimo Mazzon. All rights reserved.
 */

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

    if (mode === 'threeLine') {
        const translit = document.getElementById('threeLineTranslit').value;
        const translation = document.getElementById('threeLineTranslation').value;
        await addThreeLineBlock(raw, translit, translation, fontSize);
        closeGlyphTextDialog();
        return;
    }

    // MdC spatial operators (':' stack, '*' juxtapose, parentheses) arrange
    // glyphs in 2D, which a single linear text run cannot represent. Route to
    // the individual-sign layout engine whenever the user picks that mode OR
    // the input contains a spatial operator — so e.g. "(M17:X1)*N35" lays out
    // correctly even if "Single text run" happens to be selected.
    const hasSpatialMdC = /[:*()]/.test(raw);
    if (mode === 'individual' || hasSpatialMdC) {
        handleMdCInput(raw);
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

// -----------------------------------------------------------------------------
// Tier 1 — core spatial layout for the MdC operators  -  :  *  ( )
// -----------------------------------------------------------------------------
// handleMdCInput parses the string into a small expression tree honouring the
// Manuel de Codage operator precedence (tightest binding first):
//
//     ( ... )   grouping (highest)
//     *         juxtaposition  — glyphs placed side by side (horizontal)
//     :         superposition  — glyphs stacked top-over-bottom (vertical)
//     -         cadrat separator — laid out left-to-right along the row (lowest)
//
// So  A*B:C   parses as  (A*B):C   — "A beside B" sitting over "C", and
//     A:B*C   parses as  A:(B*C)   — "A" over "B beside C".
//
// Glyphs keep their natural metrics (no stretching); within a group they pack
// along the operator axis and centre on the cross axis. Each top-level cadrat
// is uniformly scaled down if it would exceed MDC_MAX_CADRAT so deep stacks
// stay within a sane size. Any parse failure (unbalanced parens, a stray
// operator, nothing recognised) falls back to the original flat-row layout so
// a paste never hard-fails.

const MDC_BASE = 60;            // fontSize glyphs are added at (matches addCharacterToCanvas)
const MDC_GAP = 4;              // gap between siblings inside a cadrat, at scale 1
const MDC_MAX_CADRAT = 130;     // cap on a single cadrat's width/height before downscaling
const MDC_FONT = '"Noto Sans Egyptian Hieroglyphs", "Hieroglyphica Extended", sans-serif';

function handleMdCInput(mdcString) {
    let tree = null;
    try {
        tree = parseMdCTree(tokenizeMdC(mdcString));
    } catch (_) {
        tree = null;  // fall through to the flat layout below
    }

    if (!tree || tree.children.length === 0) {
        // No spatial structure (or a parse error) — keep the original behaviour.
        return handleMdCInputFlat(mdcString);
    }

    layoutMdCRow(tree.children);
}

// Split the raw string into glyph leaves and operator tokens.
// A "word" is resolved as a whole Gardiner code first; failing that it is
// treated as a run of raw Unicode glyphs (each becomes its own leaf, joined by
// an implicit '-' so plain pasted Unicode still lays out as a row).
function tokenizeMdC(input) {
    const tokens = [];
    let word = '';

    const flushWord = () => {
        if (!word) return;
        const code = charsByCode.get(word.toUpperCase());
        if (code) {
            tokens.push({ type: 'glyph', entry: code });
        } else {
            const leaves = [];
            for (const ch of word) {
                const g = charsByGlyph.get(ch);
                if (g) leaves.push(g);
            }
            leaves.forEach((g, i) => {
                if (i > 0) tokens.push({ type: 'op', op: '-' });
                tokens.push({ type: 'glyph', entry: g });
            });
        }
        word = '';
    };

    for (const ch of input) {
        if (ch === '(' || ch === ')' || ch === '-' || ch === ':' || ch === '*') {
            flushWord();
            tokens.push({ type: 'op', op: ch });
        } else if (/[\s,;]/.test(ch)) {
            flushWord();
            tokens.push({ type: 'op', op: '-' });   // whitespace/comma = cadrat break
        } else {
            word += ch;
        }
    }
    flushWord();
    return tokens;
}

// Recursive-descent parse into:
//   { type:'glyph', entry }                 leaf
//   { type:'h', children:[...] }            '*' horizontal group
//   { type:'v', children:[...] }            ':' vertical group
//   { type:'row', children:[cadrat,...] }   top-level '-' sequence
function parseMdCTree(tokens) {
    let pos = 0;
    const peek = () => tokens[pos];
    const eat = () => tokens[pos++];
    const isOp = (t, op) => t && t.type === 'op' && t.op === op;

    function parseAtom() {
        const t = peek();
        if (isOp(t, '(')) {
            eat();
            const inner = parseStack();
            if (!isOp(peek(), ')')) throw new Error('unbalanced parens');
            eat();
            return inner;
        }
        if (t && t.type === 'glyph') { eat(); return { type: 'glyph', entry: t.entry }; }
        throw new Error('unexpected token');
    }

    function parseJuxt() {
        const kids = [parseAtom()];
        while (isOp(peek(), '*')) { eat(); kids.push(parseAtom()); }
        return kids.length === 1 ? kids[0] : { type: 'h', children: kids };
    }

    function parseStack() {
        const kids = [parseJuxt()];
        while (isOp(peek(), ':')) { eat(); kids.push(parseJuxt()); }
        return kids.length === 1 ? kids[0] : { type: 'v', children: kids };
    }

    function parseSeq() {
        const cadrats = [];
        while (isOp(peek(), '-')) eat();          // skip leading separators
        while (peek()) {
            cadrats.push(parseStack());
            while (isOp(peek(), '-')) eat();       // collapse separators between cadrats
        }
        return { type: 'row', children: cadrats };
    }

    const tree = parseSeq();
    if (pos < tokens.length) throw new Error('trailing tokens');
    return tree;
}

// Compute each node's natural (unscaled) box, storing w/h on the node.
function measureMdCNode(node) {
    if (node.type === 'glyph') {
        const t = new fabric.Text(node.entry[1], { fontSize: MDC_BASE, fontFamily: MDC_FONT });
        node.w = t.width || MDC_BASE;
        node.h = t.height || MDC_BASE;
        return node;
    }
    node.children.forEach(measureMdCNode);
    const gaps = MDC_GAP * (node.children.length - 1);
    if (node.type === 'h') {
        node.w = node.children.reduce((s, c) => s + c.w, 0) + gaps;
        node.h = Math.max(...node.children.map(c => c.h));
    } else { // 'v'
        node.w = Math.max(...node.children.map(c => c.w));
        node.h = node.children.reduce((s, c) => s + c.h, 0) + gaps;
    }
    return node;
}

// Render a measured node. (x, y) is the top-left of the node's box; the whole
// subtree is drawn at the given uniform `scale`. Children pack along the
// operator axis and centre on the cross axis.
function placeMdCNode(node, x, y, scale) {
    const boxW = node.w * scale;
    const boxH = node.h * scale;

    if (node.type === 'glyph') {
        const obj = addCharacterToCanvas(node.entry[1], node.entry[0], 0, 0);
        obj.set({ scaleX: scale, scaleY: scale, left: x + boxW / 2, top: y + boxH / 2 });
        obj.setCoords();
        return;
    }

    if (node.type === 'h') {
        let cx = x;
        for (const c of node.children) {
            const ch = c.h * scale;
            placeMdCNode(c, cx, y + (boxH - ch) / 2, scale);   // centre vertically
            cx += c.w * scale + MDC_GAP * scale;
        }
    } else { // 'v'
        let cy = y;
        for (const c of node.children) {
            const cw = c.w * scale;
            placeMdCNode(c, x + (boxW - cw) / 2, cy, scale);   // centre horizontally
            cy += c.h * scale + MDC_GAP * scale;
        }
    }
}

// Lay a sequence of cadrats out along the row: bottom-aligned, wrapping at the
// right edge, placed below any existing canvas content (mirrors the old flat
// layout, but each item is a fully laid-out cadrat block).
function layoutMdCRow(cadrats) {
    const hGap = 12, vGap = 18, margin = 50, startX = 100;
    const rightEdge = canvas.width - margin;
    const usableBottom = canvas.height - margin;

    const blocks = cadrats.map(node => {
        measureMdCNode(node);
        const scale = Math.min(1, MDC_MAX_CADRAT / node.w, MDC_MAX_CADRAT / node.h);
        return { node, w: node.w * scale, h: node.h * scale, scale };
    });

    let baselineY = 100 + MDC_BASE;
    const existing = canvas.getObjects();
    if (existing.length > 0) {
        const lowestBottom = existing.reduce(
            (m, o) => Math.max(m, o.top + o.getScaledHeight() / 2), 0);
        baselineY = Math.max(baselineY, lowestBottom + MDC_BASE + vGap);
    }

    let cursorX = startX;
    let rowMaxH = 0;

    for (const b of blocks) {
        if (cursorX + b.w > rightEdge && cursorX > startX) {
            cursorX = startX;
            baselineY += rowMaxH + vGap;   // advance by the tallest cadrat in the row
            rowMaxH = 0;
        }
        if (baselineY > usableBottom) {
            alert('Canvas is full. Some glyphs were not placed.');
            break;
        }
        placeMdCNode(b.node, cursorX, baselineY - b.h, b.scale);  // bottom edge on baseline
        cursorX += b.w + hGap;
        rowMaxH = Math.max(rowMaxH, b.h);
    }

    canvas.requestRenderAll();
}

// Original flat layout — one fabric.Text per sign in a single bottom-aligned,
// wrapping row. Retained as the fallback when there is no spatial structure to
// honour (or a parse error). Treats every operator as a plain separator.
function handleMdCInputFlat(mdcString) {
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
