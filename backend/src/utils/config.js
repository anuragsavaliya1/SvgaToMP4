'use strict';

/**
 * Shared runtime config for svga-gift-converter.
 *
 * Toggle logging from consuming project:
 *   const svgaMP4 = require('svga-gift-converter');
 *   svgaMP4.isLoggingEnabled = false;   // silence all [SVGAMP4] output
 *   svgaMP4.isLoggingEnabled = true;    // re-enable
 */
const config = {
  isLoggingEnabled: true,
};

module.exports = config;
