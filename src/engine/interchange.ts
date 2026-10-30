// Import / export: CSV, Excel (XLSX), JSON and SQL scripts.
// Imports go through analyse → map → validate → insert, and every rejected
// row is reported with its reason (nothing is silently discarded).
import * as XLSX from 'xlsx';
import { q, lit } from './sqlite';
import { WowProject, WowError, coerceValue, friendlyError, uid } from './project';
import { inferType, runSql } from './queries';
import type { DataType, FieldDef, TableDef } from './types';

// ---------------- parsing ----------------
export function detectDelimiter(text: string): string {
  const first = text.split(/\r?\n/).slice(0, 5).join('\n');
  const counts = [',', ';', '\t', '|'].map((d) => ({ d, n: first.split(d).length }));
  counts.sort((a, b) => b.n - a.n);
  return counts[0].n > 1 ? counts[0].d : ',';
}

export function parseCSV(text: string, delimiter?: string): string[][] {
  const d = delimiter ?? detectDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [], field = '', i = 0, inQ = false;
  const t = text.replace(/^﻿/, '');
  while (i < t.length) {
    const c = t[i];
    if (inQ) {
      if (c === '"') { if (t[i + 1] === '"') { field += '"'; i += 2; continue; } inQ = false; i++; continue; }
      field += c; i++; continue;
    }
    if (c === '"' && field === '') { inQ = true; i++; continue; }
    if (c === d) { row.push(field); field = ''; i++; continue; }
    if (c === '\r') { i++; continue; }
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
    field += c; i++;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim() !== ''));
}

export function toCSV(columns: string[], rows: unknown[][]): string {
  const esc = (v: unknown) => {
    if (v === null || v === undefined) return '';
    const s = v instanceof Uint8Array ? '[binary]' : String(v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return [columns.map(esc).join(','), ...rows.map((r) => r.map(esc).join(','))].join('\r\n');
}

export interface SheetData { name: string; rows: unknown[][]; }

export function readWorkbook(buf: ArrayBuffer): SheetData[] {
  const wb = XLSX.read(buf, { type: 'array', cellDates: true });
  return wb.SheetNames.map((n) => {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[n], { header: 1, raw: true, defval: null }) as unknown[][];
    return { name: n, rows: rows.map((r) => r.map((v) => (v instanceof Date ? isoOf(v) : v))).filter((r) => r.some((v) => v !== null && v !== '')) };
  });
}
function isoOf(d: Date) {
  const p = (n: number) => String(n).padStart(2, '0');
  const base = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  return d.getHours() || d.getMinutes() ? `${base} ${p(d.getHours())}:${p(d.getMinutes())}:00` : base;
}

export function writeWorkbook(sheets: { name: string; columns: string[]; rows: unknown[][] }[]): Uint8Array {
  const wb = XLSX.utils.book_new();
  for (const s of sheets) {
    const ws = XLSX.utils.aoa_to_sheet([s.columns, ...s.rows.map((r) => r.map((v) => (v instanceof Uint8Array ? '[binary]' : v)))]);
    XLSX.utils.book_append_sheet(wb, ws, s.name.slice(0, 31).replace(/[\\/?*[\]:]/g, '_'));
  }
  return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer);
}

export function parseJSON(text: string): SheetData[] {
  let data: unknown;
  try { data = JSON.parse(text); } catch (e) { throw new WowError('The file is not valid JSON: ' + (e as Error).message); }
  const toRows = (arr: unknown[]): unknown[][] => {
    const objs = arr.filter((x) => x && typeof x === 'object' && !Array.isArray(x)) as Record<string, unknown>[];
    if (!objs.length && arr.every(Array.isArray)) return arr as unknown[][];
    const cols: string[] = [];
    objs.forEach((o) => Object.keys(o).forEach((k) => { if (!cols.includes(k)) cols.push(k); }));
    return [cols, ...objs.map((o) => cols.map((c) => { const v = o[c]; return v !== null && typeof v === 'object' ? JSON.stringify(v) : v; }))];
  };
  if (Array.isArray(data)) return [{ name: 'Sheet1', rows: toRows(data) }];
  if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>;
    const tables = (obj.tables && typeof obj.tables === 'object' ? obj.tables : obj) as Record<string, unknown>;
    const out: SheetData[] = [];
    for (const [k, v] of Object.entries(tables)) if (Array.isArray(v)) out.push({ name: k, rows: toRows(v) });
    if (out.length) return out;
  }
  throw new WowError('JSON must be an array of records, or an object whose properties are arrays of records.');
}

