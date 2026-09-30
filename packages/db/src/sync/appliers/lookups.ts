import { categories, manufacturers, paymentModes, suppliers, units } from '../../schema/sqlite-all';
import { simpleMasterApplier } from './common';
import { APPLY_ORDER, registerApplier } from './registry';

/** Units of measure. `code` is unique per organisation. Parents of items. */
export const applyUnit = simpleMasterApplier({
  table: units,
  spec: { code: 's', name: 's' },
  required: ['code', 'name'],
  naturalKey: { field: 'code', column: units.code },
  immutable: ['code'],
});

/** Categories: `parentId` has no foreign key (a child may arrive before its parent). */
export const applyCategory = simpleMasterApplier({
  table: categories,
  spec: { name: 's', parentId: 'sn' },
  required: ['name'],
});

export const applyManufacturer = simpleMasterApplier({
  table: manufacturers,
  spec: { name: 's' },
  required: ['name'],
});

/** Payment modes (cash, card, wallet ...). `code` is unique per organisation. */
export const applyPaymentMode = simpleMasterApplier({
  table: paymentModes,
  spec: {
    code: 's',
    name: 's',
    kind: 's',
    opensDrawer: 'b',
    isActive: 'b',
    sortOrder: 'i',
  },
  required: ['code', 'name', 'kind'],
  naturalKey: { field: 'code', column: paymentModes.code },
  immutable: ['code'],
  voidSet: { isActive: false },
});

/**
 * Suppliers. The opening balance never travels: it is money one branch owes from its own books, so a
 * pulled supplier always starts at 0 here. The credit limit is copied when the supplier is created
 * and is then the branch's own to change (decision to confirm with the owner).
 */
export const applySupplier = simpleMasterApplier({
  table: suppliers,
  spec: {
    name: 's',
    phone: 'sn',
    ntn: 'sn',
    strn: 'sn',
    termsDays: 'i',
    creditLimitMinor: 'i',
    isActive: 'b',
  },
  required: ['name'],
  rules: { branchLocal: ['creditLimitMinor'] },
  voidSet: { isActive: false },
});

registerApplier('units', applyUnit, { order: APPLY_ORDER.lookups });
registerApplier('categories', applyCategory, { order: APPLY_ORDER.lookups });
registerApplier('manufacturers', applyManufacturer, { order: APPLY_ORDER.lookups });
registerApplier('payment_modes', applyPaymentMode, { order: APPLY_ORDER.lookups });
registerApplier('suppliers', applySupplier, { order: APPLY_ORDER.parties });
