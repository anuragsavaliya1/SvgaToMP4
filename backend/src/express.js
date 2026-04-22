'use strict';

const express  = require('express');
const multer   = require('multer');
const path     = require('path');
const fs       = require('fs');
const os       = require('os');
const { v4: uuidv4 } = require('uuid');

const { parseSvga }                        = require('./services/svgaParser');
const { renderFrames }                     = require('./services/frameRenderer');
const { parseWebp, renderWebpFrames }      = require('./services/webpParser');
const { extractAudio, pickPrimaryAudio }   = require('./services/audioExtractor');
const { encodeVideo }                      = require('./services/videoEncoder');
const { removeDir, removeFile }            = require('./utils/cleanup');

/**
 * Create an Express router that exposes the svga-gift-converter API.
 *
 * @param {object} [defaultOptions]
 * @param {string} [defaultOptions.backgroundImage]  - Absolute path to default background PNG/JPG
 * @param {string} [defaultOptions.outputDir]        - Where to save output videos (default: os.tmpdir())
 * @param {string} [defaultOptions.uploadsDir]       - Where multer stores uploads (default: os.tmpdir())
 * @param {number} [defaultOptions.topReserved]      - Fraction of canvas height above animation (default: 0.30)
 * @param {string} [defaultOptions.background]       - CSS fallback colour (default: '#ffffff')
 * @param {number} [defaultOptions.maxFileSize]      - Upload size limit in bytes (default: 100 MB)
 *
 * Mounted routes:
 *   POST /mp4        — upload .svga or .webp → { url }
 *   POST /convert    — upload .svga or .webp → full metadata response
 *   POST /audio      — extract audio from .svga → { tracks }
 *   GET  /health     — liveness check → { status: 'ok' }
 */
