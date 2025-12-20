/**
 * Flash Image Editor
 * Редактор аватаров и баннеров в стиле Discord
 */

const ImageEditor = {
    // State
    canvas: null,
    ctx: null,
    image: null,
    type: 'avatar', // 'avatar' or 'banner'
    
    // Transform state
    scale: 1,
    minScale: 0.1,
    maxScale: 3,
    offsetX: 0,
    offsetY: 0,
    
    // Drag state
    isDragging: false,
    dragStartX: 0,
    dragStartY: 0,
    lastOffsetX: 0,
    lastOffsetY: 0,
    
    // History for undo/redo
    history: [],
    historyIndex: -1,
    
    // Callbacks
    onSave: null,
    onCancel: null,

    /**
     * Open editor with file
     */
    open(file, type, onSave, onCancel) {
        this.type = type;
        this.onSave = onSave;
        this.onCancel = onCancel;
        
        // Reset state
        this.scale = 1;
        this.offsetX = 0;
        this.offsetY = 0;
        this.history = [];
        this.historyIndex = -1;
        
        // Load image
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                this.image = img;
                this.showModal();
                this.initCanvas();
                this.fitImageToCanvas();
                this.saveState();
                this.render();
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    },

    /**
     * Show modal
     */
    showModal() {
        const modal = document.getElementById('image-editor-modal');
        const title = document.getElementById('editor-title');
        
        title.textContent = this.type === 'avatar' 
            ? 'Редактировать аватар' 
            : 'Редактировать баннер';
        
        modal.classList.add('show');
        
        // Update canvas container class
        const container = document.getElementById('editor-canvas-container');
        container.className = 'editor-canvas-container ' + (this.type === 'avatar' ? 'avatar-mode' : 'banner-mode');
    },

    /**
     * Hide modal
     */
    hideModal() {
        const modal = document.getElementById('image-editor-modal');
        modal.classList.remove('show');
    },

    /**
     * Initialize canvas
     */
    initCanvas() {
        this.canvas = document.getElementById('editor-canvas');
        this.ctx = this.canvas.getContext('2d');
        
        const container = document.getElementById('editor-canvas-container');
        const rect = container.getBoundingClientRect();
        
        // Set canvas size
        this.canvas.width = rect.width;
        this.canvas.height = rect.height;
        
        // Bind events
        this.bindEvents();
    },

    /**
     * Fit image to canvas initially
     */
    fitImageToCanvas() {
        if (!this.image) return;
        
        // Calculate minimum scale to cover crop area
        const minForCrop = this.getMinScaleForCrop();
        
        // Set initial scale slightly larger than minimum
        this.scale = minForCrop * 1.2;
        this.maxScale = minForCrop * 5;
        
        // Center image
        this.offsetX = 0;
        this.offsetY = 0;
        
        // Ensure bounds are respected
        this.clampOffset();
        
        // Update slider
        this.updateSlider();
    },

    /**
     * Bind canvas events
     */
    bindEvents() {
        const canvas = this.canvas;
        
        // Remove old listeners
        canvas.onmousedown = null;
        canvas.onmousemove = null;
        canvas.onmouseup = null;
        canvas.onmouseleave = null;
        canvas.onwheel = null;
        canvas.ontouchstart = null;
        canvas.ontouchmove = null;
        canvas.ontouchend = null;
        
        // Mouse events
        canvas.onmousedown = (e) => this.startDrag(e.clientX, e.clientY);
        canvas.onmousemove = (e) => this.drag(e.clientX, e.clientY);
        canvas.onmouseup = () => this.endDrag();
        canvas.onmouseleave = () => this.endDrag();
        
        // Wheel zoom
        canvas.onwheel = (e) => {
            e.preventDefault();
            const delta = e.deltaY > 0 ? -0.05 : 0.05;
            this.zoom(delta);
        };
        
        // Touch events
        canvas.ontouchstart = (e) => {
            if (e.touches.length === 1) {
                this.startDrag(e.touches[0].clientX, e.touches[0].clientY);
            }
        };
        canvas.ontouchmove = (e) => {
            if (e.touches.length === 1) {
                e.preventDefault();
                this.drag(e.touches[0].clientX, e.touches[0].clientY);
            }
        };
        canvas.ontouchend = () => this.endDrag();
    },

    /**
     * Get crop area bounds
     */
    getCropBounds() {
        const canvas = this.canvas;
        if (this.type === 'avatar') {
            const radius = Math.min(canvas.width, canvas.height) * 0.35;
            return {
                x: canvas.width / 2 - radius,
                y: canvas.height / 2 - radius,
                w: radius * 2,
                h: radius * 2
            };
        } else {
            const cropW = canvas.width * 0.9;
            const cropH = canvas.height * 0.6;
            return {
                x: (canvas.width - cropW) / 2,
                y: (canvas.height - cropH) / 2,
                w: cropW,
                h: cropH
            };
        }
    },

    /**
     * Clamp offset to keep image covering crop area
     */
    clampOffset() {
        if (!this.image || !this.canvas) return;
        
        const crop = this.getCropBounds();
        const imgW = this.image.width * this.scale;
        const imgH = this.image.height * this.scale;
        
        // Image center position
        const imgCenterX = this.canvas.width / 2 + this.offsetX;
        const imgCenterY = this.canvas.height / 2 + this.offsetY;
        
        // Image bounds
        const imgLeft = imgCenterX - imgW / 2;
        const imgRight = imgCenterX + imgW / 2;
        const imgTop = imgCenterY - imgH / 2;
        const imgBottom = imgCenterY + imgH / 2;
        
        // Crop bounds
        const cropLeft = crop.x;
        const cropRight = crop.x + crop.w;
        const cropTop = crop.y;
        const cropBottom = crop.y + crop.h;
        
        // Calculate max allowed offset
        // Image must cover crop area completely
        const maxOffsetX = (imgW / 2) - (crop.w / 2);
        const maxOffsetY = (imgH / 2) - (crop.h / 2);
        
        // Clamp offsets
        if (maxOffsetX > 0) {
            this.offsetX = Math.max(-maxOffsetX, Math.min(maxOffsetX, this.offsetX));
        } else {
            this.offsetX = 0;
        }
        
        if (maxOffsetY > 0) {
            this.offsetY = Math.max(-maxOffsetY, Math.min(maxOffsetY, this.offsetY));
        } else {
            this.offsetY = 0;
        }
    },

    /**
     * Start dragging
     */
    startDrag(x, y) {
        this.isDragging = true;
        this.dragStartX = x;
        this.dragStartY = y;
        this.lastOffsetX = this.offsetX;
        this.lastOffsetY = this.offsetY;
        this.canvas.style.cursor = 'grabbing';
    },

    /**
     * Drag image
     */
    drag(x, y) {
        if (!this.isDragging) return;
        
        this.offsetX = this.lastOffsetX + (x - this.dragStartX);
        this.offsetY = this.lastOffsetY + (y - this.dragStartY);
        this.clampOffset();
        this.render();
    },

    /**
     * End dragging
     */
    endDrag() {
        if (this.isDragging) {
            this.isDragging = false;
            this.canvas.style.cursor = 'grab';
            this.saveState();
        }
    },

    /**
     * Calculate minimum scale to cover crop area
     */
    getMinScaleForCrop() {
        if (!this.image || !this.canvas) return 0.1;
        
        const crop = this.getCropBounds();
        const scaleX = crop.w / this.image.width;
        const scaleY = crop.h / this.image.height;
        return Math.max(scaleX, scaleY);
    },

    /**
     * Zoom
     */
    zoom(delta) {
        const oldScale = this.scale;
        const minForCrop = this.getMinScaleForCrop();
        const newScale = this.scale + delta * this.scale;
        this.scale = Math.max(minForCrop, Math.min(this.maxScale, newScale));
        
        // Clamp offset after zoom
        this.clampOffset();
        this.updateSlider();
        this.render();
    },

    /**
     * Set scale from slider
     */
    setScale(value) {
        const minForCrop = this.getMinScaleForCrop();
        const range = this.maxScale - minForCrop;
        this.scale = minForCrop + (value / 100) * range;
        this.clampOffset();
        this.render();
    },

    /**
     * Update slider position
     */
    updateSlider() {
        const slider = document.getElementById('editor-zoom-slider');
        if (slider) {
            const minForCrop = this.getMinScaleForCrop();
            const range = this.maxScale - minForCrop;
            const value = ((this.scale - minForCrop) / range) * 100;
            slider.value = Math.max(0, Math.min(100, value));
        }
    },

    /**
     * Render canvas
     */
    render() {
        if (!this.ctx || !this.image) return;
        
        const ctx = this.ctx;
        const canvas = this.canvas;
        const img = this.image;
        
        // Clear
        ctx.fillStyle = '#1a1a2e';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        // Calculate image position
        const imgW = img.width * this.scale;
        const imgH = img.height * this.scale;
        const imgX = (canvas.width - imgW) / 2 + this.offsetX;
        const imgY = (canvas.height - imgH) / 2 + this.offsetY;
        
        // Draw image
        ctx.drawImage(img, imgX, imgY, imgW, imgH);
        
        // Draw overlay with crop hole
        this.drawOverlay();
    },

    /**
     * Draw dark overlay with transparent crop area
     */
    drawOverlay() {
        const ctx = this.ctx;
        const canvas = this.canvas;
        
        // Create overlay
        ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
        
        if (this.type === 'avatar') {
            // Circle crop
            const centerX = canvas.width / 2;
            const centerY = canvas.height / 2;
            const radius = Math.min(canvas.width, canvas.height) * 0.35;
            
            // Draw overlay with circle hole
            ctx.beginPath();
            ctx.rect(0, 0, canvas.width, canvas.height);
            ctx.arc(centerX, centerY, radius, 0, Math.PI * 2, true);
            ctx.fill('evenodd');
            
            // Draw circle border
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
            ctx.stroke();
        } else {
            // Rectangle crop for banner
            const cropW = canvas.width * 0.9;
            const cropH = canvas.height * 0.6;
            const cropX = (canvas.width - cropW) / 2;
            const cropY = (canvas.height - cropH) / 2;
            
            // Draw overlay with rectangle hole
            ctx.beginPath();
            ctx.rect(0, 0, canvas.width, canvas.height);
            ctx.rect(cropX, cropY, cropW, cropH);
            ctx.fill('evenodd');
            
            // Draw rectangle border
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
            ctx.lineWidth = 3;
            ctx.strokeRect(cropX, cropY, cropW, cropH);
        }
    },

    /**
     * Save state for undo
     */
    saveState() {
        // Remove future states if we're not at the end
        if (this.historyIndex < this.history.length - 1) {
            this.history = this.history.slice(0, this.historyIndex + 1);
        }
        
        this.history.push({
            scale: this.scale,
            offsetX: this.offsetX,
            offsetY: this.offsetY
        });
        
        this.historyIndex = this.history.length - 1;
        
        // Limit history
        if (this.history.length > 50) {
            this.history.shift();
            this.historyIndex--;
        }
    },

    /**
     * Undo
     */
    undo() {
        if (this.historyIndex > 0) {
            this.historyIndex--;
            const state = this.history[this.historyIndex];
            this.scale = state.scale;
            this.offsetX = state.offsetX;
            this.offsetY = state.offsetY;
            this.updateSlider();
            this.render();
        }
    },

    /**
     * Reset to initial state
     */
    reset() {
        this.fitImageToCanvas();
        this.saveState();
        this.render();
    },

    /**
     * Export cropped image
     */
    export() {
        if (!this.image) return null;
        
        const outputCanvas = document.createElement('canvas');
        const outputCtx = outputCanvas.getContext('2d');
        
        // Output dimensions
        let outputW, outputH, cropX, cropY, cropW, cropH;
        
        if (this.type === 'avatar') {
            outputW = outputH = 256;
            const radius = Math.min(this.canvas.width, this.canvas.height) * 0.35;
            cropX = this.canvas.width / 2 - radius;
            cropY = this.canvas.height / 2 - radius;
            cropW = cropH = radius * 2;
        } else {
            outputW = 600;
            outputH = 200;
            cropW = this.canvas.width * 0.9;
            cropH = this.canvas.height * 0.6;
            cropX = (this.canvas.width - cropW) / 2;
            cropY = (this.canvas.height - cropH) / 2;
        }
        
        outputCanvas.width = outputW;
        outputCanvas.height = outputH;
        
        // Calculate source coordinates
        const imgW = this.image.width * this.scale;
        const imgH = this.image.height * this.scale;
        const imgX = (this.canvas.width - imgW) / 2 + this.offsetX;
        const imgY = (this.canvas.height - imgH) / 2 + this.offsetY;
        
        // Scale factors
        const scaleX = outputW / cropW;
        const scaleY = outputH / cropH;
        
        // Draw background
        outputCtx.fillStyle = '#1a1a2e';
        outputCtx.fillRect(0, 0, outputW, outputH);
        
        // Draw image portion
        outputCtx.drawImage(
            this.image,
            0, 0, this.image.width, this.image.height,
            (imgX - cropX) * scaleX,
            (imgY - cropY) * scaleY,
            imgW * scaleX,
            imgH * scaleY
        );
        
        return outputCanvas.toDataURL('image/jpeg', 0.92);
    },

    /**
     * Save and close
     */
    save() {
        const base64 = this.export();
        if (base64 && this.onSave) {
            this.onSave(base64, this.type);
        }
        this.hideModal();
    },

    /**
     * Cancel and close
     */
    cancel() {
        if (this.onCancel) {
            this.onCancel();
        }
        this.hideModal();
    }
};

// Export
window.ImageEditor = ImageEditor;
