/*!
 * ΙΕΡΟΓΛΥΦΩ editor — editor-init (part 7 of 7)
 *
 * Classic <script defer>; shares globals with the other editor scripts via the
 * global lexical environment. Do NOT convert to type="module" (inline onclick=
 * handlers need these functions global). Load order:
 *   editor-core → canvas-interactions → workspace → export → drawing-tools → glyph-input → editor-init
 *
 * @copyright Copyright (c) 2024 Massimo Mazzon. All rights reserved.
 */

// =============================================================================
// DOM event wiring (search, help overlay, dropdown)
// =============================================================================

document.getElementById("dropdownButton").addEventListener("click", () => {
    const content = document.getElementById("dropdownContent");
    content.style.display = content.style.display === "block" ? "none" : "block";
});

document.getElementById('help').addEventListener('click', function () {
    var helpOverlay = document.getElementById('helpOverlay');
    helpOverlay.style.display = helpOverlay.style.display === 'flex' ? 'none' : 'flex';
});

// Help content: Click outside iframe to close
document.getElementById('helpOverlay').addEventListener('click', function (e) {
    if (e.target === this) { // Only if clicking outside the iframe
        this.style.display = 'none';
    }
});
document.getElementById('searchInput').addEventListener('input', (e) => {
    // Filter and display characters based on the search query
    filterAndDisplayCharacters(characters, e.target.value);
});
// Save / Open / Wiki are wired up inside the main file menu init above.

//============================ Adds char to Gardiner field ===================
function initCharDragstart() {
    const container = document.getElementById('charListContainer');
    container.addEventListener('dragstart', (event) => {
        // Check if className exists and is a string
        if (event.target.className && typeof event.target.className === 'string' &&
            event.target.className.includes('char-container')) {
            event.dataTransfer.setData('text/plain', event.target.querySelector('.char').textContent);
        }
    }, false);

    // Click-to-select: highlight the clicked palette cell, clearing any prior
    // selection. Selection is purely visual — drag and existing add-to-canvas
    // flows are unaffected.
    container.addEventListener('click', (event) => {
        const cell = event.target.closest('.char-container');
        if (!cell || !container.contains(cell)) return;
        const prev = container.querySelector('.char-container.selected');
        if (prev === cell) return;
        if (prev) prev.classList.remove('selected');
        cell.classList.add('selected');
    });
}
// =============================================================================
// Background image
// =============================================================================
canvas.on('selection:created', function (e) {
    const selectedObject = e.selected && e.selected[0];
    if (selectedObject && selectedObject.type === 'image' && !selectedObject.selectable) {
        canvas.discardActiveObject();
        canvas.sendToBack(selectedObject);
        canvas.requestRenderAll();
    }
});
function initBackgroundImage() {
    const opacitySlider = document.getElementById('bgOpacity');
    const opacityValue = document.getElementById('opacityValue');

    if (opacitySlider && opacityValue) {
        opacitySlider.addEventListener('input', function () {
            const opacity = this.value / 100;
            // Get all image objects from canvas
            const images = canvas.getObjects().filter(obj => obj.type === 'image');

            // Update opacity for all background images
            images.forEach(img => {
                img.set('opacity', opacity);
            });

            // Update the display value
            opacityValue.textContent = `${this.value}%`;

            // Render the canvas to show changes
            canvas.requestRenderAll();
        });
    }
    const bgImageInput = document.getElementById('bgImageInput');

    // Function to handle image loading
    function handleImageLoad(imageUrl) {
    // Create a new fabric Image object from the URL
    fabric.Image.fromURL(imageUrl, function(img) {
        // Get the original image dimensions
        const imgWidth = img.width;
        const imgHeight = img.height;
        
        // Calculate appropriate scaling to fit within the canvas
        // Using 80% of the canvas size to leave some padding
        const scale = Math.min(
            (canvas.width / imgWidth) * 0.8,
            (canvas.height / imgHeight) * 0.8
        );

        // Configure the image properties
        img.set({
            left: canvas.width / 2,
            top: canvas.height / 2,
            originX: 'center',
            originY: 'center',
            scaleX: scale,
            scaleY: scale,
            id: generateUniqueId()
        });

        // Add the image to the canvas
        canvas.add(img);
        
        // Send the image to the back of all other objects
        canvas.sendToBack(img);
        
        // Redraw grid if it exists
        if (typeof drawGrid === 'function') {
            drawGrid();
        }

        // Add to undo history
        undoHistory.push({
            type: 'add',
            object: img.toJSON(['id']),
            id: img.id
        });

        canvas.requestRenderAll();
    });
}
    // Background image handling
// Background image handling with privacy safeguards
bgImageInput.addEventListener('change', function (e) {
    const file = e.target.files[0];
    
    // Validate file type before processing
    if (!file.type.startsWith('image/')) {
        console.error('Please select an image file');
        bgImageInput.value = '';
        return;
    }

    // Use the file directly as an object URL — no FileReader needed.
    const tempUrl = URL.createObjectURL(file);
    handleImageLoad(tempUrl);
    setTimeout(() => URL.revokeObjectURL(tempUrl), 1000);
    bgImageInput.value = '';
});

// Add these attributes to your input element for additional security
bgImageInput.setAttribute('accept', 'image/*');
bgImageInput.setAttribute('capture', 'environment');

    // Modified remove background function
    window.removeBackground = function () {
        const activeObject = canvas.getActiveObject();
        if (activeObject && activeObject.type === 'image') {
            // Store the removal in undo history
            undoHistory.push({
                type: 'delete',
                object: activeObject.toJSON(['id']),
                id: activeObject.id
            });

            // Remove the image
            canvas.remove(activeObject);
            canvas.requestRenderAll();
        }
    };
}

