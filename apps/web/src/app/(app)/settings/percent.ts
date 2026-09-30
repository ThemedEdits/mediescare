/** Basis points (100 = 1%) shown as a percentage text: 1700 -> "17", 50 -> "0.5", 1725 -> "17.25". */
export function bpToPercent(bp: number): string {
  const whole = Math.trunc(bp / 100);
  const frac = bp % 100;
  if (frac === 0) return String(whole);
  return `${whole}.${String(frac).padStart(2, '0').replace(/0$/, '')}`;
}

/** A typed percentage ("17", "0.5", "17.25") as basis points, or null when it is not a valid rate from 0 to 100. */
export function percentToBp(text: string): number | null {
  const t = text.trim();
  if (t === '') return 0;
  const m = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(t);
  if (!m) return null;
  const bp = Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0') || 0);
  return bp <= 10_000 ? bp : null;
}
