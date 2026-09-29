import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openDatabase } from './client';
import { isInitialized } from './firstRun';
import { pendingMigrationCount, runMigrations } from './migrate';

describe('pendingMigrationCount', () => {
  it('counts unapplied migrations on a new database and none after migrating', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mediescare-mig-'));
    const handle = openDatabase({
      file: join(dir, 'a.db'),
      keyHex: randomBytes(32).toString('hex'),
    });
    try {
      // Regression: the server checks this on a fresh install before the first migration has run.
      expect(isInitialized(handle.db)).toBe(false);
      expect(pendingMigrationCount(handle.db)).toBeGreaterThanOrEqual(2);
      runMigrations(handle.db);
      expect(pendingMigrationCount(handle.db)).toBe(0);
    } finally {
      handle.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
