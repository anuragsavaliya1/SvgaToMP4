'use strict';

/**
 * Example: Use svga-gift-converter as Express middleware in your own project.
 *
 * Run:  node server.js
 * Test: POST http://localhost:4000/api/gifts/mp4  (form-data, field "file" = .svga or .webp)
 */

const express = require('express');
const path    = require('path');
const fs      = require('fs');

// ── Import from the npm package ───────────────────────────────────────────────
const { createExpressRouter } = require('svga-gift-converter');

const app  = express();
const PORT = process.env.PORT || 4000;

// Output directory for converted videos
const OUTPUT_DIR = path.join(__dirname, 'outputs');
fs.mkdirSync(OUTPUT_DIR, { recursive: true });

// Serve output files so the returned URL works
app.use('/outputs', express.static(OUTPUT_DIR));

// ── Mount the gift converter router ──────────────────────────────────────────
//
// Options you can pass:
//   backgroundImage  — path to your background PNG (optional)
//   outputDir        — where to save MP4/WebM files
//   topReserved      — fraction of canvas height to leave blank above the animation (default 0.30 = 30%)
//   background       — fallback background color (default '#ffffff')
//
const giftRouter = createExpressRouter({
  outputDir: OUTPUT_DIR,
  backgroundImage: path.join(__dirname, 'BACKGROUND.png'),  // uncomment + set your own image
  topReserved: 0.30,
  //background:  '#ffffff',
});

app.use('/api/gifts', giftRouter);

// ── Your own routes go here ───────────────────────────────────────────────────
app.get('/', (_req, res) => {
  res.json({
    message: 'svga-gift-converter example server',
    endpoints: {
      'POST /api/gifts/mp4':     'Upload .svga or .webp → { url }',
      'POST /api/gifts/convert': 'Upload .svga → full metadata',
      'POST /api/gifts/audio':   'Extract audio from .svga',
      'GET  /api/gifts/health':  'Health check',
    },
  });
});

app.listen(PORT, () => {
  console.log(`Example server running at http://localhost:${PORT}`);
  console.log('');
  console.log('Try it:');
  console.log(`  curl -X POST http://localhost:${PORT}/api/gifts/mp4 \\`);
  console.log(`    -F "file=@/path/to/your-gift.svga"`);
});
