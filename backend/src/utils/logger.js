'use strict';

const TAG = '[SVGAMP4]';

/**
 * Minimal structured logger.
 * Every line is prefixed with [SVGAMP4][<module>] so logs are visible
 * both in this project and in any consuming project that requires the package.
 *
 * Usage:
 *   const log = require('../utils/logger')('svgaParser');
 *   log.info('Parsing file:', filePath);
 *   log.warn('No audio found');
 *   log.error('Decode failed:', err.message);
 */
function createLogger(module) {
  const prefix = `${TAG}[${module}]`;

  return {
    info(...args)  { console.log(  prefix, ...args); },
    warn(...args)  { console.warn( prefix, ...args); },
    error(...args) { console.error(prefix, ...args); },
    debug(...args) { if (process.env.SVGAMP4_DEBUG) console.log(`${prefix}[DEBUG]`, ...args); },
  };
}

module.exports = createLogger;
