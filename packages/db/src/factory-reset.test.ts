import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { assertFactoryResetAllowed, deleteDatabaseFiles, isSuperAdmin } from './factory-reset';
import { CLEAR_DATABASE_PHRASE } from '@mediescare/core';
import { ADMIN_PASSWORD, createTestEnv, type TestEnv } from './test-helpers';

describe('factory reset', () => {
  let env: TestEnv;
  beforeEach(async () => {
    env = await createTestEnv();
  });
  afterEach(() => env.cleanup());

  it('recognises only the Super Admin role', async () => {
    const manager = await env.addUser(env.setup.adminUserId, 'manager1', 'branch_manager');
    expect(isSuperAdmin(env.db, env.setup.adminUserId)).toBe(true);
    expect(isSuperAdmin(env.db, manager)).toBe(false);
  });

  it('needs the phrase and the correct password', async () => {
    const ok = { password: ADMIN_PASSWORD, phrase: CLEAR_DATABASE_PHRASE };
    await expect(assertFactoryResetAllowed(env.db, env.setup.adminUserId, ok)).resolves.toBe(
      undefined,
    );
    await expect(
      assertFactoryResetAllowed(env.db, env.setup.adminUserId, { ...ok, phrase: 'delete' }),
    ).rejects.toMatchObject({ code: 'INVALID' });
    await expect(
      assertFactoryResetAllowed(env.db, env.setup.adminUserId, { ...ok, password: 'wrong-Pass-1' }),
    ).rejects.toMatchObject({ code: 'INVALID' });
  });

  it('refuses anyone who is not a Super Admin, even with the right password', async () => {
    const manager = await env.addUser(env.setup.adminUserId, 'manager2', 'branch_manager', {
      password: 'manager-Password-2026',
    });
    await expect(
      assertFactoryResetAllowed(env.db, manager, {
        password: 'manager-Password-2026',
        phrase: CLEAR_DATABASE_PHRASE,
      }),
    ).rejects.toMatchObject({ code: 'PRIVILEGE_ESCALATION' });
  });
});

describe('deleteDatabaseFiles', () => {
  it('removes the database and cloud login but keeps the recovery keyring', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mediescare-reset-'));
    try {
      const names = ['mediescare.db', 'mediescare.db-wal', 'mediescare.db-shm', 'cloud-auth.json'];
      for (const n of [...names, 'keyring.json']) writeFileSync(join(dir, n), 'x');
      deleteDatabaseFiles(dir);
      for (const n of names) expect(existsSync(join(dir, n))).toBe(false);
      expect(existsSync(join(dir, 'keyring.json'))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
