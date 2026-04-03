'use strict';

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const { parseSvga } = require('../services/svgaParser');
const { renderFrames } = require('../services/frameRenderer');
const { extractAudio, pickPrimaryAudio } = require('../services/audioExtractor');
const { encodeVideo } = require('../services/videoEncoder');
const { removeDir, removeFile } = require('../utils/cleanup');

const router = express.Router();

// Directories (resolved relative to project root)
const UPLOADS_DIR = path.join(__dirname, '../../uploads');
const OUTPUTS_DIR = path.join(__dirname, '../../outputs');
const TEMP_DIR = path.join(__dirname, '../../temp');

// Multer: store uploaded SVGA on disk
const upload = multer({
  dest: UPLOADS_DIR,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100 MB
  fileFilter(_req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === '.svga' || file.mimetype === 'application/octet-stream') {
      cb(null, true);
    } else {
      cb(new Error('Only .svga files are accepted'));
    }
  },
});

// ─── POST /api/svga/convert ──────────────────────────────────────────────────
//
// Body (multipart/form-data):
//   file    - the .svga file
//   width   - (optional) output width  in px
//   height  - (optional) output height in px
//   format  - (optional) 'mp4' (default) | 'webm'
//
// Response:
//   { success, jobId, downloadUrl, format, fps, frames, width, height, hasAudio }
// ─────────────────────────────────────────────────────────────────────────────
router.post('/convert', upload.single('file'), async (req, res) => {
  const jobId = uuidv4();
  const jobTempDir = path.join(TEMP_DIR, jobId);
  let uploadedPath = null;

  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No file uploaded' });
    }

    uploadedPath = req.file.path;

    const width = req.body.width ? parseInt(req.body.width, 10) : undefined;
    const height = req.body.height ? parseInt(req.body.height, 10) : undefined;
    const format = req.body.format === 'webm' ? 'webm' : 'mp4';
    // background: caller can pass e.g. 'transparent', '#000000', '#ffffff'
    // MP4 (yuv420p) has no alpha — default to white; WebM supports alpha so default transparent
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
    console.log(`[${jobId}] Rendering ${params.frames} frames… (background: ${background})`);
    await renderFrames(animData, framesDir, { width, height, background });

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

module.exports = router;
