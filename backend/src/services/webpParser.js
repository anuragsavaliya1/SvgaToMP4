'use strict';

const ffmpeg = require('fluent-ffmpeg');
const { createCanvas, loadImage } = require('canvas');
const path = require('path');
const fs = require('fs');

/**
 * Extract metadata (fps, frameCount, width, height) from an animated WebP.
 */
function probeWebp(filePath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, meta) => {
      if (err) return reject(err);
      const stream = (meta.streams || []).find(s => s.codec_type === 'video');
      if (!stream) return reject(new Error('No video stream found in WebP'));

      // fps: r_frame_rate is a fraction string like "10/1"
      let fps = 10;
      if (stream.r_frame_rate) {
        const [num, den] = stream.r_frame_rate.split('/').map(Number);
        if (den && den > 0) fps = num / den;
      }
      // avg_frame_rate is more reliable for animated WebP
      if (stream.avg_frame_rate) {
        const [num, den] = stream.avg_frame_rate.split('/').map(Number);
        if (den && den > 0 && num > 0) fps = num / den;
      }

      const frameCount = stream.nb_frames
        ? parseInt(stream.nb_frames, 10)
        : Math.round((meta.format.duration || 1) * fps);

      resolve({
        width:  stream.width  || 0,
        height: stream.height || 0,
        fps:    Math.round(fps) || 10,
        frames: frameCount || 1,
      });
    });
  });
}

/**
 * Extract all frames from an animated WebP to individual PNGs.
 * Returns array of absolute PNG file paths (sorted).
 */
function extractFrames(filePath, framesDir) {
  return new Promise((resolve, reject) => {
    const pattern = path.join(framesDir, 'raw_%06d.png');
    ffmpeg(filePath)
      .outputOptions(['-vsync 0'])
      .output(pattern)
      .on('end', () => {
        const files = fs.readdirSync(framesDir)
          .filter(f => f.startsWith('raw_') && f.endsWith('.png'))
          .sort()
          .map(f => path.join(framesDir, f));
        resolve(files);
      })
      .on('error', reject)
      .run();
  });
}

/**
 * Parse an animated WebP file and return the same animData shape as svgaParser,
 * so the existing frameRenderer and videoEncoder can be reused.
 *
 * @param {string} webpFilePath
 * @param {string} rawFramesDir  - temp dir to extract raw WebP frames into
 * @returns {object} animData compatible with renderWebpFrames()
 */
async function parseWebp(webpFilePath, rawFramesDir) {
  fs.mkdirSync(rawFramesDir, { recursive: true });

  const meta = await probeWebp(webpFilePath);
  console.log(`[webpParser] ${meta.width}x${meta.height} fps=${meta.fps} frames=${meta.frames}`);

  const rawFramePaths = await extractFrames(webpFilePath, rawFramesDir);
  // Use actual count from extracted files (more reliable than probe for WebP)
  meta.frames = rawFramePaths.length || meta.frames;

  return { meta, rawFramePaths };
}

/**
 * Render WebP frames composited on top of a background image,
 * placing the animation in the bottom (1-topReserved) portion.
 *
 * @param {object} parsed         - result of parseWebp()
 * @param {string} outFramesDir   - where to write composited PNGs
 * @param {object} options        - { backgroundImage, topReserved, background }
 * @returns {string[]} sorted composited frame paths
 */
async function renderWebpFrames(parsed, outFramesDir, options = {}) {
  const { meta, rawFramePaths } = parsed;
  const topReserved = options.topReserved != null ? options.topReserved : 0.30;
  const background  = options.background  || '#ffffff';

  fs.mkdirSync(outFramesDir, { recursive: true });

  // Load background image
  let bgImage = null;
  let canvasW, canvasH;

  if (options.backgroundImage && fs.existsSync(options.backgroundImage)) {
    bgImage  = await loadImage(options.backgroundImage);
    canvasW  = bgImage.width;
    canvasH  = bgImage.height;
  } else {
    canvasW  = meta.width  || 480;
    canvasH  = meta.height || 480;
  }

  // Animation placement: bottom (1 - topReserved) of canvas
  const areaY = Math.round(canvasH * topReserved);
  const areaH = canvasH - areaY;
  const areaW = canvasW;

  const scale  = Math.min(areaW / meta.width, areaH / meta.height);
  const drawW  = meta.width  * scale;
  const drawH  = meta.height * scale;
  const offsetX = (areaW - drawW) / 2;
  const offsetY = areaY + (areaH - drawH);  // bottom-aligned

  const framePaths = [];

  for (let i = 0; i < rawFramePaths.length; i++) {
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
    const frame = await loadImage(rawFramePaths[i]);
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
