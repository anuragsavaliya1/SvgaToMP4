'use strict';

const request = require('supertest');
const express = require('express');
const path    = require('path');
const os      = require('os');
const fs      = require('fs');

// Mock all heavy service dependencies
jest.mock('../src/services/svgaParser');
jest.mock('../src/services/frameRenderer');
jest.mock('../src/services/audioExtractor');
jest.mock('../src/services/webpParser');
jest.mock('../src/services/videoEncoder');
jest.mock('../src/services/stillsExtractor');

const { parseSvga }          = require('../src/services/svgaParser');
const { renderFrames }       = require('../src/services/frameRenderer');
const { extractAudio, pickPrimaryAudio } = require('../src/services/audioExtractor');
const { parseWebp, renderWebpFrames }    = require('../src/services/webpParser');
const { encodeVideo }        = require('../src/services/videoEncoder');
const { extractStills }      = require('../src/services/stillsExtractor');

let app;
let outputDir;

beforeEach(() => {
  jest.resetAllMocks();
  const config = require('../src/utils/config');
  config.isLoggingEnabled = false;

  outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'express-test-'));

  // Default service mock return values
  parseSvga.mockResolvedValue({
    params: { viewBoxWidth: 200, viewBoxHeight: 200, fps: 20, frames: 10 },
    sprites: [],
    imageBuffers: {},
    audios: [],
    audioBuffers: {},
  });
  renderFrames.mockResolvedValue([]);
  extractAudio.mockResolvedValue([]);
  pickPrimaryAudio.mockReturnValue(null);
  parseWebp.mockResolvedValue({
    meta: { width: 100, height: 100, fps: 10, frames: 5 },
    frameBuffers: [],
  });
  renderWebpFrames.mockResolvedValue([]);

  // encodeVideo writes a tiny placeholder file so downstream stat() doesn't fail
  encodeVideo.mockImplementation(async ({ outputPath }) => {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, 'fake-video');
    return outputPath;
  });

  extractStills.mockResolvedValue([]);

  const { createExpressRouter } = require('../src/express');
  const router = createExpressRouter({ outputDir });

  app = express();
  app.use('/api', router);
  // Serve outputs for URL construction
  app.use('/outputs', express.static(outputDir));
});

afterEach(() => {
  fs.rmSync(outputDir, { recursive: true, force: true });
});

// ── GET /health ───────────────────────────────────────────────────────────────

describe('GET /health', () => {
  it('returns 200 with status ok', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.package).toBe('svga-gift-converter');
  });
});

// ── POST /mp4 ─────────────────────────────────────────────────────────────────

describe('POST /mp4', () => {
  it('returns 400 when no file is uploaded', async () => {
    const res = await request(app).post('/api/mp4');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/no file/i);
  });

  it('returns 200 with a url when a valid SVGA file is uploaded', async () => {
    // Write a tiny placeholder .svga file that multer will accept
    const svgaPath = path.join(os.tmpdir(), 'test.svga');
    fs.writeFileSync(svgaPath, 'fake-svga-content');

    const res = await request(app)
      .post('/api/mp4')
      .attach('file', svgaPath, 'test.svga');

    fs.unlinkSync(svgaPath);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('url');
    expect(res.body.url).toMatch(/\.mp4$/);
  });

  it('returns 200 with webm url when format=webm is specified', async () => {
    const svgaPath = path.join(os.tmpdir(), 'test2.svga');
    fs.writeFileSync(svgaPath, 'fake-svga-content');

    const res = await request(app)
      .post('/api/mp4')
      .attach('file', svgaPath, 'test2.svga')
      .field('format', 'webm');

    fs.unlinkSync(svgaPath);

    expect(res.status).toBe(200);
    expect(res.body.url).toMatch(/\.webm$/);
  });

  it('returns 500 when parseSvga rejects', async () => {
    parseSvga.mockRejectedValue(new Error('parse error'));

    const svgaPath = path.join(os.tmpdir(), 'bad.svga');
    fs.writeFileSync(svgaPath, 'bad content');

    const res = await request(app)
      .post('/api/mp4')
      .attach('file', svgaPath, 'bad.svga');

    fs.unlinkSync(svgaPath);

    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/parse error/);
  });

  it('handles animated WebP files', async () => {
    const webpPath = path.join(os.tmpdir(), 'test.webp');
    fs.writeFileSync(webpPath, 'fake-webp-content');

    const res = await request(app)
      .post('/api/mp4')
      .attach('file', webpPath, 'test.webp');

    fs.unlinkSync(webpPath);

    expect(parseWebp).toHaveBeenCalled();
    expect(renderWebpFrames).toHaveBeenCalled();
    expect(res.status).toBe(200);
  });
});

