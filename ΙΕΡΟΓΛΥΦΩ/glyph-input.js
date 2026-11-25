/*!
 * ΙΕΡΟΓΛΥΦΩ editor — glyph-input
 *
 * Classic <script defer>; shares globals with the other editor scripts via the
 * global lexical environment. Do NOT convert to type="module" (inline onclick=
 * handlers need these functions global). Load order is fixed in index.html
 * (see STRUCTURE.md).
 *
 * @copyright Copyright (c) 2024–2026 Massimo Mazzon. All rights reserved.
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
// text node in SVG and as real text in both PDF exports.

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
    const rtlBox = document.getElementById('glyphRtl');
    if (rtlBox) { try { rtlBox.checked = localStorage.getItem('glyphRtl') === '1'; } catch (_) { } }
    // Bind once per open via onchange (replaces, so no listener buildup).
    document.querySelectorAll('input[name="glyphMode"]').forEach(r => {
        r.onchange = syncThreeLineExtras;
    });
    syncThreeLineExtras();
    setupTranslitPalette();
    // The size starts at the palette's "Size of dropped signs" (one setting
    // for every way of adding signs); it can still be changed for this text.
    const sizeField = document.getElementById('glyphTextFontSize');
    if (sizeField && typeof paletteDropSize === 'function') sizeField.value = paletteDropSize();
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
    // Right to left is a layout of individual signs (a text run stays as typed).
    const rtl = !!document.getElementById('glyphRtl')?.checked;
    try { localStorage.setItem('glyphRtl', rtl ? '1' : '0'); } catch (_) { }
    if (mode === 'individual' || hasSpatialMdC || rtl) {
        // Ensure the hieroglyph font is ready before layout: the engine measures
        // glyph ink boxes with the Canvas API, which silently uses a fallback
        // font (wrong metrics) if this hasn't loaded yet.
        try { await document.fonts.load(`${MDC_BASE}px ${MDC_FONT}`); } catch (_) { /* best-effort */ }
        handleMdCInput(raw, { rtl, size: fontSize });
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
//   - collectDeletion sweeps siblings before removing the target
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
    recordBatch(rows.map(r => ({ type: 'add', id: r.id, object: r.toObject(UNDO_PROPS) })));
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
    const saveAsPdfTextBtn = document.getElementById('saveAsPdfTextBtn');
    if (saveAsPdfTextBtn) saveAsPdfTextBtn.addEventListener('click', (e) => { e.stopPropagation(); saveToPDFText(); close(); });
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
const MDC_CADRAT_GAP = 10;      // '-' separator: cadrats within a word (also between the cadrats inside a cartouche or [ ])
const MDC_WORD_GAP = 28;        // single space / '_' : word boundary
const MDC_SENTENCE_GAP = 50;    // double space / '__' : sentence boundary
// Vertical gap between rows (normal wrap / '!'). Wider than any gap inside a
// stack (up to 26 at size 60, e.g. A1:B1), so a copy can always tell a new
// row from the lower half of a stack (mdcSplitRows breaks at 0.5·size = 30).
const MDC_LINE_VGAP = 34;
// A row is at least as tall as a standing sign (A1's ink is 42 at size 60), so a
// row of only flat signs (N35, D21, X1…) keeps the normal line spacing. Packed
// to its own height it sat so close under the row above that it looked, and
// copied, like the bottom half of a stack.
const MDC_ROW_MIN_H = MDC_BASE * 0.7;
const MDC_PAGE_VGAP = 70;       // extra vertical gap added for a '!!' page break
const MDC_ENC_PAD = 14;         // inner padding: sides + gap below content (to panel/base)
const MDC_ENC_PAD_TOP = 30;     // inner padding above content (generous: figure stands, sky above)
const MDC_SEREKH_PANEL = 14;    // height of the serekh's (simplified) paneled facade strip
const MDC_CART_TIE = 10;        // room for the tie bar at the end of a cartouche

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

// The whole string is one undo step. opts.unbounded: keep laying out rows
// below the visible canvas (a long imported text) instead of stopping there.
// opts.rtl: right to left (rows start at the right, signs face right).
function handleMdCInput(mdcString, opts = {}) {
    return groupUndo(() => handleMdCInputNow(mdcString, opts));
}

