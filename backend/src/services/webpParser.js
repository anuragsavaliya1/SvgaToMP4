'use strict';

const sharp = require('sharp');
const { createCanvas, loadImage } = require('canvas');
const path = require('path');
const fs = require('fs');
const log = require('../utils/logger')('webpParser');

/**
 * Parse an animated WebP: read metadata and extract all frames as PNG buffers.
 *
 * @param {string} webpFilePath
 * @returns {object} { meta: { width, height, fps, frames }, frameBuffers: Buffer[] }
 */
async function parseWebp(webpFilePath) {
  const fileName = path.basename(webpFilePath);
  const fileSizeKB = (fs.statSync(webpFilePath).size / 1024).toFixed(1);
  log.info(`Parsing animated WebP: ${fileName} (${fileSizeKB} KB)`);

  const meta = await sharp(webpFilePath, { animated: true }).metadata();

  if (!meta.pages || meta.pages < 1) {
    log.error(`Not an animated WebP or no frames found: ${fileName}`);
    throw new Error('Not an animated WebP or no frames found');
  }

  const frameW = meta.width;
  const frameH = Math.round(meta.height / meta.pages);

  const delays = meta.delay && meta.delay.length > 0 ? meta.delay : [100];
  const avgDelay = delays.reduce((a, b) => a + b, 0) / delays.length;
  const minDelay = Math.min(...delays);
  const maxDelay = Math.max(...delays);
  const fps = Math.round(1000 / avgDelay) || 10;

  log.info(
    `WebP metadata — size: ${frameW}x${frameH} | frames: ${meta.pages} | fps: ${fps} | ` +
    `avg delay: ${avgDelay.toFixed(1)}ms | delay range: ${minDelay}–${maxDelay}ms`
  );

  // Extract each frame as a raw PNG buffer.
  // Must use { page: i } WITHOUT animated:true.
  log.info(`Extracting ${meta.pages} frame(s) as PNG buffers...`);
  const frameBuffers = [];
  const logStep = Math.max(1, Math.floor(meta.pages / 5));
  for (let i = 0; i < meta.pages; i++) {
    const buf = await sharp(webpFilePath, { page: i }).png().toBuffer();
    frameBuffers.push(buf);
    if (i === 0 || (i + 1) % logStep === 0 || i === meta.pages - 1) {
      log.info(`Extracted frame ${i + 1}/${meta.pages}`);
    }
  }

  log.info(`WebP parse complete — ${meta.pages} frame(s) ready`);
  return {
    meta: { width: frameW, height: frameH, fps, frames: meta.pages },
    frameBuffers,
  };
}

/**
 * Render WebP frames composited on a background image and save as PNGs.
 * Same layout as SVGA: animation placed in bottom (1-topReserved) of canvas.
 *
 * @param {object} parsed       - result of parseWebp()
 * @param {string} outFramesDir - directory to write composited frame PNGs
 * @param {object} options      - { backgroundImage, topReserved, background }
 * @returns {string[]} sorted composited frame file paths
 */
