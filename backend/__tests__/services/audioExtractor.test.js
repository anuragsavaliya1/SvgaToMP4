'use strict';

const fs   = require('fs');
const path = require('path');
const os   = require('os');

let audioExtractor;

beforeEach(() => {
  jest.resetModules();
  const config = require('../../src/utils/config');
  config.isLoggingEnabled = false;
  audioExtractor = require('../../src/services/audioExtractor');
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ── pickPrimaryAudio ──────────────────────────────────────────────────────────

describe('pickPrimaryAudio', () => {
  it('returns null when audioFiles is empty', () => {
    expect(audioExtractor.pickPrimaryAudio([], 100)).toBeNull();
  });

  it('returns null when audioFiles is null', () => {
    expect(audioExtractor.pickPrimaryAudio(null, 100)).toBeNull();
  });

  it('returns the single track filePath when only one track exists', () => {
    const track = { key: 'bgm', filePath: '/tmp/bgm.mp3', startFrame: 0, endFrame: 50 };
    expect(audioExtractor.pickPrimaryAudio([track], 50)).toBe('/tmp/bgm.mp3');
  });

  it('returns the track with the widest frame span for multiple tracks', () => {
    const tracks = [
      { key: 'a', filePath: '/tmp/a.mp3', startFrame: 0,  endFrame: 10 },
      { key: 'b', filePath: '/tmp/b.mp3', startFrame: 0,  endFrame: 50 }, // widest
      { key: 'c', filePath: '/tmp/c.mp3', startFrame: 10, endFrame: 30 },
    ];
    expect(audioExtractor.pickPrimaryAudio(tracks, 50)).toBe('/tmp/b.mp3');
  });

  it('returns the first track when all spans are equal', () => {
    const tracks = [
      { key: 'a', filePath: '/tmp/a.mp3', startFrame: 0, endFrame: 10 },
      { key: 'b', filePath: '/tmp/b.mp3', startFrame: 0, endFrame: 10 },
    ];
    expect(audioExtractor.pickPrimaryAudio(tracks, 10)).toBe('/tmp/a.mp3');
  });
});

// ── extractAudio ─────────────────────────────────────────────────────────────

describe('extractAudio', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'audio-extract-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns empty array when audioBuffers is empty', async () => {
    const animData = { audios: [], audioBuffers: {} };
    const result = await audioExtractor.extractAudio(animData, tmpDir);
    expect(result).toEqual([]);
  });

  it('returns empty array when audioBuffers is missing', async () => {
    const animData = { audios: [] };
    const result = await audioExtractor.extractAudio(animData, tmpDir);
    expect(result).toEqual([]);
  });

  it('writes audio buffers to disk and returns metadata', async () => {
    const fakeData = Buffer.from([0x49, 0x44, 0x33, 0x00]); // ID3 header
    const animData = {
      audios: [{ audioKey: 'bgm', startFrame: 0, endFrame: 20, startTime: 0, totalTime: 1000 }],
      audioBuffers: {
        bgm: { data: fakeData, ext: '.mp3', entryName: 'bgm.mp3' },
      },
    };

    const result = await audioExtractor.extractAudio(animData, tmpDir);

    expect(result).toHaveLength(1);
    expect(result[0].key).toBe('bgm');
    expect(result[0].ext).toBe('.mp3');
    expect(result[0].startFrame).toBe(0);
    expect(result[0].endFrame).toBe(20);
    expect(result[0].startTime).toBe(0);
    expect(result[0].totalTime).toBe(1000);

    // File must have been written
    expect(fs.existsSync(result[0].filePath)).toBe(true);
    expect(fs.readFileSync(result[0].filePath)).toEqual(fakeData);
  });

  it('uses metadata defaults (0) when audio key not found in audios array', async () => {
    const fakeData = Buffer.from([0xff, 0xe0]); // MP3 sync word
    const animData = {
      audios: [], // no matching metadata
      audioBuffers: {
        sfx: { data: fakeData, ext: '.mp3', entryName: 'sfx.mp3' },
      },
    };

    const result = await audioExtractor.extractAudio(animData, tmpDir);

    expect(result).toHaveLength(1);
    expect(result[0].startFrame).toBe(0);
    expect(result[0].endFrame).toBe(0);
    expect(result[0].startTime).toBe(0);
    expect(result[0].totalTime).toBe(0);
  });

  it('defaults ext to .mp3 when not provided in audioInfo', async () => {
    const fakeData = Buffer.from([0x00, 0x01]);
    const animData = {
      audios: [],
      audioBuffers: {
        track: { data: fakeData, entryName: 'track' }, // no ext
      },
    };

    const result = await audioExtractor.extractAudio(animData, tmpDir);

    expect(result[0].ext).toBe('.mp3');
  });

  it('handles multiple audio tracks', async () => {
    const animData = {
      audios: [],
      audioBuffers: {
        a: { data: Buffer.from([0x01]), ext: '.mp3', entryName: 'a' },
        b: { data: Buffer.from([0x02]), ext: '.wav', entryName: 'b' },
      },
    };

    const result = await audioExtractor.extractAudio(animData, tmpDir);
    expect(result).toHaveLength(2);
  });
});
