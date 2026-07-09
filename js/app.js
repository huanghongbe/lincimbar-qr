/**
 * app.js — Main application: tab switching, UI wiring, initialization
 */
(function () {
  'use strict';

  const GRID_SIZE = Cimbar.DEFAULT_GRID;
  const BARCODE_SIZE = 600;
  const $ = (sel) => document.querySelector(sel);

  const tabEncode = $('#tab-encode'), tabDecode = $('#tab-decode');
  const panelEncode = $('#panel-encode'), panelDecode = $('#panel-decode');
  const fileInput = $('#file-input'), dropZone = $('#drop-zone');
  const encodeCanvas = $('#encode-canvas');
  const btnPlay = $('#btn-play'), btnPause = $('#btn-pause'), btnStop = $('#btn-stop');
  const encodeStatus = $('#encode-status'), encodeProgress = $('#encode-progress');
  const speedSlider = $('#speed-slider'), speedLabel = $('#speed-label');
  const gridSelect = $('#grid-select');
  const decodeVideo = $('#decode-video'), decodePreview = $('#decode-preview');
  const btnStartCam = $('#btn-start-cam'), btnStopCam = $('#btn-stop-cam');
  const btnScan = $('#btn-scan'), btnPauseScan = $('#btn-pause-scan');
  const decodeStatus = $('#decode-status'), decodeProgress = $('#decode-progress');
  const cameraSelect = $('#camera-select');

  let encodeInterval = null, decodeInterval = null;

  function clearEncodeInterval() {
    if (encodeInterval) { clearInterval(encodeInterval); encodeInterval = null; }
  }
  function clearDecodeInterval() {
    if (decodeInterval) { clearInterval(decodeInterval); decodeInterval = null; }
  }

  EncodeUI.init(encodeCanvas, BARCODE_SIZE);
  DecodeUI.init(decodeVideo, decodePreview, 400, 300);

  // --- Tab switching ---
  function switchTab(tab) {
    clearEncodeInterval(); clearDecodeInterval();
    if (tab === 'encode') {
      tabEncode.classList.add('active'); tabDecode.classList.remove('active');
      panelEncode.classList.add('active'); panelDecode.classList.remove('active');
      DecodeUI.stopCamera(); EncodeUI.pause();
    } else {
      tabDecode.classList.add('active'); tabEncode.classList.remove('active');
      panelDecode.classList.add('active'); panelEncode.classList.remove('active');
    }
    document.body.dataset.tab = tab;
  }
  tabEncode.addEventListener('click', () => switchTab('encode'));
  tabDecode.addEventListener('click', () => switchTab('decode'));

  // --- Encode Panel ---
  function updateEncodeStatus() {
    const s = EncodeUI.getState();
    encodeProgress.textContent = s.totalFrames
      ? 'Frame ' + (s.currentFrame+1) + ' / ' + s.totalFrames + '  |  ' + s.bytesPerFrame + ' B/frame' : '';
    encodeStatus.textContent = s.totalFrames
      ? (s.playing ? 'Animating…' : 'Paused') : 'Select a file to begin';
  }

  async function handleFile(file) {
    clearEncodeInterval();
    try {
      encodeStatus.textContent = 'Encoding…';
      const result = await EncodeUI.loadFile(file);
      const s = EncodeUI.getState();
      encodeStatus.textContent = 'Ready — ' + result.totalFrames + ' frames, ' + s.bytesPerFrame + ' bytes each';
      EncodeUI.renderFrame(0); updateEncodeStatus();
    } catch (e) { encodeStatus.textContent = 'Error: ' + e.message; }
  }

  fileInput.addEventListener('change', () => { if (fileInput.files.length) handleFile(fileInput.files[0]); });
  dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('dragover'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
  dropZone.addEventListener('drop', e => {
    e.preventDefault(); dropZone.classList.remove('dragover');
    if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
  });
  dropZone.addEventListener('click', () => fileInput.click());

  btnPlay.addEventListener('click', () => {
    EncodeUI.play(); updateEncodeStatus();
    clearEncodeInterval();
    encodeInterval = setInterval(updateEncodeStatus, 400);
  });
  btnPause.addEventListener('click', () => { EncodeUI.pause(); clearEncodeInterval(); updateEncodeStatus(); });
  btnStop.addEventListener('click', () => { EncodeUI.stop(); clearEncodeInterval(); updateEncodeStatus(); });

  speedSlider.addEventListener('input', () => {
    const ms = parseInt(speedSlider.value);
    EncodeUI.setSpeed(ms); speedLabel.textContent = ms + 'ms';
  });
  EncodeUI.setSpeed(parseInt(speedSlider.value));

  gridSelect.addEventListener('change', () => {
    const sz = parseInt(gridSelect.value);
    EncodeUI.setGridSize(sz); DecodeUI.setGridSize(sz);
    encodeStatus.textContent = 'Grid changed — reselect file to re-encode';
  });

  // --- Decode Panel ---
  function updateDecodeStatus() {
    const s = DecodeUI.getState();
    if (s.totalFrames) decodeProgress.textContent = s.receivedCount + ' / ' + s.totalFrames + ' frames';
    if (s.totalFrames && s.receivedCount >= s.totalFrames) {
      decodeStatus.textContent = 'File received: ' + (s.fileName || 'unknown');
      clearDecodeInterval();
      return;
    }
    decodeStatus.textContent = s.scanning ? 'Scanning…' : (s.totalFrames ? 'Paused' : 'Ready');
  }

  btnStartCam.addEventListener('click', async () => {
    try {
      decodeStatus.textContent = 'Starting camera…';
      await DecodeUI.startCamera(cameraSelect.value);
      decodeStatus.textContent = 'Camera ready — point at barcode';
    } catch (e) { decodeStatus.textContent = 'Camera error: ' + e.message; }
  });
  btnStopCam.addEventListener('click', () => { DecodeUI.stopCamera(); clearDecodeInterval(); decodeStatus.textContent = 'Camera stopped'; decodeProgress.textContent = ''; });
  btnScan.addEventListener('click', () => {
    DecodeUI.startScan(); updateDecodeStatus();
    clearDecodeInterval();
    decodeInterval = setInterval(updateDecodeStatus, 300);
  });
  btnPauseScan.addEventListener('click', () => { DecodeUI.pauseScan(); clearDecodeInterval(); updateDecodeStatus(); });

  // --- Init ---
  switchTab('encode');
})();
