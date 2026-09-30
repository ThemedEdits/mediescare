import { sql } from 'drizzle-orm';
import type { ReportRow, ReportRunner } from './types';
import { clampLimit, cut, likePattern, num, resolveRange, sumRows } from './util';

export const narcoticRegister: ReportRunner = (db, ctx, filters) => {
  const range = resolveRange(db, ctx, filters, 30);
  const cap = clampLimit(filters.limit, 5_000);
  const like = likePattern(filters.q);
  const found = db.all<{
    at: string;
    doc_no: string;
    item: string;
    qty: number;
    patient: string;
    cnic: string;
    doctor: string;
    rx: string | null;
    sold_by: string | null;
    status: string;
  }>(sql`
    SELECT strftime('%Y-%m-%d %H:%M', n.sold_at, ${range.localMod}) AS at, s.doc_no, i.name AS item,
      n.qty_base AS qty, n.patient_name AS patient, n.patient_cnic AS cnic, n.doctor_name AS doctor,
      n.prescription_ref AS rx, u.full_name AS sold_by, s.status
    FROM narcotic_register n
    JOIN sales s ON s.id = n.sale_id
    JOIN items i ON i.id = n.item_id
    LEFT JOIN users u ON u.id = n.sold_by
    WHERE n.branch_id = ${ctx.branchId} AND n.sold_at >= ${range.startIso} AND n.sold_at < ${range.endIso}
      ${
        like
          ? sql`AND (lower(i.name) LIKE ${like} ESCAPE '\\' OR lower(n.patient_name) LIKE ${like} ESCAPE '\\'
            OR lower(n.doctor_name) LIKE ${like} ESCAPE '\\' OR lower(s.doc_no) LIKE ${like} ESCAPE '\\')`
          : sql``
      }
    ORDER BY n.sold_at DESC
    LIMIT ${cap + 1}`);
  const { rows: page, truncated } = cut(found, cap);
  const rows: ReportRow[] = page.map((r) => ({
    time: r.at,
    docNo: r.doc_no,
    item: r.item,
    qty: num(r.qty),
    patient: r.patient,
    cnic: r.cnic,
    doctor: r.doctor,
    prescriptionRef: r.rx,
    soldBy: r.sold_by,
    status: r.status === 'void' ? 'Void' : 'Posted',
  }));
  return {
    id: 'narcotic-register',
    title: 'Narcotic register',
    columns: [
      { key: 'time', label: 'Date and time', type: 'datetime' },
      { key: 'docNo', label: 'Invoice', type: 'text' },
      { key: 'item', label: 'Item', type: 'text' },
      { key: 'qty', label: 'Quantity', type: 'qty', align: 'end' },
      { key: 'patient', label: 'Patient', type: 'text' },
      { key: 'cnic', label: 'CNIC', type: 'text' },
      { key: 'doctor', label: 'Doctor', type: 'text' },
      { key: 'prescriptionRef', label: 'Prescription', type: 'text' },
      { key: 'soldBy', label: 'Sold by', type: 'text' },
      { key: 'status', label: 'Invoice status', type: 'text' },
    ],
    rows,
    totals: sumRows(rows, ['qty']),
    note: 'Controlled-drug sales. Entries of voided invoices stay in the register and are marked Void.',
    truncated,
  };
};

export const missedSales: ReportRunner = (db, ctx, filters) => {
  const range = resolveRange(db, ctx, filters, 30);
  const cap = clampLimit(filters.limit, 5_000);
  const like = likePattern(filters.q);
  const found = db.all<{ name: string | null; qty: number; n: number; phones: string | null }>(sql`
    SELECT COALESCE(i.name, MAX(m.item_text)) AS name, SUM(m.qty) AS qty, COUNT(*) AS n,
      group_concat(DISTINCT m.customer_phone) AS phones
    FROM missed_sales m LEFT JOIN items i ON i.id = m.item_id
    WHERE m.branch_id = ${ctx.branchId} AND m.created_at >= ${range.startIso} AND m.created_at < ${range.endIso}
      ${like ? sql`AND lower(COALESCE(i.name, m.item_text, '')) LIKE ${like} ESCAPE '\\'` : sql``}
    GROUP BY COALESCE(m.item_id, 'text:' || lower(trim(m.item_text)))
    ORDER BY n DESC, name
    LIMIT ${cap + 1}`);
  const { rows: page, truncated } = cut(found, cap);
  const rows: ReportRow[] = page.map((r) => ({
    item: r.name ?? 'Unnamed',
    qty: num(r.qty),
    count: num(r.n),
    phones: r.phones ? r.phones.split(',').join(', ') : null,
  }));
  return {
    id: 'missed-sales',
    title: 'Missed sales',
    columns: [
      { key: 'item', label: 'Item', type: 'text' },
      { key: 'qty', label: 'Quantity asked', type: 'qty', align: 'end' },
      { key: 'count', label: 'Times asked', type: 'qty', align: 'end' },
      { key: 'phones', label: 'Customer phones', type: 'text' },
    ],
    rows,
    totals: sumRows(rows, ['qty', 'count']),
    note: 'Items customers asked for that were not available, most asked first. Use it to decide what to order.',
    truncated,
  };
};
