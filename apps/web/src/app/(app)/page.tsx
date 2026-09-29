import { getSyncStatus, verifyAuditChain } from '@mediescare/db';
import { requirePage } from '@/server/page-auth';
import { getDb } from '@/server/runtime';

export const dynamic = 'force-dynamic';

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ denied?: string }>;
}) {
  const auth = await requirePage();
  const denied = (await searchParams).denied === '1';
  const db = getDb();
  const sync = getSyncStatus(db);
  const chain = auth.branchId ? verifyAuditChain(db, auth.branchId) : null;
  return (
    <main className="mx-auto max-w-4xl space-y-4 p-6">
      {denied ? (
        <p role="alert" className="rounded-[6px] bg-[#FEE2E2] px-4 py-3 text-sm text-danger">
          You do not have permission to open that page.
        </p>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card
          title="Signed in as"
          value={auth.username}
          note={`${auth.access.permissions.size} permissions`}
        />
        <Card
          title="Sync queue"
          value={String(sync.pending)}
          note={
            sync.pending === 0
              ? 'Nothing waiting for the cloud'
              : 'Waiting for the cloud (works offline)'
          }
        />
        <Card
          title="Audit chain"
          value={chain?.ok ? 'Verified' : 'BROKEN'}
          note={
            chain?.ok
              ? `${chain.count} entries`
              : chain
                ? `Broken at entry ${chain.brokenAtSeq}`
                : ''
          }
          bad={chain ? !chain.ok : false}
        />
      </div>
    </main>
  );
}

function Card({
  title,
  value,
  note,
  bad = false,
}: {
  title: string;
  value: string;
  note: string;
  bad?: boolean;
}) {
  return (
    <section className="rounded-[10px] border border-border bg-surface p-4">
      <h2 className="text-sm text-muted">{title}</h2>
      <p className={`mt-1 text-3xl font-semibold ${bad ? 'text-danger' : ''}`}>{value}</p>
      <p className="mt-1 text-sm text-muted">{note}</p>
    </section>
  );
}
