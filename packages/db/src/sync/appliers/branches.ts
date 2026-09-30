import { and, eq, ne } from 'drizzle-orm';
import { branches } from '../../schema/sqlite';
import { simpleMasterApplier } from './common';
import { APPLY_ORDER, registerApplier } from './registry';

/**
 * Registry of the organisation's branches (code, name, Head Office flag). Comes first in the pull
 * order: every other entity is judged by which branch wrote it.
 *
 * `isHeadOffice` is set when a branch row is created and never changed by a pull. A row that claims
 * to be a second Head Office is stored as a normal branch (there is one Head Office per organisation).
 */
export const applyBranch = simpleMasterApplier({
  table: branches,
  spec: {
    code: 's',
    name: 's',
    isHeadOffice: 'b',
    address: 'sn',
    licenceNo: 'sn',
    ntn: 'sn',
    timezone: 's',
    status: 's',
  },
  required: ['code', 'name'],
  naturalKey: { field: 'code', column: branches.code },
  immutable: ['isHeadOffice'],
  onInsert: (tx, row, env) => {
    if (row.isHeadOffice !== true) return;
    const other = tx
      .select({ id: branches.id })
      .from(branches)
      .where(
        and(
          eq(branches.tenantId, env.tenantId),
          eq(branches.isHeadOffice, true),
          ne(branches.id, String(row.id)),
        ),
      )
      .get();
    if (other) row.isHeadOffice = false;
  },
});

registerApplier('branches', applyBranch, { order: APPLY_ORDER.branches });