function handleMdCInputNow(mdcString, opts = {}) {
    mdcString = unicodeLayoutToMdC(mdcString);   // Unicode format controls → MdC operators
    let tree = null;
    try {
        tree = parseMdCTree(tokenizeMdC(mdcString));
    } catch (_) {
        tree = null;  // fall through to the flat layout below
    }

    if (!tree || !tree.children.some(c => c.kind === 'cadrat')) {
        // No glyphs to place (or a parse error) — keep the original behaviour.
        return handleMdCInputFlat(mdcString, opts);
    }

    layoutMdCRow(tree.children, opts);
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
// JSesh codes (jsesh-codes.js), exact and ignoring case. Built once.
let _jseshSigns = null, _jseshNoCase = null;

function jseshSignMap() {
    if (!_jseshSigns) {
        _jseshSigns = new Map();
        _jseshNoCase = new Map();
        if (typeof JSESH_SIGNS_RAW === 'string') {
            for (const pair of JSESH_SIGNS_RAW.split(',')) {
                const i = pair.lastIndexOf(':');
                const ch = String.fromCodePoint(parseInt(pair.slice(i + 1), 16));
                const code = pair.slice(0, i);
                _jseshSigns.set(code, ch);
                if (!_jseshNoCase.has(code.toUpperCase())) _jseshNoCase.set(code.toUpperCase(), ch);
            }
        }
    }
    return _jseshSigns;
}

// The palette entry for a sign character. A sign the palette doesn't list
// (about 220 base-block signs; the font still draws them) gets an entry made
// on the spot, named by its JSesh code when there is one.
let _jseshNameOf = null;
function signEntryForChar(ch, name) {
    const e = charsByGlyph.get(ch);
    if (e) return e;
    const cp = ch.codePointAt(0);
    if (!(cp >= 0x13000 && cp <= 0x1342F) && !(cp >= 0x13460 && cp <= 0x143FF)) return undefined;
    if (!name) name = jseshNameOf(ch) || numeralSignName(cp) || 'U+' + cp.toString(16).toUpperCase();
    return [name, ch];
}

// The (first) JSesh code of a sign character, or undefined.
function jseshNameOf(ch) {
    if (!_jseshNameOf) {
        _jseshNameOf = new Map();
        for (const [code, c] of jseshSignMap()) if (!_jseshNameOf.has(c)) _jseshNameOf.set(c, code);
    }
    return _jseshNameOf.get(ch);
}

// Gardiner name of a Unicode numeral sign (Z15–Z15H, V20–V20H, V1–V1H,
// M12–M12H: one to nine units, tens, hundreds, thousands), or ''.
function numeralSignName(cp) {
    for (const [base, name] of [[0x133FA, 'Z15'], [0x13386, 'V20'], [0x13362, 'V1'], [0x131BC, 'M12']]) {
        const k = cp - base;
        if (k >= 0 && k <= 8) return name + (k ? 'ABCDEFGH'[k - 1] : '');
    }
    return '';
}

// Resolve one typed code to its sign entry, or undefined. Order: an MdC sound
// letter (case-sensitive), the exact code, a JSesh code (M1A, V23A: also the
// Extended-A signs), a multi-letter MdC sound code (ra, nTr, anx), then the
// codes ignoring case. The old lookup upper-cased everything, so `a` gave the
// vulture and the 66 codes with a small letter (Aa1…, A5a, G7a…) could not be
// typed at all.
function mdcLookupCode(word) {
    if (word.length === 1 && MDC_PHONETIC[word]) {
        const e = charsByCode.get(MDC_PHONETIC[word]);
        if (e) return e;
    }
    const exact = charsByCode.get(word);
    if (exact) return exact;
    const js = jseshSignMap().get(word);
    if (js) return signEntryForChar(js, word);
    if (typeof MDC_PHONETIC_CODES === 'object' && word.length > 1 && MDC_PHONETIC_CODES[word]) {
        const target = MDC_PHONETIC_CODES[word];
        return charsByCode.get(target) || (jseshSignMap().get(target) && signEntryForChar(jseshSignMap().get(target), target));
    }
    if (!_mdcCodesNoCase) {
        _mdcCodesNoCase = new Map();
        for (const [k, e] of charsByCode) _mdcCodesNoCase.set(k.toUpperCase(), e);
    }
    const nc = _mdcCodesNoCase.get(word.toUpperCase());
    if (nc) return nc;
    const jnc = _jseshNoCase.get(word.toUpperCase());
    return jnc ? signEntryForChar(jnc) : undefined;
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
        // Sign modifiers (MdC / JSesh): a trailing '\\' mirrors the sign,
        // '\\R90' turns it (degrees, clockwise), '\\70' sets its size (70 %).
        // Other modifiers are ignored.
        let mirror = false, rot = 0, size = 1;
        const m = word.match(/^(.*?)((?:\\[A-Za-z]*-?\d*)+)$/);
        if (m && m[1]) {
            word = m[1];
            for (const [, name, val] of m[2].matchAll(/\\([A-Za-z]*)(-?\d*)/g)) {
                if (!name && !val) mirror = !mirror;
                else if (!name && val) { const pc = parseInt(val, 10); if (pc >= 10 && pc <= 400) size = pc / 100; }
                else if (name === 'R' && val) rot = ((parseInt(val, 10) % 360) + 360) % 360;
            }
        }
        const glyph = entry => ({ type: 'glyph', entry, color: curColor, shade: curShade, mirror, rot, size });
        const code = mdcLookupCode(word);
        if (code) {
            tokens.push(glyph(code));
        } else {
            const leaves = [];
            for (const ch of word) {
                const g = signEntryForChar(ch);
                if (g) leaves.push(g);
            }
            leaves.forEach((g, i) => {
                if (i > 0) tokens.push({ type: 'op', op: '-' });
                tokens.push(glyph(g));
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
            // Enclosures: '<S' serekh, '<H' hwt, '<F' fortified wall, closed by
            // '>S' / '>H' / '>F'; a bare '<' … '>' (or '<C' … '>C') is a cartouche.
            flushWord();
            const nx = chars[i + 1];
            const v = nx && 'SHFCshfc'.includes(nx) ? nx.toUpperCase() : null;
            tokens.push({ type: 'op', op: ch === '<' ? 'encOpen' : 'encClose', variant: v || 'C' });
            i += v ? 2 : 1;
        } else if (ch === '.') {
            // Blank space: '.' half a quadrat, '..' a whole one.
            flushWord();
            if (chars[i + 1] === '.') { tokens.push({ type: 'space', size: 'full' }); i += 2; }
            else { tokens.push({ type: 'space', size: 'half' }); i++; }
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
        if (t && t.type === 'space') { eat(); return { type: 'space', size: t.size }; }
        if (t && t.type === 'glyph') {
            eat();
            return { type: 'glyph', entry: t.entry, color: t.color, shade: t.shade, mirror: t.mirror, rot: t.rot, size: t.size };
        }
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
        const turned = node.rot === 90 || node.rot === 270;
        const sz = node.size || 1;
        node.w = (turned ? ink.h : ink.w) * sz;
        node.h = (turned ? ink.w : ink.h) * sz;
        node.ink = ink;
        return node;
    }
    if (node.type === 'space') {
        node.w = node.h = node.size === 'full' ? MDC_BASE : MDC_BASE / 2;
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
        node.innerW = node.children.reduce((s, c) => s + c.w, 0) + MDC_CADRAT_GAP * Math.max(0, n - 1);
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
        node.innerW = node.children.reduce((s, c) => s + c.w, 0) + MDC_CADRAT_GAP * Math.max(0, n - 1);
        node.innerH = n ? Math.max(...node.children.map(c => c.h)) : MDC_BASE;
        node.padTop = node.variant === 'C' ? MDC_ENC_PAD : MDC_ENC_PAD_TOP;
        node.w = node.innerW + 2 * MDC_ENC_PAD + (node.variant === 'C' ? MDC_CART_TIE : 0);
        node.h = node.padTop + node.innerH + MDC_ENC_PAD + (node.variant === 'S' ? MDC_SEREKH_PANEL : 0);
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

    if (node.type === 'space') return;   // blank: takes room, draws nothing

    if (node.type === 'glyph') {
        const ink = node.ink;
        const sc = scale * (node.size || 1);   // a sized sign (\70) draws smaller
        const obj = addCharacterToCanvas(node.entry[1], node.entry[0], 0, 0);
        const Wf = obj.width || ink.w;     // fabric line-box width/height (unscaled)
        const Hf = obj.height || ink.h;
        // (x, y) is the ink box's top-left. Position the fabric object (centre
        // origin) so the glyph's ink lands exactly there.
        const fabricLeftEdge = x + sc * ink.left;
        const baselineY = y + sc * ink.ascent;
        obj.set({
            scaleX: sc,
            scaleY: sc,
            left: fabricLeftEdge + sc * Wf / 2,
            top: baselineY - sc * mdcBaselineFromTop(Hf) + sc * Hf / 2,
        });
        if (node.color) obj.set({ fill: node.color });
        // Mirrored: the ink sits at the other end of the line box, so the
        // centre moves for the ink to still start at x.
        if (node.mirror) obj.set({ flipX: true, left: x + sc * (ink.w - ink.left - Wf / 2) });
        if (node.rot) {
            // A turned sign: centre it in its (turned) box.
            obj.set({ angle: node.rot, left: x + boxW / 2, top: y + boxH / 2 });
        }
        obj.setCoords();
        // Damaged-sign shading: a translucent wash over the glyph's ink box
        // (added after the glyph so it reads as overlaid damage).
        if (node.shade) addMdCAuxObject(buildShadeBox(x, y, boxW, boxH));
        return;
    }

    if (node.type === 'enclosure') {
        // Frame first so the glyphs (added afterwards) render on top of it.
        const startIdx = canvas.getObjects().length;
        const frame = buildEnclosureFrame(node.variant, x, y, boxW, boxH);
        frame.mdcEnclosure = node.variant;   // read back by the exports (enclosureVariantOf)
        addEnclosureFrame(frame);
        const contentTop = y + node.padTop * scale;
        const contentH = node.innerH * scale;
        let cx = x + MDC_ENC_PAD * scale;
        for (const c of node.children) {
            const ch = c.h * scale;
            placeMdCNode(c, cx, contentTop + (contentH - ch), scale);  // bottom-align in content
            cx += c.w * scale + MDC_CADRAT_GAP * scale;
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
            cx += c.w * scale + MDC_CADRAT_GAP * scale;
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

    if (variant === 'C') {
        // Cartouche: a rounded loop, with the tie bar across its end.
        const loopW = w - MDC_CART_TIE;
        const r = Math.min(h / 2, 24);
        const loop = new fabric.Rect({ left: -w / 2 + loopW / 2, top: 0, width: loopW, height: h, rx: r, ry: r,
            fill: 'transparent', stroke, strokeWidth: sw, ...half });
        const tie = new fabric.Line([w / 2 - 3, -h / 2 + 2, w / 2 - 3, h / 2 - 2], { stroke, strokeWidth: 4, ...half });
        return new fabric.Group([loop, tie], { left: cx, top: cy, originX: 'center', originY: 'center', selectable: true });
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
        mdcBracket: variant,        // read back by the exports
        mdcBracketSide: side,       // 'left' opens (also after a right-to-left mirror)
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
    pushUndo({ type: 'add', object: obj.toJSON(UNDO_PROPS), id: obj.id });
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
// opts.size: the sign size wanted (palette "Size of dropped signs", or the
// 𓂀… dialog's size). The block is laid out at MDC_BASE as always, then scaled
// as one picture by size / MDC_BASE around its top-left corner, so every gap,
// frame and bracket keeps its proportion. Rows wrap at the width the scaled
// block will have. Without it (JSesh import), the base size.
function layoutMdCRow(items, opts = {}) {
    const margin = 50, startX = 100;
    const rightEdge = canvas.width - margin;
    const usableBottom = canvas.height - margin;
    const k = opts.size > 0 ? opts.size / MDC_BASE : 1;
    const wrapEdge = startX + (rightEdge - startX) / k;   // right edge in layout units

    const gapFor = strength => strength === 'sentence' ? MDC_SENTENCE_GAP
        : strength === 'word' ? MDC_WORD_GAP
            : MDC_CADRAT_GAP;   // 'cadrat' / null default

    // Measure each cadrat once, attaching its placed (capped) block size. An
    // enclosure or bracketed span is capped in height only: a cartouche of
    // eight signs is wide, and capping its width shrank its signs to nothing.
    for (const item of items) {
        if (item.kind !== 'cadrat') continue;
        measureMdCNode(item.node);
        const long = item.node.type === 'enclosure' || item.node.type === 'brackets';
        const scale = Math.min(1, MDC_MAX_CADRAT / item.node.h, long ? 1 : MDC_MAX_CADRAT / item.node.w);
        item.block = { w: item.node.w * scale, h: item.node.h * scale, scale };
    }

    // Split into rows first (wrapping at the right edge, '!' / '!!' breaks), so
    // each row can sit below the previous one by ITS OWN height: placing rows
    // by the previous row's height let a tall row overlap the one above.
    const rows = [];
    let row = { cells: [], h: 0, extra: 0 };
    let cursorX = startX;
    const newRow = extra => {
        rows.push(row);
        row = { cells: [], h: 0, extra };
        cursorX = startX;
    };
    for (const item of items) {
        if (item.kind === 'break') {
            newRow(item.level === 'page' ? MDC_PAGE_VGAP : 0);
            continue;
        }
        const b = item.block;
        let gap = cursorX === startX ? 0 : gapFor(item.gap);
        if (cursorX > startX && cursorX + gap + b.w > wrapEdge) {
            newRow(0);
            gap = 0;
        }
        cursorX += gap;
        row.cells.push({ item, x: cursorX });
        row.h = Math.max(row.h, b.h);
        cursorX += b.w;
    }
    rows.push(row);

    // Start below any existing canvas content (true bottom edge regardless of
    // origin: glyphs use centre origin, enclosure frames top origin).
    let top = 100;
    const existing = canvas.getObjects().filter(o => !o._pageGuide);
    if (existing.length > 0) {
        const bottomOf = o => {
            const h = o.getScaledHeight();
            return o.originY === 'top' ? o.top + h
                : o.originY === 'bottom' ? o.top
                    : o.top + h / 2;
        };
        top = Math.max(top, existing.reduce((m, o) => Math.max(m, bottomOf(o)), 0) + MDC_LINE_VGAP);
    }
    const blockTop = top;   // the corner the block is scaled around

    const firstNew = canvas.getObjects().length;   // canvas.add appends: the new objects are the tail
    let first = true;
    for (const r of rows) {
        if (!r.cells.length) {                       // an empty row: just the break's space
            if (!first) top += r.extra;
            continue;
        }
        const baselineY = top + (first ? 0 : r.extra) + Math.max(r.h, MDC_ROW_MIN_H);
        if (!opts.unbounded && blockTop + (baselineY - blockTop) * k > usableBottom) {
            alert('Canvas is full. Some glyphs were not placed.');
            break;
        }
        for (const { item, x } of r.cells) {
            placeMdCNode(item.node, x, baselineY - item.block.h, item.block.scale);   // bottom edge on baseline
        }
        top = baselineY + MDC_LINE_VGAP;
        first = false;
    }

    if (k !== 1) scaleLaidOutBlock(canvas.getObjects().slice(firstNew), startX, blockTop, k);
    if (opts.rtl) mirrorLaidOutBlock(canvas.getObjects().slice(firstNew), startX, rightEdge);
    canvas.requestRenderAll();
}

// Scale freshly laid-out objects as one picture by k around (x0, y0). Each
// object's origin point moves with the picture and the object scales about
// that point, whatever its origin (signs: centre; frames: top-left).
function scaleLaidOutBlock(objs, x0, y0, k) {
    for (const o of objs) {
        o.set({
            left: x0 + (o.left - x0) * k,
            top: y0 + (o.top - y0) * k,
            scaleX: (o.scaleX || 1) * k,
            scaleY: (o.scaleY || 1) * k,
        });
        o.setCoords();
    }
}

// Right to left: lay out as usual, then mirror the new objects as one picture
// across the writing area [left, right]. Each row then starts at the right
// edge, and every sign, cartouche tie and bracket faces the other way.
// Positions go by the INK centre, since a sign's ink is not centred in its
// line box. A turned sign mirrors as turned the other way. (Undo is fine: the
// caller's groupUndo re-reads the added objects afterwards.)
function mirrorLaidOutBlock(objs, left, right) {
    const midX = o => {
        const b = o.type === 'text' ? signInkBox(o) : o.getBoundingRect(true, true);
        return b.left + b.width / 2;
    };
    for (const o of objs) {
        const target = left + right - midX(o);
        o.set('flipX', !o.flipX);
        if (o.angle) o.set('angle', (360 - o.angle) % 360);
        o.setCoords();
        o.set('left', o.left + target - midX(o));
        o.setCoords();
    }
}

// Most signs face right (mirrored) → the text reads right to left. Counted by
// sign, so a mirrored text run of many signs weighs as many.
function signsReadRtl(objs) {
    let rtl = 0, ltr = 0;
    for (const o of objs) {
        const n = ((o && o.text || '').match(UNI_SIGN_RE) || []).length;   // frames, shapes: 0
        if (o.flipX) rtl += n; else ltr += n;
    }
    return rtl > ltr;
}

// Original flat layout — one fabric.Text per sign in a single bottom-aligned,
// wrapping row. Retained as the fallback when there is no spatial structure to
// honour (or a parse error). Treats every operator as a plain separator.
function handleMdCInputFlat(mdcString, opts = {}) {
    const matches = parseMdCInput(mdcString);
    if (matches.length === 0) {
        alert('No glyphs recognized. Paste Gardiner codes (e.g. A1-D21-N35) or hieroglyph characters.');
        return;
    }

    // Glyphs render at fontSize 60 with center origin. Real glyph widths
    // and heights vary, so step by measured width and bottom-align so the
    // baseline (bottom edge) is shared across the row.
    const nominalGlyph = opts.size > 0 ? opts.size : 60;
    const hGap = 12 * nominalGlyph / 60;
    const vGap = 18 * nominalGlyph / 60;
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
        const obj = addCharacterToCanvas(match[1], match[0], xOffset, baselineY, nominalGlyph);
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
    if (obj._exp === 'enc') {
        const c = obj.ctx;
        const inner = mdcFromBoxes(obj.members, c.avgW, c.avgH, c.rtl, c.size).str;
        return `${MDC_ENC_OPEN[obj.variant]}-${inner}-${MDC_ENC_CLOSE[obj.variant]}`;
    }
    if (obj._exp === 'brk') return MDC_BRK_TOKENS[obj.variant][obj.open ? 0 : 1];
    // The first code that reads back as this same sign: the palette's Gardiner
    // code, the stored key, then the JSesh code. A code must be letters and
    // digits only: the Extended-A catalogue codes (A-08-008) contain '-', which
    // MdC reads as a cadrat break. Failing all of them, the raw glyph (the
    // tokenizer also accepts bare Unicode).
    const ch = obj.text;
    const entry = charsByGlyph.get(ch);
    const cands = [entry && entry[0], obj.characterKey, jseshNameOf(ch)];
    for (const code of cands) {
        if (!code || !/^[A-Za-z0-9]+$/.test(code)) continue;
        const e = mdcLookupCode(code);
        if (e && e[1] === ch) return code;
    }
    return ch;
}

// ---- Enclosures and editorial brackets in the exports ----
// A cartouche (or serekh, ḥwt, fortified wall) frame stands in for the signs
// inside it: the layout sees one box, and the leaf writes the frame's markup
// around the contents ('<-…->' in MdC; the enclosure controls in Unicode).
// Each bracket mark is a box of its own, written as its opening or closing
// token. Before this, the exports dropped frames and marks, so a copied royal
// name came back without its cartouche.
const MDC_ENC_OPEN = { C: '<', S: '<S', H: '<H', F: '<F' };
const MDC_ENC_CLOSE = { C: '>', S: '>S', H: '>H', F: '>F' };
const MDC_BRK_TOKENS = {
    erased: ['[[', ']]'], superfluous: ['[{', '}]'], vanished: ['["', '"]'],
    scribal: ["['", "']"], editorial: ['[&', '&]'],
};
// Unicode: opening sign + BEGIN control … END control + closing sign. The
// walled controls go with the fortified wall (O36C/O36D); the serekh has no
// closing sign (Unicode allows an enclosure end to be missing).
const UNI_ENC = {
    C: ['\u{13379}\u{1343C}', '\u{1343D}\u{1337A}'],   // V11A … V11B
    H: ['\u{13258}\u{1343C}', '\u{1343D}\u{1325B}'],   // O6A … O6D
    F: ['\u{13288}\u{1343E}', '\u{1343F}\u{13289}'],   // O36C … O36D
    S: ['\u{13282}\u{1343C}', '\u{1343D}'],             // O33A …
};
// Unicode's text-critical marks (Unicode §11.4.4).
const UNI_BRK = {
    erased: ['\u27E6', '\u27E7'], superfluous: ['{', '}'], vanished: ['[', ']'],
    scribal: ['\u2E22', '\u2E23'], editorial: ['\u27E8', '\u27E9'],
};

// The enclosure variant ('C', 'S', 'H', 'F') an object's frame draws, or
// null. Frames made since the exports learnt enclosures carry it
// (mdcEnclosure); older ones are recognised by their parts: the MdC frames
// by their link (enclosureId), the cartouche tool's by its rounded loop + tie.
function enclosureVariantOf(o) {
    if (!o || o._pageGuide) return null;
    if (o.mdcEnclosure) return o.mdcEnclosure;
    if (o.type === 'group') {
        const kids = o._objects || [];
        const rects = kids.filter(k => k.type === 'rect'), lines = kids.filter(k => k.type === 'line');
        if (rects.length !== 1 || rects.length + lines.length !== kids.length) return null;
        if (rects[0].rx > 0 && lines.length === 1) return 'C';
        if (!o.enclosureId) return null;
        return lines.length === 1 ? 'H' : lines.length > 1 ? 'S' : null;
    }
    return o.type === 'rect' && o.enclosureId && o.fill === 'transparent' && !o.strokeDashArray ? 'F' : null;
}

// The boxes the export lays out: the sign boxes, except that the signs inside
// an enclosure frame are replaced by one box for the frame, plus a box per
// bracket mark. `ctx` ({avgW, avgH, rtl, size}) lays out a frame's contents.
function exportBoxesWithMarks(objs, signBoxes, ctx) {
    const frames = objs.map(o => ({ o, v: enclosureVariantOf(o) })).filter(f => f.v)
        .map(f => ({ ...f, r: f.o.getBoundingRect(true, true) }))
        .sort((a, b) => a.r.width * a.r.height - b.r.width * b.r.height);   // innermost first
    const marks = objs.filter(o => o && o.mdcBracket && MDC_BRK_TOKENS[o.mdcBracket] && !o._pageGuide);
    if (!frames.length && !marks.length) return signBoxes;
    let free = signBoxes;
    const out = [];
    for (const { v, r } of frames) {
        const inside = b => {
            const cx = b.left + b.width / 2, cy = b.top + b.height / 2;
            return cx > r.left && cx < r.left + r.width && cy > r.top && cy < r.top + r.height;
        };
        const members = free.filter(inside);
        if (!members.length) continue;               // an empty frame has nothing to write
        free = free.filter(b => !inside(b));
        out.push({ obj: { _exp: 'enc', variant: v, members, ctx }, left: r.left, top: r.top, width: r.width, height: r.height });
    }
    for (const m of marks) {
        const r = m.getBoundingRect(true, true);
        out.push({ obj: { _exp: 'brk', variant: m.mdcBracket, open: m.mdcBracketSide !== 'right' },
            left: r.left, top: r.top, width: r.width, height: r.height });
    }
    return free.concat(out);
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
// `rtl`: the text reads right to left (signsReadRtl), so side-by-side parts
// come right first. `size`: the typical sign size (mdcSignSize); it sets the
// '-' / '*' threshold (mdcCadratGapMin). Without it, 0.4·avgW (word finder,
// which only needs the order).
function mdcLayoutTree(boxes, avgW, avgH, rtl = false, size = 0) {
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
        const ordered = [...boxes].sort((a, b) => (a.top - b.top) || (rtl ? b.left - a.left : a.left - b.left));
        return { seq: ordered.map(b => b.obj) };
    }

    const op = axis === 'x' ? (cut.gap >= (size ? mdcCadratGapMin(size) : avgW * 0.4) ? '-' : '*') : ':';
    const center = axis === 'x'
        ? b => b.left + b.width / 2
        : b => b.top + b.height / 2;
    let first = boxes.filter(b => center(b) < cut.pos);
    let second = boxes.filter(b => center(b) >= cut.pos);
    // Overlapping signs can put every centre on one side of the cut; recursing
    // on the same set again never ended (stack overflow on crowded canvases).
    if (!first.length || !second.length) {
        const ordered = [...boxes].sort((a, b) => (a.top - b.top) || (rtl ? b.left - a.left : a.left - b.left));
        return { seq: ordered.map(b => b.obj) };
    }
    // Right to left: the right-hand part is read first.
    if (rtl && axis === 'x') [first, second] = [second, first];
    return { op, a: mdcLayoutTree(first, avgW, avgH, rtl, size), b: mdcLayoutTree(second, avgW, avgH, rtl, size) };
}

// The smallest ink gap that still means a new cadrat ('-') rather than signs
// side by side ('*'). The layout puts cadrats MDC_CADRAT_GAP (10) apart and
// side-by-side signs MDC_GAP (6) apart at size MDC_BASE; measured ink gaps
// are exactly that (9.6 / 5.6), so the threshold is halfway, scaled to the
// sign size. (It was 0.4 of the average sign WIDTH: 17 px for A1, 27 for N35,
// so every '-' between wide signs came out as '*', and between thin ones such
// as Z1 every '*' came out as '-'.)
function mdcCadratGapMin(size) {
    return (MDC_GAP + MDC_CADRAT_GAP) / 2 * size / MDC_BASE;
}

// Layout tree → { str, rank } in MdC.
function mdcFromTree(t) {
    if (t.leaf) return { str: mdcCodeFor(t.leaf), rank: MDC_LEAF_RANK };
    if (t.seq) return { str: t.seq.map(mdcCodeFor).join('-'), rank: MDC_OP_RANK['-'] };
    // A bracket mark or an enclosure is never part of a quadrat.
    const isMark = n => n.leaf && !!n.leaf._exp;
    const op = t.op === '*' && (isMark(t.a) || isMark(t.b)) ? '-' : t.op;
    const rank = MDC_OP_RANK[op];
    const a = mdcFromTree(t.a), c = mdcFromTree(t.b);
    // Parenthesize an operand only when it binds looser than the joining
    // operator (e.g. a stack inside a juxtaposition: A*(B:C)).
    const wrap = part => part.rank < rank ? `(${part.str})` : part.str;
    return { str: wrap(a) + op + wrap(c), rank };
}

function mdcFromBoxes(boxes, avgW, avgH, rtl = false, size = 0) {
    return mdcFromTree(mdcLayoutTree(boxes, avgW, avgH, rtl, size));
}

// Group boxes top-to-bottom into rows, breaking only on a clean vertical gap
// wider than a sign (genuine line spacing). A stack's internal gap is smaller,
// so aligned cadrats stay in one row instead of being mistaken for two lines.
//
// With INK boxes (signInkBox) gaps are real, so a stack's gap (up to ~0.4 of
// the sign size) can be as large as the gap between two lines of flat signs.
// Pass `signSize` (the typical font size on the canvas) for the ink rule: a
// break needs a gap of 0.5·size, or of 0.3·size under a row wider than any
// single cadrat can be (2.3·size). Measured on the layout engine's output at
// size 60: stack gaps 6–26 px; line gaps at least 34 (MDC_LINE_VGAP, plus
// MDC_ROW_MIN_H for rows of flat signs), so typed rows always break. Signs
// moved by hand closer than that read as a stack, which looks the same. Without `signSize`, the
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
    const signBoxes = signs.map(signInkBox);
    const avgW = signBoxes.reduce((s, b) => s + b.width, 0) / signBoxes.length;
    const avgH = signBoxes.reduce((s, b) => s + b.height, 0) / signBoxes.length;

    const rtl = signsReadRtl(signs);
    const size = mdcSignSize(signBoxes);
    const boxes = exportBoxesWithMarks(objs, signBoxes, { avgW, avgH, rtl, size });
    // Rows first (line breaks), then guillotine each row into cadrats.
    return mdcSplitRows(boxes, avgH, size)
        .map(row => mdcFromBoxes(row, avgW, avgH, rtl, size).str)
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

function uniSignsOf(obj, rtl = false) {
    if (obj._exp === 'enc') {
        const c = obj.ctx;
        const inner = uniFromTree(mdcLayoutTree(obj.members, c.avgW, c.avgH, c.rtl, c.size), false, c.rtl).str;
        const [open, close] = UNI_ENC[obj.variant];
        return [open + inner + close];
    }
    if (obj._exp === 'brk') return [UNI_BRK[obj.variant][obj.open ? 0 : 1]];
    let signs = (obj.text || '').match(UNI_SIGN_RE) || [];
    // A sign facing against the writing direction is marked mirrored (Unicode
    // leaves the direction itself to the display), and a run facing against
    // it reads in the other order. In a right-to-left text, signs face right.
    if (!!obj.flipX !== rtl) signs = signs.reverse().map(g => g + UNI_MIRROR);
    return signs;
}

// Layout tree → { str, rank }. `nested`: inside a joiner, where a run of
// several quadrats is not allowed, so a run becomes a horizontal group.
function uniFromTree(t, nested, rtl = false) {
    const run = (signs) => {
        if (signs.length === 1) return { str: signs[0], rank: MDC_LEAF_RANK };
        return nested ? { str: signs.join(UNI_HJ), rank: MDC_OP_RANK['*'] }
                      : { str: signs.join(''), rank: MDC_OP_RANK['-'] };
    };
    if (t.leaf) return run(uniSignsOf(t.leaf, rtl));
    if (t.seq) return run(t.seq.flatMap(o => uniSignsOf(o, rtl)));
    // Inside a joiner a cadrat break can't exist, so it becomes side by side.
    // At the top of a line, side by side is written as separate quadrats:
    // it looks the same, and a whole line joined into ONE quadrat would be
    // squeezed by the font (the editor's '*' and '-' spacing is 6 vs 10 px,
    // too close to tell apart reliably).
    const op = nested ? (t.op === '-' ? '*' : t.op) : (t.op === '*' ? '-' : t.op);
    if (op === '-') {
        return { str: uniFromTree(t.a, false, rtl).str + uniFromTree(t.b, false, rtl).str, rank: MDC_OP_RANK['-'] };
    }
    const rank = MDC_OP_RANK[op];
    const a = uniFromTree(t.a, true, rtl), c = uniFromTree(t.b, true, rtl);
    const wrap = part => part.rank < rank ? UNI_BEGIN + part.str + UNI_END : part.str;
    return { str: wrap(a) + (op === ':' ? UNI_VJ : UNI_HJ) + wrap(c), rank };
}

// The objects holding hieroglyphs (transliteration lines are skipped), laid
// out as rows of layout trees, as the Unicode copy reads them. null if none.
function uniLayoutRows(objs) {
    const signs = (objs || []).filter(o => o && (o.type === 'text' || o.type === 'i-text')
        && !o._pageGuide && UNI_HAS_SIGN.test(o.text || ''));
    if (signs.length === 0) return null;
    const signBoxes = signs.map(signInkBox);
    const avgW = signBoxes.reduce((s, b) => s + b.width, 0) / signBoxes.length;
    const avgH = signBoxes.reduce((s, b) => s + b.height, 0) / signBoxes.length;
    const rtl = signsReadRtl(signs);
    const size = mdcSignSize(signBoxes);
    const boxes = exportBoxesWithMarks(objs, signBoxes, { avgW, avgH, rtl, size });
    return { signs, rtl, ctx: { avgW, avgH, rtl, size },
        trees: mdcSplitRows(boxes, avgH, size).map(row => mdcLayoutTree(row, avgW, avgH, rtl, size)) };
}

// Pure: the Unicode-with-layout text for a list of objects ('' if no signs).
function unicodeStringForObjs(objs) {
    const L = uniLayoutRows(objs);
    if (!L) return '';
    return L.trees.map(t => uniFromTree(t, false, L.rtl).str).filter(Boolean).join('\n');
}

// The sign objects in reading order: the order of the Unicode copy and
// →MdC (rows top to bottom; in a row, cadrat by cadrat, a stack top first).
// The PDF exports write their text in this order, so text copied out of a PDF
// reads right even after signs were moved by hand.
function signsInReadingOrder(objs) {
    const L = uniLayoutRows(objs);
    if (!L) return [];
    const out = [];
    const leaf = o => {
        if (o._exp === 'enc') walk(mdcLayoutTree(o.members, o.ctx.avgW, o.ctx.avgH, o.ctx.rtl, o.ctx.size));
        else if (!o._exp) out.push(o);
    };
    const walk = t => { if (t.leaf) leaf(t.leaf); else if (t.seq) t.seq.forEach(leaf); else { walk(t.a); walk(t.b); } };
    L.trees.forEach(walk);
    return out;
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
    const done = () => showCanvasToast(signsReadRtl(src)
        ? 'Unicode copied, with layout, in reading order (right to left; the receiving app shows it left to right)'
        : 'Unicode copied, with layout (needs a font such as Egyptian Text to show stacked)');
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
// become side by side. Enclosures (opening sign + BEGIN control … END control
// + closing sign) become '<-…->' and its serekh / ḥwt / wall forms; the
// text-critical marks ⟦ ⟧ { } [ ] ⸢ ⸣ ⟨ ⟩ become MdC's bracket pairs. Mirror,
// blank and damage marks are dropped. Text without any of these is returned
// unchanged.
const UNI_ENC_OPEN_SIGN = { 0x13379: 'C', 0x13258: 'H', 0x13259: 'H', 0x1325A: 'H',
    0x13286: 'F', 0x13288: 'F', 0x13282: 'S' };
const UNI_ENC_CLOSE_SIGN = new Set([0x1337A, 0x1325B, 0x1325C, 0x1325D, 0x13287, 0x13289]);
const UNI_BRK_TO_MDC = { '\u27E6': '[[', '\u27E7': ']]', '{': '[{', '}': '}]', '[': '["', ']': '"]',
    '\u2E22': "['", '\u2E23': "']", '\u27E8': '[&', '\u27E9': '&]' };
function unicodeLayoutToMdC(str) {
    str = str || '';
    const hasControls = /[\u{13430}-\u{1345F}]/u.test(str);
    // Bracket characters only count in Unicode text: in MdC, '[' and '{' are
    // MdC's own (a text with Latin letters or digits is MdC).
    const hasMarks = UNI_HAS_SIGN.test(str) && !/[A-Za-z0-9]/.test(str)
        && /[\u27E6-\u27E9{}[\]\u2E22\u2E23]/.test(str);
    if (!hasControls && !hasMarks) return str;
    const chars = [...str];
    const encStack = [];
    let out = '', prev = null;       // prev: 'sign' | 'close' | 'op' | 'open' | null
    const newQuadrat = () => { if (prev === 'sign' || prev === 'close') out += '-'; };
    for (let i = 0; i < chars.length; i++) {
        const ch = chars[i];
        const cp = ch.codePointAt(0);
        const nx = chars[i + 1] ? chars[i + 1].codePointAt(0) : 0;
        const isSign = (cp >= 0x13000 && cp <= 0x1342F) || (cp >= 0x13460 && cp <= 0x143FF);
        if (isSign && UNI_ENC_OPEN_SIGN[cp] && (nx === 0x1343C || nx === 0x1343E)) {
            // Opening sign + BEGIN: the enclosure starts.
            const v = UNI_ENC_OPEN_SIGN[cp];
            newQuadrat(); out += MDC_ENC_OPEN[v] + '-'; encStack.push(v); prev = 'open'; i++;
        } else if (cp === 0x1343C || cp === 0x1343E) {
            // BEGIN without an opening sign (a damaged end): a plain cartouche.
            newQuadrat(); out += '<-'; encStack.push('C'); prev = 'open';
        } else if (cp === 0x1343D || cp === 0x1343F) {
            const v = encStack.pop() || 'C';
            out += '-' + MDC_ENC_CLOSE[v]; prev = 'close';
            if (UNI_ENC_CLOSE_SIGN.has(nx)) i++;      // the closing sign belongs to the frame
        } else if (!isSign && UNI_BRK_TO_MDC[ch] && hasMarks) {
            const tok = UNI_BRK_TO_MDC[ch];
            if (tok[0] === '[') { newQuadrat(); out += tok + '-'; prev = 'open'; }
            else { out += '-' + tok; prev = 'close'; }
        } else if (isSign || cp === 0x13437) {
            newQuadrat();
            out += isSign ? ch : '(';
            prev = isSign ? 'sign' : 'open';
        } else if (cp === 0x13438) { out += ')'; prev = 'close'; }
        else if (cp === 0x13430) { out += ':'; prev = 'op'; }
        else if (cp === 0x13431 || (cp >= 0x13432 && cp <= 0x13436) || (cp >= 0x13439 && cp <= 0x1343B)) {
            out += '*'; prev = 'op';
        } else if (cp >= 0x13440 && cp <= 0x1345F) {
            // mirror, blanks, damage: not representable here
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
