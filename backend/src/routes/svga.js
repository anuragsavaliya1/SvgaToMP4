'use strict';

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const { parseSvga } = require('../services/svgaParser');
const { renderFrames } = require('../services/frameRenderer');
const { parseWebp, renderWebpFrames } = require('../services/webpParser');
const { extractAudio, pickPrimaryAudio } = require('../services/audioExtractor');
const { encodeVideo } = require('../services/videoEncoder');
const { removeDir, removeFile } = require('../utils/cleanup');

const router = express.Router();

// Directories (resolved relative to project root)
const UPLOADS_DIR = path.join(__dirname, '../../uploads');
const OUTPUTS_DIR = path.join(__dirname, '../../outputs');
const TEMP_DIR = path.join(__dirname, '../../temp');

// Default background image path (bundled in repo)
const DEFAULT_BG_IMAGE = path.join(__dirname, '../../Frame_1000004515.png');

// Multer: accept both svga file and optional background image
const upload = multer({
  dest: UPLOADS_DIR,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100 MB
  fileFilter(_req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase();
    if (
      ext === '.svga' || ext === '.webp' ||
      ext === '.png'  || ext === '.jpg' || ext === '.jpeg' ||
      file.mimetype === 'application/octet-stream' ||
      file.mimetype === 'image/webp'
    ) {
      cb(null, true);
    } else {
      cb(new Error('Only .svga files are accepted'));
    }
  },
});

// ─── POST /api/svga/convert ──────────────────────────────────────────────────
//
// Body (multipart/form-data):
//   file            - the .svga file
//   backgroundImage - (optional) PNG/JPG to use as background (falls back to bundled default)
//   width           - (optional) output width  in px
//   height          - (optional) output height in px
//   format          - (optional) 'mp4' (default) | 'webm'
//   background      - (optional) CSS color fallback when no image provided
//
// Response:
//   { success, jobId, downloadUrl, format, fps, frames, width, height, hasAudio }
// ─────────────────────────────────────────────────────────────────────────────
router.post('/convert', upload.fields([{ name: 'file', maxCount: 1 }, { name: 'backgroundImage', maxCount: 1 }]), async (req, res) => {
  const jobId = uuidv4();
  const jobTempDir = path.join(TEMP_DIR, jobId);
  let uploadedPath = null;
  let uploadedBgPath = null;

  try {
    const svgaFile = req.files && req.files['file'] && req.files['file'][0];
    if (!svgaFile) {
      return res.status(400).json({ success: false, error: 'No file uploaded' });
    }

    uploadedPath = svgaFile.path;

    // Background image: uploaded file > bundled default > color fallback
    const bgFile = req.files && req.files['backgroundImage'] && req.files['backgroundImage'][0];
    uploadedBgPath = bgFile ? bgFile.path : null;

    let backgroundImage = null;
    if (uploadedBgPath) {
      backgroundImage = uploadedBgPath;
    } else if (fs.existsSync(DEFAULT_BG_IMAGE)) {
      backgroundImage = DEFAULT_BG_IMAGE;
    }

    const width = req.body.width ? parseInt(req.body.width, 10) : undefined;
    const height = req.body.height ? parseInt(req.body.height, 10) : undefined;
    const format = req.body.format === 'webm' ? 'webm' : 'mp4';
    const background = req.body.background || (format === 'mp4' ? '#ffffff' : 'transparent');

    console.log(`[${jobId}] Parsing SVGA…`);
    const animData = await parseSvga(uploadedPath);

    const { params } = animData;
    console.log(
      `[${jobId}] viewBox=${params.viewBoxWidth}x${params.viewBoxHeight} fps=${params.fps} frames=${params.frames}`
    );

    // Create temp sub-directories for this job
    const framesDir = path.join(jobTempDir, 'frames');
    const audioDir = path.join(jobTempDir, 'audio');
    fs.mkdirSync(framesDir, { recursive: true });
    fs.mkdirSync(audioDir, { recursive: true });

    // Extract audio
    console.log(`[${jobId}] Extracting audio…`);
    const audioFiles = await extractAudio(animData, audioDir);
    const audioPath = pickPrimaryAudio(audioFiles, params.frames);
    console.log(`[${jobId}] Audio tracks found: ${audioFiles.length}`);

    // Render frames
    console.log(`[${jobId}] Rendering ${params.frames} frames… (bg: ${backgroundImage || background})`);
    await renderFrames(animData, framesDir, { width, height, background, backgroundImage });

    // Encode video
    const outputFileName = `${jobId}.${format}`;
    const outputPath = path.join(OUTPUTS_DIR, outputFileName);

    console.log(`[${jobId}] Encoding video (${format})…`);
    await encodeVideo({
      framesDir,
      fps: params.fps,
      outputPath,
      audioPath: audioPath || undefined,
      format,
      width,
      height,
    });

    // Build download URL (relative; frontend/nginx should serve /outputs)
    const downloadUrl = `/outputs/${outputFileName}`;

    console.log(`[${jobId}] Done → ${outputPath}`);

    res.json({
      success: true,
      jobId,
      downloadUrl,
      format,
      fps: params.fps,
      frames: params.frames,
      width: width || Math.ceil(params.viewBoxWidth),
      height: height || Math.ceil(params.viewBoxHeight),
      hasAudio: audioFiles.length > 0,
    });
  } catch (err) {
    console.error(`[${jobId}] Error:`, err.message);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    // Clean up temp frames & audio (keep the output file)
    removeDir(jobTempDir);
    if (uploadedPath) removeFile(uploadedPath);
    if (uploadedBgPath) removeFile(uploadedBgPath);
  }
});

