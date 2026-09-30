export interface HitBatch {
  id: string;
  batchNo: string;
  expiryDate: string;
  available: number;
  /** Present only for roles that may see cost. */
  costUnitMicro?: number;
  expiry: { state: 'expired' | 'near' | 'ok'; daysLeft: number; window: number | null };
}

export interface HitUnit {
  unitId: string;
  name: string;
  factorToBase: number;
  isDefaultSale: boolean;
}

export interface Hit {
  id: string;
  sku: string;
  name: string;
  genericName: string | null;
  strength: string | null;
  dosageForm: string | null;
  baseUnitId: string;
  retailRateUnitMicro: number;
  taxBp: number;
  taxInclusive: boolean;
  isNarcotic: boolean;
  isPrescription: boolean;
  allowNegativeStock: boolean;
  rackCode: string | null;
  sellableBase: number;
  nearestExpiry: string | null;
  matchedByBarcode: boolean;
  batches: HitBatch[];
  units: HitUnit[];
}

export interface Narcotic {
  patientName: string;
  patientCnic: string;
  doctorName: string;
  prescriptionRef?: string;
}

export interface CartLine {
  key: string;
  hit: Hit;
  unitId: string;
  qty: number;
  batchId?: string;
  /** Line discount in percent, as typed. */
  discountPct: string;
  /** Price per selected unit, as typed, when changed at the counter. */
  rateText?: string;
  narcotic?: Narcotic;
}

export interface PayRow {
  key: string;
  modeId: string;
  amount: string;
  reference?: string;
}

export interface Shift {
  id: string;
  docNo: string;
  openedAt: string;
  floatMinor: number;
}

export interface PaymentMode {
  id: string;
  code: string;
  name: string;
  kind: 'cash' | 'card' | 'wallet' | 'bank' | 'qr' | 'credit';
  opensDrawer: boolean;
}

export interface Customer {
  id: string;
  mrNo: string;
  name: string;
  phone: string | null;
  isWalkin: boolean;
  creditLimitMinor: number;
}

export interface SaleResultLine {
  lineNo: number;
  name: string;
  qtyUnits: number;
  unitId: string;
  netMinor: number;
  taxMinor: number;
  discountMinor: number;
}

export interface SaleResult {
  id: string;
  docNo: string;
  replay: boolean;
  grossMinor: number;
  discountMinor: number;
  taxMinor: number;
  roundingMinor: number;
  grandTotalMinor: number;
  paidMinor: number;
  dueMinor: number;
  changeMinor: number;
  profitMinor?: number;
  lines: SaleResultLine[];
}

export interface OverrideNeed {
  kind: 'discount' | 'override_price' | 'refund' | 'void';
  percentBp?: number;
  amountMinor?: number;
}
