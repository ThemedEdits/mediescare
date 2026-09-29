import { describe, expect, it } from 'vitest';
import { GENESIS_HASH, canonicalize, chainEntry, verifyChain, type AuditEntryInput, type ChainedAuditEntry } from './audit';

const entry = (seq: number, patch: Partial<AuditEntryInput> = {}): AuditEntryInput => ({
  id: `id-${seq}`,
  branchId: 'b1',
  seq,
  userId: 'u1',
  deviceId: 'd1',
  action: 'settings.update',
  entityType: 'settings',
  entityId: 's1',
  oldJson: { a: 1 },
  newJson: { a: 2 },
  at: '2026-09-30T00:00:00.000Z',
  ...patch,
});

function build(n: number): ChainedAuditEntry[] {
  const out: ChainedAuditEntry[] = [];
  let prev: string | null = null;
  for (let i = 1; i <= n; i++) {
    const e = chainEntry(prev, entry(i));
    out.push(e);
    prev = e.hash;
  }
  return out;
}

describe('canonicalize', () => {
  it('is independent of key order', () => {
    expect(canonicalize({ b: 1, a: [2, { d: 1, c: 2 }] })).toBe(canonicalize({ a: [2, { c: 2, d: 1 }], b: 1 }));
  });
  it('treats undefined like an absent key', () => {
    expect(canonicalize({ a: 1, b: undefined })).toBe(canonicalize({ a: 1 }));
  });
});

describe('hash chain', () => {
  it('starts from the genesis hash and verifies', () => {
    const chain = build(5);
    expect(chain[0]?.prevHash).toBe(GENESIS_HASH);
    expect(verifyChain(chain)).toEqual({ ok: true, count: 5 });
  });

  it('detects an edited entry', () => {
    const chain = build(5);
    chain[2] = { ...(chain[2] as ChainedAuditEntry), newJson: { a: 999 } };
    expect(verifyChain(chain)).toMatchObject({ ok: false, brokenAtSeq: 3 });
  });

  it('detects a deleted entry', () => {
    const chain = build(5);
    chain.splice(2, 1);
    expect(verifyChain(chain)).toMatchObject({ ok: false, brokenAtSeq: 4 });
  });

  it('detects reordering', () => {
    const chain = build(4);
    [chain[1], chain[2]] = [chain[2] as ChainedAuditEntry, chain[1] as ChainedAuditEntry];
    expect(verifyChain(chain).ok).toBe(false);
  });

  it('detects a forged entry re-hashed alone', () => {
    const chain = build(4);
    const forged = chainEntry(chain[1]?.hash ?? null, entry(3, { newJson: { a: 'forged' } }));
    chain[2] = forged; // entry 4 still points at the old hash of entry 3
    expect(verifyChain(chain)).toMatchObject({ ok: false, brokenAtSeq: 4 });
  });

  it('accepts an empty chain', () => {
    expect(verifyChain([])).toEqual({ ok: true, count: 0 });
  });
});
