'use strict';

const { createCanvas, loadImage } = require('canvas');
const fs = require('fs');
const path = require('path');

/**
 * Render all frames of an SVGA animation to PNG files.
 *
 * @param {object} animData    - Parsed SVGA data from svgaParser.parseSvga()
 * @param {string} framesDir   - Directory where frame PNGs will be written
 * @param {object} [options]   - Optional overrides: { width, height, background }
 *   background: CSS color string e.g. '#ffffff', 'transparent' (default: 'transparent')
 * @returns {string[]}         - Sorted list of absolute PNG file paths
 */
async function renderFrames(animData, framesDir, options = {}) {
  const { params, sprites, imageBuffers } = animData;

  const width = options.width || Math.ceil(params.viewBoxWidth) || 480;
  const height = options.height || Math.ceil(params.viewBoxHeight) || 480;
  const totalFrames = params.frames;
  const background = options.background || 'transparent';

  if (totalFrames === 0) {
    throw new Error('SVGA has 0 frames');
  }

  // Pre-load all sprite images into canvas Image objects
  const imageCache = {};
  for (const [key, buf] of Object.entries(imageBuffers)) {
    try {
      imageCache[key] = await loadImage(buf);
    } catch {
      // skip unreadable images
    }
  }

  const framePaths = [];

  for (let frameIndex = 0; frameIndex < totalFrames; frameIndex++) {
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    // Fill background
    if (background === 'transparent') {
      ctx.clearRect(0, 0, width, height);
    } else {
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, width, height);
    }

    for (const sprite of sprites) {
      const frameData = sprite.frames[frameIndex];
      if (!frameData || frameData.hidden) continue;

      const { layout, transform, alpha, shapes } = frameData;

      ctx.save();

      // Apply global alpha
      ctx.globalAlpha = clamp(alpha, 0, 1);

      // Apply affine transform
      // SVGA transform matrix: [a c tx; b d ty; 0 0 1]
      ctx.transform(
        transform.a,
        transform.b,
        transform.c,
        transform.d,
        transform.tx,
        transform.ty
      );

      const img = imageCache[sprite.imageKey];
      if (img) {
        ctx.drawImage(img, layout.x, layout.y, layout.width || img.width, layout.height || img.height);
      }

      // Draw vector shapes if present
      if (shapes && shapes.length > 0) {
        drawShapes(ctx, shapes);
      }

      ctx.restore();
    }

    const framePath = path.join(framesDir, `frame_${String(frameIndex).padStart(6, '0')}.png`);
    await saveCanvasToPng(canvas, framePath);
    framePaths.push(framePath);
  }

  return framePaths;
}

function drawShapes(ctx, shapes) {
  for (const shape of shapes) {
    if (shape.type === 3) continue; // Keep — inherits previous shape

    ctx.save();

    const t = shape.transform;
    if (t) {
      ctx.transform(t.a, t.b, t.c, t.d, t.tx, t.ty);
    }

    applyShapeStyles(ctx, shape.styles);

    ctx.beginPath();

    switch (shape.type) {
      case 0: // Shape (SVG path)
        if (shape.args && shape.args.d) {
          drawSvgPath(ctx, shape.args.d);
        }
        break;

      case 1: // Rect
        if (shape.rectArgs) {
          const { x, y, width, height, cornerRadius } = shape.rectArgs;
          if (cornerRadius > 0) {
            roundRect(ctx, x, y, width, height, cornerRadius);
          } else {
            ctx.rect(x, y, width, height);
          }
        }
        break;

      case 2: // Ellipse
        if (shape.ellipseArgs) {
          const { x, y, radiusX, radiusY } = shape.ellipseArgs;
          ctx.ellipse(x, y, radiusX, radiusY, 0, 0, Math.PI * 2);
        }
        break;
    }

    if (shape.styles) {
      if (shape.styles.fill) ctx.fill();
      if (shape.styles.stroke && shape.styles.strokeWidth > 0) ctx.stroke();
    }

    ctx.restore();
  }
}

