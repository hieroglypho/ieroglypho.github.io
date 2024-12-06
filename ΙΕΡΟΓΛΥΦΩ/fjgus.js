// Global variable to store the loaded dictionary content
let loadedDictionary = null;

// Function to trigger file input when upload button is clicked
function triggerFileInput() {
    document.getElementById('dictionaryFileInput').click();
}

// Function to handle file upload
function initializeFileUpload() {
    const fileInput = document.getElementById('dictionaryFileInput');
    const fileStatus = document.getElementById('fileStatus');
    const searchButton = document.querySelector('.search-button');

    fileInput.addEventListener('change', async (event) => {
        const file = event.target.files[0];
        if (!file) return;

        try {
            fileStatus.textContent = 'Loading dictionary...';
            const content = await file.text();
            loadedDictionary = content;
            fileStatus.textContent = `loaded: ${file.name}`;
            
            // Enable search functionality
            searchButton.disabled = false;
        } catch (error) {
            fileStatus.textContent = 'Error loading dictionary file';
            console.error('Error loading file:', error);
            searchButton.disabled = true;
        }
    });

    // Initially disable search until dictionary is loaded
    searchButton.disabled = true;
}

// Modified search function to use loaded dictionary
async function searchFygusFile() {
    const searchInput = document.getElementById('fygusSearchInput').value.trim();
    const resultDisplay = document.getElementById('resultDisplay');
    
    // Clear previous results
    resultDisplay.innerHTML = "";
    
    if (!searchInput) {
        resultDisplay.innerText = 'Please enter search terms';
        return;
    }

    if (!loadedDictionary) {
        resultDisplay.innerText = 'Please upload a dictionary file first';
        return;
    }

    try {
        const lines = loadedDictionary.split('\n');
        
        // Clean and prepare search terms
        const searchTerms = searchInput.toLowerCase().split(/\s+/).map(term => 
            term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        );

        const matchingLines = lines.filter(line => {
            const lowerLine = line.toLowerCase();
            return searchTerms.every(term => {
                // Use lookaround assertions instead of word boundaries
                // This matches terms surrounded by spaces, start/end of line, or punctuation
                const regex = new RegExp(`(?:^|\\s|[^\\p{L}\\p{N}])(${term})(?=$|\\s|[^\\p{L}\\p{N}])`, 'iu');
                return regex.test(lowerLine);
            });
        }).map(line => {
            let highlightedLine = line;
            
            // Highlight search terms
            searchTerms.forEach(term => {
                const regex = new RegExp(`(${term})`, 'gi');
                highlightedLine = highlightedLine.replace(regex, '<span class="highlight">$1</span>');
            });

            // Process line segments
            let segments = highlightedLine.split(/(\|[^|]+\|)/);
            
            segments = segments.map(segment => {
                if (segment.startsWith('|') && segment.endsWith('|')) {
                    return segment.replace(/\|(.+)\|/, '|<span class="large-text">$1</span>|');
                } else {
                    return segment.replace(/([^\x00-\x7F]+)/g, '<span class="large-text">$1</span>');
                }
            });
            
            return segments.join('');
        });

        if (matchingLines.length > 0) {
            const div = document.createElement('div');
            div.innerHTML = `
                <div class="result-header">Found ${matchingLines.length} matches:</div>
                <div class="result-matches">
                    ${matchingLines.join('<hr class="result-separator">')}
                </div>
            `;
            resultDisplay.appendChild(div);
        } else {
            resultDisplay.innerText = 'No matching lines found.';
        }
    } catch (error) {
        resultDisplay.innerText = 'Error searching dictionary';
        console.error('Error during search:', error);
    }
}

// Add event listeners for search input
function initializeSearchListeners() {
    const fSearchInput = document.getElementById('fygusSearchInput');
    fSearchInput.addEventListener('keydown', function(e) {
        switch(e.key) {
            case 'Enter':
                searchFygusFile();
                break;
            case 'Backspace':
                e.stopPropagation();
                break;
        }
    });
}

// Initialize everything when the page loads
document.addEventListener('DOMContentLoaded', () => {
    initializeFileUpload();
    initializeSearchListeners();
});