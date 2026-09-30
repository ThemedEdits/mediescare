/**
 * Item import: which spreadsheet column feeds which item field.
 * Headers from the old cloud export and from Mediescare's own template are matched by a normalised name
 * (lower case, letters and digits only), so "Rack#", "rack no" and "RACK_NO" are the same header.
 */

export interface ImportFieldInfo {
  key: ImportField;
  label: string;
  required: boolean;
  /** Short hint shown next to the field in the mapping screen. */
  hint: string;
  /** Normalised header names, most specific first. */
  synonyms: readonly string[];
}

export const IMPORT_FIELDS = [
  'name',
  'genericName',
  'barcode',
  'sku',
  'category',
  'manufacturer',
  'suppliers',
  'unit',
  'unitsPerPack',
  'cost',
  'price',
  'reorderLevel',
  'quantity',
  'expiryDate',
  'batchNo',
  'narcotic',
  'prescription',
  'rack',
  'taxPercent',
  'active',
] as const;

export type ImportField = (typeof IMPORT_FIELDS)[number];

/** Field to column index (0-based). A missing field means "do not import". */
export type ColumnMapping = Partial<Record<ImportField, number>>;

export const IMPORT_FIELD_INFO: readonly ImportFieldInfo[] = [
  {
    key: 'name',
    label: 'Item name',
    required: true,
    hint: 'At least 2 characters; longer than 160 is cut',
    synonyms: [
      'name',
      'itemname',
      'productname',
      'medicinename',
      'item',
      'product',
      'medicine',
      'description',
      'itemdescription',
    ],
  },
  {
    key: 'genericName',
    label: 'Generic name',
    required: false,
    hint: 'Salt or formula',
    synonyms: ['genericname', 'generic', 'salt', 'saltname', 'formula', 'composition'],
  },
  {
    key: 'barcode',
    label: 'Barcode',
    required: false,
    hint: 'One barcode, 6 to 64 characters; fake codes are dropped',
    synonyms: ['barcode', 'barcodeno', 'barcodenumber', 'ean', 'upc', 'bar'],
  },
  {
    key: 'sku',
    label: 'Item code (SKU)',
    required: false,
    hint: 'Leave unmapped to number items automatically',
    synonyms: ['sku', 'itemcode', 'productcode', 'itemno', 'code'],
  },
  {
    key: 'category',
    label: 'Category',
    required: false,
    hint: 'Created when missing',
    synonyms: ['category', 'categoryname', 'itemcategory', 'group', 'itemgroup'],
  },
  {
    key: 'manufacturer',
    label: 'Manufacturer',
    required: false,
    hint: 'Created when missing',
    synonyms: ['manufacturer', 'manufacturername', 'company', 'companyname', 'brand', 'mfg', 'mfr'],
  },
  {
    key: 'suppliers',
    label: 'Supplier(s)',
    required: false,
    hint: 'Not imported: suppliers are added separately',
    synonyms: ['suppliers', 'supplier', 'suppliername', 'suppliernames', 'vendor', 'vendors'],
  },
  {
    key: 'unit',
    label: 'Stocking unit',
    required: false,
    hint: 'Pack, strip, bottle... (default Pack, or Piece for single units)',
    synonyms: ['stockingunit', 'stockunit', 'unit', 'unitname', 'uom', 'packtype'],
  },
  {
    key: 'unitsPerPack',
    label: 'Units per pack',
    required: false,
    hint: 'Whole number, or text like "1 pack = 30 tablets"',
    synonyms: [
      'conversionunit',
      'unitsperpack',
      'unitperpack',
      'packsize',
      'conversion',
      'conversionfactor',
      'packqty',
      'perpack',
      'factor',
    ],
  },
  {
    key: 'cost',
    label: 'Cost per stocking unit',
    required: false,
    hint: 'Used only for opening stock',
    synonyms: [
      'unitcost',
      'cost',
      'costprice',
      'purchaseprice',
      'purchaserate',
      'buyingprice',
      'tradeprice',
      'tp',
    ],
  },
  {
    key: 'price',
    label: 'Retail price per stocking unit',
    required: false,
    hint: 'Zero or blank: imported, but not sellable until priced',
    synonyms: [
      'retailprice',
      'price',
      'saleprice',
      'sellingprice',
      'salerate',
      'retailrate',
      'mrp',
    ],
  },
  {
    key: 'reorderLevel',
    label: 'Reorder level',
    required: false,
    hint: 'In stocking units',
    synonyms: [
      'reorderinglevel',
      'reorderlevel',
      'reorderpoint',
      'reorderqty',
      'minstock',
      'minimumstock',
    ],
  },
  {
    key: 'quantity',
    label: 'Quantity on hand',
    required: false,
    hint: 'In stocking units; used only when importing opening stock',
    synonyms: [
      'availableqty',
      'availablequantity',
      'quantity',
      'qty',
      'onhand',
      'currentstock',
      'openingstock',
      'openingqty',
      'stock',
    ],
  },
  {
    key: 'expiryDate',
    label: 'Expiry date',
    required: false,
    hint: 'Opening stock batch expiry',
    synonyms: ['expirydate', 'expiry', 'expdate', 'exp'],
  },
  {
    key: 'batchNo',
    label: 'Batch number',
    required: false,
    hint: 'Opening stock batch (default OPENING)',
    synonyms: ['batchno', 'batchnumber', 'batch'],
  },
  {
    key: 'narcotic',
    label: 'Narcotic',
    required: false,
    hint: 'true/false, yes/no, 1/0',
    synonyms: ['narcotic', 'isnarcotic', 'controlled', 'controlleddrug'],
  },
  {
    key: 'prescription',
    label: 'Prescription only',
    required: false,
    hint: 'true/false, yes/no, 1/0',
    synonyms: ['prescription', 'isprescription', 'prescriptionrequired', 'rx'],
  },
  {
    key: 'rack',
    label: 'Rack',
    required: false,
    hint: 'Created for this branch when missing',
    synonyms: ['rack', 'rackno', 'racknumber', 'rackcode', 'shelf', 'location'],
  },
  {
    key: 'taxPercent',
    label: 'Sales tax %',
    required: false,
    hint: 'Up to 2 decimals',
    synonyms: ['taxpercent', 'taxrate', 'salestax', 'tax', 'gst'],
  },
  {
    key: 'active',
    label: 'Active / status',
    required: false,
    hint: 'Active, inactive, true, false',
    synonyms: ['isactive', 'active', 'status'],
  },
];

export function normalizeHeader(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Guess the mapping from the header row. Each column feeds at most one field. */
export function detectMapping(headers: readonly string[]): ColumnMapping {
  const normalized = headers.map(normalizeHeader);
  const used = new Set<number>();
  const mapping: ColumnMapping = {};
  for (const field of IMPORT_FIELD_INFO) {
    for (const synonym of field.synonyms) {
      const index = normalized.findIndex((h, i) => h === synonym && !used.has(i));
      if (index >= 0) {
        mapping[field.key] = index;
        used.add(index);
        break;
      }
    }
  }
  return mapping;
}

/** Drop mapping entries that point outside the file, and columns used twice (the first field wins). */
export function cleanMapping(mapping: ColumnMapping, columnCount: number): ColumnMapping {
  const used = new Set<number>();
  const clean: ColumnMapping = {};
  for (const key of IMPORT_FIELDS) {
    const index = mapping[key];
    if (index === undefined || !Number.isInteger(index) || index < 0 || index >= columnCount)
      continue;
    if (used.has(index)) continue;
    used.add(index);
    clean[key] = index;
  }
  return clean;
}
