'use strict';

const fs   = require('fs');
const path = require('path');
const os   = require('os');

let cleanup;

beforeEach(() => {
  jest.resetModules();
  // Silence logger noise in tests
  const config = require('../../src/utils/config');
  config.isLoggingEnabled = false;
  cleanup = require('../../src/utils/cleanup');
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ── removeDir ──────────────────────────────────────────────────────────────────

describe('removeDir', () => {
  it('recursively removes an existing directory', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cleanup-test-'));
    fs.writeFileSync(path.join(tmpDir, 'file.txt'), 'hello');
    expect(fs.existsSync(tmpDir)).toBe(true);

    cleanup.removeDir(tmpDir);

    expect(fs.existsSync(tmpDir)).toBe(false);
  });

  it('is a no-op when the directory does not exist', () => {
    const nonExistent = path.join(os.tmpdir(), 'does-not-exist-12345');
    expect(() => cleanup.removeDir(nonExistent)).not.toThrow();
  });
});

// ── removeFile ─────────────────────────────────────────────────────────────────

describe('removeFile', () => {
  it('deletes an existing file', () => {
    const tmpFile = path.join(os.tmpdir(), `cleanup-test-${Date.now()}.txt`);
    fs.writeFileSync(tmpFile, 'data');
    expect(fs.existsSync(tmpFile)).toBe(true);

    cleanup.removeFile(tmpFile);

    expect(fs.existsSync(tmpFile)).toBe(false);
  });

  it('is a no-op when the file does not exist', () => {
    const nonExistent = path.join(os.tmpdir(), 'no-such-file-99999.txt');
    expect(() => cleanup.removeFile(nonExistent)).not.toThrow();
  });

  it('swallows unlink errors gracefully', () => {
    // Make unlinkSync throw and verify no exception bubbles up
    jest.spyOn(fs, 'existsSync').mockReturnValue(true);
    jest.spyOn(fs, 'unlinkSync').mockImplementation(() => { throw new Error('EPERM'); });
    expect(() => cleanup.removeFile('/some/protected/file')).not.toThrow();
  });
});

// ── purgeOldFiles ──────────────────────────────────────────────────────────────

describe('purgeOldFiles', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'purge-test-'));
  });

  afterEach(() => {
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('deletes files older than maxAgeMs', () => {
    const oldFile = path.join(tmpDir, 'old.txt');
    fs.writeFileSync(oldFile, 'old');

    // Back-date the file's mtime so it looks old
    const oldTime = new Date(Date.now() - 2 * 60 * 60 * 1000); // 2 hours ago
    fs.utimesSync(oldFile, oldTime, oldTime);

    cleanup.purgeOldFiles(tmpDir, 60 * 60 * 1000); // maxAge = 1 hour

    expect(fs.existsSync(oldFile)).toBe(false);
  });

  it('keeps files newer than maxAgeMs', () => {
    const newFile = path.join(tmpDir, 'new.txt');
    fs.writeFileSync(newFile, 'new');

    cleanup.purgeOldFiles(tmpDir, 60 * 60 * 1000); // maxAge = 1 hour

    expect(fs.existsSync(newFile)).toBe(true);
  });

  it('ignores subdirectories inside the purge dir', () => {
    const subDir = path.join(tmpDir, 'sub');
    fs.mkdirSync(subDir);

    // Back-date subdir so it would be purged if treated as a file
    const oldTime = new Date(Date.now() - 2 * 60 * 60 * 1000);
    fs.utimesSync(subDir, oldTime, oldTime);

    expect(() => cleanup.purgeOldFiles(tmpDir, 1)).not.toThrow();
    expect(fs.existsSync(subDir)).toBe(true); // directories are skipped
  });

  it('is a no-op when directory does not exist', () => {
    expect(() => cleanup.purgeOldFiles('/no/such/dir', 1000)).not.toThrow();
  });

  it('handles readdirSync errors gracefully', () => {
    jest.spyOn(fs, 'existsSync').mockReturnValue(true);
    jest.spyOn(fs, 'readdirSync').mockImplementation(() => { throw new Error('EACCES'); });
    expect(() => cleanup.purgeOldFiles('/some/dir', 1000)).not.toThrow();
  });
});

// ── scheduleOutputPurge ────────────────────────────────────────────────────────

describe('scheduleOutputPurge', () => {
  it('returns a NodeJS.Timeout (interval handle)', () => {
    const handle = cleanup.scheduleOutputPurge(os.tmpdir(), 60000, 600000);
    expect(handle).toBeDefined();
    clearInterval(handle);
  });

  it('calls purgeOldFiles when the interval fires (via side-effect on a real temp dir)', () => {
    jest.useFakeTimers();
    const dir = require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'schedule-test-'));

    // Write an old file (far in the past relative to Date.now which fake timers reset to real time)
    const oldFile = require('path').join(dir, 'old.txt');
    require('fs').writeFileSync(oldFile, 'x');
    const pastTime = new Date(Date.now() - 10 * 60 * 60 * 1000); // 10 hours ago
    require('fs').utimesSync(oldFile, pastTime, pastTime);

    // Max age = 1 hour, interval = 1 ms
    const handle = cleanup.scheduleOutputPurge(dir, 60 * 60 * 1000, 1);
    jest.advanceTimersByTime(1);

    clearInterval(handle);
    jest.useRealTimers();

    // File should have been purged
    expect(require('fs').existsSync(oldFile)).toBe(false);
    require('fs').rmSync(dir, { recursive: true, force: true });
  });
});
