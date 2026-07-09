/**
 * decode.js — Camera scanner + file reconstruction for cimbar color barcodes
 */
const DecodeUI = (() => {
  'use strict';

  let videoEl, previewCanvas, previewCtx;
  let scanCanvas, scanCtx;
  let stream = null, scanning = false, scanTimer = null;
  let gridSize = Cimbar.DEFAULT_GRID;
  let frameData = {}, receivedFrames = new Set(), totalFrames = null;
  let fileName = null, lastFrameIdx = -1, finished = false;

  function init(videoElement, previewCanvasEl, scanWidth, scanHeight) {
    videoEl = videoElement;
    previewCanvas = previewCanvasEl;
    previewCtx = previewCanvas.getContext('2d');
    scanCanvas = document.createElement('canvas');
    scanCanvas.width = scanWidth || 400;
    scanCanvas.height = scanHeight || 300;
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
    fileName = null; lastFrameIdx = -1; finished = false;
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
    if (!scanning || !videoEl || videoEl.readyState < 2) return;
    drawPreview();
    const sw = scanCanvas.width, sh = scanCanvas.height;
    scanCtx.drawImage(videoEl, 0, 0, sw, sh);
    const imageData = scanCtx.getImageData(0, 0, sw, sh);
    const corners = Cimbar.findGridCorners(imageData, sw, sh);
    if (!corners) return;
    const grid = Cimbar.sampleGrid(imageData, sw, sh, corners, gridSize);
    const frame = Cimbar.decodeGrid(grid, gridSize);
    if (!frame) return;
    if (frame.frameIdx === lastFrameIdx) return;
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

    drawOverlay(corners);

    if (receivedFrames.size >= totalFrames) finishScan();
    return { frameIdx: frame.frameIdx, totalFrames, received: receivedFrames.size };
  }

  function drawOverlay(corners) {
    if (!previewCtx || !corners) return;
    const pw = previewCanvas.width, ph = previewCanvas.height;
    const sw = scanCanvas.width, sh = scanCanvas.height;
    const sx = pw / sw, sy = ph / sh;
    previewCtx.strokeStyle = '#00ff88'; previewCtx.lineWidth = 2;
    previewCtx.beginPath();
    previewCtx.moveTo(corners[0].x*sx, corners[0].y*sy);
    previewCtx.lineTo(corners[1].x*sx, corners[1].y*sy);
    previewCtx.lineTo(corners[3].x*sx, corners[3].y*sy);
    previewCtx.lineTo(corners[2].x*sx, corners[2].y*sy);
    previewCtx.closePath(); previewCtx.stroke();
  }

  function startScan() {
    if (!stream) return;
    scanning = true; resetAccumulator();
    scanTimer = setInterval(processFrame, 100);
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
      if (!f) return;
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

    return { fileName, size: result.length };
  }

  function setGridSize(sz) { gridSize = sz; }

  function getState() {
    return { scanning, totalFrames, receivedCount: receivedFrames.size, fileName, gridSize };
  }

  return { init, startCamera, stopCamera, startScan, pauseScan, processFrame,
           resetAccumulator, finishScan, setGridSize, getState };
})();