// ---------------- analysis ----------------
export interface ImportColumn {
  index: number;
  source: string;
  target: string;          // field name in the destination ('' = skip)
  type: DataType;
  numberSize?: FieldDef['numberSize'];
  invalid: number;         // values that will not convert to `type`
  samples: unknown[];
}

export function analyse(rows: unknown[][], hasHeader: boolean): ImportColumn[] {
  const width = Math.max(0, ...rows.map((r) => r.length));
  const header = hasHeader ? rows[0] ?? [] : [];
  const body = hasHeader ? rows.slice(1) : rows;
  const cols: ImportColumn[] = [];
  const used = new Set<string>();
  for (let i = 0; i < width; i++) {
    let name = String(header[i] ?? '').trim().replace(/[.!`[\]]/g, '_') || `Field${i + 1}`;
    while (used.has(name.toLowerCase())) name += '_';
    used.add(name.toLowerCase());
    const vals = body.map((r) => r[i]).filter((v) => v !== null && v !== undefined && String(v).trim() !== '');
    const t = suggestType(vals);
    cols.push({ index: i, source: name, target: name, type: t.type, numberSize: t.numberSize, invalid: 0, samples: vals.slice(0, 5) });
  }
  for (const c of cols) c.invalid = countInvalid(body.map((r) => r[c.index]), c);
  return cols;
}

function suggestType(vals: unknown[]): Pick<FieldDef, 'type' | 'numberSize'> {
  if (!vals.length) return { type: 'Short Text' };
  const s = vals.map((v) => String(v).trim());
  if (s.every((v) => /^(true|false|yes|no)$/i.test(v))) return { type: 'Yes/No' };
  if (s.every((v) => /^-?\d+$/.test(v))) return { type: 'Number', numberSize: 'Long Integer' };
  if (s.every((v) => /^-?\d*\.?\d+$/.test(v.replace(/,/g, '')))) return { type: 'Number', numberSize: 'Double' };
  if (s.every((v) => /^\d{4}-\d{1,2}-\d{1,2}([ T]\d{1,2}:\d{2}(:\d{2})?)?$/.test(v) || /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(v))) return { type: 'Date/Time' };
  const t = inferType(vals);
  return { type: t.type, numberSize: t.numberSize };
}

function fieldFor(c: ImportColumn): FieldDef { return { id: 'x', name: c.target || c.source, type: c.type, numberSize: c.numberSize }; }
export function countInvalid(values: unknown[], c: ImportColumn): number {
  const f = fieldFor(c);
  let n = 0;
  for (const v of values) {
    if (v === null || v === undefined || String(v).trim() === '') continue;
    try { coerceValue(f, v); } catch { n++; }
  }
  return n;
}

export interface ImportPlan {
  rows: unknown[][];
  hasHeader: boolean;
  columns: ImportColumn[];
  mode: 'new' | 'append';
  table: string;
  primaryKey: 'none' | 'add' | string;  // 'add' = add AutoNumber ID; or a column name
  duplicateKeys: string[];              // target fields to check for duplicates
  skipDuplicates: boolean;
}

export interface ImportSummary {
  table: string;
  total: number;
  inserted: number;
  failed: { row: number; values: unknown[]; reason: string }[];
  duplicates: number;
  created: boolean;
}

/** Find duplicate key values within the file and against the existing table. */
export function findDuplicates(p: WowProject, plan: ImportPlan): Set<number> {
  const dup = new Set<number>();
  if (!plan.duplicateKeys.length) return dup;
  const body = plan.hasHeader ? plan.rows.slice(1) : plan.rows;
  const idx = plan.duplicateKeys.map((k) => plan.columns.find((c) => c.target === k)?.index ?? -1);
  if (idx.some((i) => i < 0)) return dup;
  const seen = new Set<string>();
  if (plan.mode === 'append' && p.getTable(plan.table)) {
    const r = p.db.query(`SELECT ${plan.duplicateKeys.map(q).join(', ')} FROM ${q(plan.table)}`);
    r.rows.forEach((row) => seen.add(JSON.stringify(row.map((v) => String(v ?? '').toLowerCase()))));
  }
  body.forEach((row, i) => {
    const key = JSON.stringify(idx.map((j) => String(row[j] ?? '').trim().toLowerCase()));
    if (seen.has(key)) dup.add(i); else seen.add(key);
  });
  return dup;
}

export function runImport(p: WowProject, plan: ImportPlan): ImportSummary {
  const mapped = plan.columns.filter((c) => c.target);
  if (!mapped.length) throw new WowError('Choose at least one field to import.');
  const body = plan.hasHeader ? plan.rows.slice(1) : plan.rows;
  let created = false;
  if (plan.mode === 'new') {
    const fields: FieldDef[] = [];
    if (plan.primaryKey === 'add') fields.push({ id: uid('f'), name: mapped.some((c) => c.target.toLowerCase() === 'id') ? 'ImportID' : 'ID', type: 'AutoNumber', primaryKey: true });
    for (const c of mapped) fields.push({ id: uid('f'), name: c.target, type: c.type, numberSize: c.type === 'Number' ? c.numberSize ?? 'Double' : undefined, fieldSize: c.type === 'Short Text' ? 255 : undefined, primaryKey: plan.primaryKey === c.target });
    p.saveTableDesign({ name: plan.table, fields });
    created = true;
  }
  const t = p.getTable(plan.table);
  if (!t) throw new WowError(`The table "${plan.table}" does not exist.`);
  for (const c of mapped) if (!t.fields.some((f) => f.name.toLowerCase() === c.target.toLowerCase())) throw new WowError(`The field "${c.target}" does not exist in "${t.name}".`);
  const dups = plan.skipDuplicates ? findDuplicates(p, plan) : new Set<number>();
  const summary: ImportSummary = { table: t.name, total: body.length, inserted: 0, failed: [], duplicates: dups.size, created };
  p.db.raw.run('SAVEPOINT wow_import');
  try {
    body.forEach((row, i) => {
      if (dups.has(i)) { summary.failed.push({ row: i + 1, values: row, reason: 'Duplicate of an existing key value (skipped)' }); return; }
      const values: Record<string, unknown> = {};
      for (const c of mapped) {
        const f = t.fields.find((x) => x.name.toLowerCase() === c.target.toLowerCase())!;
        const v = row[c.index];
        values[f.name] = v === undefined || (typeof v === 'string' && v.trim() === '' && f.type !== 'Short Text') ? null : v;
      }
      try {
        p.db.raw.run('SAVEPOINT wow_row');
        const cols = Object.keys(values).filter((k) => { const f = t.fields.find((x) => x.name === k)!; return f.type !== 'Calculated' && !(f.type === 'AutoNumber' && values[k] == null); });
        const conv = cols.map((k) => coerceValue(t.fields.find((f) => f.name === k)!, values[k]));
        p.db.raw.run(`INSERT INTO ${q(t.name)} (${cols.map(q).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, conv as never);
        p.db.raw.run('RELEASE wow_row');
        summary.inserted++;
      } catch (e) {
        try { p.db.raw.run('ROLLBACK TO wow_row'); p.db.raw.run('RELEASE wow_row'); } catch { /* ignore */ }
        summary.failed.push({ row: i + 1, values: row, reason: friendlyError(e, p, 'insert', t.name).message });
      }
    });
    p.db.raw.run('RELEASE wow_import');
  } catch (e) {
    try { p.db.raw.run('ROLLBACK TO wow_import'); p.db.raw.run('RELEASE wow_import'); } catch { /* ignore */ }
    throw e;
  }
  p.db.notify();
  return summary;
}

