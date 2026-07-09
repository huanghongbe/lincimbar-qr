/**
 * encode.js — File → animate color barcode on screen
 */
const EncodeUI = (() => {
  'use strict';

  let grids = [], totalFrames = 0, currentFrame = 0;
  let animId = null, playing = false;
  let gridSize = Cimbar.DEFAULT_GRID;
  let frameMs = 300, repeatCount = 2;
  let canvas, ctx, canvasSize = 600;

  function init(canvasEl, size) {
    canvas = canvasEl;
    ctx = canvas.getContext('2d');
    canvasSize = size || 600;
    canvas.width = canvasSize;
    canvas.height = canvasSize;
  }

  async function loadFile(file) {
    stop();
    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    const result = Cimbar.encodeFile(bytes, file.name, gridSize);
    grids = result.grids;
    totalFrames = result.totalFrames;
    currentFrame = 0;
    return result;
  }

  function renderFrame(idx) {
    if (!grids.length) return;
    const i = idx % totalFrames;
    Cimbar.renderGrid(ctx, grids[i], canvasSize);
  }

  function tick() {
    if (!playing || !grids.length) return;
    renderFrame(currentFrame);
    currentFrame = (currentFrame + 1) % totalFrames;
    animId = setTimeout(tick, frameMs);
  }

  function play() {
    if (playing || !grids.length) return;
    playing = true;
    tick();
  }

  function pause() {
    playing = false;
    if (animId) { clearTimeout(animId); animId = null; }
  }

  function stop() {
    pause();
    grids = [];
    totalFrames = 0;
    currentFrame = 0;
    if (ctx && canvas) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  }

  function setGridSize(sz) { gridSize = sz; }
  function setSpeed(ms) { frameMs = ms; }
  function setRepeat(n) { repeatCount = n; }

  function getState() {
    return {
      playing, totalFrames, currentFrame,
      gridSize, frameMs, repeatCount,
      bytesPerFrame: Cimbar.bytesPerFrame(gridSize),
    };
  }

  return { init, loadFile, play, pause, stop, renderFrame,
           setGridSize, setSpeed, setRepeat, getState };
})();
