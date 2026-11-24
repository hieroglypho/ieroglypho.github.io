/*!
 * ΙΕΡΟΓΛΥΦΩ editor — JSesh import
 *
 * Opens a JSesh text (.gly) on the canvas. JSesh writes the Manuel de Codage
 * with its own extensions; jseshToMdC reads that markup (following the rules
 * of JSesh's MdC reader) and rewrites it in the MdC the editor's layout engine
 * understands (glyph-input.js: handleMdCInput). Signs are looked up by their
 * JSesh code (jsesh-codes.js, from Unicode's Unikemet data), so Extended-A
 * signs come through as the editor's own Extended-A characters.
 *
 * What maps to what:
 *   • signs: JSesh codes, MdC sound codes (ra, nTr) and numbers (3, 800)
 *   • : * ( ) - ! !!   stacking, grouping, quadrats, line and page ends
 *   • ligatures (& && ** &&& ^^^ ##): the Unicode composite sign when there is
 *     one, otherwise the signs side by side
 *   • cartouche, serekh, hwt, enclosure (< >, <s s>, <h h>, <f f>)
 *   • $r / $b colour, #b / #e and # shading, editorial brackets [[ ]] …
 *   • \ mirror, \R90 turn; . and .. blank space; // / h/ v/ shaded area
 *   • text lines (+l … +s, +b, +i, +t): kept as one text block above the signs
 *   • a code with no Unicode sign: a dashed box, listed in the report
 *   • dropped: line numbers (|31), tab stops, the file's layout settings
 *
 * Classic <script defer>; shares globals with the other editor scripts.
 *
 * @copyright Copyright (c) 2024–2026 Massimo Mazzon. All rights reserved.
 */

// ------------------------------------------------------------ composites ---
// "a+b" (hex code points of the signs, format controls dropped) → composite.
let _jseshComposites = null;
function jseshComposite(chars) {
    if (!_jseshComposites) {
        _jseshComposites = new Map();
        if (typeof JSESH_ALTSEQ_RAW === 'string') {
            for (const item of JSESH_ALTSEQ_RAW.split(',')) {
                const [comp, seq] = item.split('=');
                const signs = seq.split('+').filter(h => { const v = parseInt(h, 16); return v < 0x13430 || v > 0x1345F; });
                if (signs.length > 1) _jseshComposites.set(signs.join('+'), String.fromCodePoint(parseInt(comp, 16)));
            }
        }
    }
    return _jseshComposites.get(chars.map(c => c.codePointAt(0).toString(16)).join('+'));
}

// -------------------------------------------------------------- numbers ---
// A number code (3, 20, 800, 1600) → its numeral signs, largest first. Unicode
// numerals run 1–9 within each sign: Z15 (units), V20 (tens), V1 (hundreds),
// M12 (thousands).
function jseshNumberSigns(code) {
    const n = parseInt(code, 10);
    if (!(n > 0) || n > 9999) return null;
    if (n === 1) return [String.fromCodePoint(0x133E4)];          // Z1, the single stroke
    const out = [];
    const digits = [[1000, 0x131BC], [100, 0x13362], [10, 0x13386], [1, 0x133FA]];
    let rest = n;
    for (const [unit, base] of digits) {
        const k = Math.floor(rest / unit);
        rest -= k * unit;
        if (k) out.push(String.fromCodePoint(base + k - 1));
    }
    return out;
}

