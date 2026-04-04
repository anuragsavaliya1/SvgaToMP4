# svga-gift-converter — Example Project

Shows two ways to use the `svga-gift-converter` package in your own project.

---

## Setup

```bash
cd example
npm install
```

---

## Way 1 — Express Middleware (API Server)

Adds the converter as a route inside your own Express app.

```bash
node server.js
```

Server starts on **http://localhost:4000**

### Convert a gift (Postman or curl)

```bash
# Returns: { "url": "http://localhost:4000/outputs/xxxx.mp4" }
curl -X POST http://localhost:4000/api/gifts/mp4 \
  -F "file=@/path/to/gift.svga"
```

### Available endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/gifts/mp4` | Upload `.svga` or `.webp` → `{ url }` |
| `POST` | `/api/gifts/convert` | Full response: url, fps, frames, hasAudio |
| `POST` | `/api/gifts/audio` | Extract audio tracks |
| `GET`  | `/api/gifts/health` | Health check |

---

## Way 2 — Programmatic (no server)

Directly call `convert()` in your own script or service.

```bash
# Convert a specific file
node convert-example.js path/to/gift.svga
node convert-example.js path/to/animation.webp

# Uses bundled test file if no argument given
node convert-example.js
```

Output is saved to `example/outputs/`.

---

## Using in your own code

### Install (after publishing to npm)
```bash
npm install svga-gift-converter
```

### Programmatic API
```js
const { convert } = require('svga-gift-converter');

const result = await convert('./gift.svga', {
  outputDir:       './outputs',
  backgroundImage: './bg.png',  // optional
  topReserved:     0.30,        // 30% blank above animation
  background:      '#ffffff',
  format:          'mp4',       // or 'webm'
});

console.log(result.filePath);  // absolute path to the MP4
console.log(result.fileName);  // e.g. "abc123.mp4"
```

### Express middleware
```js
const express = require('express');
const { createExpressRouter } = require('svga-gift-converter');

const app = express();

app.use('/outputs', express.static('./outputs'));
app.use('/api/gifts', createExpressRouter({
  outputDir:       './outputs',
  backgroundImage: './bg.png',  // optional
  topReserved:     0.30,
  background:      '#ffffff',
}));

app.listen(3000);
```
