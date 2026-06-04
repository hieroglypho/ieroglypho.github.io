// Cache for processed data and regex
let processedDictionary = null;
let cachedRegex = { input: '', exact: null, loose: null };

// The dictionary is bundled with the app and loaded automatically — there is no
// user upload. It lives at the site root; the editor sits one level down in
// ΙΕΡΟΓΛΥΦΩ/, hence the '../'.
const DICT_URL = '../dictionary.txt';
// Hand-authored entries live in a separate file so the 50k-line master stays
// pristine; we load both so additions are instantly searchable. The file is
// optional — a missing or empty one is never fatal.
const ADDITIONS_URL = '../dict-additions.txt';
// Thesaurus Linguae Aegyptiae lemma list (English glosses). Kept SEPARATE from
// the proprietary core because it is CC BY-SA 4.0 — the ShareAlike obligation
// applies only to this file. Loaded alongside the core so its entries are
// searchable too. Also optional — a missing file is never fatal.
const TLA_URL = '../dictionary-tla.txt';

// Initialize the application
function initializeApp() {
    initializeSearchListeners();
    initializeResultsResizer();
    loadBundledDictionary();
}

// Fetch the bundled dictionary once on startup and enable search when it's ready.
// The file is static, so the browser's HTTP cache keeps repeat visits cheap.
async function loadBundledDictionary() {
    const searchButton = document.querySelector('.search-button');
    const resultDisplay = document.getElementById('resultDisplay');
    if (searchButton) searchButton.disabled = true;

    try {
        const res = await fetch(DICT_URL);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const text = await res.text();
        processedDictionary = text.split('\n');

        // Fold in the additions file if present (optional, never fatal). No-store
        // so freshly-saved entries appear on the next reload without a cache hit.
        try {
            const addRes = await fetch(ADDITIONS_URL, { cache: 'no-store' });
            if (addRes.ok) {
                const addText = await addRes.text();
                if (addText) processedDictionary = processedDictionary.concat(addText.split('\n'));
            }
        } catch (_) { /* additions are optional */ }

        // Fold in the CC BY-SA TLA lemma list (separate file, see TLA_URL above).
        // Static like the core, so the normal HTTP cache is fine.
        try {
            const tlaRes = await fetch(TLA_URL);
            if (tlaRes.ok) {
                const tlaText = await tlaRes.text();
                if (tlaText) processedDictionary = processedDictionary.concat(tlaText.split('\n'));
            }
        } catch (_) { /* TLA layer is optional */ }

        if (searchButton) searchButton.disabled = false;
        // Show the entry count as a quiet placeholder in the results panel; it
        // fades the first time the user focuses the search box.
        if (resultDisplay) {
            const entries = processedDictionary.filter(l => l && l[0] !== '#').length;
            resultDisplay.innerHTML =
                `<div class="dict-ready-note">𓂀 ${entries.toLocaleString()} dictionary entries ready</div>`;
        }
    } catch (e) {
        console.error('Could not load dictionary:', e);
        if (resultDisplay) {
            resultDisplay.innerHTML =
                '<div class="dict-ready-note">Could not load the dictionary — please reload the page.</div>';
        }
        processedDictionary = null;
    }
}

// Fade the entry-count placeholder out the first time the user engages search.
function fadeDictReadyNote() {
    const note = document.querySelector('#resultDisplay .dict-ready-note');
    if (!note || note.classList.contains('fade-out')) return;
    note.classList.add('fade-out');
    note.addEventListener('transitionend', () => note.remove(), { once: true });
}

// Drag handle: pulling up shrinks the character list, growing the results panel below it.
function initializeResultsResizer() {
    const resizer = document.getElementById('resultsResizer');
    const list = document.getElementById('charListContainer');
    if (!resizer || !list) return;

    let startY = 0;
    let startHeight = 0;

    const onMove = (e) => {
        const newH = Math.max(60, startHeight + (e.clientY - startY));
        list.style.height = newH + 'px';
        list.style.minHeight = '0';
    };
    const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.body.style.userSelect = '';
    };
    resizer.addEventListener('mousedown', (e) => {
        startY = e.clientY;
        startHeight = list.getBoundingClientRect().height;
        document.body.style.userSelect = 'none';
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
        e.preventDefault();
    });
}

// Initialize search listeners
function initializeSearchListeners() {
    const searchInput = document.getElementById('dictionarySearchInput');
    searchInput.addEventListener('keydown', handleSearchKeydown);
    searchInput.addEventListener('focus', fadeDictReadyNote);
    initializeResultClickInsert();
}

// Click a glyph run in the results to drop those signs onto the canvas, reusing
// the same MdC layout pipeline as a drag-drop from the results. One delegated
// listener on the (persistent) results container covers every re-render. The
// `handleMdCInput` guard keeps this inert if the file is ever loaded without the
// editor present.
function initializeResultClickInsert() {
    const resultDisplay = document.getElementById('resultDisplay');
    if (!resultDisplay) return;
    resultDisplay.addEventListener('click', (e) => {
        const run = e.target.closest('.large-text');
        if (!run) return;
        const glyphs = run.textContent.trim();
        if (glyphs && typeof handleMdCInput === 'function') {
            handleMdCInput(glyphs);
            run.classList.add('inserted-flash');
            setTimeout(() => run.classList.remove('inserted-flash'), 350);
        }
    });
}

