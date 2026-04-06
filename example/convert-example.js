'use strict';

/**
 * Example: Use svga-gift-converter programmatically (no server, just convert a file).
 *
 * Usage:
 *   node convert-example.js                       # converts the bundled test .svga
 *   node convert-example.js path/to/gift.svga
 *   node convert-example.js path/to/animation.webp
 */

const path = require('path');
const fs   = require('fs');

// ── Import from the npm package ───────────────────────────────────────────────
const { convert } = require('svga-gift-converter');

// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  // Use file from command-line argument, or fall back to the bundled test file
  const inputFile = process.argv[2]
    || path.join(__dirname, '../40001423.svga');

  if (!fs.existsSync(inputFile)) {
    console.error(`File not found: ${inputFile}`);
    console.error('Usage: node convert-example.js path/to/gift.svga');
    process.exit(1);
  }

  const outputDir = path.join(__dirname, 'outputs');
  fs.mkdirSync(outputDir, { recursive: true });

  console.log(`Converting: ${inputFile}`);
  console.log('...');

  try {
    const result = await convert(inputFile, {
      outputDir,

      // Optional: your own background image
      // backgroundImage: path.join(__dirname, 'your-background.png'),

      topReserved: 0.30,    // 30% blank space above the animation
      background:  '#ffffff',
      format:      'mp4',   // 'mp4' or 'webm'
    });

    console.log('');
    console.log('Done!');
    console.log('  Output file:', result.filePath);
    console.log('  File name  :', result.fileName);

  } catch (err) {
    console.error('Conversion failed:', err.message);
    process.exit(1);
  }
}

main();