// =============================================================================
// DOM ready dispatcher — single entry point for all init.
// =============================================================================
document.addEventListener('DOMContentLoaded', () => {
    initKeyboardAndSearch();
    initMainMenu();
    initCharDragstart();
    initBackgroundImage();
    initColorPopup();
    initPaletteResizer();
    initResultsResizer();
    initCanvasContextMenu();
    initBlockLinkage();
});

// Replace the browser's default right-click menu on the canvas with one whose
// Save/Copy entries actually capture the composed image (Fabric pixels +
// background image). The browser default only sees Fabric's transparent
// upper-canvas, so its "Save image"/"Copy image" entries are misleading.
function initCanvasContextMenu() {
    const menu = document.getElementById('canvasCtxMenu');
    const workspace = document.getElementById('workspaceContainer');
    if (!menu || !workspace) return;

    const open = (clientX, clientY) => {
        // Show off-screen first so we can measure, then clamp into viewport.
        menu.style.left = '-9999px';
        menu.style.top = '-9999px';
        menu.classList.remove('hidden');
        const rect = menu.getBoundingClientRect();
        const x = Math.min(clientX, window.innerWidth - rect.width - 4);
        const y = Math.min(clientY, window.innerHeight - rect.height - 4);
        menu.style.left = Math.max(4, x) + 'px';
        menu.style.top = Math.max(4, y) + 'px';
    };
    const close = () => menu.classList.add('hidden');

    workspace.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        open(e.clientX, e.clientY);
    });

    menu.addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-action]');
        if (!btn) return;
        e.stopPropagation();
        close();
        switch (btn.dataset.action) {
            case 'copy': copyCanvasImage(); break;
            case 'png':  saveToPNG();       break;
            case 'svg':  saveToSVG();       break;
            case 'pdf':  saveToPDF();       break;
        }
    });

    // Dismiss on outside click, scroll, resize, or Escape.
    document.addEventListener('click', (e) => {
        if (!menu.contains(e.target)) close();
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
}

// Drag the left edge of #searchContainer to widen the Gardiner palette.
// Width is stored on :root as --palette-w and persisted in localStorage.
// The Fabric canvas is resized to fill the remaining space.
function initPaletteResizer() {
    const handle = document.getElementById('paletteResizer');
    const panel = document.getElementById('searchContainer');
    const container = document.querySelector('.container');
    if (!handle || !panel || !container) return;

    const MIN_W = 280;
    const clampW = (w) => {
        const max = Math.max(MIN_W, Math.floor(window.innerWidth * 0.8));
        return Math.min(max, Math.max(MIN_W, w));
    };

    function applyW(w) {
        document.documentElement.style.setProperty('--palette-w', w + 'px');
        if (typeof canvas !== 'undefined' && canvas && canvas.setDimensions) {
            const d = getCanvasDimensions();
            canvas.setDimensions({ width: d.width, height: d.height }, { cssOnly: false });
            try { clearExistingGrid(); drawGrid(); } catch (_) { }
            const zoom = canvas.getZoom();
            const vpt = canvas.viewportTransform;
            canvas.setViewportTransform([zoom, 0, 0, zoom, vpt[4], vpt[5]]);
            canvas.requestRenderAll();
        }
        try { updateDivWidth(); } catch (_) { }
    }

    // Restore + clamp the saved width, then re-run the canvas-resize path so
    // the Fabric pixel buffer (initialized earlier against the default palette
    // width) is brought in line with the restored width. Without this, on
    // reload the canvas stays too wide and pushes the palette off-screen until
    // any subsequent window-resize event fires.
    const saved = parseInt(localStorage.getItem('paletteW'), 10);
    if (saved > 0) applyW(clampW(saved));

    // If the window shrinks below current palette + min canvas room, clamp.
    window.addEventListener('resize', () => {
        const cur = parseInt(getComputedStyle(panel).width, 10);
        if (cur > 0) {
            const clamped = clampW(cur);
            if (clamped !== cur) applyW(clamped);
        }
    });

    let dragging = false;
    let rafPending = false;
    let pendingW = 0;

    handle.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        dragging = true;
        try { handle.setPointerCapture(e.pointerId); } catch (_) { }
        document.body.style.cursor = 'ew-resize';
    });

    handle.addEventListener('pointermove', (e) => {
        if (!dragging) return;
        const rect = container.getBoundingClientRect();
        pendingW = clampW(rect.right - e.clientX);
        if (!rafPending) {
            rafPending = true;
            requestAnimationFrame(() => {
                rafPending = false;
                applyW(pendingW);
            });
        }
    });

    function endDrag(e) {
        if (!dragging) return;
        dragging = false;
        try { handle.releasePointerCapture(e.pointerId); } catch (_) { }
        document.body.style.cursor = '';
        try {
            const cur = parseInt(getComputedStyle(panel).width, 10);
            if (cur > 0) localStorage.setItem('paletteW', String(cur));
        } catch (_) { }
    }
    handle.addEventListener('pointerup', endDrag);
    handle.addEventListener('pointercancel', endDrag);
}

