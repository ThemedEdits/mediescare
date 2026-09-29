/** Shared setup for database tests. Not a test file. All names and passwords are invented. */
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { HybridLogicalClock } from '@mediescare/sync';
import { hashPassword } from './auth/password';
import { openDatabase, type Db, type OpenDatabase } from './client';
import type { WriteContext } from './context';
import { runFirstRunSetup, type FirstRunResult } from './firstRun';
import { runMigrations } from './migrate';
import { branches, roles } from './schema/sqlite';
import { createUser, setPin } from './users';

export const ADMIN_PASSWORD = 'correct-Horse-battery-9';
export const SESSION_SECRET = 'test-secret-test-secret-test-secret';

export interface TestEnv {
  handle: OpenDatabase;
  db: Db;
  setup: FirstRunResult;
  clock: { ms: number };
  ctx(userId: string | null): WriteContext;
  roleId(code: string): string;
  /** Creates a user with a role at the test branch. Password is `password`, PIN optional. */
  addUser(
    actor: string,
    username: string,
    roleCode: string,
    opts?: { pin?: string; password?: string },
  ): Promise<string>;
  cleanup(): void;
}

export async function createTestEnv(): Promise<TestEnv> {
  const dir = mkdtempSync(join(tmpdir(), 'mediescare-test-'));
  const handle = openDatabase({
    file: join(dir, 'test.db'),
    keyHex: randomBytes(32).toString('hex'),
  });
  runMigrations(handle.db);
  const clock = { ms: Date.parse('2026-10-05T09:00:00.000Z') };
  const setup = runFirstRunSetup(handle.db, {
    tenantName: 'Test Pharmacy Group',
    branchCode: 'KHI01',
    branchName: 'Test Branch One',
    isHeadOffice: true,
    deviceName: 'Test Server',
    admin: {
      username: 'admin',
      fullName: 'Test Admin',
      passwordHash: await hashPassword(ADMIN_PASSWORD),
    },
    now: () => new Date(clock.ms),
  });
  const hlc = new HybridLogicalClock('feedbeef', () => clock.ms);
  const ctx = (userId: string | null): WriteContext => ({
    tenantId: setup.tenantId,
    branchId: setup.branchId,
    deviceId: setup.deviceId,
    userId,
    clock: hlc,
    now: () => new Date(clock.ms),
  });
  const roleId = (code: string) => {
    const r = handle.db.select().from(roles).where(eq(roles.code, code)).get();
    if (!r) throw new Error(`role ${code}`);
    return r.id;
  };
  const addUser: TestEnv['addUser'] = async (actor, username, roleCode, opts = {}) => {
    const { id } = await createUser(handle.db, ctx(actor), {
      username,
      fullName: `Test ${username}`,
      password: opts.password ?? 'user-Password-2026',
      roleIds: [roleId(roleCode)],
      branchIds: [setup.branchId],
    });
    if (opts.pin) await setPin(handle.db, ctx(actor), id, opts.pin);
    return id;
  };
  return {
    handle,
    db: handle.db,
    setup,
    clock,
    ctx,
    roleId,
    addUser,
    cleanup: () => {
      handle.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export function branchId(env: TestEnv): string {
  return env.db.select({ id: branches.id }).from(branches).get()?.id ?? '';
}
