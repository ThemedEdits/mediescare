import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { can, type AccessContext, type PermissionKey } from '@mediescare/core';
import {
  loadAccessContext,
  schema,
  SESSION_COOKIE,
  touchSession,
  verifySessionToken,
  type AuthMethod,
} from '@mediescare/db';
import { getDb, getRuntime, getSessionSecret, initialized } from './runtime';

export interface PageAuth {
  userId: string;
  sessionId: string;
  username: string;
  fullName: string;
  language: string;
  method: AuthMethod;
  access: AccessContext;
  branchId: string | null;
  branchName: string | null;
  mode: string;
  mustChangePassword: boolean;
}

/**
 * Guard for server-rendered pages. Sends the visitor to setup, login or change-password as needed,
 * and to the dashboard when a permission is missing. The API re-checks everything on each call.
 */
export async function requirePage(
  permission?: PermissionKey,
  options: { allowPendingPasswordChange?: boolean } = {},
): Promise<PageAuth> {
  if (!initialized()) redirect('/setup');
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const claims = token ? await verifySessionToken(token, getSessionSecret()) : null;
  const db = getDb();
  const session = claims ? touchSession(db, claims.sid, new Date()) : null;
  if (!claims || !session || session.userId !== claims.uid) redirect('/login');
  const access = loadAccessContext(db, claims.uid);
  if (!access) redirect('/login');
  const user = db.select().from(schema.users).where(eq(schema.users.id, claims.uid)).get();
  if (!user) redirect('/login');
  if (user.mustChangePassword && !options.allowPendingPasswordChange) redirect('/change-password');
  const branch = session.branchId
    ? db.select().from(schema.branches).where(eq(schema.branches.id, session.branchId)).get()
    : undefined;
  const method = session.authMethod as AuthMethod;
  if (
    permission &&
    (!can(access, permission) || (method === 'pin' && permission.startsWith('admin.')))
  )
    redirect('/?denied=1');
  return {
    userId: user.id,
    sessionId: session.id,
    username: user.username,
    fullName: user.fullName,
    language: user.language,
    method,
    access,
    branchId: session.branchId,
    branchName: branch?.name ?? null,
    mode: getRuntime().mode,
    mustChangePassword: user.mustChangePassword,
  };
}

export interface NavItem {
  href: string;
  label: string;
}

/** Menu entries the user may open. Hiding is cosmetic: every page and API checks the permission again. */
export function navFor(auth: PageAuth): NavItem[] {
  const items: (NavItem & { permission?: PermissionKey; adminOnly?: boolean })[] = [
    { href: '/', label: 'Dashboard' },
    { href: '/pos', label: 'POS', permission: 'pharmacy.sale.create' },
    { href: '/sales', label: 'Sales', permission: 'pharmacy.sale.view' },
    { href: '/items', label: 'Items', permission: 'pharmacy.item.view' },
    { href: '/stock', label: 'Stock', permission: 'inventory.stock.view' },
    { href: '/purchasing', label: 'Purchasing', permission: 'purchasing.supplier.view' },
    { href: '/reports', label: 'Reports', permission: 'reports.sales.view' },
    { href: '/users', label: 'Users', permission: 'admin.user.view', adminOnly: true },
    { href: '/roles', label: 'Roles', permission: 'admin.role.view', adminOnly: true },
    { href: '/backups', label: 'Backups', permission: 'admin.backup.view', adminOnly: true },
  ];
  return items
    .filter(
      (i) =>
        !i.permission ||
        (can(auth.access, i.permission) && !(auth.method === 'pin' && i.adminOnly)),
    )
    .map(({ href, label }) => ({ href, label }));
}