// Wire up the horizontal bar between the char list and the dictionary panel.
// Drag down to grow the char list, up to grow the dictionary results.
function initResultsResizer() {
    const handle = document.getElementById('resultsResizer');
    const list = document.getElementById('charListContainer');
    if (!handle || !list) return;

    const saved = parseInt(localStorage.getItem('charListH'), 10);
    if (saved > 0) {
        list.style.height = saved + 'px';
        list.style.minHeight = '0';
        list.style.flexShrink = '1';
    }

    let dragging = false;
    handle.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        dragging = true;
        try { handle.setPointerCapture(e.pointerId); } catch (_) { }
        document.body.style.cursor = 'ns-resize';
    });
    handle.addEventListener('pointermove', (e) => {
        if (!dragging) return;
        const rect = list.getBoundingClientRect();
        const newH = Math.max(120, e.clientY - rect.top);
        list.style.height = newH + 'px';
        list.style.minHeight = '0';
        list.style.flexShrink = '1';
    });
    function endDrag(e) {
        if (!dragging) return;
        dragging = false;
        try { handle.releasePointerCapture(e.pointerId); } catch (_) { }
        document.body.style.cursor = '';
        try {
            const h = parseInt(list.style.height, 10);
            if (h > 0) localStorage.setItem('charListH', String(h));
        } catch (_) { }
    }
    handle.addEventListener('pointerup', endDrag);
    handle.addEventListener('pointercancel', endDrag);
}

// =============================================================================
// Background color popup
// =============================================================================
function toggleColorPopup(e) {
    e?.stopPropagation();
    const popup = document.getElementById('colorPopup');
    popup.style.display = popup.style.display === 'none' ? 'block' : 'none';
}

function setCanvasColor(color) {
    canvas.setBackgroundColor(color, canvas.renderAll.bind(canvas));
    document.getElementById('colorPopup').style.display = 'none';
}

function initColorPopup() {
    // Close popup when clicking anywhere outside it (matches the main-menu pattern).
    // The 🎨 button's onclick calls stopPropagation, so toggling doesn't trigger this.
    document.addEventListener('click', (e) => {
        const popup = document.getElementById('colorPopup');
        if (popup.style.display !== 'none' && !popup.contains(e.target)) {
            popup.style.display = 'none';
        }
    });
}
// =============================================================================
// Layout & window lifecycle (resize, beforeunload, keybindings)
// =============================================================================
function updateDivWidth() {
    const canvasWidth = getCanvasDimensions().width;
    document.getElementById('pastedNamesContainer').style.width = `${canvasWidth}px`;
}

// Set initial width
updateDivWidth();

// Update on window resize

window.addEventListener('load', () => {
    // Skip the "maximize your window" nag in drawer mode — a phone/tablet can't
    // maximize and the message is desktop-only advice.
    if (typeof isDrawerMode === 'function' && isDrawerMode()) return;
    if (window.outerWidth < screen.availWidth) alert('Please maximize your window for the best experience');
});