// ----------------------------------------------------------------- lexer ---
const JS_ESPSO = '[ \\t\\n\\r_-]*';
function jsRe(src) { return new RegExp(src, 'suy'); }
const JS_RULES = {
    pageEnd: jsRe(`!!${JS_ESPSO}`),
    lineEnd: jsRe(`!(?:=[0-9]+%)?${JS_ESPSO}`),
    tabStop: jsRe('\\?[0-9]+'),
    percent: jsRe('%[a-z]*'),
    hrule: jsRe('\\{[lL][0-9]+,[0-9]+\\}'),
    textSuper: jsRe('\\|(?:\\\\-|[^-])*'),
    shadeOn: jsRe('-?#b'),
    shadeOff: jsRe('-?#e'),
    shadeToggle: jsRe('-#-?'),
    sep: jsRe(`-${JS_ESPSO}`),
    space: jsRe('[ \\t\\n\\r_]+'),
    hashSep: jsRe('#(?:-| +)'),
    shading: jsRe('#[1-4]*'),
    modifier: jsRe('\\\\(?:\\?|R-?[0-9]*|[A-Za-z]*[0-9]*)'),
    smallText: jsRe('"(?:[^"\\\\\\]]|\\\\.)*"'),
    curly: jsRe('\\{\\{[^}]*\\}\\}'),
    // Enclosures. Opening: < <1 <s <s1 <S <Sb <b; closing: > 1> s> s1>.
    encOpen: jsRe('<(?:[sfhg][0123]?|[SFH][bme]|[SFHG]|[bme0123])?'),
    encClose: jsRe('(?:[sfhg][0123]?|[0123])?>'),
    signCode: jsRe('(?:[A-Z]|Aa)[0-9]+A*|[@a-zA-Z0-9]+|@.'),
};
function jsMatch(re, src, i) { re.lastIndex = i; const m = re.exec(src); return m ? m[0] : null; }

// JSesh's alphabetic text: '+' then a letter (not 's') or '+', up to the next
// '+' that starts another code. Returns its length, or 0.
function jsAlphaText(src, i) {
    if (src[i] !== '+' || !/[a-rt-z+]/.test(src[i + 1] || '')) return 0;
    let k = i + 2;
    while (k < src.length) {
        const c = src[k];
        if (c === '\\' && src[k + 1] === '+') k += 2;
        else if (c !== '+') k++;
        else if (k + 1 < src.length && !/[a-z+]/.test(src[k + 1])) k += 2;
        else break;
    }
    return k - i;
}

const JS_BRACKETS_OPEN = { '[[': 'erased', '[{': 'superfluous', '["': 'vanished', "['": 'scribal',
                           '[&': 'editorial', '[(': 'editorial', '[?': 'editorial' };
const JS_BRACKETS_CLOSE = { ']]': 'erased', '}]': 'superfluous', '"]': 'vanished', "']": 'scribal',
                            '&]': 'editorial', ')]': 'editorial', '?]': 'editorial' };
const JS_BRACKET_MDC = { erased: ['[[', ']]'], superfluous: ['[{', '}]'], vanished: ['["', '"]'],
                         scribal: ["['", "']"], editorial: ['[&', '&]'] };
const JS_ENC_VARIANT = { c: 'C', s: 'S', h: 'H', f: 'F', g: 'F' };

