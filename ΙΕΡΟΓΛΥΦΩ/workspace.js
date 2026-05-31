/*!
 * ΙΕΡΟΓΛΥΦΩ editor — workspace (part 3 of 7)
 *
 * Classic <script defer>; shares globals with the other editor scripts via the
 * global lexical environment. Do NOT convert to type="module" (inline onclick=
 * handlers need these functions global). Load order:
 *   editor-core → canvas-interactions → workspace → export → drawing-tools → glyph-input → editor-init
 *
 * @copyright Copyright (c) 2024 Massimo Mazzon. All rights reserved.
 */


// Save and Load
function saveWorkspace() {
    try {
        // Get canvas objects excluding grid and the (non-content) page guide
        const objects = canvas.getObjects().filter(obj => !obj.isGridGroup && !obj.grid && !obj._pageGuide);

        // Get background image state if it exists
        const bgImage = document.getElementById('bgImage');
        const bgImageState = bgImage ? {
            src: bgImage.src,
            opacity: bgImage.style.opacity || 0.5,
            transform: bgImage.style.transform,
            display: bgImage.style.display,
            offsetX: bgImage.offsetLeft || 0,
            offsetY: bgImage.offsetTop || 0,
            // Extract scale from transform string
            scale: (bgImage.style.transform.match(/scale\(([\d.]+)\)/) || [null, 1])[1]
        } : null;

        // Preserve app-level custom properties on each object so reload
        // reconstitutes link state, glyph-run marker, etc.
        const CUSTOM_PROPS = ['id', 'characterKey', 'isGlyphTextRun', 'blockId', 'blockRow'];

        // Create workspace object with canvas state, names, and background
        const workspace = {
            canvas: {
                ...canvas.toJSON(CUSTOM_PROPS),
                objects: objects.map(obj => obj.toJSON(CUSTOM_PROPS))
            },
            pastedNames: Array.from(document.getElementById('pastedNames')?.children || [])
                .map(span => ({
                    id: span.id.replace('name-', ''),
                    text: span.textContent.replace(', ', '')
                })),
            backgroundImage: bgImageState
        };

        // Create and trigger download
        const blob = new Blob([JSON.stringify(workspace, null, 2)], {
            type: 'application/json'
        });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = 'workspace.json';
        link.click();
        URL.revokeObjectURL(link.href);

        // Show success message
        const indicator = document.createElement('div');
        indicator.textContent = 'Saved!';
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

    } catch (error) {
        console.error('Error saving workspace:', error);
        alert('Error saving workspace');
    }
}

function syncPastedNamesWithCanvas() {
    const pastedNames = document.getElementById('pastedNames');
    if (!pastedNames) {
        console.error('pastedNames container not found');
        return;
    }

    const canvasObjects = canvas.getObjects();
    console.log('Canvas objects:', canvasObjects);
    console.log('Canvas objects with characterKey:', canvasObjects.filter(obj => obj.characterKey));

    pastedNames.innerHTML = '';

    canvasObjects.forEach(obj => {
        if (obj.characterKey) {
            const span = document.createElement('span');
            span.id = `name-${obj.id}`;
            span.textContent = `${obj.characterKey} - `;
            pastedNames.appendChild(span);
            console.log('Added span for:', obj.characterKey);
        }
    });
}
function loadWorkspace() {
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.json';

    fileInput.onchange = async (event) => {
        const file = event.target.files[0];
        if (!file) return;

        try {
            // Read and parse file
            const jsonContent = await file.text();
            const workspace = JSON.parse(jsonContent);
            const canvasData = workspace.canvas || workspace;

            // Clear existing content
            canvas.clear();
            const pastedNames = document.getElementById('pastedNames');
            if (pastedNames) pastedNames.innerHTML = '';

            // Filter out grid objects
            if (canvasData.objects) {
                canvasData.objects = canvasData.objects.filter(obj =>
                    !obj.isGridGroup && !obj.grid
                );
            }

            // Load canvas data
            canvas.loadFromJSON(canvasData, () => {
                // Restore viewport transform
                // Restore characterKey for each object
                canvas.getObjects().forEach((obj, index) => {
                    if (workspace.pastedNames[index]) {
                        obj.characterKey = workspace.pastedNames[index].text.replace(' - ', '');
                    }
                });
                if (canvasData.viewportTransform) {
                    canvas.setViewportTransform(canvasData.viewportTransform);
                }

                // loadFromJSON rebuilt the canvas, dropping the page guide;
                // re-apply it if it was showing so the toggle stays in sync.
                if (typeof pageGuideState !== 'undefined' && pageGuideState !== 'off') {
                    pageGuideObj = null;
                    setPageGuide(pageGuideState);
                }

                // Restore background image if it exists
                if (workspace.backgroundImage) {
                    const bgImage = document.getElementById('bgImage');
                    if (bgImage) {
                        bgImage.src = workspace.backgroundImage.src;
                        bgImage.style.opacity = workspace.backgroundImage.opacity;
                        bgImage.style.transform = workspace.backgroundImage.transform;
                        bgImage.style.display = workspace.backgroundImage.display;

                        // Restore global offset variables
                        bgOffsetX = workspace.backgroundImage.offsetX || 0;
                        bgOffsetY = workspace.backgroundImage.offsetY || 0;

                        // // Update zoom slider if it exists
                        // const zoomSlider = document.getElementById('bgZoom');
                        // if (zoomSlider) {
                        //     const scale = parseFloat(workspace.backgroundImage.scale) || 1;
                        //     zoomSlider.value = scale * 100;
                        // }

                        // Update opacity slider if it exists
                        const opacitySlider = document.getElementById('bgOpacity');
                        if (opacitySlider) {
                            const opacity = parseFloat(workspace.backgroundImage.opacity) || 0.5;
                            opacitySlider.value = opacity * 100;
                        }
                    }
                }

                // Restore pasted names
                if (workspace.pastedNames?.length) {
                    workspace.pastedNames.forEach(({ id, text }) => {
                        if (text) {
                            const span = document.createElement('span');
                            span.id = `name-${id || Date.now()}`;
                            span.textContent = text;
                            pastedNames?.appendChild(span);
                        }
                    });
                }

                // Final rendering
                canvas.getObjects()
                    .filter(obj => obj.type === 'group')
                    .forEach(obj => obj.setCoords());

                drawGrid();
                canvas.requestRenderAll();
                console.log('Final canvas objects:', canvas.getObjects());
                console.log('PastedNames content:', pastedNames?.innerHTML);
                syncPastedNamesWithCanvas();
                if (pastedNames && canvas.getObjects().length !== pastedNames.children.length) {
                    console.warn('Mismatch between canvas objects and pasted names');
                }
                canvas.requestRenderAll();
            });

        } catch (error) {
            console.error('Error loading workspace:', error);
            alert('Error loading workspace file');
        }
    };

    // Trigger file selection
    fileInput.click();
}

