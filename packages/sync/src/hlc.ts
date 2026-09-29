/**
 * Hybrid Logical Clock (docs/phase0/sync-design.md §3).
 * String form `WWWWWWWWWWWW-CCCC-DDDDDDDD` (wall ms hex, counter hex, device hex) sorts lexically.
 * The clock never goes backwards, even if the device clock does.
 */

export interface HlcParts {
  wallMs: number;
  counter: number;
  device: string;
}

const MAX_COUNTER = 0xffff;
/** A remote clock further ahead than this is accepted but flagged (sync-design.md §3). */
export const MAX_SKEW_MS = 24 * 60 * 60 * 1000;

export function formatHlc({ wallMs, counter, device }: HlcParts): string {
  return `${wallMs.toString(16).padStart(12, '0')}-${counter.toString(16).padStart(4, '0')}-${device}`;
}

export function parseHlc(value: string): HlcParts {
  const match = /^([0-9a-f]{12})-([0-9a-f]{4})-([0-9a-f]{8})$/.exec(value);
  if (!match) throw new SyntaxError(`Invalid HLC "${value}"`);
  return { wallMs: parseInt(match[1] as string, 16), counter: parseInt(match[2] as string, 16), device: match[3] as string };
}

export function compareHlc(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export class HybridLogicalClock {
  private wallMs = 0;
  private counter = 0;

  /**
   * @param device 8 hex characters identifying this device
   * @param now injectable time source in ms (tests use a fake clock)
   */
  constructor(
    private readonly device: string,
    private readonly now: () => number = Date.now,
  ) {
    if (!/^[0-9a-f]{8}$/.test(device)) throw new Error('device must be 8 lowercase hex characters');
  }

  /** Timestamp for a local event. */
  tick(): string {
    const physical = this.now();
    if (physical > this.wallMs) {
      this.wallMs = physical;
      this.counter = 0;
    } else {
      this.bumpCounter();
    }
    return this.current();
  }

  /** Merge a timestamp received from another device. Returns the new local timestamp. */
  receive(remote: string): { hlc: string; skewed: boolean } {
    const r = parseHlc(remote);
    const physical = this.now();
    const skewed = r.wallMs - physical > MAX_SKEW_MS;
    const wall = Math.max(physical, this.wallMs, r.wallMs);
    if (wall === this.wallMs && wall === r.wallMs) {
      this.counter = Math.max(this.counter, r.counter);
      this.bumpCounter();
    } else if (wall === this.wallMs) {
      this.bumpCounter();
    } else if (wall === r.wallMs) {
      this.wallMs = wall;
      this.counter = r.counter;
      this.bumpCounter();
    } else {
      this.wallMs = wall;
      this.counter = 0;
    }
    return { hlc: this.current(), skewed };
  }

  /** Restore state after a restart so the clock stays monotonic. */
  restore(last: string): void {
    const p = parseHlc(last);
    if (p.wallMs > this.wallMs || (p.wallMs === this.wallMs && p.counter > this.counter)) {
      this.wallMs = p.wallMs;
      this.counter = p.counter;
    }
  }

  current(): string {
    return formatHlc({ wallMs: this.wallMs, counter: this.counter, device: this.device });
  }

  private bumpCounter(): void {
    if (this.counter >= MAX_COUNTER) {
      // Counter overflow: move the wall clock forward by 1 ms instead of wrapping.
      this.wallMs += 1;
      this.counter = 0;
    } else {
      this.counter += 1;
    }
  }
}