// Read JSesh source into a flat list of items:
//   {k:'sign', chars:[…], name, mirror, rot, shade, color}   one sign (a number may be several)
//   {k:'missing', name}   a code with no sign
//   {k:'blank', size}  {k:'shadebox'}
//   {k:'op', v:':'|'*'|'lig'}  {k:'lp'} {k:'rp'}
//   {k:'open'|'close', kind:'enc'|'brk', v}   {k:'break', v:'!'|'!!'}
function jseshLex(src, info) {
    const items = [];
    let i = 0, color = null, shade = false;
    let justSign = false, lineText = [];
    const lastSign = () => { const t = items[items.length - 1]; return t && (t.k === 'sign' || t.k === 'missing') ? t : null; };
    const flushText = () => {
        const line = lineText.join(' ').replace(/\s+/g, ' ').trim();
        if (line) info.texts.push(line);
        lineText = [];
    };
    const push = (t) => { items.push(t); justSign = t.k === 'sign' || t.k === 'missing'; };
    // Shading written after a sign shades that sign; after a group, every sign in it.
    const shadeLast = () => {
        const t = items[items.length - 1];
        if (!t) return;
        if (t.k === 'sign') { t.shade = true; return; }
        if (t.k === 'blank') { items[items.length - 1] = { k: 'shadebox' }; return; }
        if (t.k === 'rp') {
            let depth = 0;
            for (let j = items.length - 1; j >= 0; j--) {
                if (items[j].k === 'rp') depth++;
                else if (items[j].k === 'lp' && --depth === 0) break;
                else if (items[j].k === 'sign') items[j].shade = true;
            }
        }
    };

    while (i < src.length) {
        const c = src[i], c2 = src.substr(i, 2);
        let m;

        const alpha = jsAlphaText(src, i);
        if (alpha) {
            const kind = src[i + 1];
            const body = src.slice(i + 2, i + alpha).replace(/\\\+/g, '+').replace(/\\\\/g, '\\');
            if (kind === '+') {
                const p = body.trim().match(/^(\S+)\s+(.*)$/);
                if (p && !(p[1] in info.props)) info.props[p[1]] = p[2].trim();
            } else if (body.trim()) {
                lineText.push(body.trim());
            }
            i += alpha;
            justSign = false;
            continue;
        }
        if (c2 === '+s') { i += 2; continue; }
        if ((m = jsMatch(JS_RULES.textSuper, src, i))) { i += m.length; continue; }   // line numbers
        if ((m = jsMatch(JS_RULES.pageEnd, src, i))) { flushText(); push({ k: 'break', v: '!!' }); i += m.length; continue; }
        if ((m = jsMatch(JS_RULES.lineEnd, src, i))) { flushText(); push({ k: 'break', v: '!' }); i += m.length; continue; }
        if ((m = jsMatch(JS_RULES.tabStop, src, i))) { i += m.length; continue; }
        if ((m = jsMatch(JS_RULES.percent, src, i))) { i += m.length; continue; }
        if ((m = jsMatch(JS_RULES.hrule, src, i))) { i += m.length; continue; }
        if ((m = jsMatch(JS_RULES.curly, src, i))) { i += m.length; continue; }      // {{x,y,scale}} positions

        // Shading and separators (longest match first, as JSesh does).
        if ((m = jsMatch(JS_RULES.shadeOn, src, i))) { shade = true; i += m.length; justSign = false; continue; }
        if ((m = jsMatch(JS_RULES.shadeOff, src, i))) { shade = false; i += m.length; justSign = false; continue; }
        if (c === '-' && (m = jsMatch(JS_RULES.shadeToggle, src, i))) { shade = !shade; i += m.length; justSign = false; continue; }
        if ((m = jsMatch(JS_RULES.sep, src, i))) { i += m.length; justSign = false; continue; }
        if ((m = jsMatch(JS_RULES.space, src, i))) { i += m.length; justSign = false; continue; }
        if (c2 === '##') { push({ k: 'op', v: 'lig' }); i += 2; continue; }
        if (c === '#') {
            if ((m = jsMatch(JS_RULES.hashSep, src, i))) {
                if (justSign) shadeLast(); else shade = !shade;
                i += m.length; justSign = false; continue;
            }
            m = jsMatch(JS_RULES.shading, src, i);
            if (m.length > 1 || items.length && items[items.length - 1].k === 'rp') shadeLast();
            else if (justSign) push({ k: 'op', v: 'lig' });   // a lone # right after a sign: overwrite
            else shade = !shade;
            i += m.length; continue;
        }

        if (c === '$') {
            const n = src[i + 1];
            if (n === 'r') { color = 'r'; i += 2; }
            else if (n === 'b') { color = null; i += 2; }
            else { color = color ? null : 'r'; i++; }
            continue;
        }

        // Editorial brackets, before the single characters they start with.
        if (JS_BRACKETS_CLOSE[c2]) { push({ k: 'close', kind: 'brk', v: JS_BRACKETS_CLOSE[c2] }); i += 2; continue; }
        if (JS_BRACKETS_OPEN[c2]) { push({ k: 'open', kind: 'brk', v: JS_BRACKETS_OPEN[c2] }); i += 2; continue; }
        if (c === '[') { const e = src.indexOf(']', i); i = e === -1 ? src.length : e + 1; continue; }   // [property=…]

        if (c === '?') { i += src[i + 1] === '?' ? 2 : 1; continue; }   // lacuna toggles: not drawn
        if (src.startsWith('^^^', i)) { push({ k: 'op', v: 'lig' }); i += 3; continue; }
        if (c2 === '^^') { push({ k: 'op', v: 'lig' }); i += 2; continue; }
        if (c === '^') { i++; continue; }                                 // omission toggle
        if (src.startsWith('&&&', i)) { push({ k: 'op', v: 'lig' }); i += 3; continue; }
        if (c2 === '&&' || c2 === '**') { push({ k: 'op', v: 'lig' }); i += 2; continue; }
        if (c === '&') { push({ k: 'op', v: 'lig' }); i++; continue; }
        if (c === ':' || c === '*') { push({ k: 'op', v: c }); i++; continue; }
        if (c === '(') { push({ k: 'lp' }); i++; continue; }
        if (c === ')') { push({ k: 'rp' }); i++; continue; }
        if (c === '=') { i++; continue; }

        if (c === '\\') {
            m = jsMatch(JS_RULES.modifier, src, i);
            const t = lastSign();
            if (t && t.k === 'sign') {
                const name = m.slice(1).replace(/-?[0-9]+$/, ''), val = m.slice(1 + name.length);
                if (!name && !val) t.mirror = !t.mirror;
                else if (!name && val) { const pc = parseInt(val, 10); if (pc >= 10 && pc <= 400) t.size = pc; }   // \70 = 70 %
                else if (name === 'R' && val) t.rot = ((parseInt(val, 10) % 360) + 360) % 360;
                else if (name === 'shading') t.shade = true;
            }
            i += m.length; continue;
        }

        if (c === '<') {
            m = jsMatch(JS_RULES.encOpen, src, i);
            const letter = (m[1] || 'c').toLowerCase();
            push({ k: 'open', kind: 'enc', v: JS_ENC_VARIANT[letter] || 'C' });
            i += m.length; continue;
        }
        // A sign code and an enclosure end can start alike ("s>" vs the sign s):
        // the longer wins, the enclosure end on a tie.
        const close = jsMatch(JS_RULES.encClose, src, i);
        const code = jsMatch(JS_RULES.signCode, src, i);
        if (close && close.length >= (code ? code.length : 0)) {
            push({ k: 'close', kind: 'enc', v: JS_ENC_VARIANT[close.length > 1 && /[a-z]/.test(close[0]) ? close[0] : 'c'] || 'C' });
            i += close.length; continue;
        }
        if (c2 === '..') { push({ k: 'blank', size: 'full' }); i += 2; continue; }
        if (c2 === '//') { push({ k: 'shadebox' }); i += 2; continue; }
        if (c2 === 'h/' || c2 === 'v/') { push({ k: 'shadebox' }); i += 2; continue; }
        if (c === '/') { push({ k: 'shadebox' }); i++; continue; }
        if (c === '.') { push({ k: 'blank', size: 'half' }); i++; continue; }
        if ((m = jsMatch(JS_RULES.smallText, src, i))) { push({ k: 'blank', size: 'half' }); i += m.length; continue; }
        if (c === '`') { i++; continue; }
        if ((c === 'o' || c === 'O') && !(code && code.length > 1)) { push({ k: 'blank', size: 'half' }); i++; continue; }   // red / black point

        if (code === 'sic') { push({ k: 'blank', size: 'half' }); i += 3; continue; }   // a small "sic" note
        if (code) {
            push(jseshSign(code, color, shade, info));
            i += code.length;
            continue;
        }
        i += src.codePointAt(i) > 0xFFFF ? 2 : 1;   // anything else: skip
    }
    flushText();
    return items;
}

