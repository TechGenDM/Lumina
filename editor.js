// editor.js

// 1. Define custom Fabric classes BEFORE the DOMContentLoaded handler
fabric.Arrow = fabric.util.createClass(fabric.Line, {
  type: 'arrow',
  initialize: function(points, options) {
    options || (options = {});
    this.callSuper('initialize', points, options);
  },
  _render: function(ctx) {
    this.callSuper('_render', ctx);
    if (this.width === 0 && this.height === 0) return;
    ctx.save();
    var xDiff = this.x2 - this.x1;
    var yDiff = this.y2 - this.y1;
    var angle = Math.atan2(yDiff, xDiff);
    var p = this.calcLinePoints();
    ctx.translate(p.x2, p.y2);
    ctx.rotate(angle);
    ctx.beginPath();
    var headlen = Math.max(10, this.strokeWidth * 3);
    ctx.moveTo(0, 0);
    ctx.lineTo(-headlen, headlen / 2);
    ctx.lineTo(-headlen, -headlen / 2);
    ctx.closePath();
    ctx.fillStyle = this.stroke;
    ctx.fill();
    ctx.restore();
  },
  toObject: function(propertiesToInclude) {
    return this.callSuper('toObject', ['type'].concat(propertiesToInclude));
  }
});
fabric.Arrow.fromObject = function(object, callback) {
  callback && callback(new fabric.Arrow([object.x1, object.y1, object.x2, object.y2], object));
};

fabric.NumberMarker = fabric.util.createClass(fabric.Group, {
  type: 'numberMarker',
  initialize: function(options) {
    options || (options = {});
    const radius = options.radius || 15;
    const text = options.text || '1';
    
    const circle = new fabric.Circle({
      radius: radius,
      fill: options.fill || '#FF3B30',
      originX: 'center',
      originY: 'center',
      stroke: options.stroke || null,
      strokeWidth: options.strokeWidth || 0
    });
    
    const textObj = new fabric.Text(text, {
      fontSize: radius * 1.2,
      fill: '#ffffff',
      originX: 'center',
      originY: 'center',
      fontFamily: 'Arial',
      fontWeight: 'bold'
    });
    
    this.callSuper('initialize', [circle, textObj], options);
    this.markerNumber = parseInt(text);
  },
  toObject: function(propertiesToInclude) {
    return this.callSuper('toObject', ['type', 'markerNumber', 'radius'].concat(propertiesToInclude));
  }
});
fabric.NumberMarker.fromObject = function(object, callback) {
  const options = { ...object };
  if (object.objects && object.objects.length > 0) {
    options.fill = object.objects[0].fill;
    options.radius = object.objects[0].radius;
    options.text = object.objects[1].text;
    options.stroke = object.objects[0].stroke;
    options.strokeWidth = object.objects[0].strokeWidth;
  }
  callback && callback(new fabric.NumberMarker(options));
};

let globalMarkerCounter = 1;
let bgImageElement = null;

function generateFilterRegionDataURL(rect, type, bgImg) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  canvas.width = rect.width;
  canvas.height = rect.height;

  if (type === 'Blur') {
    ctx.filter = 'blur(8px)';
    ctx.drawImage(bgImg, rect.left - 8, rect.top - 8, rect.width + 16, rect.height + 16, -8, -8, rect.width + 16, rect.height + 16);
  } else if (type === 'Pixelate') {
    const block = 10;
    const w = rect.width;
    const h = rect.height;
    
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = w / block;
    tempCanvas.height = h / block;
    const tempCtx = tempCanvas.getContext('2d');
    tempCtx.drawImage(bgImg, rect.left, rect.top, w, h, 0, 0, w / block, h / block);
    
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(tempCanvas, 0, 0, w / block, h / block, 0, 0, w, h);
  }
  return canvas.toDataURL('image/png');
}