// ─── POST /api/svga/audio ────────────────────────────────────────────────────
//
// Body (multipart/form-data):
//   file - the .svga file
//
// Response:
//   { success, tracks: [{ key, downloadUrl, ext, startFrame, endFrame }] }
// ─────────────────────────────────────────────────────────────────────────────
router.post('/audio', upload.single('file'), async (req, res) => {
  const jobId = uuidv4();
  const jobTempDir = path.join(TEMP_DIR, jobId);
  let uploadedPath = null;

  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No file uploaded' });
    }

    uploadedPath = req.file.path;

    const animData = await parseSvga(uploadedPath);

    const audioDir = path.join(jobTempDir, 'audio');
    fs.mkdirSync(audioDir, { recursive: true });

    const audioFiles = await extractAudio(animData, audioDir);

    if (audioFiles.length === 0) {
      return res.json({ success: true, tracks: [], message: 'No audio found in SVGA' });
    }

    // Move audio files to outputs so they can be downloaded
    const tracks = [];
    for (const af of audioFiles) {
      const outName = `${jobId}_audio_${af.key}${af.ext}`;
      const outPath = path.join(OUTPUTS_DIR, outName);
      fs.copyFileSync(af.filePath, outPath);
      tracks.push({
        key: af.key,
        downloadUrl: `/outputs/${outName}`,
        ext: af.ext,
        startFrame: af.startFrame,
        endFrame: af.endFrame,
        startTime: af.startTime,
        totalTime: af.totalTime,
      });
    }

    res.json({ success: true, tracks });
  } catch (err) {
    console.error(`[${jobId}] Audio extract error:`, err.message);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    removeDir(jobTempDir);
    if (uploadedPath) removeFile(uploadedPath);
  }
});

// ─── POST /api/svga/mp4 ───────────────────────────────────────────────────────
//
// Simple endpoint for batch processing via Postman.
//
// Request (multipart/form-data):
//   file   — .svga file  (required)
//   format — 'mp4' | 'webm'  (optional, default: mp4)
//
// Success response:
//   { "url": "http://host:port/outputs/xxxx.mp4" }
//
// Error response:
//   { "error": "description" }
// ─────────────────────────────────────────────────────────────────────────────
router.post('/mp4', upload.single('file'), async (req, res) => {
  const jobId = uuidv4();
  const jobTempDir = path.join(TEMP_DIR, jobId);
  let uploadedPath = null;

  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded. Send the .svga file as form-data field "file".' });
    }

    uploadedPath = req.file.path;
    const format = req.body.format === 'webm' ? 'webm' : 'mp4';
    const ext    = path.extname(req.file.originalname).toLowerCase();
    const isWebp = ext === '.webp';

    const backgroundImage = fs.existsSync(DEFAULT_BG_IMAGE) ? DEFAULT_BG_IMAGE : null;
    const framesDir = path.join(jobTempDir, 'frames');
    fs.mkdirSync(framesDir, { recursive: true });

    let fps, audioPath;

    if (isWebp) {
      // ── Animated WebP flow ──────────────────────────────────────────────
      const rawFramesDir = path.join(jobTempDir, 'raw_frames');
      const parsed = await parseWebp(uploadedPath, rawFramesDir);
      fps = parsed.meta.fps;

      await renderWebpFrames(parsed, framesDir, { backgroundImage, background: '#ffffff' });
      audioPath = undefined; // WebP has no audio

    } else {
      // ── SVGA flow ───────────────────────────────────────────────────────
      const audioDir = path.join(jobTempDir, 'audio');
      fs.mkdirSync(audioDir, { recursive: true });

      const animData  = await parseSvga(uploadedPath);
      fps = animData.params.fps;

      const audioFiles = await extractAudio(animData, audioDir);
      audioPath = pickPrimaryAudio(audioFiles, animData.params.frames);

      await renderFrames(animData, framesDir, { backgroundImage, background: '#ffffff' });
    }

    const outputFileName = `${jobId}.${format}`;
    const outputPath = path.join(OUTPUTS_DIR, outputFileName);

    await encodeVideo({ framesDir, fps, outputPath, audioPath, format });

    const baseUrl = `${req.protocol}://${req.get('host')}`;
    return res.json({ url: `${baseUrl}/outputs/${outputFileName}` });

  } catch (err) {
    console.error(`[${jobId}] /mp4 error:`, err.message);
    return res.status(500).json({ error: err.message });
  } finally {
    removeDir(jobTempDir);
    if (uploadedPath) removeFile(uploadedPath);
  }
});

module.exports = router;