// ---------------- export ----------------
export function exportRows(p: WowProject, source: string): { columns: string[]; rows: unknown[][] } {
  const s = p.sourceSql(source);
  if (s.params.length) throw new WowError(`"${source}" is a parameter query. Run it and export from the results instead.`);
  const r = p.db.query(s.sql);
  const keep = r.columns.map((c, i) => (c === '__rowid' ? -1 : i)).filter((i) => i >= 0);
  return { columns: keep.map((i) => r.columns[i]), rows: r.rows.map((row) => keep.map((i) => row[i])) };
}

export function toJSON(columns: string[], rows: unknown[][]): string {
  return JSON.stringify(rows.map((r) => Object.fromEntries(columns.map((c, i) => [c, r[i] instanceof Uint8Array ? null : r[i]]))), null, 2);
}

/** A portable SQL script for one table or the whole database (schema + data). */
export function sqlDump(p: WowProject, tables?: string[]): string {
  const names = tables ?? p.tableNames();
  // parents before children so foreign keys load cleanly
  const rels = p.relationships().filter((r) => r.enforce);
  const ordered: string[] = [];
  const visit = (n: string, stack: string[] = []) => {
    if (ordered.includes(n) || stack.includes(n)) return;
    for (const r of rels) if (r.relatedTable.toLowerCase() === n.toLowerCase() && names.some((x) => x.toLowerCase() === r.primaryTable.toLowerCase())) visit(r.primaryTable, [...stack, n]);
    ordered.push(n);
  };
  names.forEach((n) => visit(n));
  const out: string[] = [`-- DBWOW SQL export of "${p.name}"`, `-- Created ${new Date().toISOString()}`, 'PRAGMA foreign_keys = OFF;', 'BEGIN TRANSACTION;'];
  for (const n of ordered) {
    const t = p.getTable(n);
    if (!t) continue;
    out.push('', `-- Table: ${t.name}`, `-- DBWOW-TABLE ${JSON.stringify(t)}`, `DROP TABLE IF EXISTS ${q(t.name)};`, p.createTableSql(t));
    const cols = t.fields.filter((f) => f.type !== 'Calculated').map((f) => f.name);
    const r = p.db.query(`SELECT ${cols.map(q).join(', ')} FROM ${q(t.name)}`);
    for (const row of r.rows) out.push(`INSERT INTO ${q(t.name)} (${cols.map(q).join(', ')}) VALUES (${row.map(lit).join(', ')});`);
    out.push(...p.triggerSql(t));
    for (const f of t.fields) {
      if (f.indexed && f.indexed !== 'No' && !(f.primaryKey && t.fields.filter((x) => x.primaryKey).length === 1)) out.push(`CREATE ${f.indexed === 'Yes (No Duplicates)' ? 'UNIQUE ' : ''}INDEX ${q(`ix_${t.name}_${f.name}`)} ON ${q(t.name)} (${q(f.name)});`);
    }
  }
  if (!tables) {
    for (const qd of p.queries()) if (p.viewable(qd)) out.push('', `-- Query: ${qd.name}`, `CREATE VIEW ${q(qd.name)} AS ${p.viewSql(qd)};`);
  }
  out.push('COMMIT;', 'PRAGMA foreign_keys = ON;');
  return out.join('\n');
}

