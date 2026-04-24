'use strict';

let stillsExtractor;

beforeEach(() => {
  jest.resetModules();
  const config = require('../../src/utils/config');
  config.isLoggingEnabled = false;
  stillsExtractor = require('../../src/services/stillsExtractor');
});

// ── positionsToIndices ────────────────────────────────────────────────────────

describe('positionsToIndices', () => {
  it('maps 0 to index 0', () => {
    expect(stillsExtractor.positionsToIndices([0], 10)).toEqual([0]);
  });

  it('maps 1 to the last frame index', () => {
    expect(stillsExtractor.positionsToIndices([1], 10)).toEqual([9]);
  });

  it('maps 0.5 to the middle frame', () => {
    // 0.5 * 9 = 4.5 → round → 5 (for 10 frames, 0-indexed)
    expect(stillsExtractor.positionsToIndices([0.5], 10)).toEqual([5]);
  });

  it('handles multiple positions', () => {
    const indices = stillsExtractor.positionsToIndices([0.20, 0.50, 0.80], 100);
    expect(indices).toHaveLength(3);
    // 0.20 * 99 = 19.8 → 20
    expect(indices[0]).toBe(20);
    // 0.50 * 99 = 49.5 → 50
    expect(indices[1]).toBe(50);
    // 0.80 * 99 = 79.2 → 79
    expect(indices[2]).toBe(79);
  });

  it('clamps below-zero positions to 0', () => {
    expect(stillsExtractor.positionsToIndices([-0.5], 10)).toEqual([0]);
  });

  it('clamps above-one positions to last frame', () => {
    expect(stillsExtractor.positionsToIndices([1.5], 10)).toEqual([9]);
  });

  it('handles single-frame animation', () => {
    expect(stillsExtractor.positionsToIndices([0, 0.5, 1], 1)).toEqual([0, 0, 0]);
  });
});

// ── extractStills — error paths ───────────────────────────────────────────────

describe('extractStills', () => {
  it('throws for unsupported file extension', async () => {
    await expect(
      stillsExtractor.extractStills('/fake/file.gif', { fileType: '.gif' })
    ).rejects.toThrow('Unsupported file type');
  });

  it('delegates to parseSvga + renderSpecificFrames for .svga files', async () => {
    const mockAnimData = {
      params: { frames: 10, viewBoxWidth: 100, viewBoxHeight: 100, fps: 20 },
      sprites: [],
      imageBuffers: {},
    };
    const mockRendered = [
      { frameIndex: 2, filePath: '/tmp/still_2.png' },
      { frameIndex: 5, filePath: '/tmp/still_5.png' },
      { frameIndex: 8, filePath: '/tmp/still_8.png' },
    ];

    jest.mock('../../src/services/svgaParser', () => ({
      parseSvga: jest.fn().mockResolvedValue(mockAnimData),
    }));
    jest.mock('../../src/services/frameRenderer', () => ({
      renderSpecificFrames: jest.fn().mockResolvedValue(mockRendered),
    }));

    jest.resetModules();
    const config = require('../../src/utils/config');
    config.isLoggingEnabled = false;
    const se = require('../../src/services/stillsExtractor');

    const result = await se.extractStills('/fake/file.svga', {
      positions: [0.2, 0.5, 0.8],
    });

    expect(result).toHaveLength(3);
    expect(result[0].position).toBe(0.2);
    expect(result[0].frameIndex).toBe(2);
    expect(result[0].filePath).toBe('/tmp/still_2.png');
    expect(result[0].fileName).toBe('still_2.png');
  });

  it('delegates to parseWebp + renderSpecificWebpFrames for .webp files', async () => {
    const mockParsed = {
      meta: { frames: 5, width: 200, height: 200, fps: 10 },
      frameBuffers: [],
    };
    const mockRendered = [
      { frameIndex: 1, filePath: '/tmp/still_1.png' },
    ];

    jest.mock('../../src/services/webpParser', () => ({
      parseWebp: jest.fn().mockResolvedValue(mockParsed),
      renderSpecificWebpFrames: jest.fn().mockResolvedValue(mockRendered),
    }));

    jest.resetModules();
    const config = require('../../src/utils/config');
    config.isLoggingEnabled = false;
    const se = require('../../src/services/stillsExtractor');

    const result = await se.extractStills('/fake/file.webp', {
      positions: [0.2],
    });

    expect(result).toHaveLength(1);
    expect(result[0].position).toBe(0.2);
    expect(result[0].frameIndex).toBe(1);
  });
});
