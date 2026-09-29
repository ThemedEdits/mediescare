import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { APP_NAME } from '@mediescare/config';
import {
  getSyncStatus,
  loadAccessContext,
  schema,
  SESSION_COOKIE,
  touchSession,
  verifyAuditChain,
  verifySessionToken,
} from '@mediescare/db';
import { getDb, getRuntime, getSessionSecret, initialized } from '@/server/runtime';
import { SignOutButton } from './sign-out-button';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  if (!initialized()) redirect('/setup');
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const claims = token ? await verifySessionToken(token, getSessionSecret()) : null;
  const db = getDb();
  const session = claims ? touchSession(db, claims.sid, new Date()) : null;
  if (!claims || !session) redirect('/login');

  const user = db.select().from(schema.users).where(eq(schema.users.id, claims.uid)).get();
  const branch = session.branchId ? db.select().from(schema.branches).where(eq(schema.branches.id, session.branchId)).get() : undefined;
  const access = loadAccessContext(db, claims.uid);
  const sync = getSyncStatus(db);
  const chain = session.branchId ? verifyAuditChain(db, session.branchId) : null;
  const mode = getRuntime().mode;

  return (
    <div className="min-h-screen bg-white">
      <header className="flex items-center gap-4 border-b border-border px-6 py-3">
        <img src="/brand/mediescare-icon.svg" alt="" className="h-9" />
        <span className="text-lg font-semibold">{APP_NAME}</span>
        <span className="ms-auto text-sm text-muted">
          {branch?.name} · {mode} · {user?.fullName}
        </span>
        <SignOutButton />
      </header>
      <main className="mx-auto grid max-w-4xl gap-4 p-6 sm:grid-cols-3">
        <Card title="Signed in as" value={user?.username ?? ''} note={`${access?.permissions.size ?? 0} permissions`} />
        <Card
          title="Sync queue"
          value={String(sync.pending)}
          note={sync.pending === 0 ? 'Nothing waiting for the cloud' : 'Waiting for the cloud (works offline)'}
        />
        <Card
          title="Audit chain"
          value={chain?.ok ? 'Verified' : 'BROKEN'}
          note={chain?.ok ? `${chain.count} entries` : chain ? `Broken at entry ${chain.brokenAtSeq}` : ''}
          bad={chain ? !chain.ok : false}
        />
      </main>
    </div>
  );
}

function Card({ title, value, note, bad = false }: { title: string; value: string; note: string; bad?: boolean }) {
  return (
    <section className="rounded-[10px] border border-border bg-surface p-4">
      <h2 className="text-sm text-muted">{title}</h2>
      <p className={`mt-1 text-3xl font-semibold ${bad ? 'text-danger' : ''}`}>{value}</p>
      <p className="mt-1 text-sm text-muted">{note}</p>
    </section>
  );
}