// --- Off-canvas palette drawer (Track 1) -----------------------------------
// Wires the floating toggle button + scrim to a `body.palette-open` class.
// The drawer is an overlay, so opening/closing it does NOT change canvas width
// (getCanvasDimensions already returns full width in drawer mode) — no reflow
// needed here. Crossing the breakpoint fires `resize`, which reflows the canvas.
(function initPaletteDrawer() {
    const toggle = document.getElementById('paletteToggle');
    const scrim = document.getElementById('paletteScrim');
    if (!toggle) return;
    const close = () => document.body.classList.remove('palette-open');
    toggle.addEventListener('click', () => document.body.classList.toggle('palette-open'));
    if (scrim) scrim.addEventListener('click', close);
    // Leaving drawer mode (e.g. rotate to wide / desktop) clears the open state
    // so the palette returns to its normal in-flow column.
    window.matchMedia('(max-width: ' + (typeof DRAWER_BREAKPOINT !== 'undefined' ? DRAWER_BREAKPOINT : 899) + 'px)')
        .addEventListener('change', (e) => { if (!e.matches) close(); });
})();
window.addEventListener('resize', function () {
    // Clear the timeout if it exists
    if (resizeTimeout) {
        clearTimeout(resizeTimeout);
    }

    // Set a timeout to prevent excessive resizing
    resizeTimeout = setTimeout(function () {
        // Get new dimensions
        const dimensions = getCanvasDimensions();

        // Update canvas dimensions
        canvas.setDimensions({
            width: dimensions.width,
            height: dimensions.height
        }, {
            cssOnly: false
        });

        // Recalculate the grid
        clearExistingGrid();
        drawGrid();

        // Keep the page-size guide centred in the resized canvas
        if (typeof repositionPageGuide === 'function') repositionPageGuide();

        // Update viewport transform to maintain zoom and pan
        const zoom = canvas.getZoom();
        const vpt = canvas.viewportTransform;
        canvas.setViewportTransform([
            zoom, 0, 0, zoom,
            vpt[4], vpt[5]
        ]);

        // Force a full re-render
        canvas.requestRenderAll();
    }, 200); // 200ms delay to debounce resize events
});

// Add window beforeunload event
window.addEventListener('beforeunload', function (e) {
    if (canvasModified) {
        e.preventDefault();
        // Most modern browsers ignore custom messages and show their own
        return e.returnValue = 'You have unsaved changes. Are you sure you want to leave?';
    }
});
// document.addEventListener('contextmenu', event => event.preventDefault());

