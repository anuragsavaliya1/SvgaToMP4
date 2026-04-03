'use strict';

const ffmpeg = require('fluent-ffmpeg');
const path = require('path');

// Use system ffmpeg; override via FFMPEG_PATH env var if needed
if (process.env.FFMPEG_PATH) {
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

  return new Promise((resolve, reject) => {
    const framePattern = path.join(framesDir, 'frame_%06d.png');

    const cmd = ffmpeg();

    // Input: image sequence
    cmd
      .input(framePattern)
      .inputOptions([
        `-framerate ${fps}`,
        '-start_number 0',
      ]);

    // Input: audio (if present)
    if (audioPath) {
      cmd.input(audioPath);
    }

    // Video filters: scale to even dimensions (required by most codecs)
    const scaleFilter = buildScaleFilter(width, height);

    if (format === 'webm') {
      cmd.videoCodec('libvpx-vp9');
      cmd.outputOptions([
        '-crf 30',
        '-b:v 0',
        scaleFilter,
        '-pix_fmt yuva420p', // preserve alpha in webm
        '-auto-alt-ref 0',
      ]);
      if (audioPath) {
        cmd.audioCodec('libopus');
      }
    } else {
      // mp4
      cmd.videoCodec('libx264');
      cmd.outputOptions([
        '-crf 23',
        '-preset fast',
        scaleFilter,
        '-pix_fmt yuv420p', // required for broad compatibility
        '-movflags +faststart',
      ]);
      if (audioPath) {
        cmd.audioCodec('aac');
        cmd.outputOptions(['-b:a 192k']);
      }
    }

    if (audioPath) {
      cmd.outputOptions(['-shortest']); // end when shorter stream ends
    }

    cmd
      .output(outputPath)
      .on('start', (cmdLine) => {
        console.log('[ffmpeg] start:', cmdLine);
      })
      .on('progress', (progress) => {
        if (progress.percent) {
          process.stdout.write(`\r[ffmpeg] ${Math.floor(progress.percent)}%`);
        }
      })
      .on('end', () => {
        process.stdout.write('\n');
        resolve(outputPath);
      })
      .on('error', (err, stdout, stderr) => {
        console.error('[ffmpeg] error:', err.message);
        console.error('[ffmpeg] stderr:', stderr);
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

module.exports = { encodeVideo };
