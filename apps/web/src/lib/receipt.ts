import {
  concatBytes,
  drawerKick,
  encodeReceipt,
  encodeTestReceipt,
  type DrawerPin,
  type PaperWidth,
  type ReceiptData,
} from '@mediescare/core/escpos';

/** Printer-related branch settings (keys of GET /api/lookups `settings`), with safe defaults. */
export interface PrintSettings {
  printerName: string;
  paperWidth: PaperWidth;
  autoPrint: boolean;
  openDrawerOnCash: boolean;
  drawerPin: DrawerPin;
  copies: number;
  header: string;
  footer: string;
  invoiceNote: string;
}

export function readPrintSettings(raw: Record<string, unknown> | undefined): PrintSettings {
  const s = raw ?? {};
  const str = (k: string) => (typeof s[k] === 'string' ? (s[k] as string) : '');
  const copies = Number(s['print.copies']);
  return {
    printerName: str('print.printer_name'),
    paperWidth: String(s['print.paper_width']) === '58' ? '58' : '80',
    autoPrint: s['print.auto_print'] === true,
    openDrawerOnCash: s['print.open_drawer_on_cash'] !== false,
    drawerPin: s['print.drawer_pin'] === 'pin5' ? 'pin5' : 'pin2',
    copies: Number.isInteger(copies) ? Math.min(3, Math.max(1, copies)) : 1,
    header: str('print.receipt_header'),
    footer: str('print.receipt_footer'),
    invoiceNote: str('pos.invoice_note'),
  };
}

/** The parts of the POS sale response a receipt needs. Cost and profit are deliberately not here. */
export interface ReceiptSale {
  docNo: string;
  discountMinor: number;
  taxMinor: number;
  roundingMinor: number;
  grandTotalMinor: number;
  changeMinor: number;
  dueMinor: number;
  lines: { name: string; qtyUnits: number; unitId: string; netMinor: number }[];
}

export interface ReceiptPaymentInput {
  label: string;
  amountMinor: number;
  /** True for payment modes that open the cash drawer. */
  cash: boolean;
}

const splitLines = (text: string) =>
  text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

export function buildReceiptData(
  sale: ReceiptSale,
  ctx: {
    branchName: string;
    cashier: string;
    customer?: string;
    dateTime: string;
    lineUnit: (unitId: string) => string;
    payments: ReceiptPaymentInput[];
  },
  settings: PrintSettings,
): ReceiptData {
  return {
    headerLines: splitLines(settings.header),
    branchName: ctx.branchName,
    docNo: sale.docNo,
    dateTime: ctx.dateTime,
    cashier: ctx.cashier,
    customer: ctx.customer,
    lines: sale.lines.map((l) => ({
      name: l.name,
      qtyLabel: String(l.qtyUnits),
      unitLabel: ctx.lineUnit(l.unitId),
      amountMinor: l.netMinor,
    })),
    subTotalMinor: sale.lines.reduce((sum, l) => sum + l.netMinor, 0),
    discountMinor: sale.discountMinor,
    taxMinor: sale.taxMinor,
    roundingMinor: sale.roundingMinor,
    grandTotalMinor: sale.grandTotalMinor,
    payments: ctx.payments.map((p) => ({ label: p.label, amountMinor: p.amountMinor })),
    changeMinor: sale.changeMinor,
    dueMinor: sale.dueMinor,
    footerLines: splitLines(settings.footer || 'Thank you'),
    invoiceNote: settings.invoiceNote.trim() || undefined,
  };
}

export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

export interface PrintOutcome {
  ok: boolean;
  error?: string;
}

/** True when the desktop app's native printing bridge is available. */
export const hasNativePrinting = (): boolean => typeof window.mediescare?.printRaw === 'function';

function failure(error: unknown): PrintOutcome {
  return { ok: false, error: error instanceof Error ? error.message : 'Printing failed' };
}

/**
 * Prints the receipt natively and, when a payment opened the drawer, kicks it. With one copy the
 * kick is sent in the same job (drawer opens first); with several copies it is sent separately so it
 * does not fire once per copy. Never throws.
 */
export async function printReceiptNative(
  data: ReceiptData,
  settings: PrintSettings,
  opts: { openDrawer: boolean },
): Promise<PrintOutcome> {
  const bridge = window.mediescare;
  if (!bridge?.printRaw) return { ok: false, error: 'Native printing is not available here' };
  try {
    const kick = opts.openDrawer && settings.openDrawerOnCash;
    const receipt = encodeReceipt(data, settings.paperWidth);
    const single = settings.copies === 1;
    const job = kick && single ? concatBytes(drawerKick(settings.drawerPin), receipt) : receipt;
    const result = await bridge.printRaw(settings.printerName, toBase64(job), {
      copies: settings.copies,
    });
    if (!result.ok) return { ok: false, error: result.error ?? 'Printing failed' };
    if (kick && !single && bridge.openDrawer) {
      const opened = await bridge.openDrawer(settings.printerName, settings.drawerPin);
      if (!opened.ok) return { ok: false, error: opened.error ?? 'The drawer did not open' };
    }
    return { ok: true };
  } catch (e) {
    return failure(e);
  }
}

/** Test page and drawer kick for the settings screen; use the values as typed, not the saved ones. */
export async function printTestPage(printerName: string, paper: PaperWidth): Promise<PrintOutcome> {
  const bridge = window.mediescare;
  if (!bridge?.printRaw) return { ok: false, error: 'Printing needs the Mediescare desktop app' };
  try {
    const r = await bridge.printRaw(printerName, toBase64(encodeTestReceipt(paper, printerName)));
    return r.ok ? { ok: true } : { ok: false, error: r.error ?? 'Printing failed' };
  } catch (e) {
    return failure(e);
  }
}

export async function kickDrawer(printerName: string, pin: DrawerPin): Promise<PrintOutcome> {
  const bridge = window.mediescare;
  if (!bridge?.openDrawer) return { ok: false, error: 'Opening the drawer needs the desktop app' };
  try {
    const r = await bridge.openDrawer(printerName, pin);
    return r.ok ? { ok: true } : { ok: false, error: r.error ?? 'The drawer did not open' };
  } catch (e) {
    return failure(e);
  }
}
