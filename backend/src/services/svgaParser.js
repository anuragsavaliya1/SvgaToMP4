'use strict';

const AdmZip = require('adm-zip');
const protobuf = require('protobufjs');
const zlib = require('zlib');
const path = require('path');
const fs = require('fs');

const PROTO_PATH = path.join(__dirname, '../../proto/svga.proto');

// Supported audio file extensions inside SVGA archives
const AUDIO_EXTENSIONS = ['.mp3', '.wav', '.ogg', '.aac', '.m4a'];

/**
 * Detect audio format from magic bytes. Returns extension or null.
 */
function detectAudioExtension(buf) {
  if (!buf || buf.length < 4) return null;
  // MP3 with ID3 tag
  if (buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) return '.mp3';
  // MP3 sync word
  if (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0) return '.mp3';
  // OGG
  if (buf[0] === 0x4f && buf[1] === 0x67 && buf[2] === 0x67 && buf[3] === 0x53) return '.ogg';
  // WAV RIFF
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46) return '.wav';
  // AAC ADTS
  if (buf[0] === 0xff && (buf[1] & 0xf0) === 0xf0) return '.aac';
  return null;
}

// ZIP magic bytes: PK\x03\x04
const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
// zlib magic bytes: 0x78 followed by 0x01 / 0x9c / 0xda / 0x5e
const ZLIB_MAGIC = 0x78;

let _MovieEntity = null;

async function getMovieEntity() {
  if (_MovieEntity) return _MovieEntity;
  const root = await protobuf.load(PROTO_PATH);
  _MovieEntity = root.lookupType('MovieEntity');
  return _MovieEntity;
}

/**
 * Detect whether the file is a ZIP, zlib-compressed blob, or raw protobuf.
 */
function detectFormat(buf) {
  if (buf[0] === ZIP_MAGIC[0] && buf[1] === ZIP_MAGIC[1]) return 'zip';
  if (buf[0] === ZLIB_MAGIC) return 'zlib';
  return 'proto'; // raw protobuf fallback
}

/**
 * Parse an SVGA file and return structured animation data.
 * Supports SVGA v1 (zlib-compressed protobuf) and v2 (ZIP archive).
 * @param {string} svgaFilePath - Absolute path to the .svga file
 * @returns {object} Parsed animation data including params, sprites, images, audios
 */
async function parseSvga(svgaFilePath) {
  const MovieEntity = await getMovieEntity();

  const rawBuf = fs.readFileSync(svgaFilePath);
  const format = detectFormat(rawBuf);
  console.log(`[svgaParser] detected format: ${format}`);

  let movie;
  const imageBuffers = {};
  const audioBuffers = {};

  if (format === 'zip') {
    // ── SVGA v2: ZIP archive ──────────────────────────────────────────────
    const zip = new AdmZip(svgaFilePath);
    const entries = zip.getEntries();

    const specEntry = entries.find(
      (e) => e.entryName === 'movie.spec' || e.entryName.endsWith('/movie.spec')
    );
    if (!specEntry) throw new Error('Invalid SVGA ZIP: missing movie.spec');

    movie = MovieEntity.decode(specEntry.getData());

    // Images (and possibly audio) embedded in protobuf map
    if (movie.images && Object.keys(movie.images).length > 0) {
      for (const [key, bytes] of Object.entries(movie.images)) {
        const buf = Buffer.from(bytes);
        const ext = detectAudioExtension(buf);
        if (ext || key.toLowerCase().startsWith('audio')) {
          audioBuffers[key] = { data: buf, ext: ext || '.mp3', entryName: key };
        } else {
          imageBuffers[key] = buf;
        }
      }
    }

    // Images stored as separate zip entries
    for (const entry of entries) {
      if (entry.entryName === 'movie.spec') continue;
      const ext = path.extname(entry.entryName).toLowerCase();
      if (['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) {
        const key = path.basename(entry.entryName, ext);
        if (!imageBuffers[key]) imageBuffers[key] = entry.getData();
      }
      if (AUDIO_EXTENSIONS.includes(ext)) {
        const key = path.basename(entry.entryName, ext);
        audioBuffers[key] = { data: entry.getData(), ext, entryName: entry.entryName };
      }
    }
  } else {
    // ── SVGA v1: zlib-compressed protobuf (or raw protobuf) ───────────────
    let protoBuf;
    if (format === 'zlib') {
      protoBuf = zlib.inflateSync(rawBuf);
    } else {
      protoBuf = rawBuf;
    }

    movie = MovieEntity.decode(protoBuf);

    // v1 stores images AND audio inside the protobuf images map.
    // Audio entries have keys starting with "audio" or whose content starts with ID3/MP3 magic.
    if (movie.images && Object.keys(movie.images).length > 0) {
      for (const [key, bytes] of Object.entries(movie.images)) {
        const buf = Buffer.from(bytes);
        const ext = detectAudioExtension(buf);
        if (ext || key.toLowerCase().startsWith('audio')) {
          audioBuffers[key] = {
            data: buf,
            ext: ext || '.mp3',
            entryName: key,
          };
        } else {
          imageBuffers[key] = buf;
        }
      }
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
