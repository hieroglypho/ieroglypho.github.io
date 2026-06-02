// Cache for processed data and regex
let processedDictionary = null;
let cachedRegex = { input: '', exact: null, loose: null };

// The dictionary is bundled with the app and loaded automatically — there is no
// user upload. It lives at the site root; the editor sits one level down in
// ΙΕΡΟΓΛΥΦΩ/, hence the '../'.
const DICT_URL = '../dictionary.txt';

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

// Get or create regex patterns
function getSearchRegex(searchInput) {
    if (searchInput === cachedRegex.input) {
        return cachedRegex;
    }

    const terms = searchInput.split(/\s+/);
    const escapedTerms = terms.map(term =>
        term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    );

    const exactPattern = escapedTerms.join('[\s-]*');
    const loosePattern = escapedTerms
        .map(term => `(?=.*${term})`)
        .join('');

    cachedRegex = {
        input: searchInput,
        exact: new RegExp(exactPattern, 'iu'),
        loose: new RegExp(loosePattern, 'iu'),
        highlight: new RegExp(`(${escapedTerms.join('|')})`, 'giu')
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
            return segment.replace(/([^\x00-\x7F]+)/g, '<span class="large-text" title="Click to add these signs to the canvas">$1</span>');
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
