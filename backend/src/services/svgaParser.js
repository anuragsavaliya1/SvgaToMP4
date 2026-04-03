'use strict';

const AdmZip = require('adm-zip');
const protobuf = require('protobufjs');
const path = require('path');
const fs = require('fs');

const PROTO_PATH = path.join(__dirname, '../../proto/svga.proto');

// Supported audio file extensions inside SVGA archives
const AUDIO_EXTENSIONS = ['.mp3', '.wav', '.ogg', '.aac', '.m4a'];

let _MovieEntity = null;

async function getMovieEntity() {
  if (_MovieEntity) return _MovieEntity;
  const root = await protobuf.load(PROTO_PATH);
  _MovieEntity = root.lookupType('MovieEntity');
  return _MovieEntity;
}

/**
 * Parse an SVGA file and return structured animation data.
 * @param {string} svgaFilePath - Absolute path to the .svga file
 * @returns {object} Parsed animation data including params, sprites, images, audios
 */
async function parseSvga(svgaFilePath) {
  const MovieEntity = await getMovieEntity();

  const zip = new AdmZip(svgaFilePath);
  const entries = zip.getEntries();

  // Find movie.spec (protobuf binary)
  const specEntry = entries.find(
    (e) => e.entryName === 'movie.spec' || e.entryName.endsWith('/movie.spec')
  );
  if (!specEntry) {
    throw new Error('Invalid SVGA file: missing movie.spec');
  }

  const specBuffer = specEntry.getData();
  const movie = MovieEntity.decode(specBuffer);

  // Extract sprite images from the zip (keyed by imageKey)
  // SVGA v2 embeds images inside the protobuf images map; v1 stores them as separate zip entries.
  const imageBuffers = {};

  // Protobuf images map (v2)
  if (movie.images && Object.keys(movie.images).length > 0) {
    for (const [key, bytes] of Object.entries(movie.images)) {
      imageBuffers[key] = Buffer.from(bytes);
    }
  }

  // Zip entry images (v1 fallback / supplemental)
  for (const entry of entries) {
    if (entry.entryName === 'movie.spec') continue;
    const ext = path.extname(entry.entryName).toLowerCase();
    if (['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) {
      const key = path.basename(entry.entryName, ext);
      if (!imageBuffers[key]) {
        imageBuffers[key] = entry.getData();
      }
    }
  }

  // Extract audio files from zip entries
  const audioBuffers = {};
  for (const entry of entries) {
    const ext = path.extname(entry.entryName).toLowerCase();
    if (AUDIO_EXTENSIONS.includes(ext)) {
      const key = path.basename(entry.entryName, ext);
      audioBuffers[key] = {
        data: entry.getData(),
        ext: ext,
        entryName: entry.entryName,
      };
    }
  }

  const params = {
    viewBoxWidth: movie.params ? movie.params.viewBoxWidth : 0,
    viewBoxHeight: movie.params ? movie.params.viewBoxHeight : 0,
    fps: movie.params ? movie.params.fps || 20 : 20,
    frames: movie.params ? movie.params.frames || 0 : 0,
  };

  const sprites = (movie.sprites || []).map((sprite) => ({
    imageKey: sprite.imageKey || '',
    matteKey: sprite.matteKey || '',
    frames: (sprite.frames || []).map((frame) => normalizeFrame(frame)),
  }));

  const audios = (movie.audios || []).map((audio) => ({
    audioKey: audio.audioKey || '',
    startFrame: audio.startFrame || 0,
    endFrame: audio.endFrame || 0,
    startTime: audio.startTime || 0,
    totalTime: audio.totalTime || 0,
  }));

  return {
    params,
    sprites,
    audios,
    imageBuffers,
    audioBuffers,
  };
}

function normalizeFrame(frame) {
  const layout = frame.layout || {};
  const transform = frame.transform || {};
  return {
    hidden: frame.hidden || false,
    alpha: frame.alpha != null ? frame.alpha : 1.0,
    layout: {
      x: layout.x || 0,
      y: layout.y || 0,
      width: layout.width || 0,
      height: layout.height || 0,
    },
    transform: {
      a: transform.a != null ? transform.a : 1,
      b: transform.b != null ? transform.b : 0,
      c: transform.c != null ? transform.c : 0,
      d: transform.d != null ? transform.d : 1,
      tx: transform.tx || 0,
      ty: transform.ty || 0,
    },
    shapes: (frame.shapes || []).map(normalizeShape),
  };
}

function normalizeShape(shape) {
  return {
    type: shape.type || 0,
    transform: shape.transform
      ? {
          a: shape.transform.a != null ? shape.transform.a : 1,
          b: shape.transform.b || 0,
          c: shape.transform.c || 0,
          d: shape.transform.d != null ? shape.transform.d : 1,
          tx: shape.transform.tx || 0,
          ty: shape.transform.ty || 0,
        }
      : { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
    styles: shape.styles
      ? {
          fill: shape.styles.fill || null,
          stroke: shape.styles.stroke || null,
          strokeWidth: shape.styles.strokeWidth || 0,
          lineCap: shape.styles.lineCap || 'butt',
          lineJoin: shape.styles.lineJoin || 'miter',
          miterLimit: shape.styles.miterLimit || 10,
          lineDash: shape.styles.lineDash || [],
          lineDashOffset: shape.styles.lineDashOffset || 0,
        }
      : null,
    args: shape.args ? { d: shape.args.d || '' } : null,
    rectArgs: shape.rectArgs || null,
    ellipseArgs: shape.ellipseArgs || null,
  };
}

module.exports = { parseSvga };
