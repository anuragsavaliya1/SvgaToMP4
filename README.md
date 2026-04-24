# svga-gift-converter

Convert `.svga` and animated `.webp` gift animations to MP4/WebM, extract audio tracks, and generate still images.


## Features

- Convert `.svga` and animated `.webp` to `mp4` or `webm`
- Express router ready for direct API integration
- Programmatic API for backend jobs/scripts
- Optional background image compositing
- Audio extraction from SVGA files
- Stills extraction from animation timeline

## Requirements

- Node.js `>=18`
- `ffmpeg` installed and available in PATH

## Install

If published to npm:

```bash
npm install svga-gift-converter
```

For local development in this repo:

```bash
cd backend
npm install
```

## Run Standalone API Server

From this repo:

```bash
cd backend
npm start
```

Server starts on `http://localhost:3000`.

Main endpoints:

- `POST /api/gifts/mp4` -> returns `{ url }`
- `POST /api/gifts/convert` -> detailed conversion metadata
- `POST /api/gifts/stills` -> extract still images
- `POST /api/gifts/audio` -> extract audio tracks from SVGA
- `GET /api/gifts/health` -> health check

## Use This Package In Your Project

### 1) Express integration (recommended)

```js
const express = require('express');
const path = require('path');
const fs = require('fs');
const { createExpressRouter } = require('svga-gift-converter');

const app = express();
const PORT = 4000;
const OUTPUT_DIR = path.join(__dirname, 'outputs');
fs.mkdirSync(OUTPUT_DIR, { recursive: true });

app.use('/outputs', express.static(OUTPUT_DIR));

const giftRouter = createExpressRouter({
  outputDir: OUTPUT_DIR,
  // backgroundImage: path.join(__dirname, 'background.png'),
  topReserved: 0.30,
  background: '#ffffff',
});

app.use('/api/gifts', giftRouter);

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
```

Then upload with `multipart/form-data`:

- field name must be `file`
- accepted file types: `.svga`, `.webp`

Example:

```bash
curl -X POST http://localhost:4000/api/gifts/mp4 \
  -F "file=@/absolute/path/to/your-file.svga"
```

### 2) Programmatic API usage

```js
const svgaMP4 = require('svga-gift-converter');

async function run() {
  const result = await svgaMP4.convert('./gift.svga', {
    outputDir: './outputs',
    backgroundImage: './bg.png',
    topReserved: 0.30,
    format: 'mp4', // or 'webm'
  });

  console.log(result.filePath);
}

run().catch(console.error);
```

Extract still images:

```js
const svgaMP4 = require('svga-gift-converter');

async function getStills() {
  const stills = await svgaMP4.extractStills('./gift.svga', {
    outputDir: './outputs',
    positions: [0.2, 0.5, 0.8],
    imageFormat: 'png', // or 'jpeg'
    quality: 85, // used for jpeg
  });

  console.log(stills);
}

getStills().catch(console.error);
```

## API Notes

- `createExpressRouter(options)` options:
  - `backgroundImage`: absolute path to default background image
  - `outputDir`: output video/image directory
  - `uploadsDir`: custom uploads temp directory
  - `topReserved`: top reserved area fraction (default `0.30`)
  - `background`: fallback background color (default `#ffffff`)
  - `maxFileSize`: upload limit in bytes (default `100MB`)

## Example Project

See `example/server.js` for a ready-to-run integration example.

## Input and Output File Example

Real sample files in this repo:

- Input SVGA file: `backend/outputs/119040-20211122_111625_1637550985956 (1).svga`
- Generated output MP4 file: `backend/outputs/output.mp4`

You can use these files to quickly test the converter flow and verify output quality.

## License

MIT