async function renderWebpFrames(parsed, outFramesDir, options = {}) {
  const { meta, frameBuffers } = parsed;
  const topReserved = options.topReserved != null ? options.topReserved : 0.30;
  const background  = options.background || '#ffffff';

  fs.mkdirSync(outFramesDir, { recursive: true });

  let bgImage = null;
  let canvasW, canvasH;

  if (options.backgroundImage && fs.existsSync(options.backgroundImage)) {
    log.info(`Loading background image: ${path.basename(options.backgroundImage)}`);
    bgImage = await loadImage(options.backgroundImage);
    canvasW = bgImage.width;
    canvasH = bgImage.height;
    log.info(`Background loaded: ${canvasW}x${canvasH}`);
  } else {
    canvasW = meta.width;
    canvasH = meta.height;
    log.info(`No background image — canvas: ${canvasW}x${canvasH} fill: ${background}`);
  }

  const areaY   = Math.round(canvasH * topReserved);
  const areaH   = canvasH - areaY;
  const scale   = Math.min(canvasW / meta.width, areaH / meta.height);
  const drawW   = meta.width  * scale;
  const drawH   = meta.height * scale;
  const offsetX = (canvasW - drawW) / 2;
  const offsetY = areaY + (areaH - drawH);

  log.info(
    `Layout — scale: ${scale.toFixed(3)} | draw: ${drawW.toFixed(0)}x${drawH.toFixed(0)} | ` +
    `offset: (${offsetX.toFixed(0)}, ${offsetY.toFixed(0)}) | topReserved: ${topReserved}`
  );
  log.info(`Compositing ${frameBuffers.length} WebP frame(s) onto canvas...`);

  const startTime = Date.now();
  const logStep = Math.max(1, Math.floor(frameBuffers.length / 5));
  const framePaths = [];

  for (let i = 0; i < frameBuffers.length; i++) {
    const canvas = createCanvas(canvasW, canvasH);
    const ctx    = canvas.getContext('2d');

    if (bgImage) {
      ctx.drawImage(bgImage, 0, 0, canvasW, canvasH);
    } else {
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, canvasW, canvasH);
    }

    const frame = await loadImage(frameBuffers[i]);
    ctx.drawImage(frame, offsetX, offsetY, drawW, drawH);

    const outPath = path.join(outFramesDir, `frame_${String(i).padStart(6, '0')}.png`);
    await saveCanvasToPng(canvas, outPath);
    framePaths.push(outPath);

    if (i === 0 || (i + 1) % logStep === 0 || i === frameBuffers.length - 1) {
      const pct = (((i + 1) / frameBuffers.length) * 100).toFixed(0);
      log.info(`Composited frame ${i + 1}/${frameBuffers.length} (${pct}%)`);
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
  log.info(`WebP frame compositing complete — ${frameBuffers.length} frames in ${elapsed}s`);
  return framePaths;
}

/**
 * Render a specific subset of WebP animation frames and save them.
 * Uses the same compositing logic as renderWebpFrames (background, scale, layout).
 *
 * @param {object}   parsed        - Result of parseWebp()
 * @param {number[]} frameIndices  - Which frame indices to render (0-based)
 * @param {string}   outDir        - Directory to write output images
 * @param {object}   [options]     - Same options as renderWebpFrames plus:
 *   imageFormat  {string}  - 'png' (default) | 'jpeg'
 *   quality      {number}  - JPEG quality 0–100 (default 85)
 *   prefix       {string}  - Filename prefix (default 'still')
 * @returns {Promise<Array<{ frameIndex: number, filePath: string }>>}
 */
async function renderSpecificWebpFrames(parsed, frameIndices, outDir, options = {}) {
  const { meta, frameBuffers } = parsed;
  const topReserved = options.topReserved != null ? options.topReserved : 0.30;
  const background  = options.background  || '#ffffff';
  const imageFormat = options.imageFormat === 'jpeg' ? 'jpeg' : 'png';
  const quality     = options.quality != null ? options.quality : 85;
  const prefix      = options.prefix || 'still';

  fs.mkdirSync(outDir, { recursive: true });

  log.info(`Rendering ${frameIndices.length} still(s) from WebP — format: ${imageFormat} | indices: [${frameIndices.join(', ')}]`);

  // ── Canvas setup ─────────────────────────────────────────────────────────
  let bgImage = null;
  let canvasW, canvasH;
  if (options.backgroundImage && fs.existsSync(options.backgroundImage)) {
    bgImage = await loadImage(options.backgroundImage);
    canvasW = bgImage.width;
    canvasH = bgImage.height;
    log.info(`Background loaded: ${canvasW}x${canvasH}`);
  } else {
    canvasW = meta.width;
    canvasH = meta.height;
  }

  const areaY   = Math.round(canvasH * topReserved);
  const areaH   = canvasH - areaY;
  const scale   = Math.min(canvasW / meta.width, areaH / meta.height);
  const drawW   = meta.width  * scale;
  const drawH   = meta.height * scale;
  const offsetX = (canvasW - drawW) / 2;
  const offsetY = areaY + (areaH - drawH);

  const ext = imageFormat === 'jpeg' ? '.jpg' : '.png';
  const results = [];

  for (const frameIndex of frameIndices) {
    if (frameIndex < 0 || frameIndex >= frameBuffers.length) {
      log.warn(`Frame index ${frameIndex} out of range (0–${frameBuffers.length - 1}), skipping`);
      continue;
    }

    const canvas = createCanvas(canvasW, canvasH);
    const ctx    = canvas.getContext('2d');

    if (bgImage) {
      ctx.drawImage(bgImage, 0, 0, canvasW, canvasH);
    } else {
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, canvasW, canvasH);
    }

    const frame = await loadImage(frameBuffers[frameIndex]);
    ctx.drawImage(frame, offsetX, offsetY, drawW, drawH);

    const filePath = path.join(outDir, `${prefix}_${frameIndex}${ext}`);
    await saveCanvas(canvas, filePath, imageFormat, quality);
    log.info(`Still saved — frameIndex: ${frameIndex} → ${path.basename(filePath)}`);
    results.push({ frameIndex, filePath });
  }

  log.info(`Still extraction complete — ${results.length} image(s) written`);
  return results;
}

function saveCanvas(canvas, filePath, format = 'png', quality = 85) {
  return new Promise((resolve, reject) => {
    const out    = fs.createWriteStream(filePath);
    const stream = format === 'jpeg'
      ? canvas.createJPEGStream({ quality: quality / 100 })
      : canvas.createPNGStream();
    stream.pipe(out);
    out.on('finish', resolve);
    out.on('error', reject);
  });
}

function saveCanvasToPng(canvas, filePath) {
  return saveCanvas(canvas, filePath, 'png');
}

module.exports = { parseWebp, renderWebpFrames, renderSpecificWebpFrames };
