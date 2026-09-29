/** Tamper-evident audit log: SHA-256 hash chain per branch (CLAUDE.md §5, ADR-0008 proposal). */
import { createHash } from 'node:crypto';

export const GENESIS_HASH = '0'.repeat(64);

export interface AuditEntryInput {
  id: string;
  branchId: string | null;
  seq: number;
  userId: string | null;
  deviceId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  oldJson: unknown;
  newJson: unknown;
  /** ISO-8601 UTC. */
  at: string;
}

export interface ChainedAuditEntry extends AuditEntryInput {
  prevHash: string;
  hash: string;
}

/** JSON with sorted keys so the same data always hashes the same. */
export function canonicalize(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(obj[k])}`).join(',')}}`;
}

export function hashAuditEntry(prevHash: string, entry: AuditEntryInput): string {
  return createHash('sha256').update(prevHash).update('\n').update(canonicalize(entry)).digest('hex');
}

export function chainEntry(prevHash: string | null, entry: AuditEntryInput): ChainedAuditEntry {
  const prev = prevHash ?? GENESIS_HASH;
  return { ...entry, prevHash: prev, hash: hashAuditEntry(prev, entry) };
}

export type ChainVerification = { ok: true; count: number } | { ok: false; brokenAtSeq: number; reason: string };

/** Verify entries in seq order. Detects edits, deletions, reordering and insertions. */
export function verifyChain(entries: readonly ChainedAuditEntry[]): ChainVerification {
  let prev = GENESIS_HASH;
  let expectedSeq: number | undefined;
  for (const e of entries) {
    if (expectedSeq !== undefined && e.seq !== expectedSeq) {
      return { ok: false, brokenAtSeq: e.seq, reason: `sequence gap: expected ${expectedSeq}` };
    }
    if (e.prevHash !== prev) return { ok: false, brokenAtSeq: e.seq, reason: 'previous hash mismatch' };
    const { prevHash: _p, hash: _h, ...input } = e;
    if (hashAuditEntry(prev, input) !== e.hash) return { ok: false, brokenAtSeq: e.seq, reason: 'entry content changed' };
    prev = e.hash;
    expectedSeq = e.seq + 1;
  }
  return { ok: true, count: entries.length };
}
