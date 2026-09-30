'use client';

import { useState } from 'react';
import { api, Badge, Button, inputClass, NameDialog, useAsync } from '@/components/ui';
import { pkr } from '@/lib/format';
import { ReceiveForm, type ReceivePo } from '../stock/receive-form';
import { PoDetail, PO_TONE, type PoView } from './po-detail';
import { PoForm, type EditablePo } from './po-form';
import { SupplierLedger } from './supplier-ledger';

export interface PurchasingCan {
  viewOrders: boolean;
  createOrder: boolean;
  editOrder: boolean;
  approveOrder: boolean;
  viewBills: boolean;
  receive: boolean;
  viewAccounts: boolean;
  pay: boolean;
  addSupplier: boolean;
}

type Tab = 'orders' | 'bills' | 'suppliers';

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
  const tabs: [Tab, string, boolean][] = [
    ['orders', 'Purchase orders', can.viewOrders],
    ['bills', 'Supplier bills', can.viewBills],
    ['suppliers', 'Suppliers & payments', can.viewAccounts],
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

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Purchasing</h1>
        <div className="flex gap-2">
          {can.createOrder ? (
            <Button onClick={() => setPoForm({})}>New purchase order</Button>
          ) : null}
          {can.receive ? (
            <Button variant="outline" onClick={() => setReceivePo('new')}>
              Add stock without an order
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
            setToast(docNo ? `Order ${docNo} saved as a draft.` : 'Order updated.');
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
            setToast(`Stock received as ${docNo}.`);
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
          title="New supplier"
          label="Supplier name"
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
const thead = 'bg-surface-2 text-left text-xs uppercase text-muted';

function OrdersTab({ version, onOpen }: { version: number; onOpen: (id: string) => void }) {
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
          aria-label="Search orders"
          className={`${inputClass} max-w-xs`}
          placeholder="Order no. or supplier"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select
          aria-label="Status"
          className={`${inputClass} max-w-44`}
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="">All statuses</option>
          {(['draft', 'approved', 'partial', 'received', 'cancelled'] as const).map((s) => (
            <option key={s} value={s}>
              {s}
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
              <th className={th}>Order</th>
              <th>Date</th>
              <th>Supplier</th>
              <th>Expected</th>
              <th className="text-end">Items</th>
              <th className="text-end">Amount</th>
              <th className={th}>Status</th>
            </tr>
          </thead>
          <tbody>
            {data?.rows.map((r) => (
              <tr
                key={r.id}
                className="cursor-pointer border-t border-border hover:bg-primary-50"
                onClick={() => onOpen(r.id)}
              >
                <td className={`${th} font-mono text-xs`}>{r.docNo}</td>
                <td>{r.createdAt.slice(0, 10)}</td>
                <td className="font-medium">{r.supplierName}</td>
                <td>{r.expectedDate ?? '–'}</td>
                <td className="text-end tabular-nums">{r.lineCount}</td>
                <td className="text-end tabular-nums">{pkr(r.subTotalMinor)}</td>
                <td className={th}>
                  <Badge tone={PO_TONE[r.status]}>{r.status}</Badge>
                </td>
              </tr>
            ))}
            {data && data.rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-10 text-center text-muted">
                  No purchase orders yet. Create one, or use “Fill from low stock” inside it.
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
          aria-label="Search bills"
          className={`${inputClass} max-w-xs`}
          placeholder="Bill no., invoice no. or supplier"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={unpaid} onChange={(e) => setUnpaid(e.target.checked)} />{' '}
          Unpaid only
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
              <th className={th}>Bill</th>
              <th>Date</th>
              <th>Supplier</th>
              <th>Supplier invoice</th>
              <th>Order</th>
              <th className="text-end">Payable</th>
              <th className="text-end">Paid</th>
              <th className={`${th} text-end`}>Due</th>
            </tr>
          </thead>
          <tbody>
            {data?.rows.map((r) => (
              <tr key={r.id} className="border-t border-border">
                <td className={`${th} font-mono text-xs`}>{r.docNo}</td>
                <td>{r.createdAt.slice(0, 10)}</td>
                <td className="font-medium">{r.supplierName}</td>
                <td>{r.supplierInvoiceNo ?? '–'}</td>
                <td className="font-mono text-xs">{r.poDocNo ?? '–'}</td>
                <td className="text-end tabular-nums">{pkr(r.payableMinor)}</td>
                <td className="text-end tabular-nums">{pkr(r.paidMinor)}</td>
                <td className={`${th} text-end font-medium tabular-nums`}>
                  {r.outstandingMinor > 0 ? (
                    pkr(r.outstandingMinor)
                  ) : (
                    <Badge tone="success">Paid</Badge>
                  )}
                </td>
              </tr>
            ))}
            {data && data.rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-3 py-10 text-center text-muted">
                  No supplier bills found.
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
          aria-label="Search suppliers"
          className={`${inputClass} max-w-xs`}
          placeholder="Supplier name"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={owing} onChange={(e) => setOwing(e.target.checked)} />{' '}
          Only with a balance
        </label>
        {onAdd ? (
          <Button variant="outline" onClick={onAdd}>
            Add supplier
          </Button>
        ) : null}
        <p className="ms-auto text-sm text-muted">
          Total payable: <strong className="text-slate-900">PKR {pkr(totalOwed)}</strong>
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
              <th className={th}>Supplier</th>
              <th>Phone</th>
              <th className="text-end">Terms</th>
              <th>Last payment</th>
              <th className={`${th} text-end`}>We owe</th>
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
                <td>{b.phone ?? '–'}</td>
                <td className="text-end tabular-nums">{b.termsDays} d</td>
                <td>{b.lastPaymentAt?.slice(0, 10) ?? '–'}</td>
                <td className={`${th} text-end font-medium tabular-nums`}>{pkr(b.balanceMinor)}</td>
              </tr>
            ))}
            {data && data.balances.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-10 text-center text-muted">
                  No suppliers found.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
