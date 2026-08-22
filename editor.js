document.addEventListener('DOMContentLoaded', async () => {
    // 1. Theme initialization
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'dark' || (!savedTheme && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
        document.body.classList.add('dark-mode');
    }

    // Init Canvas
    let canvas = new fabric.Canvas('main-canvas', {
        isDrawingMode: false,
        selection: true
    });
    
    // Save/Back logic
    const btnBack = document.getElementById('btn-back');
    if (btnBack) {
        btnBack.addEventListener('click', () => {
            // Restore zoom to 1 to capture properly
            const origZoom = currentZoom;
            canvas.setZoom(1);
            if (canvas.backgroundImage) {
                canvas.setWidth(canvas.backgroundImage.width);
                canvas.setHeight(canvas.backgroundImage.height);
            }
            
            const dataUrl = canvas.toDataURL({ format: 'png' });
            chrome.storage.local.set({ screenshotData: dataUrl }, () => {
                window.location.href = 'output.html';
            });
        });
    }

    // Canvas container zooming
    const imageWrapper = document.getElementById('image-wrapper');
    const zoomText = document.querySelector('.toolbar-section.center span');
    let currentZoom = 1.0;
    
    function setZoom(scale) {
        currentZoom = scale;
        if (canvas && canvas.backgroundImage) {
            canvas.setZoom(currentZoom);
            canvas.setWidth(canvas.backgroundImage.width * currentZoom);
            canvas.setHeight(canvas.backgroundImage.height * currentZoom);
        }
        if (zoomText) zoomText.textContent = Math.round(currentZoom * 100) + '%';
    }
    
    function setZoomToFit() {
        const container = document.getElementById('canvas-container-outer');
        if (container && canvas.backgroundImage) {
            const padding = 80;
            const scaleX = (container.clientWidth - padding) / canvas.backgroundImage.width;
            const scaleY = (container.clientHeight - padding) / canvas.backgroundImage.height;
            const scaleToFit = Math.min(scaleX, scaleY, 1); // Don't scale up past 100%
            setZoom(scaleToFit);
        }
    }

    const zoomOutBtn = document.querySelector('button[title="Zoom Out"]');
    if (zoomOutBtn) zoomOutBtn.addEventListener('click', () => setZoom(Math.max(0.05, currentZoom - 0.1)));
    
    const zoomInBtn = document.querySelector('button[title="Zoom In"]');
    if (zoomInBtn) zoomInBtn.addEventListener('click', () => setZoom(Math.min(3, currentZoom + 0.1)));

    const fitScreenBtn = document.querySelector('button[title="Fit to Screen"]');
    if (fitScreenBtn) fitScreenBtn.addEventListener('click', () => setZoomToFit());

    // Trackpad Pinch-to-Zoom
    canvas.on('mouse:wheel', function(opt) {
        if (opt.e.ctrlKey) {
            opt.e.preventDefault();
            opt.e.stopPropagation();
            let zoom = currentZoom;
            zoom *= 0.99 ** opt.e.deltaY;
            if (zoom > 3) zoom = 3;
            if (zoom < 0.05) zoom = 0.05;
            setZoom(zoom);
        }
    });

    // Global properties
    let activeTool = 'Pointer';
    let currentColor = '#FF3B30';
    let currentFill = 'none'; // 'none' or color
    let currentThickness = 4;
    
    // Undo/Redo history
    let history = [];
    let historyIndex = -1;
    let isHistoryAction = false;
    
    function saveHistory() {
        if (isHistoryAction) return;
        const json = canvas.toJSON();
        history = history.slice(0, historyIndex + 1);
        history.push(json);
        historyIndex++;
        updateUndoRedoUI();
    }
    
    function updateUndoRedoUI() {
        const undoBtn = document.getElementById('btn-undo');
        const redoBtn = document.getElementById('btn-redo');
        if (undoBtn) undoBtn.style.opacity = historyIndex > 0 ? '1' : '0.3';
        if (redoBtn) redoBtn.style.opacity = historyIndex < history.length - 1 ? '1' : '0.3';
    }

    const undoBtn = document.getElementById('btn-undo');
    if (undoBtn) undoBtn.addEventListener('click', () => {
        if (historyIndex > 0) {
            isHistoryAction = true;
            historyIndex--;
            canvas.loadFromJSON(history[historyIndex], () => {
                canvas.renderAll();
                isHistoryAction = false;
                updateUndoRedoUI();
                updateObjectsList();
            });
        }
    });

    const redoBtn = document.getElementById('btn-redo');
    if (redoBtn) redoBtn.addEventListener('click', () => {
        if (historyIndex < history.length - 1) {
            isHistoryAction = true;
            historyIndex++;
            canvas.loadFromJSON(history[historyIndex], () => {
                canvas.renderAll();
                isHistoryAction = false;
                updateUndoRedoUI();
                updateObjectsList();
            });
        }
    });

    // Load Image
    try {
        const data = await chrome.storage.local.get('screenshotData');
        if (data.screenshotData) {
            fabric.Image.fromURL(data.screenshotData, function(img) {
                canvas.setWidth(img.width);
                canvas.setHeight(img.height);
                canvas.setBackgroundImage(img, canvas.renderAll.bind(canvas));
                
                setZoomToFit();
                saveHistory(); // Save initial state
            });
        }
    } catch (e) {
        console.error('Error loading screenshot in editor', e);
    }

    // Properties UI Handling
    const rsDefault = document.getElementById('rs-default');
    const rsProperties = document.getElementById('rs-properties');
    const rsPropIcon = document.getElementById('rs-prop-icon');
    const rsPropTitle = document.getElementById('rs-prop-title');
    
    const rsColorSection = document.getElementById('rs-color-section');
    const rsThicknessSection = document.getElementById('rs-thickness-section');
    const rsFillSection = document.getElementById('rs-fill-section');
    
    const toolsConfig = {
        'Pointer': { showProps: false },
        'Crop': { showProps: false },
        'Rectangle': { showProps: true, title: 'Rectangle', hasColor: true, hasThickness: true, hasFill: true },
        'Circle': { showProps: true, title: 'Ellipse', hasColor: true, hasThickness: true, hasFill: true },
        'Arrow': { showProps: true, title: 'Arrow', hasColor: true, hasThickness: true, hasFill: false },
        'Line': { showProps: true, title: 'Line', hasColor: true, hasThickness: true, hasFill: false },
        'Text': { showProps: true, title: 'Text', hasColor: true, hasThickness: false, hasFill: false },
        'Pen': { showProps: true, title: 'Pen', hasColor: true, hasThickness: true, hasFill: false }
    };

    function applyPropertiesToActiveObject() {
        const activeObj = canvas.getActiveObject();
        if (!activeObj) return;
        
        if (activeObj.type === 'path' || activeObj.type === 'line' || activeObj.type === 'arrow') {
            activeObj.set({ stroke: currentColor, strokeWidth: currentThickness });
        } else if (activeObj.type === 'rect' || activeObj.type === 'ellipse') {
            activeObj.set({ stroke: currentColor, strokeWidth: currentThickness, fill: currentFill === 'none' ? 'transparent' : currentFill });
        } else if (activeObj.type === 'i-text') {
            activeObj.set({ fill: currentColor });
        }
        canvas.renderAll();
        saveHistory();
    }

    // Interactive swatches and sliders
    document.querySelectorAll('.color-swatch').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.color-swatch').forEach(b => b.classList.remove('active'));
            e.currentTarget.classList.add('active');
            let bg = e.currentTarget.style.backgroundColor || e.currentTarget.style.background;
            if (bg.includes('conic-gradient')) bg = '#000000'; // fallback for multi-color
            currentColor = bg;
            applyPropertiesToActiveObject();
        });
    });

    document.querySelectorAll('.fill-swatch').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.fill-swatch').forEach(b => b.classList.remove('active'));
            e.currentTarget.classList.add('active');
            if (e.currentTarget.classList.contains('no-fill')) {
                currentFill = 'none';
            } else {
                currentFill = e.currentTarget.style.backgroundColor || e.currentTarget.style.background;
            }
            applyPropertiesToActiveObject();
        });
    });

    const thicknessSlider = document.getElementById('rs-thickness-slider');
    if (thicknessSlider) {
        thicknessSlider.addEventListener('input', (e) => {
            currentThickness = parseInt(e.target.value);
            document.getElementById('rs-thickness-val').textContent = currentThickness + ' px';
            applyPropertiesToActiveObject();
        });
    }

    // Tool Selection
    let cropRect = null;
    let cropBtnGroup = null;

    function syncCropOverlay() {
        if (!cropRect) return;
        const overlay = document.getElementById('dark-crop-overlay');
        const pill = document.getElementById('crop-dimension-pill');
        const cw = cropRect.width * cropRect.scaleX;
        const ch = cropRect.height * cropRect.scaleY;
        overlay.style.width = (cw * currentZoom) + 'px';
        overlay.style.height = (ch * currentZoom) + 'px';
        overlay.style.left = (cropRect.left * currentZoom) + 'px';
        overlay.style.top = (cropRect.top * currentZoom) + 'px';
        pill.textContent = `${Math.round(cw)} x ${Math.round(ch)}`;
        
        // Ensure corner size remains consistent regardless of zoom
        cropRect.set({ cornerSize: 12 / currentZoom });
    }

    function cleanupCrop() {
        if (cropRect) canvas.remove(cropRect);
        cropRect = null;
        document.getElementById('crop-action-bar').style.display = 'none';
        document.getElementById('dark-crop-overlay').style.display = 'none';
        canvas.renderAll();
    }

    const toolBtns = document.querySelectorAll('.left-sidebar .tool-btn');
    toolBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            toolBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            
            activeTool = btn.getAttribute('title');
            cleanupCrop();
            
            if (activeTool === 'Pointer') {
                canvas.isDrawingMode = false;
                canvas.selection = true;
                canvas.forEachObject(o => { o.selectable = true; o.evented = true; });
                canvas.defaultCursor = 'default';
            } else if (activeTool === 'Pen' || activeTool === 'Brush') {
                canvas.isDrawingMode = true;
                canvas.freeDrawingBrush.color = currentColor;
                canvas.freeDrawingBrush.width = currentThickness;
                canvas.selection = false;
                canvas.discardActiveObject();
                canvas.renderAll();
            } else if (activeTool === 'Crop') {
                canvas.isDrawingMode = false;
                canvas.selection = false;
                canvas.discardActiveObject();
                
                document.getElementById('crop-action-bar').style.display = 'flex';
                document.getElementById('dark-crop-overlay').style.display = 'block';
                
                const container = document.getElementById('canvas-container-outer');
                const scrollLeft = container.scrollLeft;
                const scrollTop = container.scrollTop;
                
                const w = Math.min(canvas.backgroundImage.width * 0.8, (container.clientWidth * 0.8) / currentZoom);
                const h = Math.min(canvas.backgroundImage.height * 0.8, (container.clientHeight * 0.8) / currentZoom);
                const cw = canvas.backgroundImage.width;
                const ch = canvas.backgroundImage.height;
                
                cropRect = new fabric.Rect({
                    left: (scrollLeft / currentZoom) + ((container.clientWidth / currentZoom) - w) / 2,
                    top: (scrollTop / currentZoom) + ((container.clientHeight / currentZoom) - h) / 2,
                    width: w,
                    height: h,
                    fill: 'transparent',
                    stroke: 'transparent',
                    strokeWidth: 0,
                    hasBorders: false,
                    cornerColor: 'white',
                    cornerStrokeColor: 'rgba(0,0,0,0.2)',
                    transparentCorners: false,
                    cornerSize: 12 / currentZoom,
                    cornerStyle: 'rect',
                    selectable: true,
                    evented: true
                });
                
                cropRect.on('moving', function() {
                    if (this.left < 0) this.left = 0;
                    if (this.top < 0) this.top = 0;
                    if (this.left + this.width * this.scaleX > cw) this.left = cw - this.width * this.scaleX;
                    if (this.top + this.height * this.scaleY > ch) this.top = ch - this.height * this.scaleY;
                    syncCropOverlay();
                });
                
                cropRect.on('scaling', syncCropOverlay);

                canvas.add(cropRect);
                canvas.setActiveObject(cropRect);
                canvas.renderAll();
                syncCropOverlay();
                
            } else {
                canvas.isDrawingMode = false;
                canvas.selection = false;
                canvas.forEachObject(o => { o.selectable = false; o.evented = false; });
                canvas.discardActiveObject();
                canvas.renderAll();
                canvas.defaultCursor = 'crosshair';
            }
            
            const config = toolsConfig[activeTool];
            
            if (config && config.showProps) {
                rsDefault.style.display = 'none';
                rsProperties.style.display = 'flex';
                rsPropTitle.textContent = config.title;
                rsPropIcon.innerHTML = btn.innerHTML;
                
                rsColorSection.style.display = config.hasColor ? 'block' : 'none';
                rsThicknessSection.style.display = config.hasThickness ? 'block' : 'none';
                rsFillSection.style.display = config.hasFill ? 'block' : 'none';
            } else {
                rsDefault.style.display = 'block';
                rsProperties.style.display = 'none';
            }
        });
    });

    document.getElementById('btn-cancel-crop').addEventListener('click', () => {
        document.querySelector('.tool-btn[title="Pointer"]').click();
    });

    document.getElementById('btn-apply-crop').addEventListener('click', () => {
        if (!cropRect) return;
        
        // Restore zoom temporarily for clean crop
        const origZoom = currentZoom;
        canvas.setZoom(1);
        
        const croppedDataURL = canvas.toDataURL({
            left: cropRect.left,
            top: cropRect.top,
            width: cropRect.width * cropRect.scaleX,
            height: cropRect.height * cropRect.scaleY,
            format: 'png'
        });
        
        cleanupCrop();
        
        fabric.Image.fromURL(croppedDataURL, function(img) {
            canvas.clear(); 
            canvas.setBackgroundImage(img, canvas.renderAll.bind(canvas));
            canvas.setWidth(img.width);
            canvas.setHeight(img.height);
            setZoomToFit();
            saveHistory();
            document.querySelector('.tool-btn[title="Pointer"]').click();
        });
    });

    // Custom drawing logic
    let isDrawing = false;
    let startX = 0, startY = 0;
    let shape = null;

    canvas.on('mouse:down', function(o) {
        if (activeTool === 'Pointer' || activeTool === 'Crop' || canvas.isDrawingMode) return;
        
        isDrawing = true;
        const pointer = canvas.getPointer(o.e);
        startX = pointer.x;
        startY = pointer.y;
        
        if (activeTool === 'Rectangle') {
            shape = new fabric.Rect({
                left: startX,
                top: startY,
                width: 0,
                height: 0,
                fill: currentFill === 'none' ? 'transparent' : currentFill,
                stroke: currentColor,
                strokeWidth: currentThickness,
                selectable: false
            });
            canvas.add(shape);
        } else if (activeTool === 'Circle') {
            shape = new fabric.Ellipse({
                left: startX,
                top: startY,
                rx: 0,
                ry: 0,
                fill: currentFill === 'none' ? 'transparent' : currentFill,
                stroke: currentColor,
                strokeWidth: currentThickness,
                selectable: false
            });
            canvas.add(shape);
        } else if (activeTool === 'Line' || activeTool === 'Arrow') {
            const points = [startX, startY, startX, startY];
            shape = new fabric.Line(points, {
                strokeWidth: currentThickness,
                stroke: currentColor,
                selectable: false,
                originX: 'center',
                originY: 'center'
            });
            shape.type = activeTool === 'Arrow' ? 'arrow' : 'line';
            canvas.add(shape);
        } else if (activeTool === 'Text') {
            const text = new fabric.IText('Text', {
                left: startX,
                top: startY,
                fontFamily: 'Helvetica',
                fill: currentColor,
                fontSize: 40 * (1/currentZoom) // Make text reasonable size
            });
            canvas.add(text);
            canvas.setActiveObject(text);
            text.enterEditing();
            text.selectAll();
            saveHistory();
            isDrawing = false;
            
            document.querySelector('.tool-btn[title="Pointer"]').click();
        }
    });

    canvas.on('mouse:move', function(o) {
        if (!isDrawing || !shape) return;
        
        const pointer = canvas.getPointer(o.e);
        
        if (activeTool === 'Rectangle') {
            shape.set({
                left: Math.min(startX, pointer.x),
                top: Math.min(startY, pointer.y),
                width: Math.abs(pointer.x - startX),
                height: Math.abs(pointer.y - startY)
            });
        } else if (activeTool === 'Circle') {
            shape.set({
                left: Math.min(startX, pointer.x),
                top: Math.min(startY, pointer.y),
                rx: Math.abs(pointer.x - startX) / 2,
                ry: Math.abs(pointer.y - startY) / 2
            });
        } else if (activeTool === 'Line' || activeTool === 'Arrow') {
            shape.set({ x2: pointer.x, y2: pointer.y });
        }
        canvas.renderAll();
    });

    canvas.on('mouse:up', function() {
        if (isDrawing) {
            isDrawing = false;
            if (shape) {
                if (shape.width < 5 && shape.height < 5 && shape.type !== 'line' && shape.type !== 'arrow') {
                    canvas.remove(shape);
                } else {
                    saveHistory();
                    updateObjectsList();
                }
                shape = null;
            }
        }
    });
    
    canvas.on('after:render', function() {
        canvas.getObjects().forEach(obj => {
            if (obj.type === 'arrow') {
                const ctx = canvas.getContext();
                const p1 = {x: obj.x1, y: obj.y1};
                const p2 = {x: obj.x2, y: obj.y2};
                const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
                
                ctx.save();
                ctx.translate(obj.left + obj.width/2, obj.top + obj.height/2);
                
                let dx = p2.x - p1.x;
                let dy = p2.y - p1.y;
                
                ctx.translate(dx/2, dy/2); 
                ctx.rotate(angle);
                
                ctx.beginPath();
                ctx.moveTo(0, 0);
                const headlen = 15 + obj.strokeWidth;
                ctx.lineTo(-headlen, headlen/2);
                ctx.lineTo(-headlen, -headlen/2);
                ctx.closePath();
                ctx.fillStyle = obj.stroke;
                ctx.fill();
                
                ctx.restore();
            }
        });
    });

    canvas.on('path:created', function() {
        saveHistory();
        updateObjectsList();
    });

    // Delete object
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Backspace' || e.key === 'Delete') {
            const activeObj = canvas.getActiveObject();
            if (activeObj && !activeObj.isEditing && activeObj.type !== 'rect') { 
                // Don't delete crop rect
                if (activeTool === 'Crop' && activeObj === cropRect) return;
                canvas.remove(activeObj);
                saveHistory();
                updateObjectsList();
            }
        }
    });

    // Property panel update on selection
    canvas.on('selection:created', updatePropsFromSelection);
    canvas.on('selection:updated', updatePropsFromSelection);
    canvas.on('selection:cleared', () => {
        if (activeTool === 'Pointer') {
            rsDefault.style.display = 'block';
            rsProperties.style.display = 'none';
        }
    });

    function updatePropsFromSelection() {
        if (activeTool !== 'Pointer') return;
        
        const obj = canvas.getActiveObject();
        if (!obj) return;
        
        rsDefault.style.display = 'none';
        rsProperties.style.display = 'flex';
        
        let typeName = 'Object';
        if (obj.type === 'rect') typeName = 'Rectangle';
        if (obj.type === 'ellipse') typeName = 'Ellipse';
        if (obj.type === 'line') typeName = 'Line';
        if (obj.type === 'arrow') typeName = 'Arrow';
        if (obj.type === 'i-text') typeName = 'Text';
        if (obj.type === 'path') typeName = 'Drawing';
        
        rsPropTitle.textContent = typeName;
        rsPropIcon.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" style="width:20px;height:20px;"><path stroke-linecap="round" stroke-linejoin="round" d="M15 15l-2 5L9 9l11 4-5 2z"/></svg>`;
        
        rsColorSection.style.display = 'block';
        rsThicknessSection.style.display = (obj.type === 'i-text') ? 'none' : 'block';
        rsFillSection.style.display = (obj.type === 'rect' || obj.type === 'ellipse') ? 'block' : 'none';
        
        if (obj.strokeWidth && thicknessSlider) {
            thicknessSlider.value = obj.strokeWidth;
            document.getElementById('rs-thickness-val').textContent = obj.strokeWidth + ' px';
        }
    }

    // Objects List
    function updateObjectsList() {
        const objectsList = document.getElementById('rs-objects-list');
        const objectsCount = document.getElementById('rs-objects-count');
        const emptyState = document.getElementById('rs-objects-empty');
        
        if (!objectsList) return;
        objectsList.innerHTML = '';
        
        const objects = canvas.getObjects();
        let displayCount = 0;
        
        [...objects].reverse().forEach((obj, i) => {
            if (obj === cropRect) return; // Hide crop rect
            displayCount++;
            let typeName = 'Drawing';
            if (obj.type === 'rect') typeName = 'Rectangle';
            if (obj.type === 'ellipse') typeName = 'Ellipse';
            if (obj.type === 'line') typeName = 'Line';
            if (obj.type === 'arrow') typeName = 'Arrow';
            if (obj.type === 'i-text') typeName = 'Text';
            
            const color = obj.stroke || obj.fill || '#000000';
            
            const item = document.createElement('div');
            item.style.display = 'flex';
            item.style.alignItems = 'center';
            item.style.justifyContent = 'space-between';
            item.style.padding = '8px 0';
            
            item.innerHTML = `
                <div style="display: flex; align-items: center; gap: 8px;">
                    <input type="checkbox" checked style="accent-color: var(--text-main);">
                    <span style="font-size: 13px; font-weight: 500;">${typeName}</span>
                </div>
                <div style="width: 8px; height: 8px; border-radius: 50%; background: ${color === 'transparent' ? 'white' : color}; border: 1px solid var(--border-color);"></div>
            `;
            
            objectsList.appendChild(item);
        });
        
        if (objectsCount) objectsCount.textContent = displayCount;
        if (emptyState) emptyState.style.display = displayCount > 0 ? 'none' : 'flex';
    }
    
    // Save/Export Logic
    const saveImgBtn = document.querySelector('.toolbar-section.right button:nth-child(3)');
    if (saveImgBtn) {
        saveImgBtn.addEventListener('click', () => {
            const origZoom = currentZoom;
            canvas.setZoom(1);
            if (canvas.backgroundImage) {
                canvas.setWidth(canvas.backgroundImage.width);
                canvas.setHeight(canvas.backgroundImage.height);
            }
            
            const dataUrl = canvas.toDataURL({ format: 'png' });
            const a = document.createElement('a');
            a.href = dataUrl;
            a.download = 'lumina_edited_screenshot.png';
            a.click();
            
            setZoomToFit(); // Restore zoom
        });
    }
});
