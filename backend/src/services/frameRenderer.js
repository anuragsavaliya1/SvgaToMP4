'use strict';

const { createCanvas, loadImage } = require('canvas');
const fs = require('fs');
const path = require('path');

/**
 * Render all frames of an SVGA animation to PNG files.
 *
 * Layout when backgroundImage is provided:
 *   - Canvas size = background image's natural size
 *   - Background drawn 1:1 (no stretch)
 *   - SVGA animation scaled to fit the bottom (1 - topReserved) portion,
 *     centered horizontally  (topReserved default = 0.30 → 30% space above)
 *
 * @param {object} animData        - Parsed SVGA data from svgaParser.parseSvga()
 * @param {string} framesDir       - Directory where frame PNGs will be written
 * @param {object} [options]
 *   backgroundImage  {string}   - Path to background PNG/JPG
 *   topReserved      {number}   - Fraction of canvas height to keep clear above animation (0–1, default 0.30)
 *   background       {string}   - Fallback CSS color when no backgroundImage
 *   width / height   {number}   - Override canvas size (ignored when backgroundImage is set)
 * @returns {string[]} Sorted list of absolute PNG file paths
 */
async function renderFrames(animData, framesDir, options = {}) {
  const { params, sprites, imageBuffers } = animData;

  const totalFrames = params.frames;
  const background = options.background || 'transparent';
  const backgroundImage = options.backgroundImage || null;
  const topReserved = options.topReserved != null ? options.topReserved : 0.30;

  if (totalFrames === 0) throw new Error('SVGA has 0 frames');

  // ── Load background image ─────────────────────────────────────────────────
  let bgImage = null;
  let canvasW, canvasH;

  if (backgroundImage) {
    bgImage = await loadImage(backgroundImage);
    // Canvas matches the background image exactly
    canvasW = bgImage.width;
    canvasH = bgImage.height;
  } else {
    canvasW = options.width  || Math.ceil(params.viewBoxWidth)  || 480;
    canvasH = options.height || Math.ceil(params.viewBoxHeight) || 480;
  }

  // ── Compute SVGA placement inside the bottom (1-topReserved) area ─────────
  //   Available area for the animation:
  const areaY = Math.round(canvasH * topReserved);   // top of the animation zone
  const areaH = canvasH - areaY;                      // height of the animation zone
  const areaW = canvasW;

  const svgaW = params.viewBoxWidth  || canvasW;
  const svgaH = params.viewBoxHeight || canvasH;

  // Scale to fit inside the available area, preserving aspect ratio
  const scale = Math.min(areaW / svgaW, areaH / svgaH);
  const drawW = svgaW * scale;
  const drawH = svgaH * scale;

  // Center horizontally; align to bottom of the available area
  const offsetX = (areaW - drawW) / 2;
  const offsetY = areaY + (areaH - drawH);   // bottom-aligned within the zone

  // ── Pre-load sprite images ────────────────────────────────────────────────
  const imageCache = {};
  for (const [key, buf] of Object.entries(imageBuffers)) {
    try { imageCache[key] = await loadImage(buf); } catch { /* skip */ }
  }

  const framePaths = [];

  for (let frameIndex = 0; frameIndex < totalFrames; frameIndex++) {
    const canvas = createCanvas(canvasW, canvasH);
    const ctx = canvas.getContext('2d');

    // Draw background
    if (bgImage) {
      ctx.drawImage(bgImage, 0, 0, canvasW, canvasH);
    } else if (background === 'transparent') {
      ctx.clearRect(0, 0, canvasW, canvasH);
    } else {
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, canvasW, canvasH);
    }

    // Push SVGA coordinate space: translate to animation zone, then scale
    ctx.save();
    ctx.translate(offsetX, offsetY);
    ctx.scale(scale, scale);

    for (const sprite of sprites) {
      const frameData = sprite.frames[frameIndex];
      if (!frameData || frameData.hidden) continue;

      const { layout, transform, alpha, shapes } = frameData;

      ctx.save();
      ctx.globalAlpha = clamp(alpha, 0, 1);
      ctx.transform(transform.a, transform.b, transform.c, transform.d, transform.tx, transform.ty);

      const img = imageCache[sprite.imageKey];
      if (img) {
        ctx.drawImage(img, layout.x, layout.y, layout.width || img.width, layout.height || img.height);
      }

      if (shapes && shapes.length > 0) {
        drawShapes(ctx, shapes);
      }

      ctx.restore();
    }

    ctx.restore(); // pop SVGA coordinate space

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
      case 'A': {
        if (args.length < 7) break;
        const [rx, ry, xRot, largeArc, sweep] = args;
        const endX = rel ? cx + args[5] : args[5];
        const endY = rel ? cy + args[6] : args[6];
        svgArcToCanvas(ctx, cx, cy, endX, endY, rx, ry, xRot * Math.PI / 180, !!largeArc, !!sweep);
        cx = endX; cy = endY;
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

/**
 * Convert SVG endpoint arc parameterization to canvas ellipse() call.
 * Implements the W3C SVG spec conversion algorithm.
 */
function svgArcToCanvas(ctx, x1, y1, x2, y2, rx, ry, phi, largeArc, sweep) {
  if (x1 === x2 && y1 === y2) return;
  if (rx === 0 || ry === 0) { ctx.lineTo(x2, y2); return; }
  rx = Math.abs(rx);
  ry = Math.abs(ry);
  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);
  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;
  const x1p =  cosPhi * dx + sinPhi * dy;
  const y1p = -sinPhi * dx + cosPhi * dy;
  // Ensure radii are large enough
  const x1pSq = x1p * x1p;
  const y1pSq = y1p * y1p;
  let rxSq = rx * rx;
  let rySq = ry * ry;
  const lambda = x1pSq / rxSq + y1pSq / rySq;
  if (lambda > 1) { const s = Math.sqrt(lambda); rx *= s; ry *= s; rxSq = rx*rx; rySq = ry*ry; }
  const num = Math.max(0, rxSq*rySq - rxSq*y1pSq - rySq*x1pSq);
  const den = rxSq*y1pSq + rySq*x1pSq;
  const coef = (largeArc !== sweep ? 1 : -1) * Math.sqrt(num / den);
  const cxp =  coef * rx * y1p / ry;
  const cyp = -coef * ry * x1p / rx;
  const cx = cosPhi * cxp - sinPhi * cyp + (x1 + x2) / 2;
  const cy = sinPhi * cxp + cosPhi * cyp + (y1 + y2) / 2;
  const vecAngle = (ux, uy, vx, vy) => {
    const n = Math.sqrt(ux*ux + uy*uy) * Math.sqrt(vx*vx + vy*vy);
    let a = Math.acos(Math.max(-1, Math.min(1, (ux*vx + uy*vy) / n)));
    if (ux*vy - uy*vx < 0) a = -a;
    return a;
  };
  const ux = (x1p - cxp) / rx;
  const uy = (y1p - cyp) / ry;
  const vx = (-x1p - cxp) / rx;
  const vy = (-y1p - cyp) / ry;
  let theta  = vecAngle(1, 0, ux, uy);
  let dtheta = vecAngle(ux, uy, vx, vy);
  if (!sweep && dtheta > 0) dtheta -= 2 * Math.PI;
  if ( sweep && dtheta < 0) dtheta += 2 * Math.PI;
  ctx.ellipse(cx, cy, rx, ry, phi, theta, theta + dtheta, !sweep);
}

function parseSvgPathCommands(d) {
  const results = [];
  const re = /([MLHVCSQTAZmlhvcsqtaz])([^MLHVCSQTAZmlhvcsqtaz]*)/g;
  let match;
  while ((match = re.exec(d)) !== null) {
    const type = match[1];
    const rawArgs = match[2].trim();
    // Match all numbers including negative and scientific notation
    const args = rawArgs.length
      ? (rawArgs.match(/-?[\d.]+(?:[eE][+-]?\d+)?/g) || []).map(Number)
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
