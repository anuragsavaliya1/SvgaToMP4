'use strict';

let svgaParser;

beforeEach(() => {
  jest.resetModules();
  const config = require('../../src/utils/config');
  config.isLoggingEnabled = false;
  svgaParser = require('../../src/services/svgaParser');
});

// ── detectAudioExtension ──────────────────────────────────────────────────────

describe('detectAudioExtension', () => {
  const { detectAudioExtension } = require('../../src/services/svgaParser');

  it('returns null for null input', () => {
    expect(detectAudioExtension(null)).toBeNull();
  });

  it('returns null for buffer shorter than 4 bytes', () => {
    expect(detectAudioExtension(Buffer.from([0x49, 0x44]))).toBeNull();
  });

  it('detects MP3 with ID3 header (0x49 0x44 0x33)', () => {
    const buf = Buffer.from([0x49, 0x44, 0x33, 0x04]);
    expect(detectAudioExtension(buf)).toBe('.mp3');
  });

  it('detects MP3 sync word (0xFF 0xE?)', () => {
    const buf = Buffer.from([0xff, 0xe3, 0x00, 0x00]);
    expect(detectAudioExtension(buf)).toBe('.mp3');
  });

  it('detects OGG (OggS magic)', () => {
    const buf = Buffer.from([0x4f, 0x67, 0x67, 0x53]);
    expect(detectAudioExtension(buf)).toBe('.ogg');
  });

  it('detects WAV RIFF header', () => {
    const buf = Buffer.from([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00]);
    expect(detectAudioExtension(buf)).toBe('.wav');
  });

  it('detects AAC ADTS (0xFF 0xF?) — note: MP3 sync check has priority, returns .mp3', () => {
    // Both the MP3 sync-word check (buf[1] & 0xe0 === 0xe0) and the AAC
    // ADTS check (buf[1] & 0xf0 === 0xf0) match 0xf1; MP3 is checked first.
    const buf = Buffer.from([0xff, 0xf1, 0x00, 0x00]);
    expect(detectAudioExtension(buf)).toBe('.mp3');
  });

  it('returns null for unknown format', () => {
    const buf = Buffer.from([0x00, 0x01, 0x02, 0x03]);
    expect(detectAudioExtension(buf)).toBeNull();
  });
});

// ── detectFormat ─────────────────────────────────────────────────────────────

describe('detectFormat', () => {
  const { detectFormat } = require('../../src/services/svgaParser');

  it('detects ZIP magic bytes (PK\\x03\\x04)', () => {
    const buf = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00]);
    expect(detectFormat(buf)).toBe('zip');
  });

  it('detects zlib magic byte (0x78)', () => {
    const buf = Buffer.from([0x78, 0x9c, 0x00, 0x00]);
    expect(detectFormat(buf)).toBe('zlib');
  });

  it('falls back to proto for unknown header', () => {
    const buf = Buffer.from([0x0a, 0x01, 0x00, 0x00]);
    expect(detectFormat(buf)).toBe('proto');
  });
});
