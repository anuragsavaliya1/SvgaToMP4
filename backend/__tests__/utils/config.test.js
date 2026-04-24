'use strict';

describe('config', () => {
  let config;

  beforeEach(() => {
    // Re-require to get a fresh module (Jest caches modules, but we test the object directly)
    jest.resetModules();
    config = require('../../src/utils/config');
  });

  it('has isLoggingEnabled defaulting to true', () => {
    expect(config.isLoggingEnabled).toBe(true);
  });

  it('can be set to false', () => {
    config.isLoggingEnabled = false;
    expect(config.isLoggingEnabled).toBe(false);
  });

  it('can be set back to true', () => {
    config.isLoggingEnabled = false;
    config.isLoggingEnabled = true;
    expect(config.isLoggingEnabled).toBe(true);
  });
});