// ── POST /convert ─────────────────────────────────────────────────────────────

describe('POST /convert', () => {
  it('returns 400 when no file is uploaded', async () => {
    const res = await request(app).post('/api/convert');
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('returns full metadata on successful SVGA conversion', async () => {
    const svgaPath = path.join(os.tmpdir(), 'convert-test.svga');
    fs.writeFileSync(svgaPath, 'fake-svga-content');

    const res = await request(app)
      .post('/api/convert')
      .attach('file', svgaPath, 'convert-test.svga');

    fs.unlinkSync(svgaPath);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body).toHaveProperty('jobId');
    expect(res.body).toHaveProperty('downloadUrl');
    expect(res.body).toHaveProperty('fps');
    expect(res.body).toHaveProperty('frames');
    expect(res.body).toHaveProperty('hasAudio');
    expect(res.body.hasAudio).toBe(false);
  });

  it('includes stills in response when includeStills is true', async () => {
    extractStills.mockResolvedValue([
      { position: 0.5, frameIndex: 5, filePath: path.join(outputDir, 'still_5.png'), fileName: 'still_5.png' },
    ]);
    const svgaPath = path.join(os.tmpdir(), 'still-test.svga');
    fs.writeFileSync(svgaPath, 'fake');

    const res = await request(app)
      .post('/api/convert')
      .attach('file', svgaPath, 'still-test.svga')
      .field('includeStills', 'true');

    fs.unlinkSync(svgaPath);

    expect(res.status).toBe(200);
    expect(res.body.stills).toHaveLength(1);
    expect(res.body.stills[0].position).toBe(0.5);
  });

  it('omits stills when includeStills=false', async () => {
    const svgaPath = path.join(os.tmpdir(), 'nostill.svga');
    fs.writeFileSync(svgaPath, 'fake');

    const res = await request(app)
      .post('/api/convert')
      .attach('file', svgaPath, 'nostill.svga')
      .field('includeStills', 'false');

    fs.unlinkSync(svgaPath);

    expect(res.status).toBe(200);
    expect(extractStills).not.toHaveBeenCalled();
    expect(res.body.stills).toEqual([]);
  });

  it('still returns video response when stills extraction fails', async () => {
    extractStills.mockRejectedValue(new Error('stills failed'));
    const svgaPath = path.join(os.tmpdir(), 'stillerr.svga');
    fs.writeFileSync(svgaPath, 'fake');

    const res = await request(app)
      .post('/api/convert')
      .attach('file', svgaPath, 'stillerr.svga');

    fs.unlinkSync(svgaPath);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.stills).toEqual([]);
  });

  it('returns 500 on conversion error', async () => {
    parseSvga.mockRejectedValue(new Error('conversion failed'));
    const svgaPath = path.join(os.tmpdir(), 'err.svga');
    fs.writeFileSync(svgaPath, 'bad');

    const res = await request(app)
      .post('/api/convert')
      .attach('file', svgaPath, 'err.svga');

    fs.unlinkSync(svgaPath);

    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
  });
});

// ── POST /audio ───────────────────────────────────────────────────────────────

