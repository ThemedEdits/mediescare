'use client';

import { useState } from 'react';
import { api, Badge, Button, inputClass, NameDialog, useAsync } from '@/components/ui';
import { useT } from '@/i18n/client';
import { pkr } from '@/lib/format';
import { ReceiveForm, type ReceivePo } from '../stock/receive-form';
import { PoDetail, PO_TONE, useStatusLabel, type PoView } from './po-detail';
import { PoForm, type EditablePo } from './po-form';
import { ReturnForm } from './return-form';
import { ReturnsTab } from './returns-tab';
import { SupplierLedger } from './supplier-ledger';

export interface PurchasingCan {
  viewOrders: boolean;
  createOrder: boolean;
  editOrder: boolean;
  approveOrder: boolean;
  viewBills: boolean;
  receive: boolean;
  viewAccounts: boolean;
  viewReturns: boolean;
  createReturn: boolean;
  pay: boolean;
  addSupplier: boolean;
}

type Tab = 'orders' | 'bills' | 'returns' | 'suppliers';

interface PoRow {
  id: string;
  docNo: string;
  status: PoView['status'];
  supplierName: string;
  expectedDate: string | null;
  lineCount: number;
  subTotalMinor: number;
  createdAt: string;
}
interface BillRow {
  id: string;
  docNo: string;
  supplierName: string;
  supplierInvoiceNo: string | null;
  poDocNo: string | null;
  payableMinor: number;
  paidMinor: number;
  outstandingMinor: number;
  createdAt: string;
}
interface BalanceRow {
  supplierId: string;
  name: string;
  phone: string | null;
  termsDays: number;
  balanceMinor: number;
  lastPaymentAt: string | null;
}

export function PurchasingClient({ branchName, can }: { branchName: string; can: PurchasingCan }) {
  const t = useT();
  const tabs: [Tab, string, boolean][] = [
    ['orders', t('purchasing.tabs.orders'), can.viewOrders],
    ['bills', t('purchasing.tabs.bills'), can.viewBills],
    ['returns', t('purchasing.tabs.returns'), can.viewReturns],
    ['suppliers', t('purchasing.tabs.suppliers'), can.viewAccounts],
  ];
  const visible = tabs.filter(([, , ok]) => ok);
  const [tab, setTab] = useState<Tab>(visible[0]?.[0] ?? 'orders');
  const [toast, setToast] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const refresh = () => setVersion((v) => v + 1);

  const [poForm, setPoForm] = useState<{ order?: EditablePo } | null>(null);
  const [openPo, setOpenPo] = useState<string | null>(null);
  const [receivePo, setReceivePo] = useState<ReceivePo | 'new' | null>(null);
  const [ledger, setLedger] = useState<string | null>(null);
  const [addingSupplier, setAddingSupplier] = useState(false);
  const [returning, setReturning] = useState(false);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">{t('purchasing.title')}</h1>
        <div className="flex gap-2">
          {can.createOrder ? (
            <Button onClick={() => setPoForm({})}>{t('purchasing.actions.newOrder')}</Button>
          ) : null}
          {can.receive ? (
            <Button variant="outline" onClick={() => setReceivePo('new')}>
              {t('purchasing.actions.addStockNoOrder')}
            </Button>
          ) : null}
          {can.createReturn ? (
            <Button variant="outline" onClick={() => setReturning(true)}>
              {t('purchasing.actions.returnToSupplier')}
            </Button>
          ) : null}
        </div>
      </div>
      {toast ? (
        <p role="status" className="rounded-[6px] bg-[#E8F5E9] px-3 py-2 text-sm text-success">
          {toast}
        </p>
      ) : null}

      <div role="tablist" className="flex gap-1 border-b border-border">
        {visible.map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${tab === id ? 'border-primary-600 text-primary-700' : 'border-transparent text-muted hover:text-slate-900'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'orders' ? <OrdersTab version={version} onOpen={setOpenPo} /> : null}
      {tab === 'bills' ? <BillsTab version={version} /> : null}
      {tab === 'returns' ? <ReturnsTab version={version} /> : null}
      {tab === 'suppliers' ? (
        <SuppliersTab
          version={version}
          onOpen={setLedger}
          onAdd={can.addSupplier ? () => setAddingSupplier(true) : undefined}
        />
      ) : null}

      {poForm ? (
        <PoForm
          order={poForm.order}
          onClose={() => setPoForm(null)}
          onSaved={(docNo) => {
            setPoForm(null);
            setToast(
              docNo
                ? t('purchasing.toast.orderSaved', { docNo })
                : t('purchasing.toast.orderUpdated'),
            );
            if (poForm.order) setOpenPo(poForm.order.id);
            refresh();
          }}
        />
      ) : null}
      {openPo && !poForm && !receivePo ? (
        <PoDetail
          id={openPo}
          branchName={branchName}
          canEdit={can.editOrder}
          canApprove={can.approveOrder}
          canReceive={can.receive}
          onClose={() => setOpenPo(null)}
          onChanged={refresh}
          onEdit={(order) => setPoForm({ order })}
          onReceive={setReceivePo}
        />
      ) : null}
      {receivePo ? (
        <ReceiveForm
          canAddSupplier={can.addSupplier}
          po={receivePo === 'new' ? undefined : receivePo}
          onClose={() => setReceivePo(null)}
          onSaved={(docNo) => {
            setReceivePo(null);
            setToast(t('purchasing.toast.stockReceived', { docNo }));
            refresh();
          }}
        />
      ) : null}
      {returning ? (
        <ReturnForm
          onClose={() => setReturning(false)}
          onSaved={(docNo) => {
            setReturning(false);
            setToast(t('purchasing.toast.goodsReturned', { docNo }));
            refresh();
          }}
        />
      ) : null}
      {ledger ? (
        <SupplierLedger
          supplierId={ledger}
          branchName={branchName}
          canPay={can.pay}
          onClose={() => setLedger(null)}
          onChanged={refresh}
        />
      ) : null}
      {addingSupplier ? (
        <NameDialog
          title={t('purchasing.newSupplier')}
          label={t('purchasing.supplierName')}
          onClose={() => setAddingSupplier(false)}
          onSubmit={async (name) => {
            await api('/api/suppliers', { body: { name } });
            setAddingSupplier(false);
            refresh();
          }}
        />
      ) : null}
    </div>
  );
}

