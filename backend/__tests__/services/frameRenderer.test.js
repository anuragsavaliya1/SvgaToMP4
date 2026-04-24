'use strict';

let frameRenderer;

beforeEach(() => {
  jest.resetModules();
  const config = require('../../src/utils/config');
  config.isLoggingEnabled = false;
  frameRenderer = require('../../src/services/frameRenderer');
});

// ── clamp ─────────────────────────────────────────────────────────────────────

describe('clamp', () => {
  it('returns the value when within range', () => {
    expect(frameRenderer.clamp(0.5, 0, 1)).toBe(0.5);
    expect(frameRenderer.clamp(50, 0, 100)).toBe(50);
  });

  it('clamps to min when value is below range', () => {
    expect(frameRenderer.clamp(-1, 0, 1)).toBe(0);
    expect(frameRenderer.clamp(-100, 0, 255)).toBe(0);
  });

  it('clamps to max when value is above range', () => {
    expect(frameRenderer.clamp(2, 0, 1)).toBe(1);
    expect(frameRenderer.clamp(300, 0, 255)).toBe(255);
  });

  it('handles boundary values exactly', () => {
    expect(frameRenderer.clamp(0, 0, 1)).toBe(0);
    expect(frameRenderer.clamp(1, 0, 1)).toBe(1);
  });
});

// ── rgbaToString ──────────────────────────────────────────────────────────────

describe('rgbaToString', () => {
  it('returns "transparent" for null input', () => {
    expect(frameRenderer.rgbaToString(null)).toBe('transparent');
  });

  it('returns "transparent" for undefined input', () => {
    expect(frameRenderer.rgbaToString(undefined)).toBe('transparent');
  });

  it('converts 0–1 float channels to 0–255 rgba string', () => {
    // r=1 g=0 b=0 a=1 → rgba(255,0,0,1)
    expect(frameRenderer.rgbaToString({ r: 1, g: 0, b: 0, a: 1 })).toBe('rgba(255,0,0,1)');
  });

  it('rounds channel values correctly', () => {
    // 0.5 * 255 = 127.5 → Math.round → 128
    const result = frameRenderer.rgbaToString({ r: 0.5, g: 0.5, b: 0.5, a: 0.5 });
    expect(result).toBe('rgba(128,128,128,0.5)');
  });

  it('defaults alpha to 1 when not provided', () => {
    const result = frameRenderer.rgbaToString({ r: 0, g: 0, b: 0 });
    expect(result).toBe('rgba(0,0,0,1)');
  });

  it('clamps channel values outside 0–1', () => {
    const result = frameRenderer.rgbaToString({ r: 2, g: -1, b: 0.5, a: 1 });
    expect(result).toBe('rgba(255,0,128,1)');
  });
});

// ── parseSvgPathCommands ──────────────────────────────────────────────────────

describe('parseSvgPathCommands', () => {
  it('returns empty array for empty string', () => {
    expect(frameRenderer.parseSvgPathCommands('')).toEqual([]);
  });

  it('parses a simple Move command', () => {
    const cmds = frameRenderer.parseSvgPathCommands('M 10 20');
    expect(cmds).toHaveLength(1);
    expect(cmds[0].type).toBe('M');
    expect(cmds[0].args).toEqual([10, 20]);
  });

  it('parses Line and Close commands', () => {
    const cmds = frameRenderer.parseSvgPathCommands('M10,20 L30,40 Z');
    expect(cmds).toHaveLength(3);
    expect(cmds[0]).toEqual({ type: 'M', args: [10, 20] });
    expect(cmds[1]).toEqual({ type: 'L', args: [30, 40] });
    expect(cmds[2]).toEqual({ type: 'Z', args: [] });
  });

  it('parses cubic bezier command (C)', () => {
    const cmds = frameRenderer.parseSvgPathCommands('C 1 2 3 4 5 6');
    expect(cmds).toHaveLength(1);
    expect(cmds[0].type).toBe('C');
    expect(cmds[0].args).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('parses negative numbers and scientific notation', () => {
    const cmds = frameRenderer.parseSvgPathCommands('M -10.5 2e1');
    expect(cmds[0].args[0]).toBeCloseTo(-10.5);
    expect(cmds[0].args[1]).toBeCloseTo(20);
  });

  it('parses lowercase (relative) commands', () => {
    const cmds = frameRenderer.parseSvgPathCommands('m 1 2 l 3 4');
    expect(cmds[0].type).toBe('m');
    expect(cmds[1].type).toBe('l');
  });

  it('parses horizontal (H) and vertical (V) line commands', () => {
    const cmds = frameRenderer.parseSvgPathCommands('H50 V100');
    expect(cmds[0]).toEqual({ type: 'H', args: [50] });
    expect(cmds[1]).toEqual({ type: 'V', args: [100] });
  });

  it('parses arc (A) command with all 7 parameters', () => {
    const cmds = frameRenderer.parseSvgPathCommands('A 10 10 0 0 1 50 50');
    expect(cmds[0].type).toBe('A');
    expect(cmds[0].args).toEqual([10, 10, 0, 0, 1, 50, 50]);
  });

  it('parses quadratic bezier command (Q)', () => {
    const cmds = frameRenderer.parseSvgPathCommands('Q 1 2 3 4');
    expect(cmds[0].type).toBe('Q');
    expect(cmds[0].args).toEqual([1, 2, 3, 4]);
  });
});
