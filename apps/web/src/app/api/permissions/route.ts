import { permissionCatalogue } from '@mediescare/db';
import { json, withPermission } from '@/server/guard';

export const dynamic = 'force-dynamic';

/** The full permission catalogue, grouped for the role editor. */
export const GET = withPermission('admin.role.view', () => json({ groups: permissionCatalogue() }));
