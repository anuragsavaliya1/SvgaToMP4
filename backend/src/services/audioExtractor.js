'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Extract audio files from parsed SVGA data and write them to disk.
 *
 * @param {object} animData  - Parsed SVGA data from svgaParser.parseSvga()
 * @param {string} outDir    - Directory to write audio files into
 * @returns {object[]}       - Array of { key, filePath, ext, startFrame, endFrame, startTime, totalTime }
 */
async function extractAudio(animData, outDir) {
  const { audios, audioBuffers } = animData;
  const results = [];

  if (!audioBuffers || Object.keys(audioBuffers).length === 0) {
    return results;
  }

  for (const [key, audioInfo] of Object.entries(audioBuffers)) {
    const ext = audioInfo.ext || '.mp3';
    const filePath = path.join(outDir, `audio_${key}${ext}`);
    fs.writeFileSync(filePath, audioInfo.data);

    // Find matching audio metadata from the protobuf audios array
    const meta = (audios || []).find((a) => a.audioKey === key) || {};

    results.push({
      key,
      filePath,
      ext,
      startFrame: meta.startFrame || 0,
      endFrame: meta.endFrame || 0,
      startTime: meta.startTime || 0,
      totalTime: meta.totalTime || 0,
    });
  }

  return results;
}

/**
 * Pick the best audio file to embed in the final video.
 * If multiple audio tracks exist, prefer the one that covers the most frames.
 *
 * @param {object[]} audioFiles - Result of extractAudio()
 * @param {number}  totalFrames
 * @returns {string|null} filePath of the chosen audio, or null
 */
function pickPrimaryAudio(audioFiles, totalFrames) {
  if (!audioFiles || audioFiles.length === 0) return null;
  if (audioFiles.length === 1) return audioFiles[0].filePath;

  // Prefer track covering most frames
  let best = audioFiles[0];
  let bestSpan = best.endFrame - best.startFrame;

  for (const af of audioFiles) {
    const span = af.endFrame - af.startFrame;
    if (span > bestSpan) {
      best = af;
      bestSpan = span;
    }
  }

  return best.filePath;
}

module.exports = { extractAudio, pickPrimaryAudio };
