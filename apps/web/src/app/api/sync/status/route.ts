import { getSyncStatus } from '@mediescare/db';
import { json, withPermission } from '@/server/guard';
import { getDb } from '@/server/runtime';

export const dynamic = 'force-dynamic';

export const GET = withPermission('admin.sync.view', () => json(getSyncStatus(getDb())));