window.addEventListener('keydown', function (e) {
    const activeObject = canvas.getActiveObject();
    const activeGroup = canvas.getActiveObjects();
    // Skip delete-from-canvas when focus is in any text field — input,
    // textarea, or contenteditable. Prevents Backspace inside dialog inputs
    // from nuking the selected canvas object.
    const tag = (e.target.tagName || '').toLowerCase();
    const isInTextField = tag === 'input' || tag === 'textarea' || e.target.isContentEditable;

    // Utility to display feedback
    const showIndicator = (message) => {
        const indicator = document.createElement('div');
        indicator.textContent = message;
        indicator.style.cssText = `
            position: fixed;
            bottom: 20px;
            right: 20px;
            background: rgba(0,0,0,0.8);
            color: white;
            padding: 8px 16px;
            border-radius: 4px;
            z-index: 1000;
        `;
        document.body.appendChild(indicator);
        setTimeout(() => indicator.remove(), 2000);
    };

    // Cycle through objects (Ctrl + Arrow Keys)
    if (e.ctrlKey && ['ArrowRight', 'ArrowLeft'].includes(e.key)) {
        e.preventDefault();
        // Skip the page guide — it's a non-content overlay, never selectable.
        const objects = canvas.getObjects().filter(o => !o._pageGuide);
        if (!objects.length) return;
        let currentIndex = objects.indexOf(activeObject);

        currentIndex = (e.key === 'ArrowRight')
            ? (currentIndex + 1) % objects.length
            : (currentIndex - 1 + objects.length) % objects.length;

        canvas.setActiveObject(objects[currentIndex]);
        canvas.requestRenderAll();
        return;
    }

    // Lock/unlock objects (Ctrl + L)
    if (e.ctrlKey && (e.key.toLowerCase() === 'l')) {
        e.preventDefault();
        const selectedObjects = canvas.getActiveObjects();
        const objects = canvas.getObjects();

        const lockObject = (obj) => {
            if (!obj.locked) {
                obj._originalProps = {
                    selectable: obj.selectable,
                    evented: obj.evented,
                    hasControls: obj.hasControls,
                    hasBorders: obj.hasBorders,
                    lockMovementX: obj.lockMovementX,
                    lockMovementY: obj.lockMovementY,
                    lockRotation: obj.lockRotation,
                    lockScalingX: obj.lockScalingX,
                    lockScalingY: obj.lockScalingY,
                };
                obj.set({
                    selectable: false,
                    evented: false,
                    hasControls: false,
                    hasBorders: false,
                    lockMovementX: true,
                    lockMovementY: true,
                    lockRotation: true,
                    lockScalingX: true,
                    lockScalingY: true,
                });
                obj.locked = true;
            }
        };

        const unlockObject = (obj) => {
            if (obj.locked && obj._originalProps) {
                obj.set(obj._originalProps);
                delete obj._originalProps;
                obj.locked = false;
            }
        };

        if (!selectedObjects.length) {
            let unlockedCount = 0;
            objects.forEach((obj) => {
                if (obj.locked) {
                    unlockObject(obj);
                    unlockedCount++;
                }
            });
            if (unlockedCount > 0) {
                showIndicator(`Unlocked ${unlockedCount} object${unlockedCount > 1 ? 's' : ''}`);
            }
        } else {
            selectedObjects.forEach((obj) => {
                obj.locked ? unlockObject(obj) : lockObject(obj);
            });
            showIndicator(
                `${selectedObjects.length} object${selectedObjects.length > 1 ? 's' : ''} ${
                    selectedObjects[0].locked ? 'locked' : 'unlocked'
                }`
            );
        }

        canvas.discardActiveObject();
        canvas.requestRenderAll();
        return;
    }

    // Save workspace (Ctrl + S)
    if (e.ctrlKey && (e.key.toLowerCase() === 's')) {
        e.preventDefault();
        saveWorkspace();
        return;
    }

    // Distribute objects equally (Ctrl + D)
    if (e.ctrlKey && (e.key.toLowerCase() === 'd')) {
        e.preventDefault();
        const selectedObjects = canvas.getActiveObjects();
        if (selectedObjects.length < 2) {
            alert("Select at least two objects to distribute them.");
            return;
        }

        // Sort and calculate equal spacing
        selectedObjects.sort((a, b) => a.left - b.left);
        const spacing =
            (selectedObjects[selectedObjects.length - 1].left - selectedObjects[0].left) /
            (selectedObjects.length - 1);

        selectedObjects.forEach((obj, index) => {
            obj.set('left', selectedObjects[0].left + index * spacing);
            obj.setCoords();
        });

        canvas.requestRenderAll();
        return;
    }

    // Delete objects (Delete/Backspace)
    if (!isInTextField && (e.key === 'Delete' || e.key === 'Backspace')) {
        e.preventDefault();
        if (activeGroup.length) {
            activeGroup.forEach(storeAndRemoveCharacter);
        } else if (activeObject) {
            storeAndRemoveCharacter(activeObject);
        }
        canvas.discardActiveObject();
        canvas.requestRenderAll();
        return;
    }

    // Alignment shortcuts
    if (!e.ctrlKey) {
        const alignMap = {
            h: 'horizontal',
            t: 'top',
            b: 'bottom',
            l: 'left',
        };
        if (alignMap[e.key.toLowerCase()]) {
            alignObjects(alignMap[e.key.toLowerCase()]);
            return;
        }
        if (e.key.toLowerCase() === 'r') {
            mirrorTextObject(activeObject);
            return;
        }
    }

    // Move objects with arrow keys
    
    if (!e.ctrlKey && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
        if (activeObject && !activeObject.locked) { // Add check for locked property
            const moveAmount = e.shiftKey ? 1 : 5;
            switch (e.key) {
                case 'ArrowLeft': 
                    activeObject.set('left', activeObject.left - moveAmount); 
                    break;
                case 'ArrowRight': 
                    activeObject.set('left', activeObject.left + moveAmount); 
                    break;
                case 'ArrowUp': 
                    activeObject.set('top', activeObject.top - moveAmount); 
                    break;
                case 'ArrowDown': 
                    activeObject.set('top', activeObject.top + moveAmount); 
                    break;
            }
            activeObject.setCoords();
            canvas.requestRenderAll();
        }
    }
    
    
        // Undo (Ctrl + Z)
        if (e.ctrlKey && e.key.toLowerCase() === 'z') {
            undoLastAction();
            return;
        }
    });
