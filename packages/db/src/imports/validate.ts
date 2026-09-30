import { eq } from 'drizzle-orm';
import { unitRateFromPack } from '@mediescare/core';
import type { Db } from '../client';
import type { WriteContext } from '../context';
import { branchToday } from '../pharmacy/common';
import { itemBarcodes, items } from '../schema/sqlite-all';
import { cleanMapping, type ColumnMapping, type ImportField } from './columns';
import type { ParsedTable } from './parse';
import type {
  ImportIssue,
  IssueSeverity,
  ItemImportReport,
  PreparedImport,
  PreparedRow,
  ValidationOptions,
} from './types';
import {
  parseActive,
  parseBool,
  parseExpiry,
  parseMicro,
  parsePackSize,
  parsePercentBp,
  parseQuantityBase,
} from './values';

export const MAX_STORED_ISSUES = 5000;
export const MAX_NAME_LENGTH = 160;
const MAX_TEXT_LENGTH = 100;
const BARCODE_PATTERN = /^[\x21-\x7e]{6,64}$/;
const RACK_PATTERN = /^[A-Z0-9][A-Z0-9 _-]{0,19}$/;
const SKU_PATTERN = /^[\x21-\x7e]{1,40}$/;

/** Counts every issue exactly but stores at most MAX_STORED_ISSUES per severity, so warnings never hide errors. */
class IssueLog {
  readonly counts: Record<string, number> = {};
  readonly stored: ImportIssue[] = [];
  truncated = false;
  private readonly perSeverity: Record<IssueSeverity, number> = { error: 0, warning: 0, exists: 0 };

  add(issue: ImportIssue): void {
    this.counts[issue.code] = (this.counts[issue.code] ?? 0) + 1;
    if (this.perSeverity[issue.severity] >= MAX_STORED_ISSUES) {
      this.truncated = true;
      return;
    }
    this.perSeverity[issue.severity]++;
    this.stored.push(issue);
  }
}

const tidy = (text: string, max = MAX_TEXT_LENGTH): string | null => {
  const clean = text.replace(/\s+/g, ' ').trim().slice(0, max);
  return clean === '' ? null : clean;
};

function dupKey(name: string, manufacturer: string | null, pack: number): string {
  const n = name
    .toLowerCase()
    .replace(/[^a-z0-9؀-ۿ]+/g, ' ')
    .trim();
  return `${n}|${(manufacturer ?? '').toLowerCase()}|${pack}`;
}

/**
 * Dry run: check every row against the rules and the current catalogue, write nothing.
 * Errors skip the row. Warnings import it. A barcode or item code that already belongs to an item
 * marks the row "already exists" and skips it, which makes importing the same file twice safe.
 */
