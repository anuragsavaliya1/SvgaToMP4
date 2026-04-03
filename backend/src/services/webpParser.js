'use strict';

const sharp = require('sharp');
const { createCanvas, loadImage } = require('canvas');
const path = require('path');
const fs = require('fs');

/**
 * Parse an animated WebP: read metadata and extract all frames as PNG buffers.
 *
 * @param {string} webpFilePath
 * @returns {object} { meta: { width, height, fps, frames }, frameBuffers: Buffer[] }
 */
async function parseWebp(webpFilePath) {
  const meta = await sharp(webpFilePath, { animated: true }).metadata();

  if (!meta.pages || meta.pages < 1) {
    throw new Error('Not an animated WebP or no frames found');
  }

  const frameW = meta.width;
  // sharp stacks all pages vertically: total height = frameH * pages
  const frameH = Math.round(meta.height / meta.pages);

  // Per-frame delay (ms). Use average to derive fps.
  const delays = meta.delay && meta.delay.length > 0 ? meta.delay : [100];
  const avgDelay = delays.reduce((a, b) => a + b, 0) / delays.length;
  const fps = Math.round(1000 / avgDelay) || 10;

  console.log(`[webpParser] ${frameW}x${frameH} fps=${fps} frames=${meta.pages}`);

  // Extract each frame as a raw PNG buffer
  const frameBuffers = [];
  for (let i = 0; i < meta.pages; i++) {
    const buf = await sharp(webpFilePath, { animated: true, page: i })
      .png()
      .toBuffer();
    frameBuffers.push(buf);
  }

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

  // Load background image
  let bgImage = null;
  let canvasW, canvasH;

  if (options.backgroundImage && fs.existsSync(options.backgroundImage)) {
    bgImage = await loadImage(options.backgroundImage);
    canvasW = bgImage.width;
    canvasH = bgImage.height;
  } else {
    canvasW = meta.width;
    canvasH = meta.height;
  }

  // Animation zone: bottom (1 - topReserved) of canvas
  const areaY   = Math.round(canvasH * topReserved);
  const areaH   = canvasH - areaY;
  const scale   = Math.min(canvasW / meta.width, areaH / meta.height);
  const drawW   = meta.width  * scale;
  const drawH   = meta.height * scale;
  const offsetX = (canvasW - drawW) / 2;
  const offsetY = areaY + (areaH - drawH); // bottom-aligned

  const framePaths = [];

  for (let i = 0; i < frameBuffers.length; i++) {
    const canvas = createCanvas(canvasW, canvasH);
    const ctx    = canvas.getContext('2d');

    // Background
    if (bgImage) {
      ctx.drawImage(bgImage, 0, 0, canvasW, canvasH);
    } else {
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, canvasW, canvasH);
    }

    // WebP frame
    const frame = await loadImage(frameBuffers[i]);
    ctx.drawImage(frame, offsetX, offsetY, drawW, drawH);

    const outPath = path.join(outFramesDir, `frame_${String(i).padStart(6, '0')}.png`);
    await saveCanvasToPng(canvas, outPath);
    framePaths.push(outPath);
  }

  return framePaths;
}

function saveCanvasToPng(canvas, filePath) {
  return new Promise((resolve, reject) => {
    const out    = fs.createWriteStream(filePath);
    const stream = canvas.createPNGStream();
    stream.pipe(out);
    out.on('finish', resolve);
    out.on('error', reject);
  });
}

module.exports = { parseWebp, renderWebpFrames };
