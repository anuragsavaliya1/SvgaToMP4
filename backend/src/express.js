'use strict';

const express  = require('express');
const multer   = require('multer');
const path     = require('path');
const fs       = require('fs');
const os       = require('os');
const { v4: uuidv4 } = require('uuid');
const log = require('./utils/logger')('router');

const { parseSvga }                        = require('./services/svgaParser');
const { renderFrames }                     = require('./services/frameRenderer');
const { parseWebp, renderWebpFrames }      = require('./services/webpParser');
const { extractAudio, pickPrimaryAudio }   = require('./services/audioExtractor');
const { encodeVideo }                      = require('./services/videoEncoder');
const { extractStills }                    = require('./services/stillsExtractor');
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
  router.post('/mp4', upload.single('file'), async (req, res) => {
    const jobId      = uuidv4();
    const tmpDir     = path.join(os.tmpdir(), `svga-gift-${jobId}`);
    const framesDir  = path.join(tmpDir, 'frames');
    let uploadedPath = null;

    try {
      if (!req.file) {
        log.warn(`[job:${jobId}] POST /mp4 — no file in request`);
        return res.status(400).json({ error: 'No file uploaded. Send the file as form-data field "file".' });
      }

      uploadedPath = req.file.path;
      const format = req.body.format === 'webm' ? 'webm' : 'mp4';
      const ext    = path.extname(req.file.originalname).toLowerCase();
      const isWebp = ext === '.webp';

      log.info(`[job:${jobId}] POST /mp4 — file: ${req.file.originalname} (${(req.file.size / 1024).toFixed(1)} KB) | format: ${format}`);

      const bgImage  = defaultBgImage && fs.existsSync(defaultBgImage) ? defaultBgImage : null;
      const outDir   = defaultOutputDir;
      fs.mkdirSync(framesDir, { recursive: true });

      let fps, audioPath;

      if (isWebp) {
        log.info(`[job:${jobId}] Processing as animated WebP`);
        const parsed = await parseWebp(uploadedPath);
        fps = parsed.meta.fps;
        await renderWebpFrames(parsed, framesDir, { backgroundImage: bgImage, background: defaultBackground, topReserved: defaultTopReserved });
        audioPath = undefined;
      } else {
        log.info(`[job:${jobId}] Processing as SVGA`);
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
      const url = `${baseUrl}/outputs/${outputFileName}`;
      log.info(`[job:${jobId}] POST /mp4 — done | url: ${url}`);
      return res.json({ url });

    } catch (err) {
      log.error(`[job:${jobId}] POST /mp4 failed: ${err.message}`);
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
          log.warn(`[job:${jobId}] POST /convert — no file in request`);
          return res.status(400).json({ success: false, error: 'No file uploaded' });
        }

        uploadedPath = svgaFile.path;
        log.info(`[job:${jobId}] POST /convert — file: ${svgaFile.originalname} (${(svgaFile.size / 1024).toFixed(1)} KB)`);

        const bgFile   = req.files && req.files['backgroundImage'] && req.files['backgroundImage'][0];
        uploadedBgPath = bgFile ? bgFile.path : null;
        if (bgFile) log.info(`[job:${jobId}] Custom background image uploaded: ${bgFile.originalname}`);

        let bgImage = null;
        if (uploadedBgPath) {
          bgImage = uploadedBgPath;
        } else if (defaultBgImage && fs.existsSync(defaultBgImage)) {
          bgImage = defaultBgImage;
          log.info(`[job:${jobId}] Using default background: ${path.basename(defaultBgImage)}`);
        } else {
          log.info(`[job:${jobId}] No background image — using color fallback`);
        }

        const width         = req.body.width  ? parseInt(req.body.width,  10) : undefined;
        const height        = req.body.height ? parseInt(req.body.height, 10) : undefined;
        const format        = req.body.format === 'webm' ? 'webm' : 'mp4';
        const background    = req.body.background || defaultBackground;
        const topReserved   = req.body.topReserved != null ? parseFloat(req.body.topReserved) : defaultTopReserved;
        // stills are ON by default; pass includeStills=false to skip them
        const includeStills = req.body.includeStills !== 'false' && req.body.includeStills !== false;

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

        // ── Extract stills from the original source animation ────────────────
        // Always runs unless the caller explicitly sends includeStills=false.
        // Failures are caught and reported without aborting the video response.
        let stillsResult = [];
        if (includeStills) {
          log.info(`[job:${jobId}] Extracting stills from original source...`);
          try {
            const rawStills = await extractStills(uploadedPath, {
              fileType:        fileExt,          // multer strips the extension; pass it explicitly
              outputDir:       defaultOutputDir,
              positions:       [0.20, 0.50, 0.80],
              imageFormat:     'png',
              backgroundImage: bgImage,
              background,
              topReserved,
              prefix:          `${jobId}_still`,
            });
            const baseUrl = `${req.protocol}://${req.get('host')}`;
            stillsResult = rawStills.map(s => ({
              position:   s.position,
              frameIndex: s.frameIndex,
              url:        `${baseUrl}/outputs/${s.fileName}`,
            }));
            log.info(`[job:${jobId}] ${stillsResult.length} still(s) ready`);
          } catch (stillsErr) {
            log.error(`[job:${jobId}] Stills extraction failed (video still returned): ${stillsErr.message}`);
          }
        }

        log.info(
          `[job:${jobId}] POST /convert — done | ` +
          `${outWidth}x${outHeight} ${fps}fps ${frameCount}frames ` +
          `hasAudio:${hasAudio} → ${downloadUrl}`
        );

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
          stills: stillsResult,
        });

      } catch (err) {
        log.error(`[job:${jobId}] POST /convert failed: ${err.message}`);
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
        log.warn(`[job:${jobId}] POST /audio — no file in request`);
        return res.status(400).json({ success: false, error: 'No file uploaded' });
      }

      uploadedPath = req.file.path;
      log.info(`[job:${jobId}] POST /audio — file: ${req.file.originalname} (${(req.file.size / 1024).toFixed(1)} KB)`);

      const animData = await parseSvga(uploadedPath);
      const audioDir = path.join(tmpDir, 'audio');
      fs.mkdirSync(audioDir, { recursive: true });

      const audioFiles = await extractAudio(animData, audioDir);

      if (audioFiles.length === 0) {
        log.info(`[job:${jobId}] POST /audio — no audio tracks in SVGA`);
        return res.json({ success: true, tracks: [], message: 'No audio found in SVGA' });
      }

      const tracks = [];
      for (const af of audioFiles) {
        const outName = `${jobId}_audio_${af.key}${af.ext}`;
        const outPath = path.join(defaultOutputDir, outName);
        fs.mkdirSync(defaultOutputDir, { recursive: true });
        fs.copyFileSync(af.filePath, outPath);
        log.info(`[job:${jobId}] Audio track saved — key="${af.key}" → /outputs/${outName}`);
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

      log.info(`[job:${jobId}] POST /audio — done | ${tracks.length} track(s) returned`);
      return res.json({ success: true, tracks });

    } catch (err) {
      log.error(`[job:${jobId}] POST /audio failed: ${err.message}`);
      return res.status(500).json({ success: false, error: err.message });
    } finally {
      removeDir(tmpDir);
      if (uploadedPath) removeFile(uploadedPath);
    }
  });

  // ── POST /stills ─────────────────────────────────────────────────────────────
  // Extract still images directly from the original SVGA or animated WebP source.
  // Never reads from the transcoded MP4/WebM — images come straight from the
  // parsed animation timeline.
  //
  // Body (multipart/form-data):
  //   file            — .svga or .webp  (required)
  //   backgroundImage — PNG/JPG         (optional, overrides server default)
  //   positions       — comma-separated floats, e.g. "0.2,0.5,0.8"  (default)
  //   imageFormat     — 'png' (default) | 'jpeg'
  //   quality         — JPEG quality 0–100  (default: 85)
  //   topReserved     — fraction of canvas height above animation (default: 0.30)
  //   background      — CSS fallback colour  (default: '#ffffff')
  //
  // Response:
  //   { success: true, stills: [{ position, frameIndex, url }] }
  router.post(
    '/stills',
    upload.fields([{ name: 'file', maxCount: 1 }, { name: 'backgroundImage', maxCount: 1 }]),
    async (req, res) => {
      const jobId        = uuidv4();
      let uploadedPath   = null;
      let uploadedBgPath = null;

      try {
        const file = req.files && req.files['file'] && req.files['file'][0];
        if (!file) {
          log.warn(`[job:${jobId}] POST /stills — no file in request`);
          return res.status(400).json({ success: false, error: 'No file uploaded' });
        }

        uploadedPath = file.path;
        log.info(`[job:${jobId}] POST /stills — file: ${file.originalname} (${(file.size / 1024).toFixed(1)} KB)`);

        // Background image: uploaded > server default > colour fallback
        const bgFile   = req.files && req.files['backgroundImage'] && req.files['backgroundImage'][0];
        uploadedBgPath = bgFile ? bgFile.path : null;
        const bgImage  = uploadedBgPath
          || (defaultBgImage && fs.existsSync(defaultBgImage) ? defaultBgImage : null);

        // Parse positions from request body, default [0.20, 0.50, 0.80]
        let positions = [0.20, 0.50, 0.80];
        if (req.body.positions) {
          const raw = String(req.body.positions).split(',').map(Number).filter(n => !isNaN(n) && n >= 0 && n <= 1);
          if (raw.length > 0) positions = raw;
        }

        const fileExt     = path.extname(file.originalname).toLowerCase();
        const imageFormat = req.body.imageFormat === 'jpeg' ? 'jpeg' : 'png';
        const quality     = req.body.quality ? Math.min(100, Math.max(0, parseInt(req.body.quality, 10))) : 85;
        const topReserved = req.body.topReserved != null ? parseFloat(req.body.topReserved) : defaultTopReserved;
        const background  = req.body.background || defaultBackground;

        log.info(`[job:${jobId}] Stills options — positions: [${positions.join(', ')}] | format: ${imageFormat} | quality: ${quality}`);

        const stills = await extractStills(uploadedPath, {
          fileType:        fileExt,   // multer strips extension; pass it explicitly
          outputDir:       defaultOutputDir,
          positions,
          imageFormat,
          quality,
          backgroundImage: bgImage,
          background,
          topReserved,
          prefix:          jobId,
        });

        const baseUrl = `${req.protocol}://${req.get('host')}`;
        const response = stills.map(s => ({
          position:   s.position,
          frameIndex: s.frameIndex,
          url:        `${baseUrl}/outputs/${s.fileName}`,
        }));

        log.info(`[job:${jobId}] POST /stills — done | ${response.length} still(s) returned`);
        return res.json({ success: true, stills: response });

      } catch (err) {
        log.error(`[job:${jobId}] POST /stills failed: ${err.message}`);
        return res.status(500).json({ success: false, error: err.message });
      } finally {
        if (uploadedPath)   removeFile(uploadedPath);
        if (uploadedBgPath) removeFile(uploadedBgPath);
      }
    }
  );

  return router;
}

module.exports = { createExpressRouter };
