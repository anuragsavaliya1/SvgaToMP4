'use strict';

const path = require('path');
const fs   = require('fs');
const { v4: uuidv4 } = require('uuid');
const log = require('./utils/logger')('converter');

const { parseSvga }            = require('./services/svgaParser');
const { renderFrames }         = require('./services/frameRenderer');
const { extractAudio, pickPrimaryAudio } = require('./services/audioExtractor');
const { parseWebp, renderWebpFrames }   = require('./services/webpParser');
const { encodeVideo }          = require('./services/videoEncoder');
const { removeDir, removeFile } = require('./utils/cleanup');

const DEFAULT_BG_IMAGE = path.join(__dirname, '../../example/BACKGROUND.png');

/**
 * Convert an SVGA or animated WebP file to MP4.
 *
 * @param {string} inputPath          - Absolute path to .svga or .webp file
 * @param {object} [options]
 * @param {string} [options.outputDir]        - Where to save the MP4 (default: os.tmpdir())
 * @param {string} [options.outputFileName]   - Custom filename (default: uuid.mp4)
 * @param {string} [options.backgroundImage]  - Path to background PNG/JPG
 * @param {string} [options.background]       - Fallback CSS color (default: '#ffffff')
 * @param {number} [options.topReserved]      - Fraction of canvas height to keep clear above animation (default: 0.30)
 * @param {string} [options.format]           - 'mp4' | 'webm' (default: 'mp4')
 * @param {number} [options.width]            - Override output width (SVGA only)
 * @param {number} [options.height]           - Override output height (SVGA only)
 *
 * @returns {Promise<{ filePath: string, fileName: string }>}
 */
async function convert(inputPath, options = {}) {
  const ext = path.extname(inputPath).toLowerCase();
  const fileName = path.basename(inputPath);
  log.info(`convert() called — file: ${fileName} | type: ${ext || '(no ext)'}`);

  if (ext === '.webp') return _convertWebp(inputPath, options);
  if (ext === '.svga') return _convertSvga(inputPath, options);

  log.error(`Unsupported file type: "${ext}" — only .svga and .webp are accepted`);
  throw new Error(`Unsupported file type: "${ext}". Use .svga or .webp`);
}

async function _convertSvga(inputPath, options) {
  const { outputDir, outputFileName, backgroundImage, background = '#ffffff',
          topReserved, format = 'mp4', width, height } = options;
  const resolvedBackgroundImage = backgroundImage || (fs.existsSync(DEFAULT_BG_IMAGE) ? DEFAULT_BG_IMAGE : undefined);

  const jobId     = uuidv4();
  const tmpDir    = path.join(require('os').tmpdir(), `svga-gift-${jobId}`);
  const framesDir = path.join(tmpDir, 'frames');
  const audioDir  = path.join(tmpDir, 'audio');
  fs.mkdirSync(framesDir, { recursive: true });
  fs.mkdirSync(audioDir,  { recursive: true });

  log.info(`[job:${jobId}] Starting SVGA → ${format} conversion`);
  log.info(`[job:${jobId}] Options — bg: ${resolvedBackgroundImage ? path.basename(resolvedBackgroundImage) : 'none'} | topReserved: ${topReserved ?? 0.30} | size: ${width || 'auto'}x${height || 'auto'}`);

  const startTime = Date.now();

  try {
    log.info(`[job:${jobId}] Step 1/4 — Parsing SVGA`);
    const animData   = await parseSvga(inputPath);

    log.info(`[job:${jobId}] Step 2/4 — Extracting audio`);
    const audioFiles = await extractAudio(animData, audioDir);
    const audioPath  = pickPrimaryAudio(audioFiles, animData.params.frames);

    log.info(`[job:${jobId}] Step 3/4 — Rendering frames`);
    await renderFrames(animData, framesDir, {
      width,
      height,
      backgroundImage: resolvedBackgroundImage,
      background,
      topReserved,
    });

    log.info(`[job:${jobId}] Step 4/4 — Encoding video`);
    const result = await _encode({ jobId, framesDir, fps: animData.params.fps, audioPath, format, outputDir, outputFileName });

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    log.info(`[job:${jobId}] SVGA conversion complete in ${elapsed}s — output: ${result.fileName}`);
    return result;
  } finally {
    removeDir(tmpDir);
    log.debug(`[job:${jobId}] Temp directory cleaned up`);
  }
}

async function _convertWebp(inputPath, options) {
  const { outputDir, outputFileName, backgroundImage, background = '#ffffff',
          topReserved, format = 'mp4' } = options;
  const resolvedBackgroundImage = backgroundImage || (fs.existsSync(DEFAULT_BG_IMAGE) ? DEFAULT_BG_IMAGE : undefined);

  const jobId     = uuidv4();
  const tmpDir    = path.join(require('os').tmpdir(), `svga-gift-${jobId}`);
  const framesDir = path.join(tmpDir, 'frames');
  fs.mkdirSync(framesDir, { recursive: true });

  log.info(`[job:${jobId}] Starting WebP → ${format} conversion`);
  log.info(`[job:${jobId}] Options — bg: ${resolvedBackgroundImage ? path.basename(resolvedBackgroundImage) : 'none'} | topReserved: ${topReserved ?? 0.30}`);

  const startTime = Date.now();

  try {
    log.info(`[job:${jobId}] Step 1/3 — Parsing WebP`);
    const parsed = await parseWebp(inputPath);

    log.info(`[job:${jobId}] Step 2/3 — Rendering frames`);
    await renderWebpFrames(parsed, framesDir, {
      backgroundImage: resolvedBackgroundImage,
      background,
      topReserved,
    });

    log.info(`[job:${jobId}] Step 3/3 — Encoding video`);
    const result = await _encode({ jobId, framesDir, fps: parsed.meta.fps, audioPath: undefined, format, outputDir, outputFileName });

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    log.info(`[job:${jobId}] WebP conversion complete in ${elapsed}s — output: ${result.fileName}`);
    return result;
  } finally {
    removeDir(tmpDir);
    log.debug(`[job:${jobId}] Temp directory cleaned up`);
  }
}

async function _encode({ jobId, framesDir, fps, audioPath, format, outputDir, outputFileName }) {
  const outDir  = outputDir || require('os').tmpdir();
  const outName = outputFileName || `${jobId}.${format}`;
  const outPath = path.join(outDir, outName);

  fs.mkdirSync(outDir, { recursive: true });
  await encodeVideo({ framesDir, fps, outputPath: outPath, audioPath, format });

  return { filePath: outPath, fileName: outName };
}

module.exports = { convert };
