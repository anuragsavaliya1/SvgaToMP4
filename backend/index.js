'use strict';

/**
 * svga-gift-converter
 *
 * Convert SVGA and animated WebP gift animations to MP4.
 *
 * ─── Programmatic usage ──────────────────────────────────────────────────────
 *
 *   const svgaMP4 = require('svga-gift-converter');
 *
 *   // Toggle logging (default: true)
 *   svgaMP4.isLoggingEnabled = false;
 *
 *   // Convert to video
 *   const { filePath } = await svgaMP4.convert('./gift.svga', {
 *     outputDir:       './outputs',
 *     backgroundImage: './bg.png',   // optional
 *     topReserved:     0.30,         // 30% top space (default)
 *     format:          'mp4',        // 'mp4' | 'webm'
 *   });
 *
 *   // Extract 3 still images from the source animation timeline
 *   const stills = await svgaMP4.extractStills('./gift.svga', {
 *     outputDir:   './outputs',
 *     positions:   [0.20, 0.50, 0.80],  // timeline positions 0–1
 *     imageFormat: 'png',               // 'png' | 'jpeg'
 *     quality:     85,                  // JPEG quality (ignored for PNG)
 *   });
 *   // stills → [{ position: 0.2, frameIndex: 10, filePath, fileName }, ...]
 *
 * ─── Express middleware usage ─────────────────────────────────────────────────
 *
 *   const { createExpressRouter } = require('svga-gift-converter');
 *   const router = createExpressRouter({ backgroundImage: './bg.png' });
 *   app.use('/api/gifts', router);
 *
 *   // POST /api/gifts/mp4        — upload file → { url }
 *   // POST /api/gifts/convert    — upload file → full metadata response
 *   //                              (add includeStills=true to get stills[])
 *   // POST /api/gifts/stills     — upload file → 3 PNG/JPEG thumbnails
 *   // POST /api/gifts/audio      — extract audio from SVGA
 *   // GET  /api/gifts/health     — health check
 */

const config           = require('./src/utils/config');
const { convert, extractStills } = require('./src/converter');
const { createExpressRouter }    = require('./src/express');

const pkg = {
  convert,
  extractStills,
  createExpressRouter,

  /** Enable or disable all [SVGAMP4] log output. */
  get isLoggingEnabled()      { return config.isLoggingEnabled; },
  set isLoggingEnabled(value) { config.isLoggingEnabled = !!value; },
};

module.exports = pkg;
