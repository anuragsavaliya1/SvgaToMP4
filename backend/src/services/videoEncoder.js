'use strict';

const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs');
const log = require('../utils/logger')('videoEncoder');

// Use system ffmpeg; override via FFMPEG_PATH env var if needed
if (process.env.FFMPEG_PATH) {
  log.info(`Using custom FFmpeg path: ${process.env.FFMPEG_PATH}`);
  ffmpeg.setFfmpegPath(process.env.FFMPEG_PATH);
}

/**
 * Stitch PNG frame files (+ optional audio) into a video.
 *
 * @param {object} opts
 * @param {string}   opts.framesDir   - Directory containing frame_000000.png … files
 * @param {number}   opts.fps         - Frames per second
 * @param {string}   opts.outputPath  - Absolute path for the output video file
 * @param {string}   [opts.audioPath] - Optional path to an audio file to embed
 * @param {string}   [opts.format]    - 'mp4' (default) | 'webm'
 * @param {number}   [opts.width]     - Output width  (must be even)
 * @param {number}   [opts.height]    - Output height (must be even)
 * @returns {Promise<string>} Resolves with outputPath on success
 */
function encodeVideo(opts) {
  const {
    framesDir,
    fps,
    outputPath,
    audioPath,
    format = 'mp4',
    width,
    height,
  } = opts;

  log.info(
    `Encode start — format: ${format} | fps: ${fps} | ` +
    `audio: ${audioPath ? path.basename(audioPath) : 'none'} | ` +
    `output: ${path.basename(outputPath)}`
  );
  if (width || height) log.info(`Output size override: ${width || 'auto'}x${height || 'auto'}`);

  return new Promise((resolve, reject) => {
    const framePattern = path.join(framesDir, 'frame_%06d.png');

    const cmd = ffmpeg();

    cmd
      .input(framePattern)
      .inputOptions([
        `-framerate ${fps}`,
        '-start_number 0',
      ]);

    if (audioPath) {
      cmd.input(audioPath);
    }

    const scaleFilter = buildScaleFilter(width, height);

    if (format === 'webm') {
      cmd.videoCodec('libvpx-vp9');
      cmd.outputOptions([
        '-crf 30',
        '-b:v 0',
        scaleFilter,
        '-pix_fmt yuva420p',
        '-auto-alt-ref 0',
      ]);
      if (audioPath) cmd.audioCodec('libopus');
    } else {
      cmd.videoCodec('libx264');
      cmd.outputOptions([
        '-crf 23',
        '-preset fast',
        scaleFilter,
        '-pix_fmt yuv420p',
        '-movflags +faststart',
      ]);
      if (audioPath) {
        cmd.audioCodec('aac');
        cmd.outputOptions(['-b:a 192k']);
      }
    }

    if (audioPath) {
      cmd.outputOptions(['-shortest']);
    }

    const startTime = Date.now();

    cmd
      .output(outputPath)
      .on('start', (cmdLine) => {
        log.info(`FFmpeg command: ${cmdLine}`);
      })
      .on('progress', (progress) => {
        if (progress.percent != null) {
          log.info(`Encoding progress: ${Math.floor(progress.percent)}% | frames: ${progress.frames || '?'} | speed: ${progress.currentFps || '?'} fps`);
        }
      })
      .on('end', () => {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
        let sizeKB = '?';
        try { sizeKB = (fs.statSync(outputPath).size / 1024).toFixed(1); } catch {}
        log.info(`Encode complete — ${elapsed}s | output size: ${sizeKB} KB | path: ${outputPath}`);
        resolve(outputPath);
      })
      .on('error', (err, stdout, stderr) => {
        log.error(`FFmpeg failed: ${err.message}`);
        log.error(`FFmpeg stderr: ${stderr}`);
        reject(new Error(`FFmpeg failed: ${err.message}`));
      })
      .run();
  });
}

function buildScaleFilter(width, height) {
  if (width && height) {
    // Force even dimensions
    const w = makeEven(width);
    const h = makeEven(height);
    return `-vf scale=${w}:${h}`;
  }
  // Ensure dimensions are even without resizing
  return `-vf scale=trunc(iw/2)*2:trunc(ih/2)*2`;
}

function makeEven(n) {
  return n % 2 === 0 ? n : n + 1;
}

module.exports = { encodeVideo, buildScaleFilter, makeEven };
