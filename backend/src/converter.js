'use strict';

const path = require('path');
const fs   = require('fs');
const { v4: uuidv4 } = require('uuid');

const { parseSvga }            = require('./services/svgaParser');
const { renderFrames }         = require('./services/frameRenderer');
const { extractAudio, pickPrimaryAudio } = require('./services/audioExtractor');
const { parseWebp, renderWebpFrames }   = require('./services/webpParser');
const { encodeVideo }          = require('./services/videoEncoder');
const { removeDir, removeFile } = require('./utils/cleanup');

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

  if (ext === '.webp') return _convertWebp(inputPath, options);
  if (ext === '.svga') return _convertSvga(inputPath, options);
  throw new Error(`Unsupported file type: "${ext}". Use .svga or .webp`);
}

async function _convertSvga(inputPath, options) {
  const { outputDir, outputFileName, backgroundImage, background = '#ffffff',
          topReserved, format = 'mp4', width, height } = options;

  const jobId     = uuidv4();
  const tmpDir    = path.join(require('os').tmpdir(), `svga-gift-${jobId}`);
  const framesDir = path.join(tmpDir, 'frames');
  const audioDir  = path.join(tmpDir, 'audio');
  fs.mkdirSync(framesDir, { recursive: true });
  fs.mkdirSync(audioDir,  { recursive: true });

  try {
    const animData   = await parseSvga(inputPath);
    const audioFiles = await extractAudio(animData, audioDir);
    const audioPath  = pickPrimaryAudio(audioFiles, animData.params.frames);

    await renderFrames(animData, framesDir, { width, height, backgroundImage, background, topReserved });

    return await _encode({ jobId, framesDir, fps: animData.params.fps, audioPath, format, outputDir, outputFileName });
  } finally {
    removeDir(tmpDir);
  }
}

async function _convertWebp(inputPath, options) {
  const { outputDir, outputFileName, backgroundImage, background = '#ffffff',
          topReserved, format = 'mp4' } = options;

  const jobId     = uuidv4();
  const tmpDir    = path.join(require('os').tmpdir(), `svga-gift-${jobId}`);
  const framesDir = path.join(tmpDir, 'frames');
  fs.mkdirSync(framesDir, { recursive: true });

  try {
    const parsed = await parseWebp(inputPath);
    await renderWebpFrames(parsed, framesDir, { backgroundImage, background, topReserved });

    return await _encode({ jobId, framesDir, fps: parsed.meta.fps, audioPath: undefined, format, outputDir, outputFileName });
  } finally {
    removeDir(tmpDir);
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