// MdC ↔ Leiden transliteration bridge. The core file is mostly MdC-style ASCII
// (A i a H x X S T D) while the CC BY-SA TLA file uses Leiden Unicode
// (ꜣ ꞽ ꜥ ḥ ḫ ẖ š ṯ ḏ); the core itself even mixes the two. So a query in either
// scheme is expanded to BOTH forms before matching, letting one search find both
// spellings. This is purely additive — the original term is always kept, so the
// bridge can only broaden results, never drop one.
const MDC_TO_LEIDEN = { A:'ꜣ', I:'ꞽ', i:'ꞽ', a:'ꜥ', H:'ḥ', x:'ḫ', X:'ẖ', S:'š', T:'ṯ', D:'ḏ' };
const LEIDEN_TO_MDC = { 'ꜣ':'A', 'ꞽ':'i', 'ꜥ':'a', 'ḥ':'H', 'ḫ':'x', 'ẖ':'X', 'š':'S', 'ṯ':'T', 'ḏ':'D',
                        'Ꜣ':'A', 'Ꞽ':'i', 'Ꜥ':'a', 'Ḥ':'H', 'Ḫ':'x', 'Š':'S', 'Ṯ':'T', 'Ḏ':'D' };
const toLeiden = s => [...s].map(c => MDC_TO_LEIDEN[c] || c).join('');
const toMdc    = s => [...s].map(c => LEIDEN_TO_MDC[c] || c).join('');
// All distinct MdC/Leiden spellings of a term, regex-escaped, ready to OR together.
function tlitVariants(term) {
    const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const variants = new Set([term, toLeiden(term), toMdc(term)]);
    return [...variants].map(escape);
}

// Get or create regex patterns
function getSearchRegex(searchInput) {
    if (searchInput === cachedRegex.input) {
        return cachedRegex;
    }

    const terms = searchInput.split(/\s+/);
    // Each term becomes a group of its transliteration variants: (?:imnH|ꞽmnḥ).
    const termGroups = terms.map(term => {
        const v = tlitVariants(term);
        return v.length > 1 ? `(?:${v.join('|')})` : v[0];
    });

    const exactPattern = termGroups.join('[\s-]*');
    const loosePattern = termGroups
        .map(group => `(?=.*${group})`)
        .join('');

    cachedRegex = {
        input: searchInput,
        exact: new RegExp(exactPattern, 'iu'),
        loose: new RegExp(loosePattern, 'iu'),
        highlight: new RegExp(`(${termGroups.join('|')})`, 'giu')
    };

    return cachedRegex;
}

// Process line segments
function processLineSegments(line) {
    return line.split(/(<time>[^<]+<\/time>|<i>[^<]+<\/i>)/)
        .map(segment => {
            if (segment.startsWith('<time>') || segment.startsWith('<i>')) {
                return segment;
            }
            // Enlarge only Egyptian Hieroglyph code points (U+13000–U+143FF:
            // base block, format controls, Extended-A) — NOT all non-ASCII.
            // Egyptological transliteration letters (ḥ ḫ ꜣ ꜥ ı͗ ḏ ṯ …) are non-ASCII
            // too but live in the BMP, so the old [^\x00-\x7F] match blew them up to
            // glyph size in the hieroglyph font.
            return segment.replace(/([\u{13000}-\u{143FF}]+)/gu, '<span class="large-text" title="Click to add these signs to the canvas">$1</span>');
        })
        .join('');
}

// Handle keydown events
function handleSearchKeydown(e) {
    if (e.key === 'Enter') {
        searchDictionary();
    } else if (e.key === 'Backspace') {
        e.stopPropagation();
    }
}

// Clear the dictionary search box and its results panel.
function clearDictionarySearch() {
    const input = document.getElementById('dictionarySearchInput');
    const resultDisplay = document.getElementById('resultDisplay');
    if (input) input.value = '';
    if (resultDisplay) resultDisplay.innerHTML = '';
    if (input) input.focus();
}

// Main search function
async function searchDictionary() {
    const searchInput = document.getElementById('dictionarySearchInput').value.trim();
    const resultDisplay = document.getElementById('resultDisplay');

    resultDisplay.innerHTML = '';

    if (!searchInput || !processedDictionary) {
        resultDisplay.innerText = !searchInput ?
            'Please enter search terms' :
            'Dictionary is still loading — try again in a moment.';
        return;
    }

    try {
        const regex = getSearchRegex(searchInput);
        const matches = [];

        // Use requestAnimationFrame for non-blocking search
        await new Promise(resolve => {
            requestAnimationFrame(() => {
                for (const line of processedDictionary) {
                    if (regex.exact.test(line) || regex.loose.test(line)) {
                        let highlightedLine = line.replace(regex.highlight,
                            '<span class="highlight">$1</span>'
                        );
                        matches.push(processLineSegments(highlightedLine));
                    }
                }
                resolve();
            });
        });

        resultDisplay.innerHTML = matches.length ?
            `<div class="result-header">Found ${matches.length} matches:</div>
             <div class="result-matches">${matches.join('<hr class="result-separator">')}</div>` :
            'No matching lines found.';

    } catch (error) {
        console.error('Error during search:', error);
        resultDisplay.innerText = 'Error searching dictionary';
    }
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', initializeApp);