// JSesh codes with no sign of their own: hieratic unit digits (larger than the
// stroke Z1) become the numerals one to four.
const JSESH_ALIASES = { Ff301: '1:133FA', Ff302: '1:133FB', Ff303: '1:133FC', Ff304: '1:133FD' };

function jseshSign(code, color, shade, info) {
    let chars = null;
    if (JSESH_ALIASES[code]) {
        chars = [String.fromCodePoint(parseInt(JSESH_ALIASES[code].split(':')[1], 16))];
    } else if (/^[0-9]+$/.test(code)) {
        chars = jseshNumberSigns(code);
    } else {
        const e = mdcLookupCode(code);
        if (e) chars = [e[1]];
    }
    if (!chars) {
        info.missing.set(code, (info.missing.get(code) || 0) + 1);
        return { k: 'missing', name: code };
    }
    info.signs += chars.length;
    return { k: 'sign', chars, name: code, color, shade, mirror: false, rot: 0, size: 0 };
}

// ------------------------------------------------------------- ligatures ---
// A ligature joins its two neighbours. When both are single signs and Unicode
// has a composite for the pair, use it; otherwise put them side by side.
function jseshResolveLigatures(items) {
    const operandStart = (j) => {      // index of the first item of the operand ending at j
        if (!items[j]) return -1;
        if (items[j].k !== 'rp') return j;
        let depth = 0;
        for (let q = j; q >= 0; q--) {
            if (items[q].k === 'rp') depth++;
            else if (items[q].k === 'lp' && --depth === 0) return q;
        }
        return -1;
    };
    const operandEnd = (j) => {
        if (!items[j]) return -1;
        if (items[j].k !== 'lp') return j;
        let depth = 0;
        for (let q = j; q < items.length; q++) {
            if (items[q].k === 'lp') depth++;
            else if (items[q].k === 'rp' && --depth === 0) return q;
        }
        return -1;
    };
    const isOperand = t => t && ['sign', 'missing', 'blank', 'shadebox', 'lp', 'rp'].includes(t.k);
    for (let k = 0; k < items.length; k++) {
        if (items[k].k !== 'op' || items[k].v !== 'lig') continue;
        const a = items[k - 1], b = items[k + 1];
        if (!isOperand(a) || !isOperand(b) || a.k === 'lp' || b.k === 'rp') { items.splice(k, 1); k--; continue; }
        if (a.k === 'sign' && b.k === 'sign' && a.chars.length === 1 && b.chars.length === 1) {
            const comp = jseshComposite([a.chars[0], b.chars[0]]);
            if (comp) {
                items.splice(k - 1, 3, { ...a, chars: [comp], name: a.name + '&' + b.name, mirror: false, rot: 0, size: 0 });
                k -= 1;
                continue;
            }
        }
        const s = operandStart(k - 1), e = operandEnd(k + 1);
        if (s < 0 || e < 0) { items[k] = { k: 'op', v: '*' }; continue; }
        items[k] = { k: 'op', v: '*' };
        items.splice(e + 1, 0, { k: 'rp' });
        items.splice(s, 0, { k: 'lp' });
        k++;
    }
}

