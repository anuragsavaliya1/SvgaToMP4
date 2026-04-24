'use strict';

// Mock heavy service dependencies before requiring anything
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
const { extractStills: _extractStills }  = require('../src/services/stillsExtractor');

let converter;

beforeEach(() => {
  jest.resetAllMocks();
  const config = require('../src/utils/config');
  config.isLoggingEnabled = false;

  // Default mock implementations
  parseSvga.mockResolvedValue({
    params: { viewBoxWidth: 200, viewBoxHeight: 200, fps: 20, frames: 30 },
    sprites: [],
    imageBuffers: {},
    audios: [],
    audioBuffers: {},
  });
  renderFrames.mockResolvedValue([]);
  extractAudio.mockResolvedValue([]);
  pickPrimaryAudio.mockReturnValue(null);
  parseWebp.mockResolvedValue({
    meta: { width: 200, height: 200, fps: 10, frames: 5 },
    frameBuffers: [],
  });
  renderWebpFrames.mockResolvedValue([]);
  encodeVideo.mockResolvedValue('/tmp/output.mp4');
  _extractStills.mockResolvedValue([]);

  converter = require('../src/converter');
});

// ── convert ───────────────────────────────────────────────────────────────────

describe('convert', () => {
  it('throws for unsupported file extensions', async () => {
    await expect(converter.convert('/fake/file.gif')).rejects.toThrow(
      'Unsupported file type'
    );
  });

  it('calls SVGA pipeline for .svga files', async () => {
    const result = await converter.convert('/fake/animation.svga', {
      outputDir: '/tmp/out',
    });

    expect(parseSvga).toHaveBeenCalledWith('/fake/animation.svga');
    expect(renderFrames).toHaveBeenCalled();
    expect(encodeVideo).toHaveBeenCalled();
    expect(result).toHaveProperty('filePath');
    expect(result).toHaveProperty('fileName');
  });

  it('calls WebP pipeline for .webp files', async () => {
    const result = await converter.convert('/fake/animation.webp', {
      outputDir: '/tmp/out',
    });

    expect(parseWebp).toHaveBeenCalledWith('/fake/animation.webp');
    expect(renderWebpFrames).toHaveBeenCalled();
    expect(encodeVideo).toHaveBeenCalled();
    expect(result).toHaveProperty('filePath');
  });

  it('uses outputFileName when provided', async () => {
    const result = await converter.convert('/fake/animation.svga', {
      outputDir: '/tmp/out',
      outputFileName: 'my-custom.mp4',
    });
    expect(result.fileName).toBe('my-custom.mp4');
  });

  it('uses uuid-based filename when outputFileName is not provided', async () => {
    const result = await converter.convert('/fake/animation.svga', {
      outputDir: '/tmp/out',
    });
    // Default format is mp4 so filename should end with .mp4
    expect(result.fileName).toMatch(/\.mp4$/);
  });

  it('passes format option to encodeVideo', async () => {
    await converter.convert('/fake/animation.svga', {
      outputDir: '/tmp/out',
      format: 'webm',
    });
    const callOpts = encodeVideo.mock.calls[0][0];
    expect(callOpts.format).toBe('webm');
  });

  it('extracts and selects primary audio for SVGA files', async () => {
    const mockAudioFiles = [
      { key: 'bgm', filePath: '/tmp/audio_bgm.mp3', startFrame: 0, endFrame: 30 },
    ];
    extractAudio.mockResolvedValue(mockAudioFiles);
    pickPrimaryAudio.mockReturnValue('/tmp/audio_bgm.mp3');

    await converter.convert('/fake/animation.svga', { outputDir: '/tmp/out' });

    expect(extractAudio).toHaveBeenCalled();
    expect(pickPrimaryAudio).toHaveBeenCalledWith(mockAudioFiles, 30);
    const callOpts = encodeVideo.mock.calls[0][0];
    expect(callOpts.audioPath).toBe('/tmp/audio_bgm.mp3');
  });

  it('propagates errors from parseSvga', async () => {
    parseSvga.mockRejectedValue(new Error('bad svga'));
    await expect(converter.convert('/fake/bad.svga', { outputDir: '/tmp/out' }))
      .rejects.toThrow('bad svga');
  });
});

// ── extractStills (public wrapper) ────────────────────────────────────────────

describe('extractStills', () => {
  it('delegates to stillsExtractor.extractStills', async () => {
    const mockStills = [{ position: 0.5, frameIndex: 2, filePath: '/tmp/s.png', fileName: 's.png' }];
    _extractStills.mockResolvedValue(mockStills);

    const result = await converter.extractStills('/fake/animation.svga', { positions: [0.5] });

    expect(_extractStills).toHaveBeenCalledWith('/fake/animation.svga', { positions: [0.5] });
    expect(result).toEqual(mockStills);
  });
});
