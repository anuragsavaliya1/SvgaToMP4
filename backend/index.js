'use strict';

/**
 * svga-gift-converter
 *
 * Convert SVGA and animated WebP gift animations to MP4.
 *
 * ─── Programmatic usage ──────────────────────────────────────────────────────
 *
 *   const { convert } = require('svga-gift-converter');
 *
 *   const { filePath } = await convert('./gift.svga', {
 *     outputDir:       './outputs',
 *     backgroundImage: './bg.png',   // optional
 *     topReserved:     0.30,         // 30% top space (default)
 *     format:          'mp4',        // 'mp4' | 'webm'
 *   });
 *
 *   // Works the same for WebP:
 *   const { filePath } = await convert('./gift.webp', { outputDir: './outputs' });
 *
 * ─── Express middleware usage ─────────────────────────────────────────────────
 *
 *   const { createExpressRouter } = require('svga-gift-converter');
 *   const router = createExpressRouter({ backgroundImage: './bg.png' });
 *   app.use('/api/gifts', router);
 *
 *   // POST /api/gifts/mp4        — upload file → { url }
 *   // POST /api/gifts/convert    — upload file → full metadata response
 *   // POST /api/gifts/audio      — extract audio from SVGA
 *   // GET  /api/gifts/health     — health check
 */

const { convert } = require('./src/converter');
const { createExpressRouter } = require('./src/express');

module.exports = { convert, createExpressRouter };
