'use strict';

const fs = require('fs');
const path = require('path');
const log = require('../utils/logger')('audioExtractor');

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
    log.info('No audio buffers found in SVGA data');
    return results;
  }

  log.info(`Extracting ${Object.keys(audioBuffers).length} audio track(s) to: ${outDir}`);

  for (const [key, audioInfo] of Object.entries(audioBuffers)) {
    const ext = audioInfo.ext || '.mp3';
    const filePath = path.join(outDir, `audio_${key}${ext}`);
    fs.writeFileSync(filePath, audioInfo.data);

    const meta = (audios || []).find((a) => a.audioKey === key) || {};

    log.info(
      `Audio track written — key="${key}" ext="${ext}" ` +
      `size=${(audioInfo.data.length / 1024).toFixed(1)}KB ` +
      `startFrame=${meta.startFrame || 0} endFrame=${meta.endFrame || 0} ` +
      `startTime=${meta.startTime || 0}ms totalTime=${meta.totalTime || 0}ms`
    );

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

  log.info(`Audio extraction complete — ${results.length} track(s) extracted`);
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
  if (!audioFiles || audioFiles.length === 0) {
    log.info('No audio tracks available — video will be silent');
    return null;
  }
  if (audioFiles.length === 1) {
    log.info(`Using single audio track: key="${audioFiles[0].key}" path=${audioFiles[0].filePath}`);
    return audioFiles[0].filePath;
  }

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

  log.info(
    `Multiple audio tracks (${audioFiles.length}) — selected primary: ` +
    `key="${best.key}" span=${bestSpan} frames (out of ${totalFrames})`
  );
  return best.filePath;
}

module.exports = { extractAudio, pickPrimaryAudio };
