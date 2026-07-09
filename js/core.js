/**
 * libcimbar.js — Core encoding/decoding engine for color barcode file transfer
 */
const Cimbar = (() => {
  'use strict';

  const MAGIC = 0xb4;
  const VERSION = 0x01;

  const MARKER_COLOR = [0, 140, 140];
  const DATA_COLORS_4 = [
    [30, 30, 30], [220, 50, 50], [50, 180, 50], [50, 100, 220],
  ];
  const DATA_COLORS_8 = [
    [30, 30, 30], [220, 50, 50], [50, 180, 50], [50, 100, 220],
    [220, 200, 30], [200, 50, 180], [30, 200, 200], [220, 220, 220],
  ];
  const CORNER_MARKER = [255, 255, 255];
  const BORDER_CELLS = 2;
  const DEFAULT_GRID = 30;
  const DEFAULT_COLORS = 8;
  const TRIAL_GRIDS = [24, 30, 36, 42, 48];
  const TRIAL_COLORS = [8, 4];

  function dataCellsPerSide(g) { return g - 2 * BORDER_CELLS; }
  function totalDataCells(g) { return dataCellsPerSide(g) ** 2; }
  function bytesPerFrame(g, bpc) { return Math.floor((totalDataCells(g) * bpc) / 8); }
  function paletteFor(colors) { return colors === 8 ? DATA_COLORS_8 : DATA_COLORS_4; }
  function bitsPerCellFor(colors) { return colors === 8 ? 3 : 2; }

  function crc16(data) {
    let crc = 0xffff;
    for (let i = 0; i < data.length; i++) {
      crc ^= data[i] & 0xff;
      for (let j = 0; j < 8; j++) {
        if (crc & 1) crc = (crc >>> 1) ^ 0xa001;
        else crc >>>= 1;
      }
    }
    return crc & 0xffff;
  }

  function bytesToBits(bytes) {
    const bits = [];
    for (const b of bytes)
      for (let i = 7; i >= 0; i--) bits.push((b >> i) & 1);
    return bits;
  }

  function bitsToBytes(bits) {
    const bytes = [];
    for (let i = 0; i + 7 < bits.length; i += 8) {
      let b = 0;
      for (let j = 0; j < 8; j++) b = (b << 1) | (bits[i + j] & 1);
      bytes.push(b);
    }
    return new Uint8Array(bytes);
  }

  function createEmptyGrid(n) {
    const g = new Array(n);
    for (let i = 0; i < n; i++) g[i] = new Array(n).fill(0);
    return g;
  }

  function encodeGrid(frameBytes, gridSize, bitsPerCell) {
    const grid = createEmptyGrid(gridSize);
    const dataSide = dataCellsPerSide(gridSize);
    const bits = bytesToBits(frameBytes);
    const maxBits = totalDataCells(gridSize) * bitsPerCell;

    for (let r = 0; r < gridSize; r++) {
      for (let c = 0; c < gridSize; c++) {
        const isBorder = r < BORDER_CELLS || r >= gridSize - BORDER_CELLS ||
                         c < BORDER_CELLS || c >= gridSize - BORDER_CELLS;
        if (isBorder) {
          grid[r][c] = -1;
        } else {
          const cellIdx = (r - BORDER_CELLS) * dataSide + (c - BORDER_CELLS);
          const base = cellIdx * bitsPerCell;
          if (base + bitsPerCell - 1 < maxBits) {
            let v = 0;
            for (let b = 0; b < bitsPerCell; b++) {
              const bit = (base + b < bits.length) ? (bits[base + b] & 1) : 0;
              v = (v << 1) | bit;
            }
            grid[r][c] = v;
          } else {
            grid[r][c] = 0;
          }
        }
      }
    }

    for (let r = 0; r < 2; r++)
      for (let c = 0; c < 2; c++) grid[r][c] = -2;
    for (let r = 0; r < 2; r++)
      for (let c = gridSize - 2; c < gridSize; c++) grid[r][c] = -2;
    for (let r = gridSize - 2; r < gridSize; r++)
      for (let c = 0; c < 2; c++) grid[r][c] = -2;

    return grid;
  }

  function getCellColor(v, palette) {
    if (v === -1) return MARKER_COLOR;
    if (v === -2) return CORNER_MARKER;
    if (!palette) palette = DATA_COLORS_8;
    return palette[v] || palette[0];
  }

  function renderGrid(ctx, grid, canvasSize, palette) {
    palette = palette || DATA_COLORS_8;
    const gs = grid.length, cs = canvasSize / gs;
    ctx.clearRect(0, 0, canvasSize, canvasSize);
    for (let r = 0; r < gs; r++) {
      for (let c = 0; c < gs; c++) {
        const [cr, cg, cb] = getCellColor(grid[r][c], palette);
        ctx.fillStyle = 'rgb(' + cr + ',' + cg + ',' + cb + ')';
        ctx.fillRect(Math.floor(c * cs), Math.floor(r * cs), Math.ceil(cs), Math.ceil(cs));
      }
    }
  }

  function encodeFile(fileBuffer, fileName, gridSize, colorCount) {
    gridSize = gridSize || DEFAULT_GRID;
    colorCount = colorCount || DEFAULT_COLORS;
    const bitsPerCell = bitsPerCellFor(colorCount);
    const frameCapacity = bytesPerFrame(gridSize, bitsPerCell);
    const overhead = 10;
    const maxPayload = frameCapacity - overhead;
    if (maxPayload < 1) throw new Error('Grid too small');

    const fnameBytes = new TextEncoder().encode(fileName);
    const f0Data = maxPayload - 1 - fnameBytes.length;
    if (f0Data < 0) throw new Error('Filename too long');

    const remaining = fileBuffer.length - f0Data;
    const otherFrames = remaining > 0 ? Math.ceil(remaining / maxPayload) : 0;
    const totalFrames = 1 + otherFrames;
    const grids = [];

    for (let fi = 0; fi < totalFrames; fi++) {
      let payload;
      const flags = (fi === 0 ? 1 : 0) | (colorCount === 8 ? 2 : 0);

      if (fi === 0) {
        const dLen = Math.min(f0Data, fileBuffer.length);
        payload = new Uint8Array(1 + fnameBytes.length + dLen);
        payload[0] = fnameBytes.length;
        payload.set(fnameBytes, 1);
        payload.set(fileBuffer.subarray(0, dLen), 1 + fnameBytes.length);
      } else {
        const start = f0Data + (fi - 1) * maxPayload;
        const end = Math.min(start + maxPayload, fileBuffer.length);
        payload = fileBuffer.subarray(start, end);
      }

      const fb = new Uint8Array(8 + payload.length + 2);
      fb[0] = MAGIC; fb[1] = VERSION; fb[2] = fi; fb[3] = totalFrames;
      fb[4] = (payload.length >> 8) & 0xff; fb[5] = payload.length & 0xff;
      fb[6] = flags;
      fb[7] = gridSize;
      fb.set(payload, 8);
      const crc = crc16(fb.subarray(0, 8 + payload.length));
      fb[8 + payload.length] = (crc >> 8) & 0xff;
      fb[8 + payload.length + 1] = crc & 0xff;
      grids.push(encodeGrid(fb, gridSize, bitsPerCell));
    }

    return { grids, totalFrames, fileName, gridSize, colorCount, palette: paletteFor(colorCount) };
  }

  function isMarkerColor(r, g, b) {
    if (g < 40 || b < 40 || r > g + 30 || r > b + 30) return false;
    const dg = g / 255, db = b / 255;
    return Math.abs(dg - db) < 0.4;
  }

  // Sample a small patch around (x,y) and return average RGB
  function samplePatch(pixels, imgWidth, imgHeight, x, y, radius) {
    let sr = 0, sg = 0, sb = 0, count = 0;
    radius = radius || 1;
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const sx = Math.round(x + dx), sy = Math.round(y + dy);
        if (sx >= 0 && sx < imgWidth && sy >= 0 && sy < imgHeight) {
          const idx = (sy * imgWidth + sx) * 4;
          sr += pixels[idx]; sg += pixels[idx + 1]; sb += pixels[idx + 2];
          count++;
        }
      }
    }
    return { r: Math.round(sr / count), g: Math.round(sg / count), b: Math.round(sb / count) };
  }

  // Ratio-based classification: works under varying lighting
  function classifyCellColorRatio(r, g, b, palette) {
    const total = r + g + b || 1;
    const rr = r / total, gg = g / total, bb = b / total;
    const maxC = Math.max(r, g, b);
    const minC = Math.min(r, g, b);

    if (maxC < 50) return 0; // black
    if (minC > 180 && maxC - minC < 40) return palette.length > 4 ? 7 : 0; // white or fallback

    if (palette.length <= 4) {
      // 4-color mode: use simple channel dominance
      if (rr > 0.4 && gg < 0.3 && bb < 0.3) return 1; // red
      if (gg > 0.4 && rr < 0.3 && bb < 0.3) return 2; // green
      if (bb > 0.4 && rr < 0.3 && gg < 0.3) return 3; // blue
      // fallback: nearest neighbor
    } else {
      // 8-color mode
      if (rr > 0.42 && gg < 0.25 && bb < 0.25) return 1; // red
      if (gg > 0.42 && rr < 0.25 && bb < 0.25) return 2; // green
      if (bb > 0.42 && rr < 0.25 && gg < 0.25) return 3; // blue
      if (rr > 0.3 && gg > 0.3 && bb < 0.2 && rr < 0.45 && gg < 0.45) return 4; // yellow
      if (rr > 0.3 && bb > 0.3 && gg < 0.2 && rr < 0.45 && bb < 0.45) return 5; // magenta
      if (gg > 0.3 && bb > 0.3 && rr < 0.2 && gg < 0.45 && bb < 0.45) return 6; // cyan
      if (minC > 160 && maxC - minC < 50) return 7; // white
    }

    // Euclidean fallback
    let best = 0, bestDist = Infinity;
    for (let i = 0; i < palette.length; i++) {
      const [cr, cg, cb] = palette[i];
      const d = (r - cr) ** 2 + (g - cg) ** 2 + (b - cb) ** 2;
      if (d < bestDist) { bestDist = d; best = i; }
    }
    return best;
  }

  function findGridCorners(imageData, width, height) {
    const pixels = imageData.data;
    const pts = [];
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        if (isMarkerColor(pixels[i], pixels[i + 1], pixels[i + 2]))
          pts.push({ x, y });
      }
    }
    if (pts.length < 20) return null;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of pts) {
      if (p.x < minX) minX = p.x; if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x; if (p.y > maxY) maxY = p.y;
    }

    const bw = maxX - minX, bh = maxY - minY;
    if (bw < 20 || bh < 20) return null;
    if (bw > 3 * bh || bh > 3 * bw) return null;

    return [{ x: minX, y: minY }, { x: maxX, y: minY },
            { x: minX, y: maxY }, { x: maxX, y: maxY }];
  }

  function mapPoint(corners, u, v) {
    const [tl, tr, bl, br] = corners;
    return {
      x: tl.x * (1 - u) * (1 - v) + tr.x * u * (1 - v) + bl.x * (1 - u) * v + br.x * u * v,
      y: tl.y * (1 - u) * (1 - v) + tr.y * u * (1 - v) + bl.y * (1 - u) * v + br.y * u * v,
    };
  }

  function sampleGrid(imageData, imgWidth, imgHeight, corners, gridSize, palette) {
    palette = palette || DATA_COLORS_8;
    const grid = createEmptyGrid(gridSize);
    const pixels = imageData.data;

    // Sample border color for white-balance reference
    let refR = 0, refG = 0, refB = 0, refN = 0;
    const cMidU = 0.5, cMidV = 0.5;
    for (let s = 0; s < 3; s++) {
      const uu = (gridSize / 2 - 1 + s) / gridSize;
      const vv = (gridSize / 2 - 1 + s) / gridSize;
      const pt = mapPoint(corners, uu, vv);
      const c = samplePatch(pixels, imgWidth, imgHeight, pt.x, pt.y, 0);
      refR += c.r; refG += c.g; refB += c.b; refN++;
    }
    const avgRefR = refN > 0 ? refR / refN : 128;
    const avgRefG = refN > 0 ? refG / refN : 128;
    const avgRefB = refN > 0 ? refB / refN : 128;
    const refBright = (avgRefR + avgRefG + avgRefB) / 3 || 1;

    for (let r = 0; r < gridSize; r++) {
      for (let c = 0; c < gridSize; c++) {
        const u = (c + 0.5) / gridSize, v = (r + 0.5) / gridSize;
        const pt = mapPoint(corners, u, v);
        const patch = samplePatch(pixels, imgWidth, imgHeight, pt.x, pt.y, 1);

        const isBorder = r < BORDER_CELLS || r >= gridSize - BORDER_CELLS ||
                         c < BORDER_CELLS || c >= gridSize - BORDER_CELLS;
        if (isBorder) {
          grid[r][c] = ((patch.r - 255) ** 2 + (patch.g - 255) ** 2 + (patch.b - 255) ** 2) < 20000 ? -2 : -1;
        } else {
          grid[r][c] = classifyCellColorRatio(patch.r, patch.g, patch.b, palette);
        }
      }
    }
    return grid;
  }

  function decodeGrid(grid, gridSize, bitsPerCell) {
    const colorCount = 1 << bitsPerCell;
    const bits = [];
    for (let r = 0; r < gridSize; r++) {
      for (let c = 0; c < gridSize; c++) {
        const isBorder = r < BORDER_CELLS || r >= gridSize - BORDER_CELLS ||
                         c < BORDER_CELLS || c >= gridSize - BORDER_CELLS;
        if (isBorder) continue;
        const ci = grid[r][c];
        if (ci < 0 || ci >= colorCount) {
          for (let b = 0; b < bitsPerCell; b++) bits.push(0);
        } else {
          for (let b = bitsPerCell - 1; b >= 0; b--) bits.push((ci >> b) & 1);
        }
      }
    }
    const fb = bitsToBytes(bits);
    if (fb.length < 10 || fb[0] !== MAGIC) return null;
    const frameIdx = fb[2], totalFrames = fb[3];
    const payloadLen = (fb[4] << 8) | fb[5];
    const flags = fb[6], hasFilename = !!(flags & 1);
    const colorDepth = (flags & 2) ? 8 : 4;
    if (8 + payloadLen + 2 > fb.length) return null;
    const crcData = fb.subarray(0, 8 + payloadLen);
    const expCrc = (fb[8 + payloadLen] << 8) | fb[8 + payloadLen + 1];
    if (crc16(crcData) !== expCrc) return null;
    const payload = fb.subarray(8, 8 + payloadLen);
    return { frameIdx, totalFrames, hasFilename, payload, version: fb[1], colorDepth, gridSize: fb[7] || DEFAULT_GRID };
  }

  function autoDetectFrame(imageData, imgWidth, imgHeight, corners) {
    for (const gs of TRIAL_GRIDS) {
      for (const cc of TRIAL_COLORS) {
        const pal = paletteFor(cc);
        const bpc = bitsPerCellFor(cc);
        const grid = sampleGrid(imageData, imgWidth, imgHeight, corners, gs, pal);
        const frame = decodeGrid(grid, gs, bpc);
        if (frame) return frame;
      }
    }
    return null;
  }

  return {
    MAGIC, VERSION, MARKER_COLOR, DATA_COLORS_4, DATA_COLORS_8, CORNER_MARKER,
    BORDER_CELLS, DEFAULT_GRID, TRIAL_GRIDS,
    bytesPerFrame, crc16, encodeFile, renderGrid, paletteFor, bitsPerCellFor,
    findGridCorners, sampleGrid, decodeGrid, autoDetectFrame,
    getCellColor, samplePatch,
  };
})();
