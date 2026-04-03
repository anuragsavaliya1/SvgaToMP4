'use strict';

/**
 * Standalone server entry point.
 * Uses the svga-gift-converter package API.
 */

const express = require('express');
const path    = require('path');
const fs      = require('fs');

const { createExpressRouter }   = require('./index');
const { scheduleOutputPurge }   = require('./src/utils/cleanup');

const app  = express();
const PORT = process.env.PORT || 3000;

const OUTPUTS_DIR = path.join(__dirname, 'outputs');
const BG_IMAGE    = path.join(__dirname, 'Frame_1000004515.png');

fs.mkdirSync(OUTPUTS_DIR, { recursive: true });

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/outputs', express.static(OUTPUTS_DIR));

// Mount the package router
const giftRouter = createExpressRouter({
  backgroundImage: fs.existsSync(BG_IMAGE) ? BG_IMAGE : null,
  outputDir:       OUTPUTS_DIR,
});
app.use('/api/gifts', giftRouter);

// Also keep the original /api/svga route for backwards compatibility
const svgaRouter = require('./src/routes/svga');
app.use('/api/svga', svgaRouter);

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

app.use((_req, res) => res.status(404).json({ error: 'Not found' }));
app.use((err, _req, res, _next) => {
  console.error('[server] unhandled error:', err.message);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

scheduleOutputPurge(OUTPUTS_DIR, 60 * 60 * 1000, 30 * 60 * 1000);

app.listen(PORT, () => {
  console.log(`SVGA Gift Converter listening on http://localhost:${PORT}`);
  console.log('');
  console.log('Package API (via createExpressRouter):');
  console.log('  POST /api/gifts/mp4      — convert SVGA/WebP → { url }');
  console.log('  POST /api/gifts/convert  — full metadata response');
  console.log('  POST /api/gifts/audio    — extract audio from SVGA');
  console.log('  GET  /api/gifts/health   — health check');
  console.log('');
  console.log('Legacy routes:');
  console.log('  POST /api/svga/mp4      — same, kept for backwards compat');
  console.log('  POST /api/svga/convert');
  console.log('  POST /api/svga/audio');
});

module.exports = app;
