'use strict';

describe('logger', () => {
  let config;
  let createLogger;

  beforeEach(() => {
    jest.resetModules();
    config = require('../../src/utils/config');
    createLogger = require('../../src/utils/logger');
  });

  afterEach(() => {
    delete process.env.SVGAMP4_DEBUG;
    jest.restoreAllMocks();
  });

  it('returns an object with info, warn, error, debug methods', () => {
    const log = createLogger('test');
    expect(typeof log.info).toBe('function');
    expect(typeof log.warn).toBe('function');
    expect(typeof log.error).toBe('function');
    expect(typeof log.debug).toBe('function');
  });

  describe('when logging is enabled', () => {
    beforeEach(() => {
      config.isLoggingEnabled = true;
    });

    it('info() writes to console.log with correct prefix', () => {
      const spy = jest.spyOn(console, 'log').mockImplementation(() => {});
      const log = createLogger('myModule');
      log.info('hello world');
      expect(spy).toHaveBeenCalledWith('[SVGAMP4][myModule]', 'hello world');
    });

    it('warn() writes to console.warn with correct prefix', () => {
      const spy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      const log = createLogger('myModule');
      log.warn('warning');
      expect(spy).toHaveBeenCalledWith('[SVGAMP4][myModule]', 'warning');
    });

    it('error() writes to console.error with correct prefix', () => {
      const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const log = createLogger('myModule');
      log.error('oops');
      expect(spy).toHaveBeenCalledWith('[SVGAMP4][myModule]', 'oops');
    });

    it('debug() does NOT log when SVGAMP4_DEBUG is not set', () => {
      const spy = jest.spyOn(console, 'log').mockImplementation(() => {});
      const log = createLogger('myModule');
      log.debug('verbose');
      expect(spy).not.toHaveBeenCalled();
    });

    it('debug() writes to console.log when SVGAMP4_DEBUG=1', () => {
      process.env.SVGAMP4_DEBUG = '1';
      const spy = jest.spyOn(console, 'log').mockImplementation(() => {});
      const log = createLogger('myModule');
      log.debug('verbose');
      expect(spy).toHaveBeenCalledWith('[SVGAMP4][myModule][DEBUG]', 'verbose');
    });

    it('supports multiple arguments', () => {
      const spy = jest.spyOn(console, 'log').mockImplementation(() => {});
      const log = createLogger('mod');
      log.info('a', 'b', 'c');
      expect(spy).toHaveBeenCalledWith('[SVGAMP4][mod]', 'a', 'b', 'c');
    });
  });

  describe('when logging is disabled', () => {
    beforeEach(() => {
      config.isLoggingEnabled = false;
    });

    it('info() does not log', () => {
      const spy = jest.spyOn(console, 'log').mockImplementation(() => {});
      const log = createLogger('mod');
      log.info('silence');
      expect(spy).not.toHaveBeenCalled();
    });

    it('warn() does not log', () => {
      const spy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      const log = createLogger('mod');
      log.warn('silence');
      expect(spy).not.toHaveBeenCalled();
    });

    it('error() does not log', () => {
      const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const log = createLogger('mod');
      log.error('silence');
      expect(spy).not.toHaveBeenCalled();
    });

    it('debug() does not log even when SVGAMP4_DEBUG=1', () => {
      process.env.SVGAMP4_DEBUG = '1';
      const spy = jest.spyOn(console, 'log').mockImplementation(() => {});
      const log = createLogger('mod');
      log.debug('silence');
      expect(spy).not.toHaveBeenCalled();
    });
  });
});
