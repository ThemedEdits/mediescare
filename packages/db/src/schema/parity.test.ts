import { getTableConfig as pgConfig, type PgTable } from 'drizzle-orm/pg-core';
import { getTableConfig as sqliteConfig, type SQLiteTable } from 'drizzle-orm/sqlite-core';
import { getTableName, is, Table } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import * as pg from './pg';
import * as sqlite from './sqlite';

function tables<T extends Table>(mod: Record<string, unknown>): T[] {
  return Object.values(mod).filter((v): v is T => is(v, Table));
}

const sqliteTables = tables<SQLiteTable>(sqlite).map((t) => ({ name: getTableName(t), cfg: sqliteConfig(t) }));
const pgTables = tables<PgTable>(pg).map((t) => ({ name: getTableName(t), cfg: pgConfig(t) }));
const localOnly = new Set<string>(sqlite.LOCAL_ONLY_TABLES);

describe('SQLite and Postgres schema parity', () => {
  it('has the same tables (except the declared local-only ones)', () => {
    const shared = sqliteTables.map((t) => t.name).filter((n) => !localOnly.has(n)).sort();
    expect(pgTables.map((t) => t.name).sort()).toEqual(shared);
  });

  it('never lists a local-only table in Postgres', () => {
    for (const name of localOnly) expect(pgTables.map((t) => t.name)).not.toContain(name);
  });

  for (const s of sqliteTables.filter((t) => !localOnly.has(t.name))) {
    it(`table ${s.name}: same columns, nullability and primary key`, () => {
      const p = pgTables.find((t) => t.name === s.name);
      expect(p, `missing in Postgres: ${s.name}`).toBeDefined();
      const shape = (cols: { name: string; notNull: boolean; primary: boolean }[]) =>
        cols.map((c) => `${c.name}:${c.notNull ? 'req' : 'opt'}:${c.primary ? 'pk' : ''}`).sort();
      expect(shape(p!.cfg.columns)).toEqual(shape(s.cfg.columns));
    });
  }

  it('uses snake_case for every column and table name', () => {
    for (const t of sqliteTables) {
      expect(t.name).toMatch(/^[a-z][a-z0-9_]*$/);
      for (const c of t.cfg.columns) expect(c.name).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });

  it('has no auto-increment primary keys', () => {
    for (const t of sqliteTables) {
      for (const c of t.cfg.columns) {
        if (c.primary) expect(c.getSQLType()).not.toBe('integer');
      }
    }
  });
});
