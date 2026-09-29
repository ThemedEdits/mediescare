/** Exponential backoff with jitter: 2 s doubling up to a 15 min cap (sync-design.md §4). */
export const BACKOFF_BASE_MS = 2_000;
export const BACKOFF_CAP_MS = 15 * 60 * 1000;

/**
 * @param attempt 1 for the first retry
 * @param random injectable source in [0, 1), so tests are deterministic
 */
export function backoffDelayMs(attempt: number, random: () => number = Math.random): number {
  if (!Number.isInteger(attempt) || attempt < 1) throw new RangeError('attempt must be >= 1');
  const exp = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** (attempt - 1));
  // "Equal jitter": half fixed, half random. Never zero, never above the cap.
  return Math.floor(exp / 2 + random() * (exp / 2));
}
