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
            pushUndo({
                type: 'modify',
                actionType: 'moving',
                state: {
                    type: 'single',
                    id: activeTextObject.id,
                    state: prevState
                }
            });
        } else {
            const at = getInsertPoint();
            var textBox = new fabric.IText(text, {
                left: at.x,
                top: at.y,
                fontSize: fontSize, // Use the parsed fontSize
                borderColor: '#CCCCCC',
                cornerColor: '#CCCCCC',
                cornerSize: 6,
                transparentCorners: false
            });

            textBox.id = textBox.id || generateUniqueId();
            canvas.add(textBox);
            canvas.setActiveObject(textBox);

            pushUndo({
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
    // glyphs in 2D, and the Tier 2–5 markup (breaks '!', enclosures '<>',
    // colour '$', shading '#', lacunae '?', editorial brackets '[ ] { } & " \'')
    // can't be rendered by a single linear text run either. Route to the
    // individual-sign layout engine whenever the user picks that mode OR the
    // input contains any such markup — so e.g. "(M17:X1)*N35" or "[[A1-B1]]"
    // lays out correctly even if "Single text run" happens to be selected.
    const hasSpatialMdC = /[:*()!<>$#?[\]{}&"']/.test(raw) || /[\u{13430}-\u{1345F}]/u.test(raw);
    if (mode === 'individual' || hasSpatialMdC) {
        // Ensure the hieroglyph font is ready before layout: the engine measures
        // glyph ink boxes with the Canvas API, which silently uses a fallback
        // font (wrong metrics) if this hasn't loaded yet.
        try { await document.fonts.load(`${MDC_BASE}px ${MDC_FONT}`); } catch (_) { /* best-effort */ }
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
    const at = getInsertPoint();
    addGlyphTextRun(glyphString, at.x, at.y, fontSize);
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
    const _at = getInsertPoint();
    const baseX = _at.x;
    let y = _at.y;

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

// A soft link key shared by objects that move / delete together but stay
// individually selectable and editable (NO fabric grouping): three-line blocks
// (`blockId`) and MdC enclosures (`enclosureId`). The two namespaces are
// prefix-distinct, so one generic key cannot cross-match a block with an
// enclosure.
function objLinkKey(obj) {
    return obj ? (obj.blockId || obj.enclosureId || null) : null;
}

function getBlockSiblings(obj) {
    const key = objLinkKey(obj);
    if (!key) return [];
    return canvas.getObjects().filter(o => objLinkKey(o) === key && o !== obj);
}

// Wires drag propagation: moving any row moves all siblings by the same delta.
// Uses _lastLeft/_lastTop on the dragged object as a per-frame anchor; we reset
// these on mouse:down so the first frame of the next drag starts from a clean
// reference point.
function initBlockLinkage() {
    let suppress = false;

    canvas.on('mouse:down', (opt) => {
        const obj = opt.target;
        if (obj && objLinkKey(obj)) {
            obj._lastLeft = obj.left;
            obj._lastTop = obj.top;
        }
    });

    canvas.on('object:moving', (e) => {
        const obj = e.target;
        if (!obj || !objLinkKey(obj) || suppress) return;
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

    pushUndo({
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
    const aboutBtn = document.getElementById('aboutBtn');

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
    const shareBtn = document.getElementById('shareLinkBtn');
    if (shareBtn) shareBtn.addEventListener('click', (e) => { e.stopPropagation(); shareWorkspace(); close(); });
    if (aboutBtn) aboutBtn.addEventListener('click', (e) => { e.stopPropagation(); openAbout(); close(); });
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
        const codeMatch = mdcLookupCode(token);   // case rules: see MDC_PHONETIC
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
// Tiers 1–2 — spatial layout + text structure for the MdC operators
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
// Tier 2 adds text structure between cadrats:
//     space / _    word boundary    — a wider gap than '-'
//     2× space / __ sentence boundary — wider still
//     !            line break       — force a new row
//     !!           page/section break — new row plus a large vertical gap
//
// Glyphs keep their natural metrics (no stretching); within a group they pack
// along the operator axis and centre on the cross axis. Each top-level cadrat
// is uniformly scaled down if it would exceed MDC_MAX_CADRAT so deep stacks
// stay within a sane size. Any parse failure (unbalanced parens, a stray
// operator, nothing recognised) falls back to the original flat-row layout so
// a paste never hard-fails.

const MDC_BASE = 60;            // fontSize glyphs are added at (matches addCharacterToCanvas)
const MDC_GAP = 6;              // gap between siblings inside a cadrat, at scale 1
const MDC_MAX_CADRAT = 130;     // cap on a single cadrat's width/height before downscaling
const MDC_FONT = '"Noto Sans Egyptian Hieroglyphs", "Hieroglyphica Extended", sans-serif';
const MDC_CADRAT_GAP = 10;      // '-' separator: cadrats within a word
const MDC_WORD_GAP = 28;        // single space / '_' : word boundary
const MDC_SENTENCE_GAP = 50;    // double space / '__' : sentence boundary
const MDC_LINE_VGAP = 18;       // vertical gap between rows (normal wrap / '!')
const MDC_PAGE_VGAP = 70;       // extra vertical gap added for a '!!' page break
const MDC_ENC_PAD = 14;         // inner padding: sides + gap below content (to panel/base)
const MDC_ENC_PAD_TOP = 30;     // inner padding above content (generous: figure stands, sky above)
const MDC_SEREKH_PANEL = 14;    // height of the serekh's (simplified) paneled facade strip

// Tier 4 — flags / toggles ----------------------------------------------------
// Colour rubric: $r red, $g green, $b/$k back to black. Unknown letters reset to
// black. Shading ('#b'…'#e', lone '#') marks damaged signs with a translucent
// grey wash; lacunae ('?' small, '??' large) are dashed gap boxes. Colour and
// shade are stream state (persist until re-toggled), so they live in the
// tokenizer and are stamped onto each glyph token as it is emitted.
const MDC_COLORS = { r: '#c0392b', g: '#1e7d34', b: null, k: null };  // null = black
const MDC_SHADE_FILL = 'rgba(0,0,0,0.18)';   // damaged-sign wash (drawn over the glyph)
const MDC_LACUNA_FILL = 'rgba(0,0,0,0.05)';  // lacuna gap tint
const MDC_LACUNA_STROKE = '#888';            // lacuna gap border (dashed)
const MDC_LACUNA_SMALL = 0.6;                // '?' box edge as a fraction of MDC_BASE

// Tier 5 — editorial brackets -------------------------------------------------
// A bracket pair (variant: erased/superfluous/vanished/scribal/editorial) wraps
// a laid-out span and draws a distinct line mark on each side. Parallels Tier 3
// enclosures but lighter: just the two side marks, no full frame.
const MDC_BRK_ARM = 9;     // arm length / mark column width at scale 1
const MDC_BRK_GAP = 6;     // gap between a bracket mark and the enclosed glyphs
const MDC_BRK_VPAD_TOP = 10; // marks rise this far above the tallest enclosed sign
                             // — enough headroom that a tall sign's apex (e.g. the
                             // A1 figure's head) clears the top mark rather than
                             // grazing it
const MDC_BRK_VPAD_BOT = 3;  // …and drop just below the baseline


// --- Ink-box measurement -----------------------------------------------------
// fabric.Text reports a uniform *line-box* height (~fontSize·1.3) for every
// glyph, so short signs (sun, water) get a tall box full of dead space — which
// makes vertical stacks gappy and breaks baseline alignment across a row. We
// instead measure each glyph's real ink box via Canvas measureText() and place
// glyphs by that box, so stacks pack tight and cadrats share an ink baseline.
let _mdcMeasureCtx = null;
const _mdcInkCache = new Map();
let _mdcFontBox = null;

function mdcMeasureCtx() {
    if (!_mdcMeasureCtx) _mdcMeasureCtx = document.createElement('canvas').getContext('2d');
    _mdcMeasureCtx.font = `${MDC_BASE}px ${MDC_FONT}`;
    _mdcMeasureCtx.textAlign = 'left';
    _mdcMeasureCtx.textBaseline = 'alphabetic';
    return _mdcMeasureCtx;
}

// Ink box of a single glyph at MDC_BASE, relative to the text origin
// (x = pen start, y = alphabetic baseline). Cached per glyph.
function measureGlyphInk(ch) {
    if (_mdcInkCache.has(ch)) return _mdcInkCache.get(ch);
    const m = mdcMeasureCtx().measureText(ch);
    let ink;
    if (typeof m.actualBoundingBoxAscent === 'number') {
        ink = {
            w: Math.max(1, m.actualBoundingBoxLeft + m.actualBoundingBoxRight),
            h: Math.max(1, m.actualBoundingBoxAscent + m.actualBoundingBoxDescent),
            ascent: m.actualBoundingBoxAscent,    // baseline → ink top  (up, +)
            descent: m.actualBoundingBoxDescent,  // baseline → ink bottom (down, +)
            left: m.actualBoundingBoxLeft,        // origin → ink left (left, +)
        };
    } else {
        // Old browser without actualBoundingBox*: fall back to advance + full em.
        const w = Math.max(1, m.width);
        ink = { w, h: MDC_BASE, ascent: MDC_BASE * 0.8, descent: MDC_BASE * 0.2, left: 0 };
    }
    _mdcInkCache.set(ch, ink);
    return ink;
}

// Distance from a fabric.Text's top edge down to its alphabetic baseline for a
// line-box height Hf, derived from the font's own ascent/descent. Lets us place
// a glyph by its ink box instead of fabric's uniform line box.
function mdcBaselineFromTop(Hf) {
    if (!_mdcFontBox) {
        const m = mdcMeasureCtx().measureText('\u{13000}');  // any hieroglyph (A1)
        _mdcFontBox = (typeof m.fontBoundingBoxAscent === 'number')
            ? { asc: m.fontBoundingBoxAscent, desc: m.fontBoundingBoxDescent }
            : { asc: MDC_BASE * 0.8, desc: MDC_BASE * 0.2 };
    }
    return (Hf - (_mdcFontBox.asc + _mdcFontBox.desc)) / 2 + _mdcFontBox.asc;
}

function handleMdCInput(mdcString) {
    mdcString = unicodeLayoutToMdC(mdcString);   // Unicode format controls → MdC operators
    let tree = null;
    try {
        tree = parseMdCTree(tokenizeMdC(mdcString));
    } catch (_) {
        tree = null;  // fall through to the flat layout below
    }

    if (!tree || !tree.children.some(c => c.kind === 'cadrat')) {
        // No glyphs to place (or a parse error) — keep the original behaviour.
        return handleMdCInputFlat(mdcString);
    }

    layoutMdCRow(tree.children);
}

// MdC single-letter sound codes. Case matters: a capital is a different sound
// (A = ꜣ vulture, a = ꜥ arm; H = ḥ, h = h; x = ḫ, X = ẖ; S = š; T = ṯ; D = ḏ).
// Letters not listed (B, F, G, …) fall through to the sign table as before.
const MDC_PHONETIC = {
    A: 'G1', a: 'D36', i: 'M17', y: 'Z4', w: 'G43', b: 'D58', p: 'Q3', f: 'I9',
    m: 'G17', n: 'N35', r: 'D21', l: 'E23', h: 'O4', H: 'V28', x: 'Aa1', X: 'F32',
    z: 'O34', s: 'S29', S: 'N37', q: 'N29', k: 'V31', g: 'W11', t: 'X1', T: 'V13',
    d: 'D46', D: 'I10'
};

// Gardiner codes ignoring case (a1 → A1, aa1 → Aa1, g7a → G7a). Built once;
// no two codes in the table differ only by case.
let _mdcCodesNoCase = null;

// Resolve one typed code to its sign entry, or undefined. Order: an MdC sound
// letter (case-sensitive), the exact code, then the code ignoring case. The old
// lookup upper-cased everything, so `a` gave the vulture and the 66 codes with
// a small letter (Aa1…, A5a, G7a, N35a…) could not be typed at all.
function mdcLookupCode(word) {
    if (word.length === 1 && MDC_PHONETIC[word]) {
        const e = charsByCode.get(MDC_PHONETIC[word]);
        if (e) return e;
    }
    const exact = charsByCode.get(word);
    if (exact) return exact;
    if (!_mdcCodesNoCase) {
        _mdcCodesNoCase = new Map();
        for (const [k, e] of charsByCode) _mdcCodesNoCase.set(k.toUpperCase(), e);
    }
    return _mdcCodesNoCase.get(word.toUpperCase());
}

// Split the raw string into glyph leaves and operator tokens.
// A "word" is resolved as a whole Gardiner code first; failing that it is
// treated as a run of raw Unicode glyphs (each becomes its own leaf, joined by
// an implicit '-' so plain pasted Unicode still lays out as a row).
function tokenizeMdC(input) {
    const tokens = [];
    let word = '';
    let curColor = null;    // stream state: ink colour (null = black)
    let curShade = false;   // stream state: '#b'…'#e' damaged-sign shading

    const flushWord = () => {
        if (!word) return;
        const code = mdcLookupCode(word);
        if (code) {
            tokens.push({ type: 'glyph', entry: code, color: curColor, shade: curShade });
        } else {
            const leaves = [];
            for (const ch of word) {
                const g = charsByGlyph.get(ch);
                if (g) leaves.push(g);
            }
            leaves.forEach((g, i) => {
                if (i > 0) tokens.push({ type: 'op', op: '-' });
                tokens.push({ type: 'glyph', entry: g, color: curColor, shade: curShade });
            });
        }
        word = '';
    };

    // Index over code points (not UTF-16 units) so glyph surrogate pairs stay
    // intact while we still get look-ahead for '!!' / '__' / space runs.
    const chars = [...input];
    let i = 0;
    while (i < chars.length) {
        const ch = chars[i];
        if (ch === '(' || ch === ')' || ch === '-' || ch === ':' || ch === '*') {
            flushWord();
            tokens.push({ type: 'op', op: ch });
            i++;
        } else if (ch === '!') {
            flushWord();
            if (chars[i + 1] === '!') { tokens.push({ type: 'op', op: '!!' }); i += 2; }
            else { tokens.push({ type: 'op', op: '!' }); i++; }
        } else if (ch === '_') {
            flushWord();
            let n = 0;
            while (i < chars.length && chars[i] === '_') { n++; i++; }
            tokens.push({ type: 'op', op: n >= 2 ? 'sgap' : 'wgap' });
        } else if (/\s/.test(ch)) {
            flushWord();
            let n = 0;
            while (i < chars.length && /\s/.test(chars[i])) { n++; i++; }
            tokens.push({ type: 'op', op: n >= 2 ? 'sgap' : 'wgap' });
        } else if (ch === '<' || ch === '>') {
            flushWord();
            const v = 'SHFshf'.includes(chars[i + 1] || '') ? chars[i + 1].toUpperCase() : null;
            if (v) {
                tokens.push({ type: 'op', op: ch === '<' ? 'encOpen' : 'encClose', variant: v });
                i += 2;
            } else {
                // Bare '<'/'>' (cartouche) is out of scope — treat as a cadrat
                // break so it doesn't swallow the adjacent code.
                tokens.push({ type: 'op', op: '-' });
                i++;
            }
        } else if (ch === '$') {
            // Colour rubric: '$r'/'$g' set red/green, '$b'/'$k' (or anything
            // else, incl. bare '$') reset to black. Persists as stream state.
            flushWord();
            const c = (chars[i + 1] || '').toLowerCase();
            if (/[a-z]/.test(c)) { curColor = (c in MDC_COLORS) ? MDC_COLORS[c] : null; i += 2; }
            else { curColor = null; i++; }
        } else if (ch === '#') {
            // '#b' begins / '#e' ends damaged-sign shading; a lone '#' is a
            // fully-shaded (destroyed) quadrat — e.g. the canonical '-#-'.
            flushWord();
            const c = (chars[i + 1] || '').toLowerCase();
            if (c === 'b') { curShade = true; i += 2; }
            else if (c === 'e') { curShade = false; i += 2; }
            else { tokens.push({ type: 'shadebox' }); i++; }
        } else if (ch === '?') {
            // Lacuna: '?' small gap, '??' large gap.
            flushWord();
            if (chars[i + 1] === '?') { tokens.push({ type: 'lacuna', size: 'large' }); i += 2; }
            else { tokens.push({ type: 'lacuna', size: 'small' }); i++; }
        } else if (ch === '[') {
            // Editorial bracket OPEN: the second char selects the variant
            // ('[['=erased, '[{'=superfluous, '["'=vanished, "['"=scribal,
            // '[&'=editorial). A bare '[' (no variant char) is a cadrat break.
            flushWord();
            const nx = chars[i + 1];
            const v = nx === '[' ? 'erased' : nx === '{' ? 'superfluous'
                : nx === '"' ? 'vanished' : nx === "'" ? 'scribal'
                    : nx === '&' ? 'editorial' : null;
            if (v) { tokens.push({ type: 'op', op: 'brkOpen', variant: v }); i += 2; }
            else { tokens.push({ type: 'op', op: '-' }); i++; }
        } else if (']}"\'&'.includes(ch) && chars[i + 1] === ']') {
            // Editorial bracket CLOSE: ']]' / '}]' / '"]' / "']" / '&]'.
            flushWord();
            const v = ch === ']' ? 'erased' : ch === '}' ? 'superfluous'
                : ch === '"' ? 'vanished' : ch === "'" ? 'scribal' : 'editorial';
            tokens.push({ type: 'op', op: 'brkClose', variant: v });
            i += 2;
        } else if (ch === ',' || ch === ';') {
            flushWord();
            tokens.push({ type: 'op', op: '-' });   // legacy paste convenience = cadrat break
            i++;
        } else {
            word += ch;
            i++;
        }
    }
    flushWord();
    return tokens;
}

// Recursive-descent parse into:
//   { type:'glyph', entry }                 leaf
//   { type:'h', children:[...] }            '*' horizontal group
//   { type:'v', children:[...] }            ':' vertical group
//   { type:'row', children:[item,...] }     top-level sequence, where each item
//                                            is { kind:'cadrat', node, gap } or
//                                            { kind:'break', level:'line'|'page' }
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
        if (isOp(t, 'encOpen')) {
            const variant = t.variant;
            eat();
            // Collect the enclosed cadrat sequence (skipping separators) until
            // the matching close. The frame is drawn around the whole group.
            const children = [];
            while (peek() && !isOp(peek(), 'encClose')) {
                const p = peek();
                if (p.type === 'op' && (p.op === '-' || p.op === 'wgap' || p.op === 'sgap')) {
                    eat();
                    continue;
                }
                children.push(parseStack());
            }
            if (!isOp(peek(), 'encClose')) throw new Error('unclosed enclosure');
            eat();
            return { type: 'enclosure', variant, children };
        }
        if (isOp(t, 'brkOpen')) {
            const variant = t.variant;
            eat();
            // Collect the bracketed span (skipping separators) until any close.
            // Mismatched close variants are tolerated (we keep the open variant)
            // so a typo can't drop the whole paste to the flat fallback.
            const children = [];
            while (peek() && !isOp(peek(), 'brkClose')) {
                const p = peek();
                if (p.type === 'op' && (p.op === '-' || p.op === 'wgap' || p.op === 'sgap')) {
                    eat();
                    continue;
                }
                children.push(parseStack());
            }
            if (!isOp(peek(), 'brkClose')) throw new Error('unclosed brackets');
            eat();
            return { type: 'brackets', variant, children };
        }
        if (t && t.type === 'lacuna') { eat(); return { type: 'lacuna', size: t.size }; }
        if (t && t.type === 'shadebox') { eat(); return { type: 'shadebox' }; }
        if (t && t.type === 'glyph') { eat(); return { type: 'glyph', entry: t.entry, color: t.color, shade: t.shade }; }
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
        const SEP_GAP = { '-': 'cadrat', wgap: 'word', sgap: 'sentence' };
        const GAP_RANK = { cadrat: 1, word: 2, sentence: 3 };
        const items = [];

        // Consume a run of separators/breaks between cadrats. Pushes break items
        // in order as it sees them; returns the strongest gap in the run (a gap
        // sitting next to a break is moot, since a break starts a fresh row).
        function consumeSeps() {
            let gap = null;
            while (peek() && peek().type === 'op' &&
                (peek().op in SEP_GAP || peek().op === '!' || peek().op === '!!')) {
                const op = eat().op;
                if (op === '!' || op === '!!') {
                    items.push({ kind: 'break', level: op === '!!' ? 'page' : 'line' });
                    gap = null;
                } else {
                    const g = SEP_GAP[op];
                    if (!gap || GAP_RANK[g] > GAP_RANK[gap]) gap = g;
                }
            }
            return gap;
        }

        let gap = consumeSeps();                 // leading run (gap is ignored at row start)
        while (peek()) {
            const node = parseStack();
            items.push({ kind: 'cadrat', node, gap });
            gap = consumeSeps();
        }
        return { type: 'row', children: items };
    }

    const tree = parseSeq();
    if (pos < tokens.length) throw new Error('trailing tokens');
    return tree;
}

// A node's ascent: the height it occupies above the writing baseline. For a
// glyph that's its ink ascent (ignoring the font's often-oversized descent);
// any other node is treated as a block sitting on the line, so its ascent is its
// full height. Used to size editorial brackets to the visible signs.
function mdcNodeAscent(node) {
    return node.type === 'glyph' ? node.ink.ascent : node.h;
}

// Compute each node's natural (unscaled) box, storing w/h on the node.
function measureMdCNode(node) {
    if (node.type === 'glyph') {
        const ink = measureGlyphInk(node.entry[1]);
        node.w = ink.w;
        node.h = ink.h;
        node.ink = ink;
        return node;
    }
    if (node.type === 'lacuna') {
        const s = node.size === 'large' ? MDC_BASE : MDC_BASE * MDC_LACUNA_SMALL;
        node.w = s;
        node.h = s;
        return node;
    }
    if (node.type === 'shadebox') {
        node.w = MDC_BASE;
        node.h = MDC_BASE;
        return node;
    }
    if (node.type === 'brackets') {
        node.children.forEach(measureMdCNode);
        const n = node.children.length;
        node.innerW = node.children.reduce((s, c) => s + c.w, 0) + MDC_GAP * Math.max(0, n - 1);
        // Size the marks by the signs' ASCENT (visible height above the
        // baseline), not the full ink box: some signs (e.g. N35) carry a large
        // empty descent in the font metrics, which would push the marks well
        // below the visible glyph. A glyph contributes its ink ascent; any other
        // node (stack/enclosure) contributes its full height (it sits above the
        // line as a block).
        node.innerAsc = n ? Math.max(...node.children.map(mdcNodeAscent)) : MDC_BASE;
        // Marks are sized proportionally to the enclosed content's visible ascent
        // (not a fixed line height): the bracket hugs its own sign, tall around a
        // tall sign, short around a low one. VPAD_TOP gives the apex headroom;
        // VPAD_BOT sits the marks just below the baseline.
        node.w = node.innerW + 2 * (MDC_BRK_ARM + MDC_BRK_GAP);
        node.h = node.innerAsc + MDC_BRK_VPAD_TOP + MDC_BRK_VPAD_BOT;
        return node;
    }
    if (node.type === 'enclosure') {
        node.children.forEach(measureMdCNode);
        const n = node.children.length;
        node.innerW = node.children.reduce((s, c) => s + c.w, 0) + MDC_GAP * Math.max(0, n - 1);
        node.innerH = n ? Math.max(...node.children.map(c => c.h)) : MDC_BASE;
        node.w = node.innerW + 2 * MDC_ENC_PAD;
        node.h = MDC_ENC_PAD_TOP + node.innerH + MDC_ENC_PAD + (node.variant === 'S' ? MDC_SEREKH_PANEL : 0);
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

    if (node.type === 'lacuna') {
        addMdCAuxObject(buildLacunaBox(x, y, boxW, boxH));
        return;
    }

    if (node.type === 'shadebox') {
        addMdCAuxObject(buildShadeBox(x, y, boxW, boxH));
        return;
    }

    if (node.type === 'glyph') {
        const ink = node.ink;
        const obj = addCharacterToCanvas(node.entry[1], node.entry[0], 0, 0);
        const Wf = obj.width || ink.w;     // fabric line-box width/height (unscaled)
        const Hf = obj.height || ink.h;
        // (x, y) is the ink box's top-left. Position the fabric object (centre
        // origin) so the glyph's ink lands exactly there.
        const fabricLeftEdge = x + scale * ink.left;
        const baselineY = y + scale * ink.ascent;
        obj.set({
            scaleX: scale,
            scaleY: scale,
            left: fabricLeftEdge + scale * Wf / 2,
            top: baselineY - scale * mdcBaselineFromTop(Hf) + scale * Hf / 2,
        });
        if (node.color) obj.set({ fill: node.color });
        obj.setCoords();
        // Damaged-sign shading: a translucent wash over the glyph's ink box
        // (added after the glyph so it reads as overlaid damage).
        if (node.shade) addMdCAuxObject(buildShadeBox(x, y, boxW, boxH));
        return;
    }

    if (node.type === 'enclosure') {
        // Frame first so the glyphs (added afterwards) render on top of it.
        const startIdx = canvas.getObjects().length;
        addEnclosureFrame(buildEnclosureFrame(node.variant, x, y, boxW, boxH));
        const contentTop = y + MDC_ENC_PAD_TOP * scale;
        const contentH = node.innerH * scale;
        let cx = x + MDC_ENC_PAD * scale;
        for (const c of node.children) {
            const ch = c.h * scale;
            placeMdCNode(c, cx, contentTop + (contentH - ch), scale);  // bottom-align in content
            cx += c.w * scale + MDC_GAP * scale;
        }
        // Soft-link the frame and everything inside it: each member stays
        // independently editable, but moves/mirrors/deletes as one unit (the same
        // mechanism as a three-line block — see objLinkKey / getBlockSiblings).
        // canvas.add only appends, so the new objects are exactly the tail slice.
        const enclosureId = `enc_${Date.now()}_${Math.floor(Math.random() * 9999)}`;
        canvas.getObjects().slice(startIdx).forEach(o => { o.enclosureId = enclosureId; });
        return;
    }

    if (node.type === 'brackets') {
        const arm = MDC_BRK_ARM * scale;
        const pad = MDC_BRK_GAP * scale;
        // Each sign sits with its baseline on `baseY`; the marks span the box,
        // rising VPAD_TOP above the tallest sign's ascent and dropping only
        // VPAD_BOT below the baseline. Sizing by ascent (see measureMdCNode)
        // keeps the marks tight to the visible signs even when a sign carries a
        // large empty descent in its metrics.
        const baseY = y + boxH - MDC_BRK_VPAD_BOT * scale;
        addMdCAuxObject(buildBracketMark(node.variant, 'left', x, y, boxH, arm));
        let cx = x + arm + pad;
        for (const c of node.children) {
            placeMdCNode(c, cx, baseY - mdcNodeAscent(c) * scale, scale);  // baseline-align
            cx += c.w * scale + MDC_GAP * scale;
        }
        addMdCAuxObject(buildBracketMark(node.variant, 'right', x + boxW - arm, y, boxH, arm));
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

// Build the Fabric frame for an enclosure variant, sized w×h with its top-left
// at (x, y). 'F' = plain rectangle, 'H' = box with a small doorway notch, 'S' =
// serekh (rectangle + a simplified paneled facade strip along the bottom).
function buildEnclosureFrame(variant, x, y, w, h) {
    const stroke = 'black', sw = 2;
    // Centre-origin throughout (matches the working addCartouche pattern): a
    // group placed by top-left origin lands ~half its height too high in fabric.
    const cx = x + w / 2, cy = y + h / 2;
    const half = { originX: 'center', originY: 'center' };
    const rect = new fabric.Rect({ left: 0, top: 0, width: w, height: h, fill: 'transparent', stroke, strokeWidth: sw, ...half });

    if (variant === 'F') {
        rect.set({ left: cx, top: cy, selectable: true });
        return rect;
    }

    const parts = [rect];
    if (variant === 'H') {
        // doorway notch: short upright near the bottom-left (centre-relative coords)
        const doorH = Math.min(14, h * 0.3);
        parts.push(new fabric.Line([-w / 2 + 10, h / 2, -w / 2 + 10, h / 2 - doorH], { stroke, strokeWidth: sw, ...half }));
    } else {
        // 'S' serekh: divider above the bottom panel + a few niche uprights.
        const yPanel = h / 2 - MDC_SEREKH_PANEL;
        parts.push(new fabric.Line([-w / 2, yPanel, w / 2, yPanel], { stroke, strokeWidth: sw, ...half }));
        const niches = Math.max(2, Math.round(w / 18));
        for (let k = 1; k < niches; k++) {
            const nx = -w / 2 + w * k / niches;
            parts.push(new fabric.Line([nx, yPanel, nx, h / 2], { stroke, strokeWidth: 1, ...half }));
        }
    }
    return new fabric.Group(parts, { left: cx, top: cy, originX: 'center', originY: 'center', selectable: true });
}

// Build one side ('left'/'right') of an editorial bracket pair as a stroked
// fabric.Path, drawn in absolute canvas coords spanning the column [X, X+arm]
// vertically over [Ytop, Ytop+H]. `vx` is the outer (vertical) edge and `ax` the
// inner arm tip toward the enclosed glyphs, so the same formulae mirror for both
// sides. Variants: erased = double square, superfluous = curly brace, vanished =
// dashed square, scribal = corner ticks, editorial = angle.
function buildBracketMark(variant, side, X, Ytop, H, arm) {
    const Y = Ytop, B = Ytop + H;
    const vx = side === 'left' ? X : X + arm;   // outer / vertical edge
    const ax = side === 'left' ? X + arm : X;   // arm tip (content side)
    let d;
    switch (variant) {
        case 'editorial':   // angle ⟨ ⟩
            d = `M ${ax} ${Y} L ${vx} ${(Y + B) / 2} L ${ax} ${B}`;
            break;
        case 'scribal': {   // corner ticks ⌜ ⌝ (top + bottom, no full vertical)
            const t = H * 0.25;
            d = `M ${ax} ${Y} L ${vx} ${Y} L ${vx} ${Y + t} M ${vx} ${B - t} L ${vx} ${B} L ${ax} ${B}`;
            break;
        }
        case 'erased': {    // double square ⟦ ⟧ (outer bracket + inner vertical)
            const io = (ax - vx) * 0.35;
            d = `M ${ax} ${Y} L ${vx} ${Y} L ${vx} ${B} L ${ax} ${B} M ${vx + io} ${Y} L ${vx + io} ${B}`;
            break;
        }
        case 'superfluous': {   // curly brace { } (cusp at outer edge, mid-height)
            const my = (Y + B) / 2, sx = ax + (vx - ax) * 0.45, q = H * 0.18, e = H * 0.08;
            d = `M ${ax} ${Y} Q ${sx} ${Y} ${sx} ${Y + q} L ${sx} ${my - e} Q ${sx} ${my} ${vx} ${my}`
                + ` Q ${sx} ${my} ${sx} ${my + e} L ${sx} ${B - q} Q ${sx} ${B} ${ax} ${B}`;
            break;
        }
        case 'vanished':    // dashed square (handled by strokeDashArray below)
        default:
            d = `M ${ax} ${Y} L ${vx} ${Y} L ${vx} ${B} L ${ax} ${B}`;
    }
    return new fabric.Path(d, {
        fill: '',
        stroke: 'black',
        strokeWidth: 2,
        strokeDashArray: variant === 'vanished' ? [4, 3] : null,
        objectCaching: false,
        selectable: true,
    });
}

// Damaged-sign shading wash — a translucent grey box. Drawn over a glyph's ink
// box (Tier 4 '#b'…'#e') or as a standalone destroyed quadrat (lone '#').
function buildShadeBox(x, y, w, h) {
    return new fabric.Rect({
        left: x, top: y, width: w, height: h,
        originX: 'left', originY: 'top',
        fill: MDC_SHADE_FILL, stroke: null, selectable: true,
    });
}

// Lacuna gap box — a dashed-border tinted rectangle marking a destroyed area
// ('?' small, '??' large).
function buildLacunaBox(x, y, w, h) {
    return new fabric.Rect({
        left: x, top: y, width: w, height: h,
        originX: 'left', originY: 'top',
        fill: MDC_LACUNA_FILL, stroke: MDC_LACUNA_STROKE, strokeWidth: 1,
        strokeDashArray: [4, 3], selectable: true,
    });
}

// Register an MdC-generated auxiliary object (enclosure frame, shade wash,
// lacuna box) on the canvas with an id + undo entry — mirrors how the shape
// tools register their objects.
function addMdCAuxObject(obj) {
    obj.id = generateUniqueId();
    canvas.add(obj);
    pushUndo({ type: 'add', object: obj.toJSON(['id']), id: obj.id });
    return obj;
}

// Add an enclosure frame to the canvas. Kept as a named wrapper for the
// enclosure call site; delegates to the shared aux-object adder.
function addEnclosureFrame(obj) {
    return addMdCAuxObject(obj);
}

// Lay the row items out: cadrats bottom-aligned and wrapping at the right edge,
// separated by a gap whose width reflects the cadrat / word / sentence boundary,
// with '!' / '!!' break items forcing a new row (plus extra space for a page
// break). Placed below any existing canvas content.
function layoutMdCRow(items) {
    const margin = 50, startX = 100;
    const rightEdge = canvas.width - margin;
    const usableBottom = canvas.height - margin;

    const gapFor = strength => strength === 'sentence' ? MDC_SENTENCE_GAP
        : strength === 'word' ? MDC_WORD_GAP
            : MDC_CADRAT_GAP;   // 'cadrat' / null default

    // Measure each cadrat once, attaching its placed (capped) block size.
    for (const item of items) {
        if (item.kind !== 'cadrat') continue;
        measureMdCNode(item.node);
        const scale = Math.min(1, MDC_MAX_CADRAT / item.node.w, MDC_MAX_CADRAT / item.node.h);
        item.block = { w: item.node.w * scale, h: item.node.h * scale, scale };
    }

    // Tallest block — reserve vertical room so the first row clears any existing
    // content (and the canvas top) even for tall stacks/enclosures.
    const blockHeights = items.filter(it => it.kind === 'cadrat').map(it => it.block.h);
    const maxBlockH = blockHeights.length ? Math.max(...blockHeights) : MDC_BASE;

    let baselineY = 100 + maxBlockH;
    const existing = canvas.getObjects();
    if (existing.length > 0) {
        // True bottom edge regardless of origin: glyphs use centre origin, but
        // enclosure frames use top origin — the old centre-only math placed a
        // new paste too high and overlapped existing frames.
        const bottomOf = o => {
            const h = o.getScaledHeight();
            return o.originY === 'top' ? o.top + h
                : o.originY === 'bottom' ? o.top
                    : o.top + h / 2;
        };
        const lowestBottom = existing.reduce((m, o) => Math.max(m, bottomOf(o)), 0);
        baselineY = Math.max(baselineY, lowestBottom + MDC_LINE_VGAP + maxBlockH);
    }

    let cursorX = startX;
    let rowMaxH = 0;
    const advanceRow = extra => {
        cursorX = startX;
        baselineY += rowMaxH + MDC_LINE_VGAP + extra;  // advance by the row's tallest cadrat
        rowMaxH = 0;
    };

    for (const item of items) {
        if (item.kind === 'break') {
            advanceRow(item.level === 'page' ? MDC_PAGE_VGAP : 0);
            continue;
        }

        const b = item.block;
        let gap = cursorX === startX ? 0 : gapFor(item.gap);

        // Wrap if this cadrat (plus its leading gap) would spill past the edge.
        if (cursorX > startX && cursorX + gap + b.w > rightEdge) {
            advanceRow(0);
            gap = 0;
        }
        if (baselineY > usableBottom) {
            alert('Canvas is full. Some glyphs were not placed.');
            break;
        }

        cursorX += gap;
        placeMdCNode(item.node, cursorX, baselineY - b.h, b.scale);  // bottom edge on baseline
        cursorX += b.w;
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

// =============================================================================
// Export: canvas selection → MdC code (the inverse of the layout engine)
// =============================================================================
// MdC's spatial operators are guillotine cuts: `*` (side-by-side), `:` (stack),
// `-` (cadrat separator along the row). So we recover the code by recursively
// finding a clean axis-aligned gap that splits the signs in two, emitting the
// operator that gap implies, and recursing — the reverse of how layoutMdCRow
// packs them. Reading order is left→right then top→bottom, matching the engine's
// own output, so paste → export → paste round-trips.

// Operator precedence (tightest → loosest), mirroring parseMdCTree: * > : > -.
const MDC_OP_RANK = { '*': 3, ':': 2, '-': 1 };
const MDC_LEAF_RANK = 99;   // a bare sign never needs parentheses

function mdcCodeFor(obj) {
    // Prefer the canonical Gardiner code the importer is keyed on (charsByCode),
    // so the string re-imports cleanly; fall back to the stored key, then the
    // raw glyph (the tokenizer also accepts bare Unicode).
    const entry = charsByGlyph.get(obj.text);
    if (entry) return entry[0];
    if (obj.characterKey) return obj.characterKey;
    return obj.text;
}

// The widest separation along an axis: the neighbouring pair (ordered by start
// edge) with the largest start-minus-running-max distance. A positive value is a
// real gap; zero means the boxes touch (still a clean guillotine cut); negative
// means they overlap. Returns { gap, pos } (pos = the dividing line) or null for
// <2 boxes. Boxes are canvas-plane rects {left, top, width, height}.
function mdcWidestGap(boxes, axis) {
    const lo = axis === 'x' ? b => b.left : b => b.top;
    const hi = axis === 'x' ? b => b.left + b.width : b => b.top + b.height;
    const sorted = [...boxes].sort((a, b) => lo(a) - lo(b));
    let runMax = hi(sorted[0]);
    let best = null;
    for (let i = 1; i < sorted.length; i++) {
        const gap = lo(sorted[i]) - runMax;
        if (!best || gap > best.gap) best = { gap, pos: runMax + gap / 2 };
        runMax = Math.max(runMax, hi(sorted[i]));
    }
    return best;
}

// Recursively turn a set of sign-boxes into a layout tree:
//   { leaf: obj }                 one canvas object (a sign, or a run of signs)
//   { op: '*'|':'|'-', a, b }     a guillotine cut (side by side / stack / next cadrat)
//   { seq: [obj, …] }             overlapping signs with no clean cut, in reading order
// We split on whichever axis is the more separated (its widest gap is larger),
// so a row decomposes into cadrats before a cadrat decomposes into stacks.
// `avgW`/`avgH` only set thresholds: a horizontal gap wide enough is a cadrat
// separator (`-`) else tight juxtaposition (`*`); a vertical split is a stack.
// Shared by the MdC and Unicode exports (mdcFromTree / uniFromTree).
function mdcLayoutTree(boxes, avgW, avgH) {
    if (boxes.length === 1) return { leaf: boxes[0].obj };

    const xGap = mdcWidestGap(boxes, 'x');
    const yGap = mdcWidestGap(boxes, 'y');
    // Any clean left–right gap wins: quadrats follow each other along the
    // row, while the signs of a stack always overlap horizontally. (Comparing
    // gap sizes alone failed with ink boxes: r:a next to the sun has a bigger
    // vertical gap under r than horizontal gap before the sun.)
    const axis = (xGap.gap > 1 || xGap.gap >= yGap.gap) ? 'x' : 'y';
    const cut = axis === 'x' ? xGap : yGap;

    // Both axes overlap heavily (e.g. fused/ligatured signs): no sensible
    // guillotine, so keep them in reading order.
    if (cut.gap < -(axis === 'x' ? avgW : avgH) * 0.5) {
        const ordered = [...boxes].sort((a, b) => (a.top - b.top) || (a.left - b.left));
        return { seq: ordered.map(b => b.obj) };
    }

    const op = axis === 'x' ? (cut.gap >= avgW * 0.4 ? '-' : '*') : ':';
    const center = axis === 'x'
        ? b => b.left + b.width / 2
        : b => b.top + b.height / 2;
    const first = boxes.filter(b => center(b) < cut.pos);
    const second = boxes.filter(b => center(b) >= cut.pos);
    return { op, a: mdcLayoutTree(first, avgW, avgH), b: mdcLayoutTree(second, avgW, avgH) };
}

// Layout tree → { str, rank } in MdC.
function mdcFromTree(t) {
    if (t.leaf) return { str: mdcCodeFor(t.leaf), rank: MDC_LEAF_RANK };
    if (t.seq) return { str: t.seq.map(mdcCodeFor).join('-'), rank: MDC_OP_RANK['-'] };
    const rank = MDC_OP_RANK[t.op];
    const a = mdcFromTree(t.a), c = mdcFromTree(t.b);
    // Parenthesize an operand only when it binds looser than the joining
    // operator (e.g. a stack inside a juxtaposition: A*(B:C)).
    const wrap = part => part.rank < rank ? `(${part.str})` : part.str;
    return { str: wrap(a) + t.op + wrap(c), rank };
}

function mdcFromBoxes(boxes, avgW, avgH) {
    return mdcFromTree(mdcLayoutTree(boxes, avgW, avgH));
}

// Group boxes top-to-bottom into rows, breaking only on a clean vertical gap
// wider than a sign (genuine line spacing). A stack's internal gap is smaller,
// so aligned cadrats stay in one row instead of being mistaken for two lines.
//
// With INK boxes (signInkBox) gaps are real, so a stack's gap (up to ~0.4 of
// the sign size) can be as large as the gap between two lines of flat signs.
// Pass `signSize` (the typical font size on the canvas) for the ink rule: a
// break needs a gap of 0.5·size, or of 0.3·size under a row wider than any
// single cadrat can be (2.3·size). Measured on the layout engine's output:
// stack gaps 5–25 px, line gaps 23 (flat signs) to 35 px, at size 60. Two
// one-sign "lines" closer than that read as a stack, which looks the same. Without `signSize`, the
// original line-box rule (gap ≥ 0.9·avgH) applies — word-finder.js uses that.
function mdcSplitRows(boxes, avgH, signSize) {
    const sorted = [...boxes].sort((a, b) => a.top - b.top);
    const rows = [];
    let cur = [];
    let runMax = -Infinity, rowL = Infinity, rowR = -Infinity;
    const isBreak = (gap) => {
        if (!signSize) return gap >= avgH * 0.9;
        if (gap < signSize * 0.3) return false;
        return gap >= signSize * 0.5 || (rowR - rowL) > signSize * 2.3;
    };
    for (const b of sorted) {
        if (cur.length && isBreak(b.top - runMax)) {
            rows.push(cur); cur = []; runMax = -Infinity; rowL = Infinity; rowR = -Infinity;
        }
        cur.push(b);
        runMax = Math.max(runMax, b.top + b.height);
        rowL = Math.min(rowL, b.left); rowR = Math.max(rowR, b.left + b.width);
    }
    if (cur.length) rows.push(cur);
    return rows;
}

// The typical sign size on screen-independent canvas units: the median of
// fontSize × scale over the signs (robust against one huge or tiny sign).
function mdcSignSize(boxes) {
    const sizes = boxes.map(b => (b.obj.fontSize || MDC_BASE) * Math.abs(b.obj.scaleY || 1)
        * (b.obj.group ? Math.abs(b.obj.group.scaleY || 1) : 1)).sort((x, y) => x - y);
    return sizes[Math.floor(sizes.length / 2)] || MDC_BASE;
}

// Sign boxes for layout detection. Each box is the sign's INK in canvas-plane
// coords (objInkExtent for top/bottom, measureText for left/right), not
// fabric's line box: a flat sign such as N35 sits in a tall box of empty
// space, and those boxes overlapped when stacked, so stacks were read as rows.
let _signInkCtx = null;
function signInkBox(o) {
    o.setCoords();
    const r = o.getBoundingRect(true, true);    // canvas-plane, zoom-independent
    let box = { obj: o, left: r.left, top: r.top, width: r.width, height: r.height };
    if (o.angle) return box;                    // rotated sign: keep its bounding box
    if (typeof objInkExtent === 'function') {
        const e = objInkExtent(o);
        box.top = e.top; box.height = Math.max(1, e.bottom - e.top);
    }
    const text = o.text || '';
    if (text && text.indexOf('\n') === -1) {
        if (!_signInkCtx) _signInkCtx = document.createElement('canvas').getContext('2d');
        _signInkCtx.font = `100px ${o.fontFamily || 'sans-serif'}`;
        const m = _signInkCtx.measureText(text);
        if (typeof m.actualBoundingBoxLeft === 'number' && m.width > 0) {
            let l = -m.actualBoundingBoxLeft / m.width, rt = m.actualBoundingBoxRight / m.width;
            if (o.flipX) [l, rt] = [1 - rt, 1 - l];
            l = Math.max(0, Math.min(1, l)); rt = Math.max(l, Math.min(1, rt));
            box.left = r.left + l * r.width;
            box.width = Math.max(1, (rt - l) * r.width);
        }
    }
    return box;
}

// Pure: build the MdC string for a list of sign objects (no clipboard, no toast).
// Returns '' when the list has no glyph signs. Shared by exportSelectionToMdC and
// the Inspect modal so the two never drift.
function mdcStringForObjs(objs) {
    const signs = (objs || []).filter(o => o.type === 'text' && !o._pageGuide);
    if (signs.length === 0) return '';
    const boxes = signs.map(signInkBox);
    const avgW = boxes.reduce((s, b) => s + b.width, 0) / boxes.length;
    const avgH = boxes.reduce((s, b) => s + b.height, 0) / boxes.length;

    // Rows first (line breaks), then guillotine each row into cadrats.
    return mdcSplitRows(boxes, avgH, mdcSignSize(boxes))
        .map(row => mdcFromBoxes(row, avgW, avgH).str)
        .join(' ! ');
}

// =============================================================================
// Unicode with layout: the Egyptian Hieroglyph Format Controls (U+13430…)
// =============================================================================
// The same layout tree, written as Unicode text that keeps the arrangement:
//   ':' stack        → U+13430 VERTICAL JOINER
//   '*' side by side → U+13431 HORIZONTAL JOINER
//   '( )' grouping   → U+13437 BEGIN SEGMENT / U+13438 END SEGMENT
//   '-' next cadrat  → nothing (quadrats simply follow each other)
//   line break       → newline;  mirrored sign → sign + U+13440 MIRROR HORIZONTALLY
// Precedence matches MdC: the horizontal joiner binds tighter than the vertical
// one, so a stack inside a side-by-side group is bracketed: A 𓐱 𓐷 B 𓐰 C 𓐸.
// Renders as quadrats only with a font that implements the controls (e.g. the
// free "Egyptian Text"); other fonts show the signs in a row.
const UNI_VJ = '\u{13430}', UNI_HJ = '\u{13431}';
const UNI_BEGIN = '\u{13437}', UNI_END = '\u{13438}', UNI_MIRROR = '\u{13440}';
const UNI_SIGN_RE = /[\u{13000}-\u{1342F}\u{13460}-\u{143FF}]/gu;   // for match()
const UNI_HAS_SIGN = /[\u{13000}-\u{1342F}\u{13460}-\u{143FF}]/u;   // for test(): no lastIndex state

function uniSignsOf(obj) {
    let signs = (obj.text || '').match(UNI_SIGN_RE) || [];
    // A mirrored run reads in the other direction, each sign mirrored.
    if (obj.flipX) signs = signs.reverse().map(g => g + UNI_MIRROR);
    return signs;
}

// Layout tree → { str, rank }. `nested`: inside a joiner, where a run of
// several quadrats is not allowed, so a run becomes a horizontal group.
function uniFromTree(t, nested) {
    const run = (signs) => {
        if (signs.length === 1) return { str: signs[0], rank: MDC_LEAF_RANK };
        return nested ? { str: signs.join(UNI_HJ), rank: MDC_OP_RANK['*'] }
                      : { str: signs.join(''), rank: MDC_OP_RANK['-'] };
    };
    if (t.leaf) return run(uniSignsOf(t.leaf));
    if (t.seq) return run(t.seq.flatMap(uniSignsOf));
    // Inside a joiner a cadrat break can't exist, so it becomes side by side.
    // At the top of a line, side by side is written as separate quadrats:
    // it looks the same, and a whole line joined into ONE quadrat would be
    // squeezed by the font (the editor's '*' and '-' spacing is 6 vs 10 px,
    // too close to tell apart reliably).
    const op = nested ? (t.op === '-' ? '*' : t.op) : (t.op === '*' ? '-' : t.op);
    if (op === '-') {
        return { str: uniFromTree(t.a, false).str + uniFromTree(t.b, false).str, rank: MDC_OP_RANK['-'] };
    }
    const rank = MDC_OP_RANK[op];
    const a = uniFromTree(t.a, true), c = uniFromTree(t.b, true);
    const wrap = part => part.rank < rank ? UNI_BEGIN + part.str + UNI_END : part.str;
    return { str: wrap(a) + (op === ':' ? UNI_VJ : UNI_HJ) + wrap(c), rank };
}

// Pure: the Unicode-with-layout text for a list of objects ('' if no signs).
// Only objects holding hieroglyphs count (transliteration lines are skipped).
function unicodeStringForObjs(objs) {
    const signs = (objs || []).filter(o => o && (o.type === 'text' || o.type === 'i-text')
        && !o._pageGuide && UNI_HAS_SIGN.test(o.text || ''));
    if (signs.length === 0) return '';
    const boxes = signs.map(signInkBox);
    const avgW = boxes.reduce((s, b) => s + b.width, 0) / boxes.length;
    const avgH = boxes.reduce((s, b) => s + b.height, 0) / boxes.length;
    return mdcSplitRows(boxes, avgH, mdcSignSize(boxes))
        .map(row => uniFromTree(mdcLayoutTree(row, avgW, avgH), false).str)
        .filter(Boolean)
        .join('\n');
}

// Copy the selection (or, with nothing selected, the whole canvas) as Unicode
// text with layout. Puts plain text plus an HTML version naming the Egyptian
// Text font, so word processors that have it installed show the quadrats.
// Bound to the `u` shortcut and the canvas right-click menu.
function copySelectionAsUnicode(objs) {
    let src = objs && objs.length ? objs : canvas.getActiveObjects();
    if (!src.length) src = canvas.getObjects();
    const text = unicodeStringForObjs(src);
    if (!text) {
        showCanvasToast('No hieroglyphs to copy');
        return Promise.resolve('');
    }
    const esc = t => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const html = `<span style="font-family:'Egyptian Text','Noto Sans Egyptian Hieroglyphs'">` +
        esc(text).replace(/\n/g, '<br>') + '</span>';
    const done = () => showCanvasToast('Unicode copied, with layout (needs a font such as Egyptian Text to show stacked)');
    const plainOnly = () => navigator.clipboard.writeText(text).then(done);
    let p;
    if (navigator.clipboard && window.ClipboardItem && navigator.clipboard.write) {
        p = navigator.clipboard.write([new ClipboardItem({
            'text/plain': new Blob([text], { type: 'text/plain' }),
            'text/html': new Blob([html], { type: 'text/html' })
        })]).then(done).catch(plainOnly);
    } else if (navigator.clipboard && navigator.clipboard.writeText) {
        p = plainOnly();
    } else {
        p = Promise.reject(new Error('no clipboard'));
    }
    return p.catch(() => { window.prompt('Unicode with layout (copy):', text); }).then(() => text);
}

// Unicode with layout controls → MdC, so text copied from elsewhere (or from
// this editor) can be pasted back and laid out. Joiners and segments map 1:1;
// the insertion and overlay controls have no MdC operator in this editor and
// become side by side; enclosure, mirror, blank and damage marks are dropped.
// Text without format controls is returned unchanged.
function unicodeLayoutToMdC(str) {
    if (!/[\u{13430}-\u{1345F}]/u.test(str || '')) return str;
    let out = '', prev = null;       // prev: 'sign' | 'close' | 'op' | 'open' | null
    for (const ch of str) {
        const cp = ch.codePointAt(0);
        const isSign = (cp >= 0x13000 && cp <= 0x1342F) || (cp >= 0x13460 && cp <= 0x143FF);
        if (isSign || cp === 0x13437) {
            if (prev === 'sign' || prev === 'close') out += '-';   // a new quadrat starts
            out += isSign ? ch : '(';
            prev = isSign ? 'sign' : 'open';
        } else if (cp === 0x13438) { out += ')'; prev = 'close'; }
        else if (cp === 0x13430) { out += ':'; prev = 'op'; }
        else if (cp === 0x13431 || (cp >= 0x13432 && cp <= 0x13436) || (cp >= 0x13439 && cp <= 0x1343B)) {
            out += '*'; prev = 'op';
        } else if (cp >= 0x1343C && cp <= 0x1345F) {
            // enclosures, mirror, blanks, damage: not representable here
        } else if (ch === '\n' || ch === '\r') {
            if (prev !== null) out += ' ! ';
            prev = null;
        } else {
            out += ch;
            if (/\s/.test(ch)) prev = null;
        }
    }
    return out;
}

function exportSelectionToMdC() {
    const mdc = mdcStringForObjs(canvas.getActiveObjects());
    if (!mdc) {
        showCanvasToast('Select some signs to copy as MdC');
        return;
    }

    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(mdc)
            .then(() => showCanvasToast('MdC copied: ' + mdc))
            .catch(() => window.prompt('MdC for selection (copy):', mdc));
    } else {
        window.prompt('MdC for selection (copy):', mdc);
    }
}
