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
            totalLines = content.split('\n').length;  // Count the lines
            fileStatus.textContent = `Loaded: ${file.name} (${totalLines.toLocaleString()} lines)`;
            
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
        
        // Create a single regex pattern that matches the exact sequence of characters
        const searchPattern = searchInput.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const searchRegex = new RegExp(searchPattern, 'u');

        const matchingLines = lines.filter(line => {
            return searchRegex.test(line);
        }).map(line => {
            let highlightedLine = line;
            
            // Highlight the exact sequence
            const regex = new RegExp(`(${searchPattern})`, 'gu');
            highlightedLine = highlightedLine.replace(regex, '<span class="highlight">$1</span>');

            // Process line segments for time tags and other special text
            let segments = highlightedLine.split(/(<time>[^<]+<\/time>|<i>[^<]+<\/i>)/);
            
            segments = segments.map(segment => {
                if (segment.startsWith('<time>') && segment.endsWith('</time>')) {
                    return segment;
                } else if (segment.startsWith('<i>') && segment.endsWith('</i>')) {
                    return segment;
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