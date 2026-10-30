// Thin wrapper around sql.js (the real SQLite engine compiled to WebAssembly).
// Every data operation in WOWDB goes through this class. Nothing is simulated.
import initSqlJs, { type Database, type SqlJsStatic, type SqlValue } from 'sql.js';
import type { QueryResult } from './types';

export type WasmSource = { wasmBinary?: ArrayBuffer | Uint8Array; locateFile?: (f: string) => string };
let wasmSource: WasmSource = { locateFile: (f: string) => f };
let sqlPromise: Promise<SqlJsStatic> | null = null;

/** Platform entry points call this before the first database is opened. */
export function configureWasm(src: WasmSource) { wasmSource = src; sqlPromise = null; }

export function loadSqlJs(): Promise<SqlJsStatic> {
  if (!sqlPromise) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sqlPromise = initSqlJs(wasmSource as any);
  }
  return sqlPromise;
}

export type Params = SqlValue[] | Record<string, SqlValue>;

export class WowDatabase {
  readonly raw: Database;
  private listeners = new Set<() => void>();
  constructor(raw: Database) {
    this.raw = raw;
    this.raw.run('PRAGMA foreign_keys = ON;');
  }

  static async create(bytes?: Uint8Array): Promise<WowDatabase> {
    const SQL = await loadSqlJs();
    return new WowDatabase(bytes ? new SQL.Database(bytes) : new SQL.Database());
  }

  /** Subscribe to "database changed" notifications (used for autosave). */
  onChange(fn: () => void) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  notify() { this.listeners.forEach((l) => l()); }

  /** Run a statement that returns rows. Always parameterised. */
  query(sql: string, params?: Params): QueryResult {
    const t0 = now();
    const stmt = this.raw.prepare(sql);
    try {
      if (params) stmt.bind(params as never);
      const columns = stmt.getColumnNames();
      const rows: unknown[][] = [];
      while (stmt.step()) rows.push(stmt.get());
      return { columns, rows, ms: now() - t0 };
    } finally {
      stmt.free();
    }
  }

  /** Rows as objects keyed by column name. */
  all<T = Record<string, unknown>>(sql: string, params?: Params): T[] {
    const r = this.query(sql, params);
    return r.rows.map((row) => Object.fromEntries(r.columns.map((c, i) => [c, row[i]])) as T);
  }

  get<T = Record<string, unknown>>(sql: string, params?: Params): T | undefined {
    return this.all<T>(sql, params)[0];
  }

  scalar(sql: string, params?: Params): unknown {
    const r = this.query(sql, params);
    return r.rows[0]?.[0];
  }

  /** Run a statement that changes data. Returns number of changed rows. */
  run(sql: string, params?: Params, silent = false): number {
    this.raw.run(sql, params as never);
    const n = this.raw.getRowsModified();
    if (!silent) this.notify();
    return n;
  }

  /** Execute a multi-statement script (used by SQL import, schema rebuilds). */
  exec(sql: string, silent = false): QueryResult[] {
    const t0 = now();
    const res = this.raw.exec(sql);
    const ms = now() - t0;
    if (!silent) this.notify();
    return res.map((r) => ({ columns: r.columns, rows: r.values, ms }));
  }

  lastInsertRowid(): number { return Number(this.scalar('SELECT last_insert_rowid()')); }

  /** Run fn in a transaction; rolls back on error. */
  transaction<T>(fn: () => T): T {
    this.raw.run('SAVEPOINT wow_tx');
    try {
      const r = fn();
      this.raw.run('RELEASE wow_tx');
      this.notify();
      return r;
    } catch (e) {
      try { this.raw.run('ROLLBACK TO wow_tx'); this.raw.run('RELEASE wow_tx'); } catch { /* ignore */ }
      throw e;
    }
  }

  export(): Uint8Array {
    // sql.js export() resets pragmas; re-enable foreign keys afterwards
    const bytes = this.raw.export();
    this.raw.run('PRAGMA foreign_keys = ON;');
    return bytes;
  }

  close() { this.raw.close(); }
}

export function q(id: string): string { return '"' + String(id).replace(/"/g, '""') + '"'; }
export function lit(v: unknown): string {
  if (v === null || v === undefined || v === '') return 'NULL';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
  if (typeof v === 'boolean') return v ? '1' : '0';
  if (v instanceof Uint8Array) return "X'" + Array.from(v).map((b) => b.toString(16).padStart(2, '0')).join('') + "'";
  return "'" + String(v).replace(/'/g, "''") + "'";
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}
