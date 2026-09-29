/** Branch-prefixed document numbers, e.g. KHI01-INV-000123 (CLAUDE.md §4.3 rule 6). */

export const DOC_TYPES = [
  'INV', // sale invoice
  'RET', // sale return
  'GRN', // goods receipt
  'PO', // purchase order
  'PRT', // purchase return
  'REQ', // requisition
  'TRF', // transfer note
  'ADJ', // stock adjustment
  'EXP', // expense voucher
  'PAY', // payment
  'SHF', // shift
] as const;
export type DocType = (typeof DOC_TYPES)[number];

const BRANCH_CODE = /^[A-Z][A-Z0-9]{1,7}$/;

export function formatDocNo(branchCode: string, type: DocType, seq: number): string {
  if (!BRANCH_CODE.test(branchCode)) throw new Error(`Invalid branch code "${branchCode}"`);
  if (!Number.isSafeInteger(seq) || seq < 1) throw new RangeError('Sequence must be a positive integer');
  return `${branchCode}-${type}-${String(seq).padStart(6, '0')}`;
}

export function parseDocNo(docNo: string): { branchCode: string; type: DocType; seq: number } {
  const match = /^([A-Z][A-Z0-9]{1,7})-([A-Z]{2,3})-(\d{6,})$/.exec(docNo);
  const type = match?.[2];
  if (!match || !type || !(DOC_TYPES as readonly string[]).includes(type)) {
    throw new SyntaxError(`Invalid document number "${docNo}"`);
  }
  return { branchCode: match[1] as string, type: type as DocType, seq: Number(match[3]) };
}

/**
 * A counter reserves numbers in blocks so a promoted standby server can continue safely
 * (ADR-0004). `next` is the next number to hand out, `blockEnd` is the last number reserved.
 */
export interface CounterState {
  next: number;
  blockEnd: number;
}

export const DEFAULT_BLOCK_SIZE = 1000;
/** Numbers skipped after a failover to avoid reusing numbers issued but not yet replicated. */
export const FAILOVER_GAP = 500;

export function takeNumber(state: CounterState, blockSize = DEFAULT_BLOCK_SIZE): { seq: number; state: CounterState } {
  const blockEnd = state.next > state.blockEnd ? state.next + blockSize - 1 : state.blockEnd;
  return { seq: state.next, state: { next: state.next + 1, blockEnd } };
}

/** Counter state for a server that has just been promoted after a failover. */
export function afterFailover(lastReplicatedSeq: number): CounterState {
  const next = lastReplicatedSeq + FAILOVER_GAP + 1;
  return { next, blockEnd: next + DEFAULT_BLOCK_SIZE - 1 };
}
