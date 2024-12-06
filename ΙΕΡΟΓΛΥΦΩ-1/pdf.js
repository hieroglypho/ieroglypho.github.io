// Get canvas objects
const objects = canvas.getObjects();
const pdf = new jsPDF({
    orientation: 'landscape',
    unit: 'pt',
    format: [canvas.width, canvas.height]
});

// First add background/shapes as image
const bgData = canvas.toDataURL({
    format: 'png',
    // Filter out text objects when creating background image
    filter: obj => !(obj instanceof fabric.Text)
});
pdf.addImage(bgData, 'PNG', 0, 0, canvas.width, canvas.height);

// Then add text objects as actual PDF text
objects.forEach(obj => {
    if (obj instanceof fabric.Text) {
        const bounds = obj.getBoundingRect();
        pdf.setFontSize(obj.fontSize);
        
        // Convert fabric rotation (in degrees) to radians
        const rotation = obj.angle * Math.PI / 180;
        
        pdf.setTextMatrix(
            Math.cos(rotation),
            Math.sin(rotation),
            -Math.sin(rotation),
            Math.cos(rotation),
            bounds.left,
            bounds.top + obj.fontSize // Adjust Y for baseline
        );
        
        pdf.text(obj.text, bounds.left, bounds.top + obj.fontSize);
    }
});

pdf.save('canvas.pdf');