// ------------------------------------------------------------- write MdC ---
// Writes the items as editor MdC, repairing what the editor's stricter reader
// would reject: two quadrats side by side get a '-', an operator with nothing
// on one side is dropped, enclosures and brackets left open at a line end are
// closed there and reopened on the next line.
function jseshWriteMdC(items) {
    let out = '';
    let last = 'start';        // 'start' | 'operand' | 'op' | 'open'
    let curColor = null, curShade = false;
    // Open parentheses. JSesh allows '-' inside them (sub-groups side by side);
    // the editor doesn't, so such a group is written (a)*(b): `split` says the
    // group has been cut, `seg` where its current part starts in `out`.
    const parens = [];
    const stack = [];          // open enclosures / brackets: {kind, v, parens}
    let lineHasContent = false;

    const openStr = o => o.kind === 'enc' ? '<' + o.v : JS_BRACKET_MDC[o.v][0];
    const closeStr = o => o.kind === 'enc' ? '>' + o.v : JS_BRACKET_MDC[o.v][1];
    const baseParens = () => stack.length ? stack[stack.length - 1].parens : 0;
    const dropTrailingOp = () => {
        if (last === 'op') { out = out.replace(/[:*]$/, ''); last = 'operand'; }
    };
    const beforeOperand = () => {
        if (last === 'operand') {
            const p = parens.length > baseParens() ? parens[parens.length - 1] : null;
            if (p) {
                if (!p.split) { out = out.slice(0, p.seg) + '(' + out.slice(p.seg); p.split = true; }
                out += ')*(';
            } else {
                out += '-';
            }
        }
        lineHasContent = true;
    };
    const closeOneParen = () => {
        dropTrailingOp();
        const p = parens.pop();
        if (p.split && out.endsWith(')*(')) out = out.slice(0, -2) + ')';   // empty last part
        else if (p.split) out += '))';
        else if (out.endsWith('(')) {
            // An empty group (it held only a note, e.g. R88*(+l?+s)): take it
            // out with the operator or separator written before it.
            out = out.slice(0, p.start);
            if (p.prevLast === 'op') out = out.replace(/[:*]$/, '');
            last = p.prevLast === 'op' || p.prevLast === 'operand' ? 'operand' : p.prevLast;
            return;
        }
        else out += ')';
        last = 'operand';
    };
    const closeParensTo = depth => { while (parens.length > depth) closeOneParen(); dropTrailingOp(); };
    const setInk = t => {
        const color = t.color || null, shade = !!t.shade;
        if (color !== curColor) { out += color ? '$r' : '$b'; curColor = color; }
        if (shade !== curShade) { out += shade ? '#b' : '#e'; curShade = shade; }
    };

    for (const t of items) {
        switch (t.k) {
            case 'sign': {
                beforeOperand();
                setInk(t);
                const mods = (t.mirror ? '\\' : '') + (t.rot ? '\\R' + t.rot : '') + (t.size ? '\\' + t.size : '');
                const parts = t.chars.map(ch => ch + mods);
                out += parts.length > 1 ? '(' + parts.join('*') + ')' : parts[0];
                last = 'operand';
                break;
            }
            case 'missing':
                beforeOperand(); out += '?'; last = 'operand'; break;
            case 'blank':
                beforeOperand(); out += t.size === 'full' ? '..' : '.'; last = 'operand'; break;
            case 'shadebox':
                beforeOperand(); out += '#'; last = 'operand'; break;
            case 'op':
                if (last === 'operand') { out += t.v === 'lig' ? '*' : t.v; last = 'op'; }
                break;
            case 'lp': {
                const rec = { start: out.length, prevLast: last, split: false };
                beforeOperand();
                out += '(';
                rec.seg = out.length;
                parens.push(rec);
                last = 'open';
                break;
            }
            case 'rp':
                if (parens.length > baseParens()) closeOneParen();
                break;
            case 'open':
                // An enclosure or bracket can be an operand inside a group
                // (sn*[[n:A1]]), so an operator before it stays.
                beforeOperand();
                stack.push({ kind: t.kind, v: t.v, parens: parens.length });
                out += openStr(t);
                last = 'open';
                break;
            case 'close': {
                let at = -1;
                for (let q = stack.length - 1; q >= 0; q--) if (stack[q].kind === t.kind) { at = q; break; }
                if (at < 0) break;                      // a close with no open: drop it
                while (stack.length > at) {
                    const o = stack.pop();
                    closeParensTo(o.parens);
                    out += closeStr(o);
                }
                last = 'operand';
                break;
            }
            case 'break': {
                if (!lineHasContent) break;             // a text-only line: no empty row
                const open = stack.slice();
                for (let q = stack.length - 1; q >= 0; q--) { closeParensTo(stack[q].parens); out += closeStr(stack[q]); }
                closeParensTo(0);
                out += t.v === '!!' ? '-!!-' : '-!-';
                stack.length = 0;
                last = 'start';
                lineHasContent = false;
                for (const o of open) { out += openStr(o); stack.push({ ...o, parens: 0 }); last = 'open'; }
                break;
            }
        }
    }
    for (let q = stack.length - 1; q >= 0; q--) { closeParensTo(stack[q].parens); out += closeStr(stack[q]); }
    closeParensTo(0);
    if (curShade) out += '#e';
    // Strip enclosures that hold nothing (opened right before a line end).
    return out.replace(/<([SHFC])>\1/g, '').replace(/-+!/g, '-!').replace(/^[-!]+/, '');
}

