import ExcelJS from 'exceljs';

const HEADERS = [
  'name',
  'generic_name',
  'barcode',
  'category',
  'manufacturer',
  'unit',
  'units_per_pack',
  'cost',
  'price',
  'reorder_level',
  'quantity',
  'expiry_date',
  'batch_no',
  'narcotic',
  'prescription',
  'rack',
  'tax_percent',
  'sku',
] as const;

// Clearly fake sample rows. Cost and price are per stocking unit (the pack when units_per_pack is above 1).
const SAMPLES: (string | number)[][] = [
  [
    'Sample Tablet 500mg',
    'Samplecetamol',
    '0000000000001',
    'Medicines',
    'Sample Pharma',
    'Strip',
    10,
    50,
    80,
    20,
    100,
    '2028-12-31',
    'B001',
    'false',
    'false',
    'A1',
    0,
    '',
  ],
  [
    'Sample Syrup 120ml',
    'Samplecillin',
    '0000000000002',
    'Medicines',
    'Sample Pharma',
    'Bottle',
    1,
    120,
    180,
    5,
    24,
    '2028-06-30',
    'B002',
    'false',
    'true',
    'B2',
    0,
    '',
  ],
  [
    'Sample Lotion 100ml',
    '',
    '',
    'Wellness and beauty',
    'Fake Labs',
    'Piece',
    1,
    300,
    450,
    3,
    0,
    '',
    '',
    'false',
    'false',
    '',
    18,
    '',
  ],
];

/** The downloadable starter file: one sheet, the headers Mediescare understands, three fake example rows. */
export async function buildItemTemplate(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Items');
  sheet.addRow([...HEADERS]).font = { bold: true };
  SAMPLES.forEach((r) => sheet.addRow(r));
  sheet.columns.forEach((c) => {
    c.width = 18;
  });
  // Barcodes must stay text, or Excel turns them into numbers and drops leading zeros.
  sheet.getColumn(3).numFmt = '@';
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
