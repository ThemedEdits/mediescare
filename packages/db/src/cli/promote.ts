/**
 * Manual failover promotion (ADR-0004): bumps the server epoch of this database.
 * Usage: node ../../scripts/electron-node.mjs --import tsx src/cli/promote.ts --reason "old server PC failed" [--device <id>]
 * Run it only after checking that the old primary is really down. Stop the app first.
 */
import { max } from 'drizzle-orm';
import { HybridLogicalClock } from '@mediescare/sync';
import { openDatabase } from '../client';
import { getServerIdentity, hlcDeviceId } from '../identity';
import { syncOutbox } from '../schema/sqlite';
import { promote } from '../sync/epoch';
import { cliDatabaseOptions } from './env';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const reason = arg('reason');
if (!reason) {
  console.error('Missing --reason "why this server is being promoted"');
  process.exit(2);
}

const { db, close } = openDatabase(cliDatabaseOptions());
try {
  const identity = getServerIdentity(db);
  if (!identity) throw new Error('This database has not been set up yet');
  const clock = new HybridLogicalClock(hlcDeviceId(identity.deviceId));
  const last = db
    .select({ hlc: max(syncOutbox.hlc) })
    .from(syncOutbox)
    .get()?.hlc;
  if (last) clock.restore(last); // keep the clock monotonic across restarts
  const ctx = {
    ...identity,
    userId: arg('user') ?? null,
    clock,
  };
  const result = promote(db, ctx, { reason, deviceId: arg('device') });
  console.log(
    `Promoted. Server epoch ${result.previousEpoch} -> ${result.epoch}; ${result.countersAdvanced} document counters advanced.`,
  );
} finally {
  close();
}
