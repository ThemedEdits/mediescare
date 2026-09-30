import { createHash } from 'node:crypto';
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { and, asc, isNull, lte } from 'drizzle-orm';
import { appendAudit } from '../audit';
import type { Db } from '../client';
import type { WriteContext } from '../context';
import { getServerIdentity } from '../identity';
import { syncOutbox } from '../schema/sqlite';
import { getServerEpoch } from './epoch';

export const FENCED_ERROR = 'fenced: stale server epoch, exported for manager review';

export interface TailExport {
  file: string;
  count: number;
  sha256: string;
}

/**
 * A fenced server (the cloud knows a newer epoch) must not push. Its unsent events are written to
 * a review file and parked in the error queue, never deleted and never merged (ADR-0004). A
 * manager reviews the file and re-posts anything still needed as normal documents on the new
 * primary. Returns null if nothing was pending.
 *
 * The file holds full event payloads (customer names may appear), so it is written to a folder
 * the manager chooses and is not synced anywhere.
 */
export function exportUnsentTail(
  db: Db,
  dir: string,
  options: { cloudEpoch?: number; ctx?: WriteContext; now?: () => Date } = {},
): TailExport | null {
  const rows = db
    .select()
    .from(syncOutbox)
    .where(and(isNull(syncOutbox.ackAt), isNull(syncOutbox.error)))
    .orderBy(asc(syncOutbox.seq))
    .all();
  if (rows.length === 0) return null;

  const lastSeq = rows[rows.length - 1]?.seq ?? 0; // rows added while we write the file stay queued
  const identity = getServerIdentity(db);
  const exportedAt = (options.now ? options.now() : new Date()).toISOString();
  const body = JSON.stringify(
    {
      kind: 'mediescare-fenced-outbox-tail',
      exportedAt,
      tenantId: identity?.tenantId ?? null,
      branchId: identity?.branchId ?? null,
      deviceId: identity?.deviceId ?? null,
      localEpoch: getServerEpoch(db),
      cloudEpoch: options.cloudEpoch ?? null,
      events: rows.map((r) => ({
        id: r.id,
        seq: r.seq,
        entityType: r.entityType,
        entityId: r.entityId,
        op: r.op,
        hlc: r.hlc,
        createdAt: r.createdAt,
        payload: JSON.parse(r.payloadJson) as unknown,
      })),
    },
    null,
    2,
  );
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `fenced-tail-${exportedAt.replace(/[:.]/g, '-')}.json`);
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, body, { encoding: 'utf8', mode: 0o600 });
  renameSync(tmp, file);
  const sha256 = createHash('sha256').update(body).digest('hex');

  db.transaction((tx) => {
    tx.update(syncOutbox)
      .set({ error: FENCED_ERROR })
      .where(and(isNull(syncOutbox.ackAt), isNull(syncOutbox.error), lte(syncOutbox.seq, lastSeq)))
      .run();
    if (options.ctx) {
      appendAudit(tx, options.ctx, {
        action: 'sync.fenced.export',
        entityType: 'sync_outbox',
        newValue: { count: rows.length, file, sha256, cloudEpoch: options.cloudEpoch ?? null },
      });
    }
  });
  return { file, count: rows.length, sha256 };
}
