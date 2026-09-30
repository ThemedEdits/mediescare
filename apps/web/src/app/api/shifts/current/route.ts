import { getOpenShift } from '@mediescare/db';
import { json, withPermission } from '@/server/guard';
import { getDb, writeContext } from '@/server/runtime';

export const dynamic = 'force-dynamic';

/** The caller's open shift, or null. The expected cash is deliberately not included (blind count). */
export const GET = withPermission('shifts.shift.view', (_request, auth) => {
  const shift = getOpenShift(getDb(), writeContext(auth.userId).branchId, auth.userId);
  return json({
    shift: shift && {
      id: shift.id,
      docNo: shift.docNo,
      openedAt: shift.openedAt,
      floatMinor: shift.floatMinor,
    },
  });
});