document.addEventListener('DOMContentLoaded', async () => {
  // Theme
  if (localStorage.getItem('theme') === 'dark' || (!localStorage.getItem('theme') && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
    document.body.classList.add('dark-mode');
  }

  // Canvas Init
  const canvasContainerOuter = document.getElementById('canvas-container-outer');
  const canvas = new fabric.Canvas('main-canvas', {
    isDrawingMode: false,
    selection: true,
    preserveObjectStacking: true,
    fireRightClick: true,
    stopContextMenu: true
  });

  function resizeCanvas() {
    canvas.setWidth(canvasContainerOuter.clientWidth);
    canvas.setHeight(canvasContainerOuter.clientHeight);
    canvas.renderAll();
  }
  window.addEventListener('resize', resizeCanvas);
  resizeCanvas();

  // Zoom System
  let currentZoom = 1;
  const zoomText = document.getElementById('zoom-percentage');
  
  function updateZoomUI() {
    const zt = document.querySelector('.toolbar-section.center span');
    if(zt) zt.innerText = Math.round(canvas.getZoom() * 100) + '%';
  }

  function setZoom(scale, point) {
    canvas.zoomToPoint(point, scale);
    updateZoomUI();
  }

  function setZoomToFit() {
    if (!canvas.backgroundImage) return;
    const padding = 80;
    const bg = canvas.backgroundImage;
    const scaleX = (canvas.width - padding * 2) / bg.width;
    const scaleY = (canvas.height - padding * 2) / bg.height;
    const scale = Math.min(scaleX, scaleY, 1);
    
    canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
    const center = canvas.getCenter();
    canvas.zoomToPoint(new fabric.Point(center.left, center.top), scale);
    
    const vpt = canvas.viewportTransform;
    vpt[4] = (canvas.width - bg.width * scale) / 2;
    vpt[5] = (canvas.height - bg.height * scale) / 2;
    canvas.requestRenderAll();
    updateZoomUI();
  }

  document.querySelector('button[title="Zoom In"]')?.addEventListener('click', () => setZoom(canvas.getZoom() * 1.1, canvas.getVpCenter()));
  document.querySelector('button[title="Zoom Out"]')?.addEventListener('click', () => setZoom(canvas.getZoom() / 1.1, canvas.getVpCenter()));
  document.querySelector('button[title="Fit to Screen"]')?.addEventListener('click', setZoomToFit);

  // Panning & Mouse Wheel
  let isDraggingCanvas = false;
  let lastPosX, lastPosY;
  let isSpaceDown = false;

  window.addEventListener('keydown', e => {
    if (e.code === 'Space' && e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
      isSpaceDown = true;
      canvas.defaultCursor = 'grab';
    }
  });
  window.addEventListener('keyup', e => {
    if (e.code === 'Space') {
      isSpaceDown = false;
      canvas.defaultCursor = activeTool === 'Pointer' ? 'default' : 'crosshair';
    }
  });

  canvas.on('mouse:down', function(opt) {
    const evt = opt.e;
    if (isSpaceDown || evt.button === 1) { // Middle click or Space + Left click
      isDraggingCanvas = true;
      canvas.selection = false;
      lastPosX = evt.clientX;
      lastPosY = evt.clientY;
    }
  });

  canvas.on('mouse:move', function(opt) {
    if (isDraggingCanvas) {
      const e = opt.e;
      const vpt = this.viewportTransform;
      vpt[4] += e.clientX - lastPosX;
      vpt[5] += e.clientY - lastPosY;
      this.requestRenderAll();
      lastPosX = e.clientX;
      lastPosY = e.clientY;
      if(cropRect) syncCropOverlay();
    }
  });

  canvas.on('mouse:up', function(opt) {
    if (isDraggingCanvas) {
      this.setViewportTransform(this.viewportTransform);
      isDraggingCanvas = false;
      canvas.selection = activeTool === 'Pointer';
    }
  });

  canvas.on('mouse:wheel', function(opt) {
    const delta = opt.e.deltaY;
    if (opt.e.ctrlKey) {
      let zoom = canvas.getZoom();
      zoom *= 0.999 ** delta;
      if (zoom > 20) zoom = 20;
      if (zoom < 0.01) zoom = 0.01;
      setZoom(zoom, { x: opt.e.offsetX, y: opt.e.offsetY });
    } else {
      const vpt = this.viewportTransform;
      vpt[4] -= opt.e.deltaX;
      vpt[5] -= opt.e.deltaY;
      this.requestRenderAll();
      if(cropRect) syncCropOverlay();
    }
    opt.e.preventDefault();
    opt.e.stopPropagation();
  });

  // State Variables
  let activeTool = 'Pointer';
  let currentColor = '#FF3B30';
  let currentFill = 'transparent';
  let currentThickness = 4;
  let cropRect = null;

  // History
  let history = [];
  let historyIndex = -1;
  let isHistoryAction = false;

  function saveHistory() {
    if (isHistoryAction) return;
    const json = canvas.toJSON(['selectable', 'evented', 'type', 'name', 'filterType', 'markerNumber', 'radius']);
    history.splice(historyIndex + 1);
    history.push(json);
    historyIndex = history.length - 1;
    updateObjectsList();
  }

  function doUndo() {
    if (historyIndex > 0) {
      isHistoryAction = true;
      historyIndex--;
      canvas.loadFromJSON(history[historyIndex], () => {
        if (canvas.backgroundImage) {
          bgImageElement = canvas.backgroundImage.getElement();
        }
        canvas.renderAll();
        isHistoryAction = false;
        updateObjectsList();
      });
    }
  }

  function doRedo() {
    if (historyIndex < history.length - 1) {
      isHistoryAction = true;
      historyIndex++;
      canvas.loadFromJSON(history[historyIndex], () => {
        if (canvas.backgroundImage) {
          bgImageElement = canvas.backgroundImage.getElement();
        }
        canvas.renderAll();
        isHistoryAction = false;
        updateObjectsList();
      });
    }
  }

  document.getElementById('btn-undo')?.addEventListener('click', doUndo);
  document.getElementById('btn-redo')?.addEventListener('click', doRedo);

  canvas.on('object:modified', saveHistory);
  canvas.on('path:created', saveHistory);

  // Back Button
  document.getElementById('btn-back')?.addEventListener('click', async () => {
    const origVpt = canvas.viewportTransform;
    canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
    if (canvas.backgroundImage) {
      canvas.setWidth(canvas.backgroundImage.width);
      canvas.setHeight(canvas.backgroundImage.height);
    }
    canvas.discardActiveObject();
    if(cropRect) cropRect.visible = false;
    canvas.renderAll();
    
    const dataURL = canvas.toDataURL({ format: 'png' });
    
    // Restore
    resizeCanvas();
    canvas.setViewportTransform(origVpt);
    if(cropRect) cropRect.visible = true;
    canvas.renderAll();

    await chrome.storage.local.set({ screenshotData: dataURL });
    window.location.href = 'output.html';
  });

  // Load Image
  chrome.storage.local.get('screenshotData', (data) => {
    if (data.screenshotData) {
      fabric.Image.fromURL(data.screenshotData, (img) => {
        bgImageElement = img.getElement();
        img.set({ selectable: false, evented: false });
        canvas.setBackgroundImage(img, canvas.renderAll.bind(canvas));
        setZoomToFit();
        saveHistory();
        
        // Bottom bar text
        const dims = document.querySelectorAll('.bottom-bar span');
        if(dims.length > 0) dims[0].innerText = `${img.width} × ${img.height}`;
      });
    }
  });

  // Crop System
  const cropOverlay = document.getElementById('dark-crop-overlay');
  const cropPill = document.getElementById('crop-dimension-pill');
  const cropActionBar = document.getElementById('crop-action-bar');
  let cropRatio = null;

  function syncCropOverlay() {
    if (!cropRect) return;
    cropRect.setCoords();
    const zoom = canvas.getZoom();
    const vpt = canvas.viewportTransform;
    
    // Get the crop rect's logical coordinates
    const left = cropRect.left;
    const top = cropRect.top;
    const width = cropRect.getScaledWidth();
    const height = cropRect.getScaledHeight();
    
    // Transform to screen coordinates within the canvas element
    const screenLeft = left * zoom + vpt[4];
    const screenTop = top * zoom + vpt[5];
    const screenWidth = width * zoom;
    const screenHeight = height * zoom;

    cropOverlay.style.left = `${screenLeft}px`;
    cropOverlay.style.top = `${screenTop}px`;
    cropOverlay.style.width = `${screenWidth}px`;
    cropOverlay.style.height = `${screenHeight}px`;
    cropOverlay.style.display = 'block';

    // Dimension pill positioned inside the overlay
    cropPill.innerText = `${Math.round(width)} × ${Math.round(height)}`;
    cropPill.style.display = 'block';
  }

  function cleanupCrop() {
    if (cropRect) {
      canvas.remove(cropRect);
      cropRect = null;
    }
    cropOverlay.style.display = 'none';
    cropPill.style.display = 'none';
    cropActionBar.style.display = 'none';
  }

  function setTool(toolName) {
    document.querySelectorAll('.left-sidebar .tool-btn').forEach(b => b.classList.remove('active'));
    const btn = document.querySelector(`.left-sidebar .tool-btn[data-tool="${toolName}"]`);
    if(btn) btn.classList.add('active');
    
    activeTool = toolName;
    cleanupCrop();
    canvas.discardActiveObject();
    
    canvas.isDrawingMode = (toolName === 'Pen' || toolName === 'Highlight');
    canvas.selection = (toolName === 'Pointer');
    canvas.defaultCursor = (toolName === 'Pointer') ? 'default' : (canvas.isDrawingMode ? 'default' : 'crosshair');
    
    if (toolName === 'Pen') {
      canvas.freeDrawingBrush = new fabric.PencilBrush(canvas);
      canvas.freeDrawingBrush.color = currentColor;
      canvas.freeDrawingBrush.width = currentThickness;
    } else if (toolName === 'Highlight') {
      canvas.freeDrawingBrush = new fabric.PencilBrush(canvas);
      canvas.freeDrawingBrush.color = new fabric.Color(currentColor).setAlpha(0.4).toRgba();
      canvas.freeDrawingBrush.width = Math.max(20, currentThickness * 4);
      canvas.freeDrawingBrush.strokeLineCap = 'round';
    }

    const objects = canvas.getObjects();
    objects.forEach(obj => {
      obj.set({
        selectable: (toolName === 'Pointer'),
        evented: (toolName === 'Pointer')
      });
    });

    if (toolName === 'Crop') {
      const bg = canvas.backgroundImage;
      if (!bg) return;
      const cw = bg.width * 0.8;
      const ch = bg.height * 0.8;
      cropRect = new fabric.Rect({
        left: bg.width / 2 - cw / 2,
        top: bg.height / 2 - ch / 2,
        width: cw,
        height: ch,
        fill: 'transparent',
        stroke: '#007AFF',
        strokeWidth: 2,
        strokeDashArray: [5, 5],
        cornerColor: '#007AFF',
        transparentCorners: false,
        selectable: true,
        evented: true,
        hasRotatingPoint: false
      });
      canvas.add(cropRect);
      canvas.setActiveObject(cropRect);
      cropOverlay.style.display = 'block';
      cropPill.style.display = 'block';
      cropActionBar.style.display = 'flex';
      syncCropOverlay();
    }
    
    canvas.requestRenderAll();
  }

  document.querySelectorAll('.left-sidebar .tool-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      setTool(btn.getAttribute('data-tool'));
    });
  });

  document.querySelectorAll('.crop-aspect-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.crop-aspect-btn').forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');
      const aspect = e.target.getAttribute('data-aspect');
      if (!cropRect) return;
      if (aspect === 'free') {
        cropRatio = null;
        cropRect.set({ lockUniScaling: false });
      } else {
        const [w, h] = aspect.split(':').map(Number);
        cropRatio = w / h;
        const currentH = cropRect.getScaledHeight();
        cropRect.set({ 
          width: currentH * cropRatio,
          scaleX: 1,
          lockUniScaling: true 
        });
      }
      canvas.requestRenderAll();
      syncCropOverlay();
    });
  });

  document.getElementById('btn-cancel-crop')?.addEventListener('click', () => setTool('Pointer'));
  document.getElementById('btn-apply-crop')?.addEventListener('click', () => {
    if(!cropRect) return;
    
    // Get crop rect logical coordinates
    const cropLeft = cropRect.left;
    const cropTop = cropRect.top;
    const cropWidth = cropRect.getScaledWidth();
    const cropHeight = cropRect.getScaledHeight();
    
    // Save current state then reset viewport for full-res export
    const origVpt = canvas.viewportTransform.slice(0);
    canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
    if (canvas.backgroundImage) {
      canvas.setWidth(canvas.backgroundImage.width);
      canvas.setHeight(canvas.backgroundImage.height);
    }
    cropRect.visible = false;
    canvas.discardActiveObject();
    canvas.renderAll();
    
    // Export just the crop region at full resolution
    const croppedDataURL = canvas.toDataURL({
      format: 'png',
      left: cropLeft,
      top: cropTop,
      width: cropWidth,
      height: cropHeight
    });
    
    // Restore viewport temporarily
    resizeCanvas();
    canvas.setViewportTransform(origVpt);
    cropRect.visible = true;
    
    fabric.Image.fromURL(croppedDataURL, (img) => {
      bgImageElement = img.getElement();
      img.set({ selectable: false, evented: false });
      
      // Remove cropRect and reposition all objects
      canvas.remove(cropRect);
      const objects = canvas.getObjects();
      for (let i = objects.length - 1; i >= 0; i--) {
        const obj = objects[i];
        obj.set({
          left: obj.left - cropLeft,
          top: obj.top - cropTop
        });
        obj.setCoords();
        const obr = obj.getBoundingRect(true, true);
        if (obr.left + obr.width < 0 || obr.top + obr.height < 0 || obr.left > cropWidth || obr.top > cropHeight) {
          canvas.remove(obj);
        }
      }
      
      canvas.setBackgroundImage(img, () => {
        resizeCanvas();
        setZoomToFit();
        cleanupCrop();
        setTool('Pointer');
        saveHistory();
        
        const dims = document.querySelectorAll('.bottom-bar span');
        if(dims.length > 0) dims[0].innerText = `${Math.round(cropWidth)} × ${Math.round(cropHeight)}`;
      });
    });
  });

  canvas.on('object:moving', (e) => { if(e.target === cropRect) syncCropOverlay(); });
  canvas.on('object:scaling', (e) => { if(e.target === cropRect) syncCropOverlay(); });
  canvas.on('object:modified', (e) => { if(e.target === cropRect) syncCropOverlay(); });

  // Drawing Events
  let isDrawingShape = false;
  let currentShape = null;
  let startX, startY;

  canvas.on('mouse:down', function(opt) {
    if (activeTool === 'Pointer' || activeTool === 'Crop' || canvas.isDrawingMode || isDraggingCanvas) return;
    
    const pointer = canvas.getPointer(opt.e);
    startX = pointer.x;
    startY = pointer.y;
    isDrawingShape = true;

    const commonOpts = {
      fill: currentFill,
      stroke: currentColor,
      strokeWidth: currentThickness,
      selectable: false,
      evented: false,
      transparentCorners: false,
      cornerColor: '#007AFF'
    };

    if (activeTool === 'Rectangle') {
      currentShape = new fabric.Rect({
        left: startX, top: startY, width: 0, height: 0, ...commonOpts
      });
    } else if (activeTool === 'RoundedRectangle') {
      currentShape = new fabric.Rect({
        left: startX, top: startY, width: 0, height: 0, rx: 8, ry: 8, ...commonOpts
      });
    } else if (activeTool === 'Circle') {
      currentShape = new fabric.Ellipse({
        left: startX, top: startY, rx: 0, ry: 0, ...commonOpts
      });
    } else if (activeTool === 'Line') {
      currentShape = new fabric.Line([startX, startY, startX, startY], {
        ...commonOpts, fill: undefined
      });
    } else if (activeTool === 'Arrow') {
      currentShape = new fabric.Arrow([startX, startY, startX, startY], {
        ...commonOpts, fill: undefined
      });
    } else if (activeTool === 'Text') {
      currentShape = new fabric.IText('Text', {
        left: startX, top: startY,
        fill: currentColor,
        fontSize: Math.max(20, currentThickness * 10),
        fontFamily: 'Arial',
        selectable: true,
        evented: true
      });
      canvas.add(currentShape);
      canvas.setActiveObject(currentShape);
      currentShape.enterEditing();
      currentShape.selectAll();
      isDrawingShape = false;
      setTool('Pointer');
      saveHistory();
      return;
    } else if (activeTool === 'NumberMarker') {
      currentShape = new fabric.NumberMarker({
        left: startX, top: startY,
        text: String(globalMarkerCounter++),
        fill: currentColor,
        radius: Math.max(15, currentThickness * 5),
        selectable: true,
        evented: true,
        originX: 'center', originY: 'center'
      });
      canvas.add(currentShape);
      isDrawingShape = false;
      saveHistory();
      return;
    } else if (activeTool === 'Blur' || activeTool === 'Pixelate') {
      currentShape = new fabric.Rect({
        left: startX, top: startY, width: 0, height: 0,
        fill: 'transparent',
        stroke: '#000',
        strokeDashArray: [5, 5],
        selectable: false,
        evented: false,
        isTemporaryFilterRect: true
      });
    } else if (activeTool === 'Solid') {
      currentShape = new fabric.Rect({
        left: startX, top: startY, width: 0, height: 0,
        fill: currentColor,
        stroke: null,
        strokeWidth: 0,
        selectable: false,
        evented: false
      });
    }

    if (currentShape) canvas.add(currentShape);
  });

  canvas.on('mouse:move', function(opt) {
    if (!isDrawingShape || !currentShape || activeTool === 'Pointer' || activeTool === 'Crop') return;
    const pointer = canvas.getPointer(opt.e);
    
    if (activeTool === 'Rectangle' || activeTool === 'RoundedRectangle' || activeTool === 'Blur' || activeTool === 'Pixelate' || activeTool === 'Solid') {
      currentShape.set({
        left: Math.min(startX, pointer.x),
        top: Math.min(startY, pointer.y),
        width: Math.abs(pointer.x - startX),
        height: Math.abs(pointer.y - startY)
      });
    } else if (activeTool === 'Circle') {
      let rx = Math.abs(pointer.x - startX) / 2;
      let ry = Math.abs(pointer.y - startY) / 2;
      if (opt.e.shiftKey) {
        rx = ry = Math.max(rx, ry);
      }
      currentShape.set({
        left: Math.min(startX, pointer.x),
        top: Math.min(startY, pointer.y),
        rx: rx,
        ry: ry,
        width: rx * 2,
        height: ry * 2
      });
      currentShape.setCoords();
    } else if (activeTool === 'Line' || activeTool === 'Arrow') {
      currentShape.set({ x2: pointer.x, y2: pointer.y });
    }
    
    canvas.requestRenderAll();
  });

  canvas.on('mouse:up', function() {
    if (!isDrawingShape || !currentShape) return;
    isDrawingShape = false;
    
    let isSmall = false;
    if (activeTool === 'Line' || activeTool === 'Arrow') {
      isSmall = (Math.abs(currentShape.x2 - currentShape.x1) < 5 && Math.abs(currentShape.y2 - currentShape.y1) < 5);
    } else {
      const w = currentShape.getScaledWidth ? currentShape.getScaledWidth() : (currentShape.width || 0);
      const h = currentShape.getScaledHeight ? currentShape.getScaledHeight() : (currentShape.height || 0);
      isSmall = (w < 5 && h < 5);
    }
    
    if (isSmall) {
      canvas.remove(currentShape);
      currentShape = null;
      return;
    }

    if (activeTool === 'Blur' || activeTool === 'Pixelate') {
      currentShape.setCoords();
      const br = currentShape.getBoundingRect(true, true);
      const filterDataURL = generateFilterRegionDataURL(br, activeTool, bgImageElement);
      
      fabric.Image.fromURL(filterDataURL, (img) => {
        img.set({
          left: br.left,
          top: br.top,
          selectable: (activeTool === 'Pointer'),
          evented: (activeTool === 'Pointer'),
          filterType: activeTool
        });
        canvas.add(img);
        canvas.remove(currentShape);
        currentShape = null;
        saveHistory();
      });
    } else {
      currentShape.set({ 
        selectable: (activeTool === 'Pointer'), 
        evented: (activeTool === 'Pointer') 
      });
      currentShape.setCoords();
      saveHistory();
    }
    
    currentShape = null;
  });

  // Keyboard Shortcuts
  window.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (canvas.getActiveObject() && canvas.getActiveObject().isEditing) return;

    if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
      e.preventDefault();
      if (e.shiftKey) doRedo();
      else doUndo();
      return;
    }

    const keyMap = {
      'v': 'Pointer', 'r': 'Rectangle', 'c': 'Circle', 'a': 'Arrow', 'l': 'Line',
      'p': 'Pen', 't': 'Text', 'h': 'Highlight', 'b': 'Blur', 'n': 'NumberMarker'
    };
    if (keyMap[e.key.toLowerCase()] && !e.metaKey && !e.ctrlKey) {
      setTool(keyMap[e.key.toLowerCase()]);
    }

    if (e.key === 'Escape') {
      if (activeTool === 'Crop') setTool('Pointer');
      canvas.discardActiveObject();
      canvas.requestRenderAll();
    }

    if (e.key === 'Delete' || e.key === 'Backspace') {
      const activeObjs = canvas.getActiveObjects();
      if (activeObjs.length > 0) {
        let deleted = false;
        activeObjs.forEach(obj => {
          if (obj !== cropRect) {
            canvas.remove(obj);
            deleted = true;
          }
        });
        canvas.discardActiveObject();
        if (deleted) saveHistory();
      }
    }

    if ((e.metaKey || e.ctrlKey) && e.key === 'd') {
      e.preventDefault();
      const activeObj = canvas.getActiveObject();
      if (activeObj && activeObj !== cropRect) {
        activeObj.clone((cloned) => {
          cloned.set({
            left: cloned.left + 20,
            top: cloned.top + 20,
            evented: true,
            selectable: true
          });
          if (cloned.type === 'activeSelection') {
            cloned.canvas = canvas;
            cloned.forEachObject(obj => canvas.add(obj));
            cloned.setCoords();
          } else {
            canvas.add(cloned);
          }
          canvas.setActiveObject(cloned);
          canvas.requestRenderAll();
          saveHistory();
        });
      }
    }

    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'l') {
      e.preventDefault();
      const activeObj = canvas.getActiveObject();
      if (activeObj && activeObj !== cropRect) {
        const isLocked = activeObj.lockMovementX;
        activeObj.set({
          lockMovementX: !isLocked,
          lockMovementY: !isLocked,
          lockRotation: !isLocked,
          lockScalingX: !isLocked,
          lockScalingY: !isLocked,
          hasControls: isLocked
        });
        canvas.requestRenderAll();
        saveHistory();
      }
    }
  });

  // Properties Panel
  const rsDefault = document.getElementById('rs-default');
  const rsProperties = document.getElementById('rs-properties');
  const rsPropTitle = document.getElementById('rs-prop-title');
  const inputX = document.getElementById('rs-input-x');
  const inputY = document.getElementById('rs-input-y');
  const inputW = document.getElementById('rs-input-w');
  const inputH = document.getElementById('rs-input-h');
  const inputRot = document.getElementById('rs-input-rot');
  const opacitySlider = document.getElementById('rs-opacity-slider');
  const opacityVal = document.getElementById('rs-opacity-val');
  const thicknessSlider = document.getElementById('rs-thickness-slider');
  const thicknessVal = document.getElementById('rs-thickness-val');
  const radiusSlider = document.getElementById('rs-radius-slider');
  const radiusVal = document.getElementById('rs-radius-val');
  const fontSection = document.getElementById('rs-font-section');
  const fontSizeInput = document.getElementById('rs-input-fontsize');
  const fontFamilyInput = document.getElementById('rs-input-fontfamily');
  const textBgInput = document.getElementById('rs-input-textbg');
  const textShadowInput = document.getElementById('rs-input-textshadow');

  function applyPropertiesToActiveObject() {
    const obj = canvas.getActiveObject();
    if (!obj) return;

    if (obj.type === 'i-text' || obj.type === 'text') {
      obj.set({ fill: currentColor });
    } else if (obj.type === 'path' || obj.type === 'line' || obj.type === 'arrow') {
      obj.set({ stroke: currentColor, strokeWidth: currentThickness });
    } else if (obj.type === 'numberMarker') {
      obj.item(0).set({ fill: currentColor });
    } else if (!obj.isTemporaryFilterRect && obj.type !== 'image') {
      obj.set({ stroke: currentColor, fill: currentFill, strokeWidth: currentThickness });
    }
    
    if (activeTool === 'Pen' && canvas.freeDrawingBrush) {
      canvas.freeDrawingBrush.color = currentColor;
    } else if (activeTool === 'Highlight' && canvas.freeDrawingBrush) {
      canvas.freeDrawingBrush.color = new fabric.Color(currentColor).setAlpha(0.4).toRgba();
    }

    canvas.requestRenderAll();
    saveHistory();
  }

  document.querySelectorAll('.color-swatch').forEach(sw => {
    sw.addEventListener('click', (e) => {
      document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('active'));
      e.currentTarget.classList.add('active');
      currentColor = e.currentTarget.style.backgroundColor || e.currentTarget.style.background || '#000000';
      applyPropertiesToActiveObject();
    });
  });

  document.querySelectorAll('.fill-swatch').forEach(sw => {
    sw.addEventListener('click', (e) => {
      document.querySelectorAll('.fill-swatch').forEach(s => s.classList.remove('active'));
      e.currentTarget.classList.add('active');
      if (e.currentTarget.classList.contains('no-fill')) {
        currentFill = 'transparent';
      } else {
        currentFill = e.currentTarget.style.backgroundColor || e.currentTarget.style.background || '#000000';
      }
      applyPropertiesToActiveObject();
    });
  });

  thicknessSlider?.addEventListener('input', (e) => {
    currentThickness = parseInt(e.target.value);
    if(thicknessVal) thicknessVal.innerText = currentThickness + 'px';
    const obj = canvas.getActiveObject();
    if (obj && (obj.type === 'path' || obj.type === 'line' || obj.type === 'arrow' || obj.type === 'rect' || obj.type === 'ellipse' || obj.type === 'circle')) {
      obj.set({ strokeWidth: currentThickness });
      canvas.requestRenderAll();
    }
    if (activeTool === 'Pen') canvas.freeDrawingBrush.width = currentThickness;
    if (activeTool === 'Highlight') canvas.freeDrawingBrush.width = Math.max(20, currentThickness * 4);
  });
  thicknessSlider?.addEventListener('change', () => { if(canvas.getActiveObject()) saveHistory(); });

  opacitySlider?.addEventListener('input', (e) => {
    const val = parseInt(e.target.value);
    if(opacityVal) opacityVal.innerText = val + '%';
    const obj = canvas.getActiveObject();
    if (obj) {
      obj.set({ opacity: val / 100 });
      canvas.requestRenderAll();
    }
  });
  opacitySlider?.addEventListener('change', () => { if(canvas.getActiveObject()) saveHistory(); });

  radiusSlider?.addEventListener('input', (e) => {
    const val = parseInt(e.target.value);
    if(radiusVal) radiusVal.innerText = val + 'px';
    const obj = canvas.getActiveObject();
    if (obj && obj.type === 'rect') {
      obj.set({ rx: val, ry: val });
      canvas.requestRenderAll();
    }
  });
  radiusSlider?.addEventListener('change', () => { if(canvas.getActiveObject()?.type === 'rect') saveHistory(); });

  fontSizeInput?.addEventListener('change', (e) => {
    const obj = canvas.getActiveObject();
    if (obj && (obj.type === 'i-text' || obj.type === 'text')) {
      obj.set({ fontSize: parseInt(e.target.value) || 20 });
      canvas.requestRenderAll();
      saveHistory();
    }
  });

  fontFamilyInput?.addEventListener('change', (e) => {
    const obj = canvas.getActiveObject();
    if (obj && (obj.type === 'i-text' || obj.type === 'text')) {
      obj.set({ fontFamily: e.target.value });
      canvas.requestRenderAll();
      saveHistory();
    }
  });

  textBgInput?.addEventListener('change', (e) => {
    const obj = canvas.getActiveObject();
    if (obj && (obj.type === 'i-text' || obj.type === 'text')) {
      obj.set({ textBackgroundColor: e.target.checked ? '#000000' : '' });
      canvas.requestRenderAll();
      saveHistory();
    }
  });

  textShadowInput?.addEventListener('change', (e) => {
    const obj = canvas.getActiveObject();
    if (obj && (obj.type === 'i-text' || obj.type === 'text')) {
      obj.set({ shadow: e.target.checked ? new fabric.Shadow({ color: 'rgba(0,0,0,0.5)', blur: 4, offsetX: 2, offsetY: 2 }) : null });
      canvas.requestRenderAll();
      saveHistory();
    }
  });

  function updatePropsFromSelection() {
    const obj = canvas.getActiveObject();
    if (!obj || obj === cropRect) {
      rsDefault.style.display = 'block';
      rsProperties.style.display = 'none';
      return;
    }
    rsDefault.style.display = 'none';
    rsProperties.style.display = 'flex';
    
    const typeNames = {
      'rect': obj.rx > 0 ? 'Rounded Rect' : 'Rectangle',
      'ellipse': 'Ellipse',
      'line': 'Line',
      'arrow': 'Arrow',
      'i-text': 'Text',
      'text': 'Text',
      'path': 'Drawing',
      'image': obj.filterType === 'Blur' ? 'Blur' : obj.filterType === 'Pixelate' ? 'Pixelate' : 'Image',
      'numberMarker': 'Number Marker',
      'group': obj.markerNumber ? `Marker ${obj.markerNumber}` : 'Group'
    };
    rsPropTitle.innerText = typeNames[obj.type] || (obj.type.charAt(0).toUpperCase() + obj.type.slice(1));

    if(inputX) inputX.value = Math.round(obj.left);
    if(inputY) inputY.value = Math.round(obj.top);
    if(inputW) inputW.value = Math.round(obj.width * obj.scaleX);
    if(inputH) inputH.value = Math.round(obj.height * obj.scaleY);
    if(inputRot) inputRot.value = Math.round(obj.angle);

    if(opacitySlider) opacitySlider.value = Math.round(obj.opacity * 100);
    if(opacityVal) opacityVal.innerText = Math.round(obj.opacity * 100) + '%';
    
    // Show/hide sections based on type
    const colorSection = document.getElementById('rs-color-section');
    const fillSection = document.getElementById('rs-fill-section');
    const thickSection = document.getElementById('rs-thickness-section');
    
    const isText = (obj.type === 'i-text' || obj.type === 'text');
    const isShape = (obj.type === 'rect' || obj.type === 'ellipse');
    const isStroke = (obj.type === 'path' || obj.type === 'line' || obj.type === 'arrow');
    const isImage = (obj.type === 'image');
    const isMarker = (obj.type === 'numberMarker' || (obj.type === 'group' && obj.markerNumber));
    
    if (colorSection) colorSection.style.display = isImage ? 'none' : 'block';
    if (fillSection) fillSection.style.display = isShape ? 'block' : 'none';
    if (thickSection) thickSection.style.display = (isText || isImage || isMarker) ? 'none' : 'block';

    if (obj.type === 'rect') {
      if(radiusSlider) radiusSlider.parentElement.style.display = 'block';
      if(radiusSlider) radiusSlider.value = obj.rx || 0;
      if(radiusVal) radiusVal.innerText = (obj.rx || 0) + 'px';
    } else {
      if(radiusSlider) radiusSlider.parentElement.style.display = 'none';
    }

    if (isText) {
      if(fontSection) fontSection.style.display = 'block';
      if(fontSizeInput) fontSizeInput.value = obj.fontSize;
      if(fontFamilyInput) fontFamilyInput.value = obj.fontFamily;
      if(textBgInput) textBgInput.checked = !!obj.textBackgroundColor;
      if(textShadowInput) textShadowInput.checked = !!obj.shadow;
    } else {
      if(fontSection) fontSection.style.display = 'none';
    }
    
    if (thicknessSlider && obj.strokeWidth !== undefined) {
      thicknessSlider.value = obj.strokeWidth;
      if(thicknessVal) thicknessVal.innerText = obj.strokeWidth + 'px';
    }
  }

  canvas.on('selection:created', updatePropsFromSelection);
  canvas.on('selection:updated', updatePropsFromSelection);
  canvas.on('selection:cleared', updatePropsFromSelection);
  
  canvas.on('object:moving', updatePropsFromSelection);
  canvas.on('object:scaling', updatePropsFromSelection);
  canvas.on('object:rotating', updatePropsFromSelection);
  canvas.on('object:modified', updatePropsFromSelection);

  ['input-x', 'input-y', 'input-w', 'input-h', 'input-rot'].forEach(id => {
    document.getElementById('rs-' + id)?.addEventListener('change', (e) => {
      const obj = canvas.getActiveObject();
      if (!obj) return;
      const val = parseFloat(e.target.value);
      if (isNaN(val)) return;
      
      switch(id) {
        case 'input-x': obj.set({ left: val }); break;
        case 'input-y': obj.set({ top: val }); break;
        case 'input-w': obj.set({ scaleX: val / obj.width }); break;
        case 'input-h': obj.set({ scaleY: val / obj.height }); break;
        case 'input-rot': obj.set({ angle: val }); break;
      }
      obj.setCoords();
      canvas.requestRenderAll();
      saveHistory();
    });
  });

  document.getElementById('btn-bring-forward')?.addEventListener('click', () => {
    const obj = canvas.getActiveObject();
    if (obj && obj !== cropRect) {
      canvas.bringForward(obj);
      saveHistory();
    }
  });

  document.getElementById('btn-send-backward')?.addEventListener('click', () => {
    const obj = canvas.getActiveObject();
    if (obj && obj !== cropRect) {
      canvas.sendBackwards(obj);
      saveHistory();
    }
  });

  document.getElementById('btn-reset-markers')?.addEventListener('click', () => {
    globalMarkerCounter = 1;
  });

  // Objects List
  const objectsList = document.getElementById('rs-objects-list');
  const objectsCount = document.getElementById('rs-objects-count');
  const objectsEmpty = document.getElementById('rs-objects-empty');

  function updateObjectsList() {
    if (!objectsList) return;
    objectsList.innerHTML = '';
    const objects = canvas.getObjects();
    let count = 0;
    
    for (let i = objects.length - 1; i >= 0; i--) {
      const obj = objects[i];
      if (obj === cropRect || obj.isTemporaryFilterRect) continue;
      count++;
      
      const item = document.createElement('div');
      item.className = 'layer-item';
      if (canvas.getActiveObject() === obj) item.classList.add('active');
      
      item.onclick = (e) => {
        if(e.target.tagName === 'BUTTON' || e.target.parentElement.tagName === 'BUTTON') return;
        canvas.setActiveObject(obj);
        canvas.requestRenderAll();
      };
      
      let typeName = obj.type.charAt(0).toUpperCase() + obj.type.slice(1);
      if (obj.filterType) typeName = obj.filterType;
      
      item.innerHTML = `
        <span style="display:inline-block; width:12px; height:12px; border-radius:50%; background:${obj.fill && obj.fill !== 'transparent' ? obj.fill : (obj.stroke || '#fff')}; margin-right:8px;"></span>
        <span style="flex-grow:1; font-size:12px;">${typeName}</span>
        <button class="layer-btn visibility-btn">${obj.visible ? '👁️' : '👁️‍🗨️'}</button>
        <button class="layer-btn delete-btn">🗑️</button>
      `;
      
      item.querySelector('.visibility-btn').onclick = () => {
        obj.visible = !obj.visible;
        canvas.requestRenderAll();
        updateObjectsList();
      };
      item.querySelector('.delete-btn').onclick = () => {
        canvas.remove(obj);
        saveHistory();
      };
      
      objectsList.appendChild(item);
    }
    
    if(objectsCount) objectsCount.innerText = count;
    if(objectsEmpty) objectsEmpty.style.display = count === 0 ? 'block' : 'none';
  }

  // Export
  function getFinalDataURL() {
    const origVpt = canvas.viewportTransform;
    canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
    if (canvas.backgroundImage) {
      canvas.setWidth(canvas.backgroundImage.width);
      canvas.setHeight(canvas.backgroundImage.height);
    }
    canvas.discardActiveObject();
    if(cropRect) cropRect.visible = false;
    canvas.renderAll();
    
    const dataURL = canvas.toDataURL({ format: 'png' });
    
    resizeCanvas();
    canvas.setViewportTransform(origVpt);
    if(cropRect) cropRect.visible = true;
    canvas.renderAll();
    
    return dataURL;
  }

  // Export buttons - matched by position in the right toolbar section
  const rightSection = document.querySelector('.toolbar-section.right');
  if (rightSection) {
    const exportBtns = rightSection.querySelectorAll('.icon-btn');
    
    // Copy (1st button)
    if (exportBtns[0]) exportBtns[0].addEventListener('click', async () => {
      try {
        const dataURL = getFinalDataURL();
        const blob = await (await fetch(dataURL)).blob();
        await navigator.clipboard.write([
          new ClipboardItem({ 'image/png': blob })
        ]);
        alert('Copied to clipboard!');
      } catch (err) {
        alert('Failed to copy: ' + err);
      }
    });

    // PDF (2nd button)
    if (exportBtns[1]) exportBtns[1].addEventListener('click', () => {
      if (!window.jspdf || !window.jspdf.jsPDF) {
        alert('jsPDF library not loaded');
        return;
      }
      const dataURL = getFinalDataURL();
      const img = new Image();
      img.onload = () => {
        const pdf = new window.jspdf.jsPDF({
          orientation: img.width > img.height ? 'landscape' : 'portrait',
          unit: 'px',
          format: [img.width, img.height]
        });
        pdf.addImage(dataURL, 'PNG', 0, 0, img.width, img.height);
        pdf.save('Lumina-Annotation.pdf');
      };
      img.src = dataURL;
    });

    // Save Image (3rd button)
    if (exportBtns[2]) exportBtns[2].addEventListener('click', () => {
      const dataURL = getFinalDataURL();
      const a = document.createElement('a');
      a.href = dataURL;
      a.download = 'Lumina-Screenshot.png';
      a.click();
    });
  }

});