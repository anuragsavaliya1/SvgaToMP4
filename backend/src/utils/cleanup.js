'use strict';

const fs = require('fs');
const path = require('path');
const log = require('./logger')('cleanup');

/**
 * Recursively delete a directory and all its contents.
 */
function removeDir(dirPath) {
  if (!fs.existsSync(dirPath)) return;
  fs.rmSync(dirPath, { recursive: true, force: true });
}

/**
 * Delete a single file if it exists.
 */
function removeFile(filePath) {
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch {
    // ignore
  }
}

/**
 * Delete all files in a directory that are older than maxAgeMs milliseconds.
 * Does NOT recurse into subdirectories.
 *
 * @param {string} dirPath
 * @param {number} maxAgeMs - e.g. 60 * 60 * 1000 for 1 hour
 */
function purgeOldFiles(dirPath, maxAgeMs) {
  if (!fs.existsSync(dirPath)) return;

  const now = Date.now();
  let entries;
  try {
    entries = fs.readdirSync(dirPath);
  } catch {
    return;
  }

  for (const name of entries) {
    const full = path.join(dirPath, name);
    try {
      const stat = fs.statSync(full);
      if (stat.isFile() && now - stat.mtimeMs > maxAgeMs) {
        fs.unlinkSync(full);
        log.info(`Purged old output file: ${name}`);
      }
    } catch {
      // ignore per-file errors
    }
  }
}

/**
 * Schedule periodic purge of old output files using setInterval.
 *
 * @param {string} outputDir
 * @param {number} maxAgeMs    - Files older than this are deleted (default 1 hour)
 * @param {number} intervalMs  - How often to run the purge (default 30 minutes)
 * @returns {NodeJS.Timeout}   - The interval handle (call clearInterval to stop)
 */
function scheduleOutputPurge(outputDir, maxAgeMs = 60 * 60 * 1000, intervalMs = 30 * 60 * 1000) {
  log.info(`Scheduling output purge — every ${intervalMs / 60000} min, max age ${maxAgeMs / 60000} min`);
  return setInterval(() => {
    purgeOldFiles(outputDir, maxAgeMs);
  }, intervalMs);
}

module.exports = { removeDir, removeFile, purgeOldFiles, scheduleOutputPurge };