// The whole conversion. Returns { mdc, texts, props, missing: Map, signs }.
function jseshToMdC(src) {
    const info = { texts: [], props: {}, missing: new Map(), signs: 0 };
    const items = jseshLex(String(src || '').replace(/\r\n?/g, '\n'), info);
    jseshResolveLigatures(items);
    return { mdc: jseshWriteMdC(items), ...info };
}

// ---------------------------------------------------------------- import ---
// Lay a JSesh text out on the canvas (below anything already there) as one
// undo step, then fit the view to it and report what could not be shown.
async function importJSeshText(text, filename) {
    const r = jseshToMdC(text);
    if (!r.signs) {
        alert('No hieroglyphs found in this file. Is it a JSesh (.gly) text?');
        return r;
    }
    try {
        await Promise.all([
            document.fonts.load(`${MDC_BASE}px "Noto Sans Egyptian Hieroglyphs"`),
            document.fonts.load(`${MDC_BASE}px "Hieroglyphica Extended"`, '\u{13460}'),
        ]);
    } catch (_) { /* best-effort */ }

    groupUndo(() => {
        if (r.texts.length) {
            // The file's title and notes (often the source and who typed it).
            const bottom = canvas.getObjects().filter(o => !o._pageGuide)
                .reduce((m, o) => Math.max(m, o.getBoundingRect(true, true).top + o.getBoundingRect(true, true).height), 0);
            const note = new fabric.IText(r.texts.join('\n'), {
                left: 100, top: bottom ? bottom + 40 : 40, fontSize: 16, lineHeight: 1.3,
                fontFamily: 'Arial, sans-serif', fill: '#333', originX: 'left', originY: 'top'
            });
            note.id = generateUniqueId();
            canvas.add(note);
            pushUndo({ type: 'add', object: note.toObject(UNDO_PROPS), id: note.id });
        }
        handleMdCInputNow(r.mdc, { unbounded: true, rtl: /RIGHT_TO_LEFT/i.test(r.props.JSesh_page_direction || '') });
    });
    canvas.discardActiveObject();
    if (typeof fitCanvasToContent === 'function') fitCanvasToContent();

    const notes = [];
    const name = filename ? `“${filename}”` : 'the JSesh text';
    notes.push(`Opened ${name}: ${r.signs} signs.`);
    const vertical = /VERTICAL/i.test(r.props.JSesh_page_orientation || '');
    const rtl = /RIGHT_TO_LEFT/i.test(r.props.JSesh_page_direction || '');
    if (vertical) notes.push(`It was written in columns; here it is laid out in rows, ${rtl ? 'right to left' : 'left to right'}.`);
    if (r.missing.size) {
        const list = [...r.missing.entries()].sort((a, b) => b[1] - a[1]).map(([c, n]) => n > 1 ? `${c} (×${n})` : c);
        notes.push(`${list.length} sign code${list.length > 1 ? 's have' : ' has'} no Unicode sign and show${list.length > 1 ? '' : 's'} as a dashed box: ${list.slice(0, 12).join(', ')}${list.length > 12 ? ', …' : ''}.`);
    }
    showImportReport(notes);
    return r;
}

