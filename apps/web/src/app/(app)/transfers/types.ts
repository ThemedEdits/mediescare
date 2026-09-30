import { formatMixedQty } from '@mediescare/core/stock';
import type { Translator } from '@/i18n/core';

/** Shapes returned by /api/requisitions and /api/transfers. Cost fields are absent without the cost right. */

export interface UnitInfo {
  name: string;
  factorToBase: number;
}
export interface ItemRef {
  id: string;
  sku: string;
  name: string;
  units: UnitInfo[];
}

export interface Cost {
  dispatchedMinor: number;
  receivedMinor: number;
  damagedMinor: number;
  shortMinor: number;
  inTransitMinor?: number;
  differenceMinor?: number;
}

export type RequisitionStatus = 'submitted' | 'approved' | 'fulfilled' | 'cancelled';
export type TransferStatus = 'draft' | 'dispatched' | 'received' | 'cancelled';

export interface RequisitionRow {
  id: string;
  docNo: string;
  status: RequisitionStatus;
  fromBranchName: string;
  toBranchName: string;
  neededBy: string | null;
  lineCount: number;
  createdAt: string;
  transferId: string | null;
  incoming: boolean;
}
export interface RequisitionDetail extends RequisitionRow {
  note: string | null;
  cancelReason: string | null;
  lines: {
    id: string;
    lineNo: number;
    item: ItemRef;
    qtyRequestedBase: number;
    qtyApprovedBase: number | null;
  }[];
}

export interface TransferRow {
  id: string;
  docNo: string;
  status: TransferStatus;
  fromBranchName: string;
  toBranchName: string;
  requisitionId: string | null;
  lineCount: number;
  qtyDispatched: number;
  qtyReceived: number;
  qtyDamaged: number;
  qtyShort: number;
  dispatchedAt: string | null;
  receivedAt: string | null;
  createdAt: string;
  direction: 'outgoing' | 'incoming';
  cost?: Cost;
}
export interface TransferDetail extends TransferRow {
  note: string | null;
  receiveNote: string | null;
  cancelReason: string | null;
  requisitionDocNo: string | null;
  lines: {
    id: string;
    lineNo: number;
    item: ItemRef;
    batchNo: string;
    expiryDate: string;
    qtyDispatched: number;
    qtyReceived: number;
    qtyDamaged: number;
    qtyShort: number;
    costUnitMicro?: number;
    cost?: Cost;
  }[];
}

export const REQ_TONE = {
  submitted: 'warning',
  approved: 'success',
  fulfilled: 'success',
  cancelled: 'neutral',
} as const;
export const TRF_TONE = {
  draft: 'neutral',
  dispatched: 'warning',
  received: 'success',
  cancelled: 'neutral',
} as const;

/** "2 Box + 3 Strip" from a quantity in the smallest unit. */
export const qty = (base: number, units: UnitInfo[]): string =>
  units.length > 0 && base !== 0
    ? formatMixedQty(
        base,
        units.map((u) => ({ id: u.name, ...u })),
      )
    : String(base);

/** What the screen may offer. Decided on the server from the permission keys and the branch. */
export interface TransferAbilities {
  isHeadOffice: boolean;
  branchName: string;
  createRequisition: boolean;
  approveRequisition: boolean;
  createTransfer: boolean;
  dispatch: boolean;
  cancelTransfer: boolean;
  receive: boolean;
  print: boolean;
  viewStock: boolean;
}

/** Label of a fixed status value, falling back to the raw value when there is no translation. */
export const statusLabel = (t: Translator, group: string, value: string): string =>
  t.has(`transfers.${group}.${value}`) ? t(`transfers.${group}.${value}`) : value;
