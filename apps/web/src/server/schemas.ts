import { z } from 'zod';

/** Shared input schemas (Zod is the source of truth for request types, CLAUDE.md §8). */
const int = z.number().int().safe();

export const ItemBody = z.object({
  sku: z.string().trim().max(40).optional(),
  name: z.string().trim().min(2).max(160),
  genericName: z.string().trim().max(160).nullish(),
  strength: z.string().trim().max(60).nullish(),
  dosageForm: z.string().trim().max(60).nullish(),
  categoryId: z.string().nullish(),
  manufacturerId: z.string().nullish(),
  rackId: z.string().nullish(),
  baseUnitId: z.string().min(1),
  units: z
    .array(
      z.object({
        unitId: z.string().min(1),
        factorToBase: int.min(1),
        isDefaultSale: z.boolean().optional(),
        isDefaultPurchase: z.boolean().optional(),
      }),
    )
    .min(1)
    .max(8),
  barcodes: z.array(z.string().trim()).max(10),
  retailRateUnitMicro: int.min(0),
  taxBp: int.min(0).max(10_000).optional(),
  taxInclusive: z.boolean().optional(),
  reorderLevelBase: int.min(0).optional(),
  isPrescription: z.boolean().optional(),
  isNarcotic: z.boolean().optional(),
  isColdChain: z.boolean().optional(),
  allowNegativeStock: z.boolean().optional(),
  drapRegNo: z.string().trim().max(60).nullish(),
  isActive: z.boolean().optional(),
});

export const GrnBody = z.object({
  supplierId: z.string().min(1),
  supplierInvoiceNo: z.string().trim().max(60).nullish(),
  supplierInvoiceDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullish(),
  discountMinor: int.min(0).optional(),
  salesTaxMinor: int.min(0).optional(),
  advanceTaxMinor: int.min(0).optional(),
  whtMinor: int.min(0).optional(),
  freightMinor: int.min(0).optional(),
  stockNote: z.string().trim().max(500).nullish(),
  lines: z
    .array(
      z.object({
        itemId: z.string().min(1),
        unitId: z.string().min(1),
        qty: int.min(1),
        bonusQty: int.min(0).optional(),
        batchNo: z.string().trim().min(1).max(40),
        expiryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        mfgDate: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .nullish(),
        unitPriceMicro: int.min(0),
        mrpMicro: int.min(0).optional(),
      }),
    )
    .min(1)
    .max(300),
});

export const SaleBody = z.object({
  idempotencyKey: z.string().min(8).max(80),
  customerId: z.string().nullish(),
  lines: z
    .array(
      z.object({
        itemId: z.string().min(1),
        unitId: z.string().min(1),
        qty: int.min(1),
        batchId: z.string().optional(),
        rateUnitMicro: int.min(1).optional(),
        discountBp: int.min(0).max(10_000).optional(),
        discountMinor: int.min(0).optional(),
        narcotic: z
          .object({
            patientName: z.string().trim().max(120),
            patientCnic: z.string().trim().max(20),
            doctorName: z.string().trim().max(120),
            prescriptionRef: z.string().trim().max(60).optional(),
          })
          .optional(),
      }),
    )
    .min(1)
    .max(200),
  billDiscount: z
    .discriminatedUnion('kind', [
      z.object({ kind: z.literal('percent'), bp: int.min(0).max(10_000) }),
      z.object({ kind: z.literal('amount'), minor: int.min(0) }),
    ])
    .optional(),
  payments: z
    .array(
      z.object({
        modeId: z.string().min(1),
        amountMinor: int.min(1),
        reference: z.string().trim().max(60).optional(),
      }),
    )
    .max(8),
  note: z.string().trim().max(300).optional(),
  discountOverrideId: z.string().optional(),
  priceOverrideId: z.string().optional(),
  rounding: z.enum(['none', 'rupee', 'half_rupee']).optional(),
});
