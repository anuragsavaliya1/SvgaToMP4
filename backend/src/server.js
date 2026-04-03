'use strict';

const express = require('express');
const path = require('path');
const fs = require('fs');

const svgaRouter = require('./routes/svga');
const { scheduleOutputPurge } = require('./utils/cleanup');

const app = express();
const PORT = process.env.PORT || 3000;

// Ensure required directories exist
const DIRS = [
  path.join(__dirname, '../uploads'),
  path.join(__dirname, '../outputs'),
  path.join(__dirname, '../temp'),
];
for (const dir of DIRS) {
  fs.mkdirSync(dir, { recursive: true });
}

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve converted output files for download
app.use('/outputs', express.static(path.join(__dirname, '../outputs')));

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api/svga', svgaRouter);

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// 404 handler
app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Global error handler
app.use((err, _req, res, _next) => {
  console.error('[server] unhandled error:', err.message);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

// ── Periodic cleanup ──────────────────────────────────────────────────────────
// Purge output files older than 1 hour, check every 30 minutes
scheduleOutputPurge(
  path.join(__dirname, '../outputs'),
  60 * 60 * 1000,   // 1 hour max age
  30 * 60 * 1000    // check every 30 minutes
);

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`SVGA Converter API listening on http://localhost:${PORT}`);
  console.log('Endpoints:');
  console.log('  POST /api/svga/convert  — convert SVGA to MP4/WebM');
  console.log('  POST /api/svga/audio    — extract audio from SVGA');
  console.log('  GET  /health            — health check');
});

module.exports = app;