const th = 'px-3 py-2';
const tableWrap = 'overflow-x-auto rounded-[10px] border border-border';
const thead = 'bg-surface-2 text-start text-xs uppercase text-muted';

function OrdersTab({ version, onOpen }: { version: number; onOpen: (id: string) => void }) {
  const t = useT();
  const statusLabel = useStatusLabel();
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const { data, error } = useAsync(
    () =>
      api<{ rows: PoRow[]; total: number }>(
        `/api/purchase-orders?pageSize=100${status ? `&status=${status}` : ''}${q ? `&q=${encodeURIComponent(q)}` : ''}`,
      ),
    [status, q, version],
  );
  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <input
          aria-label={t('purchasing.orders.searchAria')}
          className={`${inputClass} max-w-xs`}
          placeholder={t('purchasing.orders.searchPlaceholder')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select
          aria-label={t('common.status')}
          className={`${inputClass} max-w-44`}
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="">{t('purchasing.orders.allStatuses')}</option>
          {(['draft', 'approved', 'partial', 'received', 'cancelled'] as const).map((s) => (
            <option key={s} value={s}>
              {statusLabel(s)}
            </option>
          ))}
        </select>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      <div className={tableWrap}>
        <table className="w-full text-sm">
          <thead className={thead}>
            <tr>
              <th className={th}>{t('purchasing.orders.order')}</th>
              <th>{t('common.date')}</th>
              <th>{t('common.supplier')}</th>
              <th>{t('purchasing.orders.expected')}</th>
              <th className="text-end">{t('purchasing.orders.items')}</th>
              <th className="text-end">{t('purchasing.col.amount')}</th>
              <th className={th}>{t('common.status')}</th>
            </tr>
          </thead>
          <tbody>
            {data?.rows.map((r) => (
              <tr
                key={r.id}
                className="cursor-pointer border-t border-border hover:bg-primary-50"
                onClick={() => onOpen(r.id)}
              >
                <td className={`${th} font-mono text-xs`}>
                  <bdi>{r.docNo}</bdi>
                </td>
                <td>{r.createdAt.slice(0, 10)}</td>
                <td className="font-medium">{r.supplierName}</td>
                <td>{r.expectedDate ?? '–'}</td>
                <td className="text-end tabular-nums">{r.lineCount}</td>
                <td className="text-end tabular-nums">{pkr(r.subTotalMinor)}</td>
                <td className={th}>
                  <Badge tone={PO_TONE[r.status]}>{statusLabel(r.status)}</Badge>
                </td>
              </tr>
            ))}
            {data && data.rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-10 text-center text-muted">
                  {t('purchasing.orders.empty')}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function BillsTab({ version }: { version: number }) {
  const t = useT();
  const [q, setQ] = useState('');
  const [unpaid, setUnpaid] = useState(false);
  const { data, error } = useAsync(
    () =>
      api<{ rows: BillRow[]; total: number }>(
        `/api/grns?pageSize=100${unpaid ? '&unpaidOnly=1' : ''}${q ? `&q=${encodeURIComponent(q)}` : ''}`,
      ),
    [q, unpaid, version],
  );
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <input
          aria-label={t('purchasing.bills.searchAria')}
          className={`${inputClass} max-w-xs`}
          placeholder={t('purchasing.bills.searchPlaceholder')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={unpaid} onChange={(e) => setUnpaid(e.target.checked)} />{' '}
          {t('purchasing.bills.unpaidOnly')}
        </label>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      <div className={tableWrap}>
        <table className="w-full text-sm">
          <thead className={thead}>
            <tr>
              <th className={th}>{t('purchasing.bills.bill')}</th>
              <th>{t('common.date')}</th>
              <th>{t('common.supplier')}</th>
              <th>{t('purchasing.bills.supplierInvoice')}</th>
              <th>{t('purchasing.bills.order')}</th>
              <th className="text-end">{t('purchasing.bills.payable')}</th>
              <th className="text-end">{t('purchasing.bills.paid')}</th>
              <th className={`${th} text-end`}>{t('purchasing.bills.due')}</th>
            </tr>
          </thead>
          <tbody>
            {data?.rows.map((r) => (
              <tr key={r.id} className="border-t border-border">
                <td className={`${th} font-mono text-xs`}>
                  <bdi>{r.docNo}</bdi>
                </td>
                <td>{r.createdAt.slice(0, 10)}</td>
                <td className="font-medium">{r.supplierName}</td>
                <td>
                  <bdi>{r.supplierInvoiceNo ?? '–'}</bdi>
                </td>
                <td className="font-mono text-xs">
                  <bdi>{r.poDocNo ?? '–'}</bdi>
                </td>
                <td className="text-end tabular-nums">{pkr(r.payableMinor)}</td>
                <td className="text-end tabular-nums">{pkr(r.paidMinor)}</td>
                <td className={`${th} text-end font-medium tabular-nums`}>
                  {r.outstandingMinor > 0 ? (
                    pkr(r.outstandingMinor)
                  ) : (
                    <Badge tone="success">{t('purchasing.bills.paid')}</Badge>
                  )}
                </td>
              </tr>
            ))}
            {data && data.rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-3 py-10 text-center text-muted">
                  {t('purchasing.bills.empty')}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SuppliersTab({
  version,
  onOpen,
  onAdd,
}: {
  version: number;
  onOpen: (id: string) => void;
  onAdd?: () => void;
}) {
  const t = useT();
  const [q, setQ] = useState('');
  const [owing, setOwing] = useState(false);
  const { data, error } = useAsync(
    () =>
      api<{ balances: BalanceRow[] }>(
        `/api/suppliers/balances?${owing ? 'onlyOwing=1&' : ''}q=${encodeURIComponent(q)}`,
      ),
    [q, owing, version],
  );
  const totalOwed = data?.balances.reduce((s, b) => s + Math.max(0, b.balanceMinor), 0) ?? 0;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <input
          aria-label={t('purchasing.suppliers.searchAria')}
          className={`${inputClass} max-w-xs`}
          placeholder={t('purchasing.supplierName')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={owing} onChange={(e) => setOwing(e.target.checked)} />{' '}
          {t('purchasing.suppliers.onlyWithBalance')}
        </label>
        {onAdd ? (
          <Button variant="outline" onClick={onAdd}>
            {t('purchasing.suppliers.add')}
          </Button>
        ) : null}
        <p className="ms-auto text-sm text-muted">
          {t('purchasing.suppliers.totalPayable')}{' '}
          <strong className="text-slate-900">
            <bdi>PKR {pkr(totalOwed)}</bdi>
          </strong>
        </p>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      <div className={tableWrap}>
        <table className="w-full text-sm">
          <thead className={thead}>
            <tr>
              <th className={th}>{t('purchasing.suppliers.supplier')}</th>
              <th>{t('purchasing.suppliers.phone')}</th>
              <th className="text-end">{t('purchasing.suppliers.terms')}</th>
              <th>{t('purchasing.suppliers.lastPayment')}</th>
              <th className={`${th} text-end`}>{t('purchasing.suppliers.weOwe')}</th>
            </tr>
          </thead>
          <tbody>
            {data?.balances.map((b) => (
              <tr
                key={b.supplierId}
                className="cursor-pointer border-t border-border hover:bg-primary-50"
                onClick={() => onOpen(b.supplierId)}
              >
                <td className={`${th} font-medium`}>{b.name}</td>
                <td>
                  <bdi>{b.phone ?? '–'}</bdi>
                </td>
                <td className="text-end tabular-nums">
                  {t('purchasing.suppliers.termsDays', { days: b.termsDays })}
                </td>
                <td>{b.lastPaymentAt?.slice(0, 10) ?? '–'}</td>
                <td className={`${th} text-end font-medium tabular-nums`}>{pkr(b.balanceMinor)}</td>
              </tr>
            ))}
            {data && data.balances.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-10 text-center text-muted">
                  {t('purchasing.suppliers.empty')}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
