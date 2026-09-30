import {
  getWalkinCustomerId,
  listCategories,
  listManufacturers,
  listPaymentModes,
  listRacks,
  listUnits,
} from '@mediescare/db';
import { json, withPermission } from '@/server/guard';
import { getDb, writeContext } from '@/server/runtime';

export const dynamic = 'force-dynamic';

/** Reference data for forms and the POS: units, categories, manufacturers, racks, payment methods. */
export const GET = withPermission('pharmacy.item.view', (_request, auth) => {
  const db = getDb();
  const ctx = writeContext(auth.userId);
  return json({
    units: listUnits(db, ctx.tenantId),
    categories: listCategories(db, ctx.tenantId),
    manufacturers: listManufacturers(db, ctx.tenantId),
    racks: listRacks(db, ctx.branchId),
    paymentModes: listPaymentModes(db, ctx.tenantId),
    walkinCustomerId: getWalkinCustomerId(db, ctx.tenantId),
  });
});
