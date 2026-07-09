/**
 * decode.js — Camera scanner + file reconstruction for cimbar color barcodes
 */
const DecodeUI = (() => {
  'use strict';

  let videoEl, previewCanvas, previewCtx;
  let scanCanvas, scanCtx;
  let stream = null, scanning = false, scanTimer = null;
  let frameData = {}, receivedFrames = new Set(), totalFrames = null;
  let fileName = null, lastFrameIdx = -1, finished = false, framesOk = 0;
  let lastCorners = null, debugCount = 0;
  // Saved detect params from first successful frame
  let detectedGridSize = null, detectedBitsPerCell = null;

  function init(videoElement, previewCanvasEl, scanWidth, scanHeight) {
    videoEl = videoElement;
    previewCanvas = previewCanvasEl;
    previewCtx = previewCanvas.getContext('2d');
    scanCanvas = document.createElement('canvas');
    scanCanvas.width = scanWidth || 800;
    scanCanvas.height = scanHeight || 600;
    scanCtx = scanCanvas.getContext('2d');
  }

  async function startCamera(facingMode) {
    stopCamera();
    const constraints = {
      video: { facingMode: facingMode || 'environment', width: {ideal:1280}, height: {ideal:720} },
      audio: false,
    };
    stream = await navigator.mediaDevices.getUserMedia(constraints);
    videoEl.srcObject = stream;
    await videoEl.play();
  }

  function stopCamera() {
    scanning = false;
    if (scanTimer) { clearInterval(scanTimer); scanTimer = null; }
    if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
    if (videoEl) videoEl.srcObject = null;
    resetAccumulator();
  }

  function resetAccumulator() {
    frameData = {}; receivedFrames = new Set(); totalFrames = null;
    fileName = null; lastFrameIdx = -1; finished = false; framesOk = 0;
    lastCorners = null; debugCount = 0;
    detectedGridSize = null; detectedBitsPerCell = null;
  }

  function drawPreview() {
    if (!videoEl || !previewCtx || videoEl.readyState < 2) return;
    const vw = videoEl.videoWidth, vh = videoEl.videoHeight;
    const pw = previewCanvas.width, ph = previewCanvas.height;
    const scale = Math.min(pw / vw, ph / vh);
    const dx = (pw - vw * scale) / 2, dy = (ph - vh * scale) / 2;
    previewCtx.clearRect(0, 0, pw, ph);
    previewCtx.drawImage(videoEl, dx, dy, vw * scale, vh * scale);
  }

  function processFrame() {
    if (!scanning || !videoEl || videoEl.readyState < 2) return null;

    drawPreview();
    const sw = scanCanvas.width, sh = scanCanvas.height;
    scanCtx.drawImage(videoEl, 0, 0, sw, sh);
    const imageData = scanCtx.getImageData(0, 0, sw, sh);

    const corners = Cimbar.findGridCorners(imageData, sw, sh);
    if (corners) lastCorners = corners;
    drawOverlay(lastCorners);

    if (!corners) { debugCount++; return null; }

    let frame;

    if (detectedGridSize !== null) {
      // Use known params for speed
      const pal = Cimbar.paletteFor(detectedBitsPerCell === 3 ? 8 : 4);
      const grid = Cimbar.sampleGrid(imageData, sw, sh, corners, detectedGridSize, pal);
      frame = Cimbar.decodeGrid(grid, detectedGridSize, detectedBitsPerCell);
    } else {
      // Auto-detect: try all combos
      frame = Cimbar.autoDetectFrame(imageData, sw, sh, corners);
      if (frame) {
        detectedGridSize = frame.gridSize;
        detectedBitsPerCell = (frame.colorDepth === 8) ? 3 : 2;
      }
    }

    if (!frame) {
      debugCount++;
      drawDebugText('No valid frame (tried 5 grids × 2 colors) #' + debugCount);
      return null;
    }

    debugCount = 0;
    framesOk++;
    drawDebugText('OK frame ' + frame.frameIdx + '/' + frame.totalFrames +
                  ' [' + detectedGridSize + 'x' + detectedGridSize + ' ' +
                  (detectedBitsPerCell === 3 ? 8 : 4) + 'c]');

    if (frame.frameIdx === lastFrameIdx) {
      return { frameIdx: frame.frameIdx, totalFrames: totalFrames || frame.totalFrames, received: receivedFrames.size };
    }
    lastFrameIdx = frame.frameIdx;

    if (totalFrames === null) totalFrames = frame.totalFrames;

    if (!receivedFrames.has(frame.frameIdx)) {
      receivedFrames.add(frame.frameIdx);
      frameData[frame.frameIdx] = frame;
      if (frame.hasFilename && frame.payload && frame.payload.length > 1) {
        const fLen = frame.payload[0];
        if (fLen > 0 && fLen < frame.payload.length)
          fileName = new TextDecoder().decode(frame.payload.subarray(1, 1 + fLen));
      }
    }

    if (receivedFrames.size >= totalFrames) finishScan();
    return { frameIdx: frame.frameIdx, totalFrames, received: receivedFrames.size };
  }

  function drawOverlay(corners) {
    if (!previewCtx) return;
    const pw = previewCanvas.width, ph = previewCanvas.height;
    const sw = scanCanvas.width, sh = scanCanvas.height;
    const sx = pw / sw, sy = ph / sh;

    if (corners) {
      previewCtx.strokeStyle = '#00ff88'; previewCtx.lineWidth = 3;
      previewCtx.beginPath();
      previewCtx.moveTo(corners[0].x*sx, corners[0].y*sy);
      previewCtx.lineTo(corners[1].x*sx, corners[1].y*sy);
      previewCtx.lineTo(corners[3].x*sx, corners[3].y*sy);
      previewCtx.lineTo(corners[2].x*sx, corners[2].y*sy);
      previewCtx.closePath(); previewCtx.stroke();

      previewCtx.fillStyle = '#ff0';
      for (const c of corners) {
        previewCtx.beginPath();
        previewCtx.arc(c.x*sx, c.y*sy, 5, 0, Math.PI*2);
        previewCtx.fill();
      }
    }
  }

  function drawDebugText(msg) {
    if (!previewCtx) return;
    previewCtx.fillStyle = 'rgba(0,0,0,0.65)';
    previewCtx.fillRect(6, 6, 320, 26);
    previewCtx.fillStyle = '#0f0';
    previewCtx.font = '15px monospace';
    previewCtx.fillText(msg, 14, 25);
  }

  function startScan() {
    if (!stream) return;
    scanning = true; resetAccumulator();
    scanTimer = setInterval(processFrame, 150);
  }

  function pauseScan() {
    scanning = false;
    if (scanTimer) { clearInterval(scanTimer); scanTimer = null; }
  }

  function finishScan() {
    if (finished) return;
    finished = true;
    pauseScan();

    const payloads = [];
    for (let i = 0; i < totalFrames; i++) {
      const f = frameData[i];
      if (!f) { drawDebugText('MISSING frame ' + i + ' — keep scanning'); finished = false; startScan(); return; }
      if (f.hasFilename) {
        const fLen = f.payload[0];
        payloads.push(f.payload.subarray(1 + fLen));
      } else {
        payloads.push(f.payload);
      }
    }

    let totalLen = 0;
    for (const p of payloads) totalLen += p.length;
    const result = new Uint8Array(totalLen);
    let offset = 0;
    for (const p of payloads) { result.set(p, offset); offset += p.length; }

    const blob = new Blob([result]);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = fileName || 'received_file';
    document.body.appendChild(a); a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    drawDebugText('DOWNLOADED: ' + (fileName || 'file') + ' (' + result.length + 'B)');
    return { fileName, size: result.length };
  }

  function getState() {
    return {
      scanning, totalFrames, receivedCount: receivedFrames.size,
      receivedSet: receivedFrames, fileName, framesOk,
      detectedGridSize, detectedBitsPerCell,
    };
  }

  return { init, startCamera, stopCamera, startScan, pauseScan, processFrame,
           resetAccumulator, finishScan, getState };
})();