describe('POST /audio', () => {
  it('returns 400 when no file is uploaded', async () => {
    const res = await request(app).post('/api/audio');
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('returns empty tracks when SVGA has no audio', async () => {
    extractAudio.mockResolvedValue([]);
    const svgaPath = path.join(os.tmpdir(), 'silent.svga');
    fs.writeFileSync(svgaPath, 'fake');

    const res = await request(app)
      .post('/api/audio')
      .attach('file', svgaPath, 'silent.svga');

    fs.unlinkSync(svgaPath);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.tracks).toEqual([]);
  });

  it('returns track list when audio is found', async () => {
    // Create a real temp file for copyFileSync to work
    const audioTmp = path.join(os.tmpdir(), 'audio_bgm.mp3');
    fs.writeFileSync(audioTmp, 'fake-audio');

    extractAudio.mockResolvedValue([
      {
        key: 'bgm', filePath: audioTmp, ext: '.mp3',
        startFrame: 0, endFrame: 20, startTime: 0, totalTime: 1000,
      },
    ]);

    const svgaPath = path.join(os.tmpdir(), 'withAudio.svga');
    fs.writeFileSync(svgaPath, 'fake');

    const res = await request(app)
      .post('/api/audio')
      .attach('file', svgaPath, 'withAudio.svga');

    fs.unlinkSync(svgaPath);
    if (fs.existsSync(audioTmp)) fs.unlinkSync(audioTmp);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.tracks).toHaveLength(1);
    expect(res.body.tracks[0].key).toBe('bgm');
    expect(res.body.tracks[0].ext).toBe('.mp3');
  });

  it('returns 500 when parseSvga throws', async () => {
    parseSvga.mockRejectedValue(new Error('parse fail'));
    const svgaPath = path.join(os.tmpdir(), 'bad-audio.svga');
    fs.writeFileSync(svgaPath, 'bad');

    const res = await request(app)
      .post('/api/audio')
      .attach('file', svgaPath, 'bad-audio.svga');

    fs.unlinkSync(svgaPath);

    expect(res.status).toBe(500);
  });
});

// ── POST /stills ──────────────────────────────────────────────────────────────

describe('POST /stills', () => {
  it('returns 400 when no file is uploaded', async () => {
    const res = await request(app).post('/api/stills');
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('returns stills for an SVGA file', async () => {
    extractStills.mockResolvedValue([
      { position: 0.2, frameIndex: 2, filePath: path.join(outputDir, 'j_2.png'), fileName: 'j_2.png' },
      { position: 0.5, frameIndex: 5, filePath: path.join(outputDir, 'j_5.png'), fileName: 'j_5.png' },
    ]);

    const svgaPath = path.join(os.tmpdir(), 'stills.svga');
    fs.writeFileSync(svgaPath, 'fake');

    const res = await request(app)
      .post('/api/stills')
      .attach('file', svgaPath, 'stills.svga');

    fs.unlinkSync(svgaPath);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.stills).toHaveLength(2);
    expect(res.body.stills[0].position).toBe(0.2);
    expect(res.body.stills[0]).toHaveProperty('url');
  });

  it('parses custom positions from request body', async () => {
    extractStills.mockResolvedValue([
      { position: 0.1, frameIndex: 1, filePath: path.join(outputDir, 's.png'), fileName: 's.png' },
    ]);

    const svgaPath = path.join(os.tmpdir(), 'pos-test.svga');
    fs.writeFileSync(svgaPath, 'fake');

    await request(app)
      .post('/api/stills')
      .attach('file', svgaPath, 'pos-test.svga')
      .field('positions', '0.1');

    fs.unlinkSync(svgaPath);

    const callOpts = extractStills.mock.calls[0][1];
    expect(callOpts.positions).toEqual([0.1]);
  });

  it('ignores invalid position values and falls back to defaults', async () => {
    extractStills.mockResolvedValue([]);
    const svgaPath = path.join(os.tmpdir(), 'bad-pos.svga');
    fs.writeFileSync(svgaPath, 'fake');

    await request(app)
      .post('/api/stills')
      .attach('file', svgaPath, 'bad-pos.svga')
      .field('positions', 'abc,xyz');

    fs.unlinkSync(svgaPath);

    const callOpts = extractStills.mock.calls[0][1];
    // All values are NaN → filter removes them → fallback to default
    expect(callOpts.positions).toEqual([0.20, 0.50, 0.80]);
  });

  it('returns 500 when extractStills throws', async () => {
    extractStills.mockRejectedValue(new Error('stills error'));
    const svgaPath = path.join(os.tmpdir(), 'err-stills.svga');
    fs.writeFileSync(svgaPath, 'fake');

    const res = await request(app)
      .post('/api/stills')
      .attach('file', svgaPath, 'err-stills.svga');

    fs.unlinkSync(svgaPath);

    expect(res.status).toBe(500);
  });
});