function applyShapeStyles(ctx, styles) {
  if (!styles) return;
  if (styles.fill) {
    ctx.fillStyle = rgbaToString(styles.fill);
  }
  if (styles.stroke) {
    ctx.strokeStyle = rgbaToString(styles.stroke);
    ctx.lineWidth = styles.strokeWidth || 1;
    ctx.lineCap = styles.lineCap || 'butt';
    ctx.lineJoin = styles.lineJoin || 'miter';
    ctx.miterLimit = styles.miterLimit || 10;
    if (styles.lineDash && styles.lineDash.length > 0) {
      ctx.setLineDash(styles.lineDash);
      ctx.lineDashOffset = styles.lineDashOffset || 0;
    }
  }
}

function rgbaToString(rgba) {
  if (!rgba) return 'transparent';
  const r = Math.round(clamp(rgba.r, 0, 1) * 255);
  const g = Math.round(clamp(rgba.g, 0, 1) * 255);
  const b = Math.round(clamp(rgba.b, 0, 1) * 255);
  const a = clamp(rgba.a != null ? rgba.a : 1, 0, 1);
  return `rgba(${r},${g},${b},${a})`;
}

/**
 * Minimal SVG path parser for canvas.
 * Supports M, L, H, V, C, Q, A, Z commands (both upper and lower case).
 */
function drawSvgPath(ctx, d) {
  const cmds = parseSvgPathCommands(d);
  let cx = 0, cy = 0;

  for (const cmd of cmds) {
    const rel = cmd.type === cmd.type.toLowerCase() && cmd.type !== 'z' && cmd.type !== 'Z';
    const type = cmd.type.toUpperCase();
    const args = cmd.args;

    switch (type) {
      case 'M':
        cx = rel ? cx + args[0] : args[0];
        cy = rel ? cy + args[1] : args[1];
        ctx.moveTo(cx, cy);
        break;
      case 'L':
        cx = rel ? cx + args[0] : args[0];
        cy = rel ? cy + args[1] : args[1];
        ctx.lineTo(cx, cy);
        break;
      case 'H':
        cx = rel ? cx + args[0] : args[0];
        ctx.lineTo(cx, cy);
        break;
      case 'V':
        cy = rel ? cy + args[0] : args[0];
        ctx.lineTo(cx, cy);
        break;
      case 'C': {
        const x1 = rel ? cx + args[0] : args[0];
        const y1 = rel ? cy + args[1] : args[1];
        const x2 = rel ? cx + args[2] : args[2];
        const y2 = rel ? cy + args[3] : args[3];
        const x = rel ? cx + args[4] : args[4];
        const y = rel ? cy + args[5] : args[5];
        ctx.bezierCurveTo(x1, y1, x2, y2, x, y);
        cx = x; cy = y;
        break;
      }
      case 'Q': {
        const cpx = rel ? cx + args[0] : args[0];
        const cpy = rel ? cy + args[1] : args[1];
        const x = rel ? cx + args[2] : args[2];
        const y = rel ? cy + args[3] : args[3];
        ctx.quadraticCurveTo(cpx, cpy, x, y);
        cx = x; cy = y;
        break;
      }
      case 'Z':
        ctx.closePath();
        break;
      default:
        break;
    }
  }
}

function parseSvgPathCommands(d) {
  const results = [];
  const re = /([MLHVCSQTAZmlhvcsqtaz])([\d\s,.\-eE]*)/g;
  let match;
  while ((match = re.exec(d)) !== null) {
    const type = match[1];
    const rawArgs = match[2].trim();
    const args = rawArgs.length
      ? rawArgs
          .split(/[\s,]+/)
          .filter(Boolean)
          .map(Number)
      : [];
    results.push({ type, args });
  }
  return results;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function saveCanvasToPng(canvas, filePath) {
  return new Promise((resolve, reject) => {
    const out = fs.createWriteStream(filePath);
    const stream = canvas.createPNGStream();
    stream.pipe(out);
    out.on('finish', resolve);
    out.on('error', reject);
  });
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

module.exports = { renderFrames };