function createExpressRouter(defaultOptions = {}) {
  const {
    backgroundImage : defaultBgImage  = null,
    outputDir       : defaultOutputDir = os.tmpdir(),
    uploadsDir                         = os.tmpdir(),
    topReserved     : defaultTopReserved = 0.30,
    background      : defaultBackground  = '#ffffff',
    maxFileSize                          = 100 * 1024 * 1024,
  } = defaultOptions;

  // Ensure output / upload directories exist
  fs.mkdirSync(defaultOutputDir, { recursive: true });
  fs.mkdirSync(uploadsDir,        { recursive: true });

  const upload = multer({
    dest: uploadsDir,
    limits: { fileSize: maxFileSize },
    fileFilter(_req, file, cb) {
      const ext = path.extname(file.originalname).toLowerCase();
      if (
        ext === '.svga' || ext === '.webp' ||
        ext === '.png'  || ext === '.jpg'  || ext === '.jpeg' ||
        file.mimetype === 'application/octet-stream' ||
        file.mimetype === 'image/webp'
      ) {
        cb(null, true);
      } else {
        cb(new Error('Only .svga or .webp files are accepted'));
      }
    },
  });

  const router = express.Router();

  // ── GET /health ─────────────────────────────────────────────────────────────
  router.get('/health', (_req, res) => {
    res.json({ status: 'ok', package: 'svga-gift-converter' });
  });

  // ── POST /mp4 ────────────────────────────────────────────────────────────────
  // Simple endpoint: upload .svga or .webp → { url } or { error }
  router.post('/mp4', upload.single('file'), async (req, res) => {
    const jobId      = uuidv4();
    const tmpDir     = path.join(os.tmpdir(), `svga-gift-${jobId}`);
    const framesDir  = path.join(tmpDir, 'frames');
    let uploadedPath = null;

    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded. Send the file as form-data field "file".' });
      }

      uploadedPath = req.file.path;
      const format = req.body.format === 'webm' ? 'webm' : 'mp4';
      const ext    = path.extname(req.file.originalname).toLowerCase();
      const isWebp = ext === '.webp';

      const bgImage  = defaultBgImage && fs.existsSync(defaultBgImage) ? defaultBgImage : null;
      const outDir   = defaultOutputDir;
      fs.mkdirSync(framesDir, { recursive: true });

      let fps, audioPath;

      if (isWebp) {
        const parsed = await parseWebp(uploadedPath);
        fps = parsed.meta.fps;
        await renderWebpFrames(parsed, framesDir, { backgroundImage: bgImage, background: defaultBackground, topReserved: defaultTopReserved });
        audioPath = undefined;
      } else {
        const audioDir = path.join(tmpDir, 'audio');
        fs.mkdirSync(audioDir, { recursive: true });

        const animData  = await parseSvga(uploadedPath);
        fps = animData.params.fps;

        const audioFiles = await extractAudio(animData, audioDir);
        audioPath = pickPrimaryAudio(audioFiles, animData.params.frames);

        await renderFrames(animData, framesDir, { backgroundImage: bgImage, background: defaultBackground, topReserved: defaultTopReserved });
      }

      const outputFileName = `${jobId}.${format}`;
      const outputPath     = path.join(outDir, outputFileName);
      await encodeVideo({ framesDir, fps, outputPath, audioPath, format });

      const baseUrl = `${req.protocol}://${req.get('host')}`;
      return res.json({ url: `${baseUrl}/outputs/${outputFileName}` });

    } catch (err) {
      console.error(`[svga-gift-converter][${jobId}] /mp4 error:`, err.message);
      return res.status(500).json({ error: err.message });
    } finally {
      removeDir(tmpDir);
      if (uploadedPath) removeFile(uploadedPath);
    }
  });

  // ── POST /convert ────────────────────────────────────────────────────────────
  // Full-metadata endpoint: returns jobId, downloadUrl, fps, frames, hasAudio, etc.
  router.post(
    '/convert',
    upload.fields([{ name: 'file', maxCount: 1 }, { name: 'backgroundImage', maxCount: 1 }]),
    async (req, res) => {
      const jobId      = uuidv4();
      const tmpDir     = path.join(os.tmpdir(), `svga-gift-${jobId}`);
      let uploadedPath = null;
      let uploadedBgPath = null;

      try {
        const svgaFile = req.files && req.files['file'] && req.files['file'][0];
        if (!svgaFile) {
          return res.status(400).json({ success: false, error: 'No file uploaded' });
        }

        uploadedPath = svgaFile.path;

        const bgFile   = req.files && req.files['backgroundImage'] && req.files['backgroundImage'][0];
        uploadedBgPath = bgFile ? bgFile.path : null;

        let bgImage = null;
        if (uploadedBgPath) {
          bgImage = uploadedBgPath;
        } else if (defaultBgImage && fs.existsSync(defaultBgImage)) {
          bgImage = defaultBgImage;
        }

        const width       = req.body.width  ? parseInt(req.body.width,  10) : undefined;
        const height      = req.body.height ? parseInt(req.body.height, 10) : undefined;
        const format      = req.body.format === 'webm' ? 'webm' : 'mp4';
        const background  = req.body.background || defaultBackground;
        const topReserved = req.body.topReserved != null ? parseFloat(req.body.topReserved) : defaultTopReserved;

        const framesDir = path.join(tmpDir, 'frames');
        const audioDir  = path.join(tmpDir, 'audio');
        fs.mkdirSync(framesDir, { recursive: true });
        fs.mkdirSync(audioDir,  { recursive: true });

        const fileExt = path.extname(svgaFile.originalname).toLowerCase();
        const isWebp  = fileExt === '.webp';

        let fps, frameCount, outWidth, outHeight, hasAudio, audioPath;

        if (isWebp) {
          const parsed = await parseWebp(uploadedPath);
          fps        = parsed.meta.fps;
          frameCount = parsed.meta.frames;
          outWidth   = width  || parsed.meta.width;
          outHeight  = height || parsed.meta.height;
          hasAudio   = false;
          audioPath  = undefined;
          await renderWebpFrames(parsed, framesDir, { backgroundImage: bgImage, background, topReserved });
        } else {
          const animData   = await parseSvga(uploadedPath);
          const { params } = animData;
          fps        = params.fps;
          frameCount = params.frames;
          outWidth   = width  || Math.ceil(params.viewBoxWidth);
          outHeight  = height || Math.ceil(params.viewBoxHeight);

          const audioFiles = await extractAudio(animData, audioDir);
          hasAudio  = audioFiles.length > 0;
          audioPath = pickPrimaryAudio(audioFiles, params.frames);
          await renderFrames(animData, framesDir, { width, height, background, backgroundImage: bgImage, topReserved });
        }

        const outputFileName = `${jobId}.${format}`;
        const outputPath     = path.join(defaultOutputDir, outputFileName);
        fs.mkdirSync(defaultOutputDir, { recursive: true });

        await encodeVideo({ framesDir, fps, outputPath, audioPath: audioPath || undefined, format, width, height });

        const downloadUrl = `/outputs/${outputFileName}`;

        return res.json({
          success: true,
          jobId,
          downloadUrl,
          format,
          fps,
          frames:   frameCount,
          width:    outWidth,
          height:   outHeight,
          hasAudio,
        });

      } catch (err) {
        console.error(`[svga-gift-converter][${jobId}] /convert error:`, err.message);
        return res.status(500).json({ success: false, error: err.message });
      } finally {
        removeDir(tmpDir);
        if (uploadedPath)   removeFile(uploadedPath);
        if (uploadedBgPath) removeFile(uploadedBgPath);
      }
    }
  );

  // ── POST /audio ──────────────────────────────────────────────────────────────
  // Extract audio tracks from an SVGA file.
  router.post('/audio', upload.single('file'), async (req, res) => {
    const jobId      = uuidv4();
    const tmpDir     = path.join(os.tmpdir(), `svga-gift-${jobId}`);
    let uploadedPath = null;

    try {
      if (!req.file) {
        return res.status(400).json({ success: false, error: 'No file uploaded' });
      }

      uploadedPath = req.file.path;

      const animData = await parseSvga(uploadedPath);
      const audioDir = path.join(tmpDir, 'audio');
      fs.mkdirSync(audioDir, { recursive: true });

      const audioFiles = await extractAudio(animData, audioDir);

      if (audioFiles.length === 0) {
        return res.json({ success: true, tracks: [], message: 'No audio found in SVGA' });
      }

      const tracks = [];
      for (const af of audioFiles) {
        const outName = `${jobId}_audio_${af.key}${af.ext}`;
        const outPath = path.join(defaultOutputDir, outName);
        fs.mkdirSync(defaultOutputDir, { recursive: true });
        fs.copyFileSync(af.filePath, outPath);
        tracks.push({
          key:         af.key,
          downloadUrl: `/outputs/${outName}`,
          ext:         af.ext,
          startFrame:  af.startFrame,
          endFrame:    af.endFrame,
          startTime:   af.startTime,
          totalTime:   af.totalTime,
        });
      }

      return res.json({ success: true, tracks });

    } catch (err) {
      console.error(`[svga-gift-converter][${jobId}] /audio error:`, err.message);
      return res.status(500).json({ success: false, error: err.message });
    } finally {
      removeDir(tmpDir);
      if (uploadedPath) removeFile(uploadedPath);
    }
  });

  return router;
}

module.exports = { createExpressRouter };
