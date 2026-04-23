'use strict';

const path = require('path');
const fs   = require('fs');
const { v4: uuidv4 } = require('uuid');

const { parseSvga }                       = require('./svgaParser');
const { parseWebp }                       = require('./webpParser');
const { renderSpecificFrames }            = require('./frameRenderer');
const { renderSpecificWebpFrames }        = require('./webpParser');
const log = require('../utils/logger')('stillsExtractor');

/**
 * Extract N still images from the original animation source at given timeline
 * positions. Images are rendered directly from the parsed animation data —
 * never from the transcoded MP4/WebM output.
 *
 * @param {string} inputPath   - Absolute path to .svga or .webp file
 * @param {object} [options]
 *   outputDir      {string}    - Directory to save stills (default: os.tmpdir())
 *   positions      {number[]}  - Timeline positions 0–1 (default: [0.20, 0.50, 0.80])
 *   imageFormat    {string}    - 'png' (default) | 'jpeg'
 *   quality        {number}    - JPEG quality 0–100 (default: 85)
 *   backgroundImage {string}  - Path to background PNG/JPG
 *   background     {string}    - CSS fallback colour (default: '#ffffff')
 *   topReserved    {number}    - Fraction of canvas height above animation (default: 0.30)
 *   prefix         {string}    - Output filename prefix (default: auto jobId)
 *
 * @returns {Promise<Array<{ position: number, frameIndex: number, filePath: string, fileName: string }>>}
 */
async function extractStills(inputPath, options = {}) {
  const {
    outputDir    = require('os').tmpdir(),
    positions    = [0.20, 0.50, 0.80],
    imageFormat  = 'png',
    quality      = 85,
    backgroundImage,
    background   = '#ffffff',
    topReserved,
    prefix,
  } = options;

  const ext      = path.extname(inputPath).toLowerCase();
  const fileName = path.basename(inputPath);
  const jobId    = uuidv4();
  const filePrefix = prefix || jobId;

  fs.mkdirSync(outputDir, { recursive: true });

  log.info(`extractStills() — file: ${fileName} | positions: [${positions.join(', ')}] | format: ${imageFormat}`);

  const startTime = Date.now();
  let rendered;
  let totalFrames;

  if (ext === '.svga') {
    const animData = await parseSvga(inputPath);
    totalFrames = animData.params.frames;
    const frameIndices = positionsToIndices(positions, totalFrames);
    log.info(`SVGA stills — total frames: ${totalFrames} | target indices: [${frameIndices.join(', ')}]`);

    rendered = await renderSpecificFrames(animData, frameIndices, outputDir, {
      backgroundImage,
      background,
      topReserved,
      imageFormat,
      quality,
      prefix: filePrefix,
    });

  } else if (ext === '.webp') {
    const parsed = await parseWebp(inputPath);
    totalFrames = parsed.meta.frames;
    const frameIndices = positionsToIndices(positions, totalFrames);
    log.info(`WebP stills — total frames: ${totalFrames} | target indices: [${frameIndices.join(', ')}]`);

    rendered = await renderSpecificWebpFrames(parsed, frameIndices, outputDir, {
      backgroundImage,
      background,
      topReserved,
      imageFormat,
      quality,
      prefix: filePrefix,
    });

  } else {
    log.error(`Unsupported file type: "${ext}" — use .svga or .webp`);
    throw new Error(`Unsupported file type: "${ext}". Use .svga or .webp`);
  }

  // Map each result back to its requested position
  const stills = rendered.map((r, i) => ({
    position:   positions[i],
    frameIndex: r.frameIndex,
    filePath:   r.filePath,
    fileName:   path.basename(r.filePath),
  }));

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
  log.info(`extractStills() done — ${stills.length} still(s) in ${elapsed}s`);
  return stills;
}

/**
 * Convert an array of 0–1 positions to concrete frame indices.
 * Clamps to valid range and deduplicates while preserving order.
 */
function positionsToIndices(positions, totalFrames) {
  return positions.map(p =>
    Math.min(totalFrames - 1, Math.max(0, Math.round(p * (totalFrames - 1))))
  );
}

module.exports = { extractStills };