/**
 * Import a SQL script. Statements run inside one transaction; tables created by
 * the script are added to the catalogue. Returns a short report.
 */
export function importSqlScript(p: WowProject, script: string): { statements: number; added: string[] } {
  const cleaned = script.replace(/^\s*PRAGMA\s+foreign_keys\s*=\s*\w+\s*;/gim, '').replace(/^\s*(BEGIN(\s+TRANSACTION)?|COMMIT)\s*;/gim, '');
  const before = new Set(p.tableNames().map((n) => n.toLowerCase()));
  // dropped-and-recreated tables lose their catalogue metadata; keep DBWOW definitions where names match
  const keep = new Map<string, TableDef>(p.tables().map((t) => [t.name.toLowerCase(), t]));
  const res = runSql(p, cleaned);
  void res;
  const added = p.tableNames().filter((n) => !before.has(n.toLowerCase()));
  // restore DBWOW field metadata (Currency, captions, rules...) written by sqlDump
  for (const line of script.split('\n')) {
    const m = /^--\s*DBWOW-TABLE\s+(\{.*\})\s*$/.exec(line.trim());
    if (!m) continue;
    try {
      const def = JSON.parse(m[1]) as TableDef;
      if (p.db.scalar("SELECT count(*) FROM sqlite_master WHERE type='table' AND name=? COLLATE NOCASE", [def.name])) p.putObject('table', def.name, def);
    } catch { /* ignore malformed metadata */ }
  }
  void keep;
  return { statements: cleaned.split(';').filter((s) => s.trim()).length, added };
}
