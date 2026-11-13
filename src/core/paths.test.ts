import { mkdirSync, mkdtempSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { configDir, dataDir, migrateLegacyDirs } from './paths';

describe.runIf(process.platform === 'linux')('migrateLegacyDirs (EVE-94)', () => {
  let root: string;
  const saved = { ...process.env };

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paths-'));
    process.env.XDG_CONFIG_HOME = join(root, 'config');
    process.env.XDG_DATA_HOME = join(root, 'data');
    process.env.XDG_CACHE_HOME = join(root, 'cache');
  });
  afterEach(() => {
    process.env = { ...saved };
  });

  it('moves the old folder over when the new one is missing', () => {
    mkdirSync(join(root, 'config', 'eve-assistant'), { recursive: true });
    writeFileSync(join(root, 'config', 'eve-assistant', 'settings.json'), '{"version":1}');
    migrateLegacyDirs();
    expect(readFileSync(join(configDir(), 'settings.json'), 'utf8')).toBe('{"version":1}');
    expect(existsSync(join(root, 'config', 'eve-assistant'))).toBe(false);
  });

  it('merges into a new folder that exists already; what is there wins', () => {
    mkdirSync(join(root, 'data', 'eve-assistant'), { recursive: true });
    writeFileSync(join(root, 'data', 'eve-assistant', 'abyss-log.json'), 'old log');
    writeFileSync(join(root, 'data', 'eve-assistant', 'updates.json'), 'old');
    mkdirSync(dataDir(), { recursive: true });
    writeFileSync(join(dataDir(), 'updates.json'), 'new');
    migrateLegacyDirs();
    expect(readFileSync(join(dataDir(), 'abyss-log.json'), 'utf8')).toBe('old log');
    expect(readFileSync(join(dataDir(), 'updates.json'), 'utf8')).toBe('new');
    expect(readFileSync(join(root, 'data', 'eve-assistant', 'updates.json'), 'utf8')).toBe('old');
  });

  it('does nothing without an old folder', () => {
    migrateLegacyDirs();
    expect(existsSync(configDir())).toBe(false);
  });
});
