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
  // Work in whole pixels: fractional or zero-sized canvases throw in drawImage
  rect = {
    left: Math.round(rect.left),
    top: Math.round(rect.top),
    width: Math.max(1, Math.round(rect.width)),
    height: Math.max(1, Math.round(rect.height))
  };
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
    
    const sw = Math.max(1, Math.round(w / block));
    const sh = Math.max(1, Math.round(h / block));
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = sw;
    tempCanvas.height = sh;
    const tempCtx = tempCanvas.getContext('2d');
    tempCtx.drawImage(bgImg, rect.left, rect.top, w, h, 0, 0, sw, sh);

    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(tempCanvas, 0, 0, sw, sh, 0, 0, w, h);
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
  const zoomText = document.getElementById('zoom-percentage');

  function updateZoomUI() {
    if (zoomText) zoomText.innerText = Math.round(canvas.getZoom() * 100) + '%';
  }

  // Small confirmation / error message at the top of the editor
  const toastEl = document.getElementById('editor-toast');
  let toastTimer = null;
  function showToast(message) {
    if (!toastEl) return;
    toastEl.textContent = message;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2200);
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
    // Tall screenshots would be unreadably small if fitted by height, so fit by
    // width and let the user scroll, unless the whole image fits comfortably.
    let scale = Math.min(scaleX, scaleY, 1);
    if (scale < 0.25) scale = Math.min(scaleX, 1);

    canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
    const center = canvas.getCenter();
    canvas.zoomToPoint(new fabric.Point(center.left, center.top), scale);
    
    const vpt = canvas.viewportTransform;
    vpt[4] = (canvas.width - bg.width * scale) / 2;
    vpt[5] = Math.max(padding / 2, (canvas.height - bg.height * scale) / 2);
    canvas.setViewportTransform(vpt);
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
  // Each entry holds the annotation objects plus a *reference* to the background
  // image. The screenshot itself is never copied into the history, otherwise a
  // few edits on a large capture would use hundreds of MB of memory.
  let history = [];
  let historyIndex = -1;
  let isHistoryAction = false;
  let screenshotMeta = {};

  const btnUndo = document.getElementById('btn-undo');
  const btnRedo = document.getElementById('btn-redo');

  function updateHistoryButtons() {
    if (btnUndo) btnUndo.disabled = historyIndex <= 0;
    if (btnRedo) btnRedo.disabled = historyIndex >= history.length - 1;
  }

  function updateStatusBar() {
    const dims = document.getElementById('status-dimensions');
    const bg = canvas.backgroundImage;
    if (dims) dims.textContent = bg ? `${bg.width} × ${bg.height} px` : '';
  }

  function saveHistory() {
    if (isHistoryAction) return;
    const bg = canvas.backgroundImage;
    canvas.backgroundImage = null; // keep the screenshot out of the JSON
    const json = canvas.toJSON(['selectable', 'evented', 'type', 'name', 'filterType', 'markerNumber', 'radius']);
    canvas.backgroundImage = bg;

    // Some actions fire two events for one change; don't record the same state twice
    const key = JSON.stringify(json.objects);
    const last = history[historyIndex];
    if (last && last.bg === bg && last.key === key) return;

    history.splice(historyIndex + 1);
    history.push({ json, key, bg, markerCounter: globalMarkerCounter });
    historyIndex = history.length - 1;
    updateHistoryButtons();
    updateObjectsList();
  }

  function restoreHistory(index) {
    if (isHistoryAction || index < 0 || index >= history.length) return;
    isHistoryAction = true;
    historyIndex = index;
    const entry = history[index];
    cleanupCrop();
    canvas.loadFromJSON(entry.json, () => {
      const bgChanged = bgImageElement !== (entry.bg && entry.bg.getElement());
      canvas.backgroundImage = entry.bg;
      bgImageElement = entry.bg ? entry.bg.getElement() : null;
      globalMarkerCounter = entry.markerCounter;
      isHistoryAction = false;
      setTool(activeTool === 'Crop' ? 'Pointer' : activeTool); // re-applies selectable/evented for the current tool
      if (bgChanged) setZoomToFit();
      canvas.renderAll();
      updateStatusBar();
      updateHistoryButtons();
      updateObjectsList();
    });
  }

  function doUndo() { restoreHistory(historyIndex - 1); }
  function doRedo() { restoreHistory(historyIndex + 1); }

  btnUndo?.addEventListener('click', doUndo);
  btnRedo?.addEventListener('click', doRedo);

  canvas.on('object:modified', (e) => { if (e.target !== cropRect) saveHistory(); });
  canvas.on('path:created', (e) => {
    // Free-drawn strokes should not be selectable while a drawing tool is active
    if (e.path) e.path.set({ selectable: activeTool === 'Pointer', evented: activeTool === 'Pointer' });
    saveHistory();
  });
  canvas.on('text:editing:exited', (e) => {
    if (e.target && !e.target.text.trim()) canvas.remove(e.target); // drop empty text boxes
    saveHistory();
  });

  // Renders the screenshot plus all annotations at full resolution, without
  // touching the on-screen canvas size or zoom.
  function exportFullImage() {
    const bg = canvas.backgroundImage;
    if (!bg) return null;
    const active = canvas.getActiveObject();
    if (active && active.isEditing) active.exitEditing();
    canvas.discardActiveObject();

    const origVpt = canvas.viewportTransform.slice();
    if (cropRect) cropRect.visible = false;
    canvas.viewportTransform = [1, 0, 0, 1, 0, 0];
    let dataURL;
    try {
      dataURL = canvas.toDataURL({ format: 'png', left: 0, top: 0, width: bg.width, height: bg.height });
    } finally {
      if (cropRect) cropRect.visible = true;
      canvas.setViewportTransform(origVpt);
      canvas.requestRenderAll();
    }
    return dataURL;
  }

  // Back Button
  document.getElementById('btn-back')?.addEventListener('click', async () => {
    try {
      const dataURL = exportFullImage();
      if (dataURL) {
        await chrome.storage.local.set({ screenshotData: dataURL, screenshotMeta });
      }
      window.location.href = 'output.html';
    } catch (err) {
      console.error('Failed to return to the viewer:', err);
      showToast('Could not go back. Save your image first, then try again.');
    }
  });

  // Load Image
  chrome.storage.local.get(['screenshotData', 'screenshotMeta'], (data) => {
    // Remove it straight away so it does not stay in storage if this tab is closed
    chrome.storage.local.remove(['screenshotData', 'screenshotMeta']);

    if (!data || !data.screenshotData) {
      const empty = document.getElementById('editor-empty');
      if (empty) empty.style.display = 'block';
      return;
    }

    screenshotMeta = data.screenshotMeta || {};
    const source = document.getElementById('status-source');
    if (source) {
      const label = screenshotMeta.url || screenshotMeta.title || '';
      source.textContent = label;
      source.title = label;
    }

    fabric.Image.fromURL(data.screenshotData, (img) => {
      bgImageElement = img.getElement();
      img.set({ selectable: false, evented: false });
      canvas.setBackgroundImage(img, canvas.renderAll.bind(canvas));
      setZoomToFit();
      saveHistory();
      updateStatusBar();
    });
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

  function brushWidth() { return Math.max(12, currentThickness * 3); }

  function setTool(toolName) {
    document.querySelectorAll('.left-sidebar .tool-btn').forEach(b => b.classList.remove('active'));
    const btn = document.querySelector(`.left-sidebar .tool-btn[data-tool="${toolName}"]`);
    if(btn) btn.classList.add('active');
    
    activeTool = toolName;
    cleanupCrop();
    canvas.discardActiveObject();
    
    canvas.isDrawingMode = (toolName === 'Pen' || toolName === 'Brush' || toolName === 'Highlight');
    canvas.selection = (toolName === 'Pointer');
    canvas.defaultCursor = (toolName === 'Pointer') ? 'default' : (canvas.isDrawingMode ? 'default' : 'crosshair');

    if (toolName === 'Pen') {
      canvas.freeDrawingBrush = new fabric.PencilBrush(canvas);
      canvas.freeDrawingBrush.color = currentColor;
      canvas.freeDrawingBrush.width = currentThickness;
    } else if (toolName === 'Brush') {
      // A thick, round marker stroke
      canvas.freeDrawingBrush = new fabric.PencilBrush(canvas);
      canvas.freeDrawingBrush.color = currentColor;
      canvas.freeDrawingBrush.width = brushWidth();
      canvas.freeDrawingBrush.strokeLineCap = 'round';
      canvas.freeDrawingBrush.strokeLineJoin = 'round';
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
      cropRatio = null;
      document.querySelectorAll('.crop-aspect-btn').forEach(b => b.classList.toggle('active', b.getAttribute('data-aspect') === 'free'));
      cropRect = new fabric.Rect({
        left: Math.round(bg.width / 2 - cw / 2),
        top: Math.round(bg.height / 2 - ch / 2),
        width: Math.round(cw),
        height: Math.round(ch),
        fill: 'transparent',
        strokeWidth: 0, // the dashed outline is drawn by the overlay, so the rect is exactly the crop area
        cornerColor: '#007AFF',
        transparentCorners: false,
        selectable: true,
        evented: true,
        lockRotation: true,
        excludeFromExport: true // never part of undo history or exports
      });
      cropRect.setControlVisible('mtr', false);
      canvas.add(cropRect);
      canvas.setActiveObject(cropRect);
      cropOverlay.style.display = 'block';
      cropPill.style.display = 'block';
      cropActionBar.style.display = 'flex';
      syncCropOverlay();
    }

    canvas.requestRenderAll();
    updatePropsFromSelection();
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
      const sideHandles = { mt: true, mb: true, ml: true, mr: true };
      if (aspect === 'free') {
        cropRatio = null;
      } else {
        const [w, h] = aspect.split(':').map(Number);
        cropRatio = w / h;
        const bg = canvas.backgroundImage;
        // Keep the current height where possible, but never grow past the image
        let newH = cropRect.getScaledHeight();
        let newW = newH * cropRatio;
        if (bg && newW > bg.width) {
          newW = bg.width;
          newH = newW / cropRatio;
        }
        cropRect.set({ width: newW, height: newH, scaleX: 1, scaleY: 1 });
        if (bg) {
          cropRect.set({
            left: Math.max(0, Math.min(cropRect.left, bg.width - newW)),
            top: Math.max(0, Math.min(cropRect.top, bg.height - newH))
          });
        }
        // Corner handles scale proportionally; the side handles would break the ratio
        Object.keys(sideHandles).forEach(k => { sideHandles[k] = false; });
      }
      cropRect.setControlsVisibility(sideHandles);
      cropRect.setCoords();
      canvas.requestRenderAll();
      syncCropOverlay();
    });
  });

  document.getElementById('btn-cancel-crop')?.addEventListener('click', () => setTool('Pointer'));
  document.getElementById('btn-apply-crop')?.addEventListener('click', () => {
    const bg = canvas.backgroundImage;
    if (!cropRect || !bg || !bgImageElement) return;

    // Crop area in image pixels, clamped to the image
    const x1 = Math.max(0, Math.round(cropRect.left));
    const y1 = Math.max(0, Math.round(cropRect.top));
    const x2 = Math.min(bg.width, Math.round(cropRect.left + cropRect.getScaledWidth()));
    const y2 = Math.min(bg.height, Math.round(cropRect.top + cropRect.getScaledHeight()));
    const cropLeft = x1;
    const cropTop = y1;
    const cropWidth = x2 - x1;
    const cropHeight = y2 - y1;
    if (cropWidth < 1 || cropHeight < 1) {
      showToast('The crop area is outside the image.');
      return;
    }

    // Crop only the screenshot itself. Annotations stay as separate, editable
    // objects and are simply shifted below.
    const cropCanvas = document.createElement('canvas');
    cropCanvas.width = cropWidth;
    cropCanvas.height = cropHeight;
    cropCanvas.getContext('2d').drawImage(bgImageElement, cropLeft, cropTop, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);
    const croppedDataURL = cropCanvas.toDataURL('image/png');

    fabric.Image.fromURL(croppedDataURL, (img) => {
      bgImageElement = img.getElement();
      img.set({ selectable: false, evented: false });

      // Remove cropRect and reposition all objects
      canvas.remove(cropRect);
      cropRect = null;
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
        updateStatusBar();
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
    if (opt.e.button !== 0) return; // only the main mouse button draws
    if (!canvas.backgroundImage) return;

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
      const textObj = currentShape;
      currentShape = null;
      isDrawingShape = false;
      // Switch to the pointer first: setTool() clears the selection, which would
      // otherwise kick the new text box straight out of edit mode.
      setTool('Pointer');
      canvas.add(textObj);
      canvas.setActiveObject(textObj);
      textObj.enterEditing();
      textObj.selectAll();
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
        strokeWidth: 1,
        selectable: false,
        evented: false,
        isTemporaryFilterRect: true,
        excludeFromExport: true
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
      // Keep our own references: currentShape is reset below, before the image has loaded
      const tempRect = currentShape;
      const filterType = activeTool;
      const br = {
        left: Math.round(tempRect.left),
        top: Math.round(tempRect.top),
        width: Math.max(1, Math.round(tempRect.width)),
        height: Math.max(1, Math.round(tempRect.height))
      };
      const filterDataURL = generateFilterRegionDataURL(br, filterType, bgImageElement);

      fabric.Image.fromURL(filterDataURL, (img) => {
        img.set({
          left: br.left,
          top: br.top,
          selectable: (activeTool === 'Pointer'),
          evented: (activeTool === 'Pointer'),
          filterType: filterType
        });
        canvas.remove(tempRect);
        canvas.add(img);
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

    const key = (e.key || '').toLowerCase();

    // Undo: Cmd/Ctrl+Z. Redo: Cmd/Ctrl+Shift+Z or Cmd/Ctrl+Y.
    if ((e.metaKey || e.ctrlKey) && (key === 'z' || key === 'y')) {
      e.preventDefault();
      if (key === 'y' || e.shiftKey) doRedo();
      else doUndo();
      return;
    }

    const keyMap = {
      'v': 'Pointer', 'r': 'Rectangle', 'c': 'Circle', 'a': 'Arrow', 'l': 'Line',
      'p': 'Pen', 't': 'Text', 'h': 'Highlight', 'b': 'Blur', 'n': 'NumberMarker'
    };
    if (keyMap[key] && !e.metaKey && !e.ctrlKey && !e.altKey) {
      setTool(keyMap[key]);
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

  // what: 'color' or 'fill' - only the property the user just changed is applied
  function applyPropertiesToActiveObject(what) {
    // Keep the drawing brush in sync even when nothing is selected
    if ((activeTool === 'Pen' || activeTool === 'Brush') && canvas.freeDrawingBrush) {
      canvas.freeDrawingBrush.color = currentColor;
    } else if (activeTool === 'Highlight' && canvas.freeDrawingBrush) {
      canvas.freeDrawingBrush.color = new fabric.Color(currentColor).setAlpha(0.4).toRgba();
    }

    const obj = canvas.getActiveObject();
    if (!obj || obj === cropRect || obj.type === 'activeSelection') return;

    if (obj.type === 'i-text' || obj.type === 'text') {
      if (what === 'color') obj.set({ fill: currentColor });
    } else if (obj.type === 'path' || obj.type === 'line' || obj.type === 'arrow') {
      if (what === 'color') obj.set({ stroke: currentColor });
    } else if (obj.type === 'numberMarker') {
      if (what === 'color') {
        obj.item(0).set({ fill: currentColor });
        obj.set({ fill: currentColor, dirty: true });
      }
    } else if (obj.type === 'rect' && !obj.stroke && what === 'color') {
      obj.set({ fill: currentColor }); // solid redaction box
    } else if (obj.type === 'rect' || obj.type === 'ellipse') {
      if (what === 'color') obj.set({ stroke: currentColor });
      else obj.set({ fill: currentFill });
    } else {
      return; // images (blur / pixelate) have no colour
    }

    canvas.requestRenderAll();
    saveHistory();
  }

  document.querySelectorAll('.color-swatch').forEach(sw => {
    sw.addEventListener('click', (e) => {
      document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('active'));
      e.currentTarget.classList.add('active');
      currentColor = e.currentTarget.style.backgroundColor || e.currentTarget.style.background || '#000000';
      applyPropertiesToActiveObject('color');
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
      applyPropertiesToActiveObject('fill');
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
    if (activeTool === 'Brush') canvas.freeDrawingBrush.width = brushWidth();
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

  const TOOL_TITLES = {
    Rectangle: 'Rectangle', RoundedRectangle: 'Rounded Rect', Circle: 'Ellipse', Arrow: 'Arrow', Line: 'Line',
    Pen: 'Pen', Brush: 'Brush', Highlight: 'Highlighter', Text: 'Text', NumberMarker: 'Number Marker', Solid: 'Solid Redact'
  };

  function updatePropsFromSelection() {
    const obj = canvas.getActiveObject();
    const setDisplay = (id, show) => {
      const el = document.getElementById(id);
      if (el) el.style.display = show ? 'block' : 'none';
    };

    if (!obj || obj === cropRect) {
      // No selection: if a drawing tool is active, show the style it will draw with
      if (TOOL_TITLES[activeTool]) {
        rsDefault.style.display = 'none';
        rsProperties.style.display = 'flex';
        rsPropTitle.innerText = TOOL_TITLES[activeTool];
        const isShapeTool = ['Rectangle', 'RoundedRectangle', 'Circle'].includes(activeTool);
        const hasStroke = !['Text', 'NumberMarker', 'Solid'].includes(activeTool);
        setDisplay('rs-transform-section', false);
        setDisplay('rs-opacity-section', false);
        setDisplay('rs-radius-section', false);
        setDisplay('rs-font-section', false);
        setDisplay('rs-color-section', true);
        setDisplay('rs-fill-section', isShapeTool);
        setDisplay('rs-thickness-section', hasStroke);
        if (thicknessSlider) thicknessSlider.value = currentThickness;
        if (thicknessVal) thicknessVal.innerText = currentThickness + 'px';
      } else {
        rsDefault.style.display = 'block';
        rsProperties.style.display = 'none';
      }
      return;
    }
    rsDefault.style.display = 'none';
    rsProperties.style.display = 'flex';
    setDisplay('rs-transform-section', true);
    setDisplay('rs-opacity-section', true);

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
        if (e.target.closest('button')) return;
        if (activeTool !== 'Pointer') setTool('Pointer');
        if (!obj.visible) return;
        canvas.setActiveObject(obj);
        canvas.requestRenderAll();
        updateObjectsList();
      };
      
      let typeName = obj.type.charAt(0).toUpperCase() + obj.type.slice(1);
      if (obj.filterType) typeName = obj.filterType;
      
      const LAYER_NAMES = { 'i-text': 'Text', path: 'Drawing', numberMarker: 'Number Marker', rect: 'Rectangle' };
      if (LAYER_NAMES[obj.type]) typeName = LAYER_NAMES[obj.type];
      if (obj.type === 'rect' && !obj.stroke) typeName = 'Redaction';
      if (obj.markerNumber) typeName = `Marker ${obj.markerNumber}`;

      const fillColor = (typeof obj.fill === 'string' && obj.fill && obj.fill !== 'transparent') ? obj.fill : (obj.stroke || '#fff');

      const swatch = document.createElement('span');
      swatch.className = 'layer-swatch';
      swatch.style.background = fillColor;

      const name = document.createElement('span');
      name.className = 'layer-name';
      name.textContent = typeName;

      const visBtn = document.createElement('button');
      visBtn.className = 'layer-btn visibility-btn';
      visBtn.title = obj.visible ? 'Hide' : 'Show';
      visBtn.textContent = obj.visible ? '👁️' : '🚫';
      visBtn.onclick = () => {
        obj.visible = !obj.visible;
        if (!obj.visible) canvas.discardActiveObject();
        canvas.requestRenderAll();
        saveHistory();
      };

      const delBtn = document.createElement('button');
      delBtn.className = 'layer-btn delete-btn';
      delBtn.title = 'Delete';
      delBtn.textContent = '🗑️';
      delBtn.onclick = () => {
        canvas.remove(obj);
        canvas.discardActiveObject();
        canvas.requestRenderAll();
        saveHistory();
      };

      item.append(swatch, name, visBtn, delBtn);

      objectsList.appendChild(item);
    }
    
    if(objectsCount) objectsCount.innerText = count;
    if(objectsEmpty) objectsEmpty.style.display = count === 0 ? 'block' : 'none';
  }

  // Export
  function buildFileBase() {
    const d = new Date();
    const pad = n => String(n).padStart(2, '0');
    const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
    const title = (screenshotMeta.title || '')
      .replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 60);
    return title ? `Lumina_${title}_${stamp}` : `Lumina_${stamp}`;
  }

  // Copy
  document.getElementById('btn-copy')?.addEventListener('click', async () => {
    try {
      const dataURL = exportFullImage();
      if (!dataURL) return;
      const blob = await (await fetch(dataURL)).blob();
      await navigator.clipboard.write([
        new ClipboardItem({ 'image/png': blob })
      ]);
      showToast('Copied to clipboard');
    } catch (err) {
      console.error('Failed to copy:', err);
      showToast('Could not copy. Very large images may be too big; use Save image instead.');
    }
  });

  // PDF
  document.getElementById('btn-pdf')?.addEventListener('click', () => {
    if (!window.jspdf || !window.jspdf.jsPDF) {
      showToast('PDF export is unavailable.');
      return;
    }
    const bg = canvas.backgroundImage;
    if (!bg) return;
    showToast('Creating PDF…');

    // Let the message paint before the heavy work starts
    setTimeout(() => {
      try {
        // Render straight to JPEG: jsPDF is very slow (and can run out of memory)
        // when it has to decode a large PNG itself.
        const active = canvas.getActiveObject();
        if (active && active.isEditing) active.exitEditing();
        canvas.discardActiveObject();
        const origVpt = canvas.viewportTransform.slice();
        const origBgColor = canvas.backgroundColor;
        if (cropRect) cropRect.visible = false;
        canvas.viewportTransform = [1, 0, 0, 1, 0, 0];
        canvas.backgroundColor = '#ffffff';
        let jpeg;
        try {
          jpeg = canvas.toDataURL({ format: 'jpeg', quality: 0.95, left: 0, top: 0, width: bg.width, height: bg.height });
        } finally {
          canvas.backgroundColor = origBgColor;
          if (cropRect) cropRect.visible = true;
          canvas.setViewportTransform(origVpt);
          canvas.requestRenderAll();
        }

        // A PDF page cannot be larger than 14,400 pt (jsPDF's "px" unit is 0.75 pt)
        const maxPagePx = 14400 / 0.75;
        const fit = Math.min(1, maxPagePx / Math.max(bg.width, bg.height));
        const pageW = bg.width * fit;
        const pageH = bg.height * fit;

        const pdf = new window.jspdf.jsPDF({
          orientation: pageW > pageH ? 'landscape' : 'portrait',
          unit: 'px',
          format: [pageW, pageH],
          compress: true
        });
        pdf.addImage(jpeg, 'JPEG', 0, 0, pageW, pageH);
        pdf.save(`${buildFileBase()}.pdf`);
      } catch (err) {
        console.error('PDF generation failed:', err);
        showToast('Could not create the PDF.');
      }
    }, 50);
  });

  // Save Image
  document.getElementById('btn-save')?.addEventListener('click', async () => {
    try {
      const dataURL = exportFullImage();
      if (!dataURL) return;
      // A blob: URL is used because very large data: URLs can fail to download
      const blob = await (await fetch(dataURL)).blob();
      const blobUrl = URL.createObjectURL(blob);
      setTimeout(() => URL.revokeObjectURL(blobUrl), 120000);
      await chrome.downloads.download({ url: blobUrl, filename: `${buildFileBase()}.png`, saveAs: true });
    } catch (err) {
      if (!/cancel/i.test(String(err && err.message))) {
        console.error('Failed to save image:', err);
        showToast('Could not save the image.');
      }
    }
  });

  updateHistoryButtons();
  updateObjectsList();
});