export function validateItemRows(
  db: Db,
  ctx: WriteContext,
  table: ParsedTable,
  mappingInput: ColumnMapping,
  options: ValidationOptions = {},
): PreparedImport {
  const mapping = cleanMapping(mappingInput, table.headers.length);
  const log = new IssueLog();
  const rows: PreparedRow[] = [];
  const today = branchToday(db, ctx);

  const existingBarcodes = new Set(
    db
      .select({ b: itemBarcodes.barcode })
      .from(itemBarcodes)
      .where(eq(itemBarcodes.tenantId, ctx.tenantId))
      .all()
      .map((r) => r.b),
  );
  const existingSkus =
    mapping.sku === undefined
      ? new Set<string>()
      : new Set(
          db
            .select({ s: items.sku })
            .from(items)
            .where(eq(items.tenantId, ctx.tenantId))
            .all()
            .map((r) => r.s),
        );
  const fileBarcodes = new Map<string, number>();
  const fileSkus = new Set<string>();
  const fileKeys = new Map<string, number>();

  let alreadyExist = 0;
  let skippedWithErrors = 0;
  let rowsWithWarnings = 0;
  let stockRows = 0;
  let needsDefaultExpiry = 0;
  let rowsWithSuppliers = 0;

  table.rows.forEach((cells, index) => {
    const rowNo = table.rowNumbers[index] as number;
    const cell = (field: ImportField): string => {
      const col = mapping[field];
      return col === undefined ? '' : (cells[col] ?? '');
    };
    const rawName = cell('name').replace(/\s+/g, ' ').trim();
    const issue = (
      severity: IssueSeverity,
      code: string,
      field: ImportField | null,
      message: string,
    ) => log.add({ row: rowNo, severity, code, field, message, name: rawName.slice(0, 80) });

    // Errors first: a row with any error is skipped, so its other problems are not worth listing.
    let errors = 0;
    const error = (code: string, field: ImportField, message: string) => {
      errors++;
      issue('error', code, field, message);
    };
    if (rawName.length < 2) error('name_invalid', 'name', 'Item name is empty or too short');

    const pack = parsePackSize(cell('unitsPerPack'));
    let packSize = 1;
    let packWarning = false;
    if (!pack.ok)
      error(
        'pack_invalid',
        'unitsPerPack',
        `Units per pack "${cell('unitsPerPack')}" is not a whole number`,
      );
    else if (pack.value === 0) packWarning = true;
    else packSize = pack.value ?? 1;

    const price = parseMicro(cell('price'));
    if (!price.ok)
      error('price_invalid', 'price', `Price "${cell('price')}" is not a valid amount`);
    else if (price.value !== null && price.value < 0)
      error('price_invalid', 'price', 'Price is negative');

    const cost = parseMicro(cell('cost'));
    if (!cost.ok) error('cost_invalid', 'cost', `Cost "${cell('cost')}" is not a valid amount`);
    else if (cost.value !== null && cost.value < 0)
      error('cost_invalid', 'cost', 'Cost is negative');

    const quantity = parseQuantityBase(cell('quantity'), packSize);
    if (!quantity.ok)
      error(
        'quantity_invalid',
        'quantity',
        `Quantity "${cell('quantity')}" is not a valid whole quantity`,
      );
    else if (quantity.value !== null && quantity.value < 0)
      error('quantity_invalid', 'quantity', 'Quantity is negative');

    const expiry = parseExpiry(cell('expiryDate'));
    if (!expiry.ok)
      error('expiry_invalid', 'expiryDate', `Expiry "${cell('expiryDate')}" is not a valid date`);

    if (errors > 0 || !pack.ok || !price.ok || !cost.ok || !quantity.ok || !expiry.ok) {
      skippedWithErrors++;
      return;
    }

    // Barcode and item code: who already owns them decides if this row is new.
    const barcodeText = cell('barcode');
    const barcodeValid = BARCODE_PATTERN.test(barcodeText);
    const skuText = cell('sku');
    const skuValid = SKU_PATTERN.test(skuText);
    if (barcodeValid && existingBarcodes.has(barcodeText)) {
      alreadyExist++;
      issue('exists', 'exists', 'barcode', `Barcode ${barcodeText} already belongs to an item`);
      return;
    }
    if (skuValid && existingSkus.has(skuText)) {
      alreadyExist++;
      issue('exists', 'exists', 'sku', `Item code ${skuText} already belongs to an item`);
      return;
    }

    let warnings = 0;
    const warn = (code: string, field: ImportField | null, message: string) => {
      warnings++;
      issue('warning', code, field, message);
    };

    let name = rawName;
    if (name.length > MAX_NAME_LENGTH) {
      name = name.slice(0, MAX_NAME_LENGTH).trim();
      warn(
        'name_truncated',
        'name',
        `Name was longer than ${MAX_NAME_LENGTH} characters and was cut`,
      );
    }
    if (packWarning) warn('pack_zero', 'unitsPerPack', 'Units per pack is 0: treated as 1');
    const priceMicroPerPack = price.value ?? 0;
    if (priceMicroPerPack === 0)
      warn(
        'zero_price',
        'price',
        'Price is zero or blank: the POS will not sell this item until it is priced',
      );

    const category = tidy(cell('category'));
    if (!category) warn('blank_category', 'category', 'No category');

    let barcode: string | null = null;
    if (barcodeText !== '') {
      if (!barcodeValid)
        warn(
          'fake_barcode',
          'barcode',
          `Barcode "${barcodeText.slice(0, 30)}" does not look real and was dropped`,
        );
      else if (fileBarcodes.has(barcodeText))
        warn(
          'duplicate_barcode',
          'barcode',
          `Barcode ${barcodeText} is already used by row ${fileBarcodes.get(barcodeText)}: imported without it`,
        );
      else barcode = barcodeText;
    }

    let sku: string | null = null;
    if (skuText !== '') {
      if (!skuValid || fileSkus.has(skuText))
        warn(
          'sku_dropped',
          'sku',
          `Item code "${skuText.slice(0, 30)}" is unusable or repeated: a new code is assigned`,
        );
      else sku = skuText;
    }

    const supplierText = cell('suppliers');
    if (supplierText !== '') {
      rowsWithSuppliers++;
      if (/[,;|\n/]/.test(supplierText))
        warn(
          'multiple_suppliers',
          'suppliers',
          'Several suppliers in one cell: suppliers are not imported',
        );
    }

    const rackText = cell('rack').toUpperCase().replace(/\s+/g, ' ').trim();
    let rack: string | null = null;
    if (rackText !== '') {
      if (RACK_PATTERN.test(rackText)) rack = rackText;
      else
        warn(
          'rack_invalid',
          'rack',
          `Rack "${rackText.slice(0, 30)}" is not a valid rack code and was ignored`,
        );
    }

    let taxBp = 0;
    const tax = parsePercentBp(cell('taxPercent'));
    if (!tax.ok || (tax.value !== null && (tax.value < 0 || tax.value > 10_000)))
      warn(
        'tax_invalid',
        'taxPercent',
        `Sales tax "${cell('taxPercent')}" is not between 0 and 100: set to 0`,
      );
    else taxBp = tax.value ?? 0;

    let reorderLevelBase = 0;
    const reorder = parseQuantityBase(cell('reorderLevel'), packSize);
    if (!reorder.ok || (reorder.value !== null && reorder.value < 0))
      warn(
        'reorder_invalid',
        'reorderLevel',
        `Reorder level "${cell('reorderLevel')}" is not valid: set to 0`,
      );
    else reorderLevelBase = reorder.value ?? 0;

    const flag = (field: ImportField): boolean => {
      const parsed = parseBool(cell(field));
      if (!parsed.ok) {
        warn('flag_invalid', field, `"${cell(field)}" is not true/false or yes/no: treated as no`);
        return false;
      }
      return parsed.value ?? false;
    };
    const isNarcotic = flag('narcotic');
    const isPrescription = flag('prescription');

    const quantityBase = quantity.value ?? 0;
    const costPackMicro = cost.value;
    if (quantityBase > 0) {
      stockRows++;
      if (expiry.value === null) needsDefaultExpiry++;
      if (options.importStock) {
        if (!costPackMicro)
          warn(
            'stock_no_cost',
            'cost',
            'Quantity given but no cost: opening stock is skipped for this item',
          );
        else if (expiry.value !== null && expiry.value < today)
          warn(
            'stock_expired',
            'expiryDate',
            'Expiry is in the past: opening stock is skipped for this item',
          );
      }
    }

    const manufacturer = tidy(cell('manufacturer'));
    const key = dupKey(name, manufacturer, packSize);
    const twin = fileKeys.get(key);
    if (twin !== undefined)
      warn(
        'possible_duplicate',
        'name',
        `Looks like row ${twin} (same name, manufacturer and pack size): imported anyway`,
      );
    else fileKeys.set(key, rowNo);
    if (barcode) fileBarcodes.set(barcode, rowNo);
    if (sku) fileSkus.add(sku);

    if (warnings > 0) rowsWithWarnings++;
    rows.push({
      rowNo,
      name,
      genericName: tidy(cell('genericName'), MAX_NAME_LENGTH),
      barcode,
      sku,
      category,
      manufacturer,
      unitName: tidy(cell('unit'), 40),
      packSize,
      retailRateUnitMicro: unitRateFromPack(priceMicroPerPack, packSize),
      costPackMicro,
      reorderLevelBase,
      quantityBase,
      expiryDate: expiry.value,
      batchNo: tidy(cell('batchNo'), 40),
      isNarcotic,
      isPrescription,
      isActive: mapping.active === undefined ? true : parseActive(cell('active')),
      rack,
      taxBp,
    });
  });

  const report: ItemImportReport = {
    totalRows: table.rows.length,
    willImport: rows.length,
    alreadyExist,
    skippedWithErrors,
    rowsWithWarnings,
    stockRows,
    needsDefaultExpiry,
    rowsWithSuppliers,
    issueCounts: log.counts,
    issues: log.stored,
    issuesTruncated: log.truncated,
  };
  return { rows, report };
}
