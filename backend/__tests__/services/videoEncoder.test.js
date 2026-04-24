'use strict';

let videoEncoder;

beforeEach(() => {
  jest.resetModules();
  const config = require('../../src/utils/config');
  config.isLoggingEnabled = false;
  videoEncoder = require('../../src/services/videoEncoder');
});

// ── makeEven ──────────────────────────────────────────────────────────────────

describe('makeEven', () => {
  it('returns even numbers unchanged', () => {
    expect(videoEncoder.makeEven(100)).toBe(100);
    expect(videoEncoder.makeEven(0)).toBe(0);
    expect(videoEncoder.makeEven(2)).toBe(2);
  });

  it('rounds odd numbers up to the next even number', () => {
    expect(videoEncoder.makeEven(101)).toBe(102);
    expect(videoEncoder.makeEven(1)).toBe(2);
    expect(videoEncoder.makeEven(3)).toBe(4);
  });
});

// ── buildScaleFilter ──────────────────────────────────────────────────────────

describe('buildScaleFilter', () => {
  it('returns auto-even scale filter when no size provided', () => {
    const filter = videoEncoder.buildScaleFilter(undefined, undefined);
    expect(filter).toBe('-vf scale=trunc(iw/2)*2:trunc(ih/2)*2');
  });

  it('returns exact dimensions (forced even) when both width and height provided', () => {
    const filter = videoEncoder.buildScaleFilter(320, 240);
    expect(filter).toBe('-vf scale=320:240');
  });

  it('rounds odd dimensions up to even', () => {
    const filter = videoEncoder.buildScaleFilter(319, 239);
    expect(filter).toBe('-vf scale=320:240');
  });

  it('returns auto scale when only width provided (no height)', () => {
    // When one dimension is missing the implementation falls through to auto
    const filter = videoEncoder.buildScaleFilter(320, undefined);
    expect(filter).toBe('-vf scale=trunc(iw/2)*2:trunc(ih/2)*2');
  });

  it('returns auto scale when only height provided (no width)', () => {
    const filter = videoEncoder.buildScaleFilter(undefined, 240);
    expect(filter).toBe('-vf scale=trunc(iw/2)*2:trunc(ih/2)*2');
  });
});

// ── encodeVideo ───────────────────────────────────────────────────────────────

describe('encodeVideo', () => {
  it('rejects when framesDir does not exist (ffmpeg fails)', async () => {
    const opts = {
      framesDir:  '/no/such/frames',
      fps:        20,
      outputPath: '/tmp/test-output.mp4',
      format:     'mp4',
    };
    await expect(videoEncoder.encodeVideo(opts)).rejects.toThrow();
  });
});