function showImportReport(lines) {
    const box = document.createElement('div');
    box.className = 'import-report';
    box.setAttribute('role', 'status');
    lines.forEach(l => { const p = document.createElement('p'); p.textContent = l; box.appendChild(p); });
    const ok = document.createElement('button');
    ok.textContent = 'OK';
    ok.addEventListener('click', () => box.remove());
    box.appendChild(ok);
    document.body.appendChild(box);
    setTimeout(() => box.remove(), 20000);
}

function openJSeshFile() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.gly,.txt,text/plain';
    input.onchange = async () => {
        const file = input.files[0];
        if (!file) return;
        try {
            await importJSeshText(await file.text(), file.name);
        } catch (err) {
            console.error('JSesh import failed', err);
            alert('Could not open this JSesh file.');
        }
    };
    input.click();
}

// A .gly file dropped on the canvas opens the same way.
function initJSeshImport() {
    const btn = document.getElementById('openJSeshBtn');
    if (btn) btn.addEventListener('click', (e) => {
        e.stopPropagation();
        document.getElementById('mainMenu')?.classList.add('hidden');
        openJSeshFile();
    });
    const zone = canvas.wrapperEl;
    if (!zone) return;
    zone.addEventListener('dragover', (e) => {
        if ([...(e.dataTransfer?.items || [])].some(it => it.kind === 'file')) e.preventDefault();
    });
    zone.addEventListener('drop', async (e) => {
        const file = [...(e.dataTransfer?.files || [])].find(f => /\.gly$/i.test(f.name));
        if (!file) return;
        e.preventDefault();
        e.stopPropagation();
        try { await importJSeshText(await file.text(), file.name); }
        catch (err) { console.error('JSesh import failed', err); alert('Could not open this JSesh file.'); }
    }, true);
}
