'use strict';

const config = require('./config');

const TAG = '[SVGAMP4]';

/**
 * Minimal structured logger.
 * Every line is prefixed with [SVGAMP4][<module>] so logs are visible
 * both in this project and in any consuming project that requires the package.
 *
 * Enable/disable globally:
 *   const svgaMP4 = require('svga-gift-converter');
 *   svgaMP4.isLoggingEnabled = false;
 *
 * Enable verbose debug lines:
 *   SVGAMP4_DEBUG=1 node server.js
 */
function createLogger(module) {
  const prefix = `${TAG}[${module}]`;

  return {
    info(...args)  { if (config.isLoggingEnabled) console.log(  prefix, ...args); },
    warn(...args)  { if (config.isLoggingEnabled) console.warn( prefix, ...args); },
    error(...args) { if (config.isLoggingEnabled) console.error(prefix, ...args); },
    debug(...args) { if (config.isLoggingEnabled && process.env.SVGAMP4_DEBUG) console.log(`${prefix}[DEBUG]`, ...args); },
  };
}

module.exports = createLogger;
