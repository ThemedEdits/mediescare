import { and, eq, like } from 'drizzle-orm';
import type Database from 'better-sqlite3';
import type { Db } from '../client';
import { auditLog, branches } from '../schema/sqlite';

/**
 * Database side of "a new branch PC joins an existing organisation" (docs/multi-branch.md).
 *
 * The join is built in a separate staging database file so that nothing half-made ever exists in the
 * live one: enroll, create the local rows, pull every master record, check the result. Only when all
 * of that worked is the staging content copied into the (still empty) live database in ONE
 * transaction. Any failure before that leaves the live database untouched and the staging file is
 * simply deleted, so the owner can retry.
 */

interface MasterRow {
  name: string;
  type: string;
  sql: string | null;
}

/** Tables to copy: real tables and the search index, not SQLite internals, migration bookkeeping or FTS shadow tables. */
function tablesToCopy(raw: Database.Database): string[] {
  const rows = raw
    .prepare(`SELECT name, type, sql FROM sqlite_master WHERE type = 'table' ORDER BY name`)
    .all() as MasterRow[];
  const virtual = rows.filter((r) => /CREATE VIRTUAL TABLE/i.test(r.sql ?? '')).map((r) => r.name);
  return rows
    .filter((r) => !r.name.startsWith('sqlite_') && !r.name.startsWith('__drizzle'))
    .filter((r) => !virtual.some((v) => r.name.startsWith(`${v}_`)))
    .map((r) => r.name);
}

const quote = (name: string) => `"${name.replace(/"/g, '""')}"`;

/**
 * Copy every row of the staging database into the live one, atomically. The live database must be
 * empty (not yet set up): this refuses to merge into existing data. Foreign keys are checked at the
 * end of the transaction, so table order does not matter.
 */
export function copyStagedDatabase(
  staged: Database.Database,
  live: Database.Database,
): { tables: number; rows: number } {
  const tables = tablesToCopy(staged);
  let rows = 0;
  const run = live.transaction(() => {
    live.pragma('defer_foreign_keys = ON');
    for (const table of tables) {
      const existing = live.prepare(`SELECT count(*) AS n FROM ${quote(table)}`).get() as {
        n: number;
      };
      if (existing.n > 0) throw new Error(`The live database is not empty (table ${table})`);
      const cols = (
        staged.prepare(`SELECT * FROM ${quote(table)} LIMIT 0`).columns() as { name: string }[]
      ).map((c) => c.name);
      const insert = live.prepare(
        `INSERT INTO ${quote(table)} (${cols.map(quote).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
      );
      for (const row of staged
        .prepare(`SELECT * FROM ${quote(table)}`)
        .raw()
        .iterate()) {
        insert.run(row as unknown[]);
        rows += 1;
      }
    }
  });
  run();
  return { tables: tables.length, rows };
}

export interface JoinExpectation {
  tenantId: string;
  branchId: string;
  branchCode: string;
}

/**
 * Sanity checks on the staged database before it goes live. Returns a message for the owner when
 * something is wrong, or null when it is fine.
 */
export function verifyJoinedDatabase(db: Db, expected: JoinExpectation): string | null {
  const rows = db.select().from(branches).where(eq(branches.tenantId, expected.tenantId)).all();
  const me = rows.find((b) => b.id === expected.branchId);
  if (!me || me.code !== expected.branchCode)
    return 'The branch record is missing after the first sync';
  if (!rows.some((b) => b.isHeadOffice))
    return 'Head Office has not shared its branch list yet. Make sure Head Office is connected to the cloud and try again';
  const clash = db
    .select({ id: auditLog.id })
    .from(auditLog)
    .where(
      and(
        eq(auditLog.action, 'sync.apply'),
        eq(auditLog.entityType, 'branches'),
        like(auditLog.newJson, '%unique_key_taken%'),
      ),
    )
    .get();
  if (clash)
    return 'Head Office and the cloud disagree about this branch (same code, different record). Ask the administrator to check the branch in the cloud';
  return null;
}
