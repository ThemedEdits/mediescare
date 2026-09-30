import { can } from '@mediescare/core/permissions';
import { getSyncStatus, salesSummary, stockValueMinor, verifyAuditChain } from '@mediescare/db';
import { pkr } from '@/lib/format';
import { getT } from '@/i18n/server';
import { requirePage } from '@/server/page-auth';
import { getDb } from '@/server/runtime';

export const dynamic = 'force-dynamic';

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ denied?: string }>;
}) {
  const auth = await requirePage();
  const { t } = await getT();
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
          {t('dashboard.denied')}
        </p>
      ) : null}
      {summary ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card
            title={t('dashboard.salesToday')}
            value={`PKR ${pkr(summary.revenueMinor)}`}
            note={
              summary.voidCount
                ? t('dashboard.invoicesVoided', {
                    count: summary.salesCount,
                    voided: summary.voidCount,
                  })
                : t('dashboard.invoices', { count: summary.salesCount })
            }
          />
          {showProfit ? (
            <Card
              title={t('dashboard.grossProfitToday')}
              value={`PKR ${pkr(summary.grossProfitMinor)}`}
              note={t('dashboard.grossProfitNote')}
              bad={summary.grossProfitMinor < 0}
            />
          ) : null}
          {showProfit ? (
            <Card
              title={t('dashboard.discountsToday')}
              value={`PKR ${pkr(summary.discountMinor)}`}
              note={t('dashboard.discountsNote')}
            />
          ) : null}
          {showValue && auth.branchId ? (
            <Card
              title={t('dashboard.stockValue')}
              value={`PKR ${pkr(stockValueMinor(db, auth.branchId))}`}
              note={t('dashboard.stockValueNote')}
            />
          ) : null}
        </div>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card
          title={t('dashboard.signedInAs')}
          value={auth.username}
          note={t('dashboard.permissions', { count: auth.access.permissions.size })}
        />
        <Card
          title={t('dashboard.syncQueue')}
          value={String(sync.pending)}
          note={sync.pending === 0 ? t('dashboard.syncNothing') : t('dashboard.syncWaiting')}
        />
        <Card
          title={t('dashboard.auditChain')}
          value={chain?.ok ? t('dashboard.verified') : t('dashboard.broken')}
          note={
            chain?.ok
              ? t('dashboard.entries', { count: chain.count })
              : chain
                ? t('dashboard.brokenAt', { seq: chain.brokenAtSeq ?? 0 })
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
