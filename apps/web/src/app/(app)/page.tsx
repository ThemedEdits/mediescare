import { can } from '@mediescare/core/permissions';
import { getSyncStatus, salesSummary, stockValueMinor, verifyAuditChain } from '@mediescare/db';
import { pkr } from '@/lib/format';
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

  // Today in the branch time zone (Karachi) as a UTC range.
  const day = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Karachi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const canSales = can(auth.access, 'pharmacy.sale.view');
  const summary =
    canSales && auth.branchId
      ? salesSummary(
          db,
          auth.branchId,
          new Date(`${day}T00:00:00+05:00`).toISOString(),
          new Date(`${day}T23:59:59.999+05:00`).toISOString(),
        )
      : null;
  // Cost and profit are shown only to roles with the matching right (permissions-matrix.md §4).
  const showProfit = can(auth.access, 'pharmacy.sale.view_profit');
  const showValue = can(auth.access, 'inventory.stock.view_cost') && !!auth.branchId;

  return (
    <main className="mx-auto max-w-5xl space-y-4 p-6">
      {denied ? (
        <p role="alert" className="rounded-[6px] bg-[#FEE2E2] px-4 py-3 text-sm text-danger">
          You do not have permission to open that page.
        </p>
      ) : null}
      {summary ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card
            title="Sales today"
            value={`PKR ${pkr(summary.revenueMinor)}`}
            note={`${summary.salesCount} invoices${summary.voidCount ? `, ${summary.voidCount} voided` : ''}`}
          />
          {showProfit ? (
            <Card
              title="Gross profit today"
              value={`PKR ${pkr(summary.grossProfitMinor)}`}
              note="Sales without tax minus batch cost"
              bad={summary.grossProfitMinor < 0}
            />
          ) : null}
          {showProfit ? (
            <Card
              title="Discounts today"
              value={`PKR ${pkr(summary.discountMinor)}`}
              note="Given at the counter"
            />
          ) : null}
          {showValue && auth.branchId ? (
            <Card
              title="Stock value"
              value={`PKR ${pkr(stockValueMinor(db, auth.branchId))}`}
              note="At batch cost"
            />
          ) : null}
        </div>
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
