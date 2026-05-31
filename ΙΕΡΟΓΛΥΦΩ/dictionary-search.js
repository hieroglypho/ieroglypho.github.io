// Cache for processed data and regex
let processedDictionary = null;
let cachedRegex = { input: '', exact: null, loose: null };

// IndexedDB persistence for the uploaded dictionary so the user doesn't
// need to re-upload on every session.
const DICT_DB = 'hieroDict';
const DICT_STORE = 'files';
const DICT_KEY = 'lastDictionary';

function openDictDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DICT_DB, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(DICT_STORE);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function saveDictToDB(name, content) {
    try {
        const db = await openDictDB();
        await new Promise((resolve, reject) => {
            const tx = db.transaction(DICT_STORE, 'readwrite');
            tx.objectStore(DICT_STORE).put({ name, content, savedAt: Date.now() }, DICT_KEY);
            tx.oncomplete = resolve;
            tx.onerror = () => reject(tx.error);
        });
        db.close();
    } catch (e) {
        console.warn('Could not cache dictionary:', e);
    }
}

async function loadDictFromDB() {
    try {
        const db = await openDictDB();
        const record = await new Promise((resolve, reject) => {
            const tx = db.transaction(DICT_STORE, 'readonly');
            const req = tx.objectStore(DICT_STORE).get(DICT_KEY);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
        db.close();
        return record || null;
    } catch (e) {
        console.warn('Could not read cached dictionary:', e);
        return null;
    }
}

// Trigger file input
function triggerFileInput() {
    document.getElementById('dictionaryFileInput').click();
}

// Initialize the application
function initializeApp() {
    initializeFileUpload();
    initializeSearchListeners();
    initializeResultsResizer();
    restoreCachedDictionary();
}

async function restoreCachedDictionary() {
    const record = await loadDictFromDB();
    if (!record || !record.content) return;
    processedDictionary = record.content.split('\n');
    const fileStatus = document.getElementById('fileStatus');
    const searchButton = document.querySelector('.search-button');
    if (fileStatus) {
        fileStatus.textContent =
            `Loaded (cached): ${record.name} (${processedDictionary.length.toLocaleString()} lines)`;
    }
    if (searchButton) searchButton.disabled = false;
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

// File upload initialization
function initializeFileUpload() {
    const fileInput = document.getElementById('dictionaryFileInput');
    const fileStatus = document.getElementById('fileStatus');
    const searchButton = document.querySelector('.search-button');
    
    fileInput.addEventListener('change', handleFileUpload);
    searchButton.disabled = true;
}

// Handle file upload
async function handleFileUpload(event) {
    const file = event.target.files[0];
    const fileStatus = document.getElementById('fileStatus');
    const searchButton = document.querySelector('.search-button');
    
    if (!file) return;
    
    try {
        fileStatus.textContent = 'Loading dictionary...';
        const content = await file.text();
        processedDictionary = content.split('\n');
        fileStatus.textContent = `Loaded: ${file.name} (${processedDictionary.length.toLocaleString()} lines)`;
        searchButton.disabled = false;
        saveDictToDB(file.name, content);
    } catch (error) {
        console.error('Error loading file:', error);
        fileStatus.textContent = 'Error loading dictionary file';
        searchButton.disabled = true;
        processedDictionary = null;
    }
}

// Initialize search listeners
function initializeSearchListeners() {
    const searchInput = document.getElementById('dictionarySearchInput');
    searchInput.addEventListener('keydown', handleSearchKeydown);
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
            return segment.replace(/([^\x00-\x7F]+)/g, '<span class="large-text">$1</span>');
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
            'Please upload a dictionary file first';
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