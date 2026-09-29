import { describe, expect, it } from 'vitest';
import { BACKOFF_CAP_MS, backoffDelayMs } from './backoff';
import { HybridLogicalClock, MAX_SKEW_MS, compareHlc, parseHlc } from './hlc';
import { isUuid, newId } from './ids';
import { partitionResults } from './outbox';

const DEVICE_A = 'aaaaaaaa';
const DEVICE_B = 'bbbbbbbb';

describe('HLC', () => {
  it('is strictly increasing even when the wall clock stands still', () => {
    const clock = new HybridLogicalClock(DEVICE_A, () => 1_000);
    const stamps = [clock.tick(), clock.tick(), clock.tick()];
    expect([...stamps].sort(compareHlc)).toEqual(stamps);
    expect(new Set(stamps).size).toBe(3);
  });

  it('never goes backwards when the device clock goes backwards', () => {
    let t = 5_000;
    const clock = new HybridLogicalClock(DEVICE_A, () => t);
    const first = clock.tick();
    t = 1_000; // clock set back
    const second = clock.tick();
    expect(compareHlc(second, first)).toBeGreaterThan(0);
  });

  it('resets the counter when physical time advances', () => {
    let t = 1_000;
    const clock = new HybridLogicalClock(DEVICE_A, () => t);
    clock.tick();
    clock.tick();
    t = 2_000;
    expect(parseHlc(clock.tick()).counter).toBe(0);
  });

  it('orders a received event before later local events', () => {
    const a = new HybridLogicalClock(DEVICE_A, () => 10_000);
    const b = new HybridLogicalClock(DEVICE_B, () => 9_000); // slower clock
    const fromA = a.tick();
    const { hlc } = b.receive(fromA);
    expect(compareHlc(hlc, fromA)).toBeGreaterThan(0);
    expect(compareHlc(b.tick(), hlc)).toBeGreaterThan(0);
  });

  it('flags a remote clock more than 24 h ahead but still accepts it', () => {
    const local = new HybridLogicalClock(DEVICE_A, () => 1_000_000);
    const fast = new HybridLogicalClock(DEVICE_B, () => 1_000_000 + MAX_SKEW_MS + 60_000);
    const { skewed, hlc } = local.receive(fast.tick());
    expect(skewed).toBe(true);
    expect(compareHlc(hlc, fast.current())).toBeGreaterThan(0);
  });

  it('survives counter overflow', () => {
    const clock = new HybridLogicalClock(DEVICE_A, () => 1_000);
    let prev = clock.tick();
    for (let i = 0; i < 70_000; i++) {
      const next = clock.tick();
      expect(compareHlc(next, prev)).toBeGreaterThan(0);
      prev = next;
    }
  });

  it('restores monotonically after a restart', () => {
    const before = new HybridLogicalClock(DEVICE_A, () => 9_000);
    const last = before.tick();
    const after = new HybridLogicalClock(DEVICE_A, () => 1_000);
    after.restore(last);
    expect(compareHlc(after.tick(), last)).toBeGreaterThan(0);
  });

  it('rejects malformed values', () => {
    expect(() => parseHlc('nope')).toThrow(SyntaxError);
    expect(() => new HybridLogicalClock('xyz', () => 0)).toThrow();
  });
});

describe('ids', () => {
  it('generates unique, time-ordered UUIDv7', () => {
    const ids = Array.from({ length: 50 }, () => newId());
    expect(ids.every(isUuid)).toBe(true);
    expect(ids.every((id) => id[14] === '7')).toBe(true);
    expect(new Set(ids).size).toBe(50);
    expect([...ids].sort()).toEqual(ids);
  });
});

describe('backoff', () => {
  it('doubles up to the cap', () => {
    const noJitter = () => 1 - Number.EPSILON;
    expect(backoffDelayMs(1, noJitter)).toBeLessThanOrEqual(2_000);
    expect(backoffDelayMs(2, noJitter)).toBeGreaterThan(2_000);
    expect(backoffDelayMs(30, noJitter)).toBeLessThanOrEqual(BACKOFF_CAP_MS);
  });

  it('never returns zero', () => {
    for (let a = 1; a < 20; a++) expect(backoffDelayMs(a, () => 0)).toBeGreaterThan(0);
  });
});

describe('push results', () => {
  it('treats duplicates as acknowledged and keeps rejects separate', () => {
    const out = partitionResults([
      { id: '1', status: 'applied' },
      { id: '2', status: 'duplicate' },
      { id: '3', status: 'rejected', reason: 'unknown entity' },
    ]);
    expect(out.acked).toEqual(['1', '2']);
    expect(out.rejected).toEqual([{ id: '3', reason: 'unknown entity' }]);
  });
});
