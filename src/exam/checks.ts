// Practical-test marking.
//
// Each task in a test carries a declarative check (plain data, so it can be
// stored with the test and kept away from students). grade() runs every check
// against the student's real database and returns marks with a short reason a
// teacher can read. Nothing is changed in the student's database: any SQL is
// run inside a savepoint that is rolled back.
import type { WowProject } from '@/engine/project';
import type { DataType, FormDef, QueryDef, ReportDef } from '@/engine/types';
import { queryParameters, runSql } from '@/engine/queries';

export type Check =
  | { kind: 'table'; table: string }
  | { kind: 'field'; table: string; field: string; type?: DataType }
  | { kind: 'primaryKey'; table: string; fields: string[] }
  | { kind: 'records'; table: string; min: number; max?: number }
  | { kind: 'recordExists'; table: string; field: string; value: string }
  | { kind: 'validation'; table: string; field: string; rejects?: string }
  | { kind: 'relationship'; primary: string; related: string; enforce?: boolean; cascadeDelete?: boolean; cascadeUpdate?: boolean }
  | { kind: 'queryResult'; sql: string; query?: string; ordered?: boolean }
  | { kind: 'queryUses'; query?: string; contains: string }
  | { kind: 'parameter'; sql: string; value: string; query?: string }
  | { kind: 'form'; source?: string; fields?: string[]; name?: string }
  | { kind: 'report'; source?: string; groupField?: string; total?: boolean; name?: string }
  | { kind: 'sql'; sql: string; label: string };

export interface ExamTask { id: string; text: string; marks: number; check: Check; }
export interface TaskResult { id: string; marks: number; max: number; ok: boolean; reason: string; }
export interface GradeResult { score: number; max: number; tasks: TaskResult[]; }

const eq = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
const q = (s: string) => `"${s.replace(/"/g, '""')}"`;

/** Run read-only SQL against the student database without keeping any change. */
function sandbox<T>(p: WowProject, fn: () => T): T {
  p.db.raw.run('SAVEPOINT wow_grade');
  try { return fn(); } finally { p.db.raw.run('ROLLBACK TO wow_grade'); p.db.raw.run('RELEASE wow_grade'); }
}

function norm(v: unknown): string {
  if (v === null || v === undefined || v === '') return '∅';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(Math.round(v * 1e4) / 1e4);
  const s = String(v).trim();
  if (/^-?\d+(\.\d+)?$/.test(s)) return norm(Number(s));
  return s.toLowerCase();
}
function rowsOf(p: WowProject, sql: string, values: Record<string, unknown> = {}): { columns: string[]; rows: string[][] } | string {
  try {
    const r = sandbox(p, () => runSql(p, sql, values));
    if (r.kind !== 'rows') return 'does not return rows';
    return { columns: r.columns, rows: r.rows.map((row) => row.map(norm)) };
  } catch (e) { return (e as Error).message; }
}
function sameRows(a: string[][], b: string[][], ordered: boolean) {
  if (a.length !== b.length) return false;
  const key = (r: string[]) => r.join('\u0001');
  if (ordered) return a.every((r, i) => key(r) === key(b[i]));
  const x = a.map(key).sort(), y = b.map(key).sort();
  return x.every((k, i) => k === y[i]);
}
/** Same rows whichever order the student put the columns in. When the answer
 * is sorted, rows that tie on the sort column may come in any order: the
 * student's rows must be the same set, with the sort column in the same order. */
function sameRowsAnyColumnOrder(model: string[][], got: string[][], ordered: boolean, sortCol = -1) {
  if (!model.length || !got.length) return sameRows(model, got, ordered);
  const n = model[0].length;
  if (got[0].length !== n) return false;
  // map each model column to a student column with identical values
  const colOf = (rows: string[][], i: number) => rows.map((r) => r[i]).sort().join('\u0001');
  const used = new Set<number>(); const perm: number[] = [];
  for (let i = 0; i < n; i++) {
    const want = colOf(model, i);
    const j = [...Array(n).keys()].find((k) => !used.has(k) && colOf(got, k) === want);
    if (j === undefined) return false;
    used.add(j); perm.push(j);
  }
  const mapped = got.map((r) => perm.map((j) => r[j]));
  if (sameRows(model, mapped, ordered)) return true;
  if (!ordered || sortCol < 0 || !sameRows(model, mapped, false)) return false;
  return model.every((r, i) => r[sortCol] === mapped[i][sortCol]);
}
/** Index (in the answer's columns) of the first ORDER BY column, or -1. */
function sortColumn(sql: string, columns: string[]): number {
  const m = /\border\s+by\s+([^,;\n]+)/i.exec(sql); if (!m) return -1;
  let term = m[1].trim().replace(/\s+(asc|desc)\s*$/i, '').trim();
  if (/^\d+$/.test(term)) return Number(term) - 1;
  term = term.replace(/^[\w"\[\]]+\./, '').replace(/^["[]|["\]]$/g, '').toLowerCase();
  return columns.findIndex((c) => c.toLowerCase() === term || c.toLowerCase().endsWith('.' + term));
}

function queries(p: WowProject, name?: string): QueryDef[] {
  const all = p.listObjects('query').map((o) => p.getQuery(o.name)).filter((x): x is QueryDef => !!x);
  return name ? all.filter((x) => eq(x.name, name)) : all;
}
function tableName(p: WowProject, t: string) { return p.tables().find((x) => eq(x.name, t))?.name; }

export function runCheck(p: WowProject, c: Check): { ok: boolean; reason: string } {
  const pass = (reason: string) => ({ ok: true, reason });
  const fail = (reason: string) => ({ ok: false, reason });
  switch (c.kind) {
    case 'table': { const t = tableName(p, c.table); return t ? pass(`Table ${t} exists.`) : fail(`No table called ${c.table}.`); }
    case 'field': {
      const t = p.tables().find((x) => eq(x.name, c.table)); if (!t) return fail(`No table called ${c.table}.`);
      const f = t.fields.find((x) => eq(x.name, c.field)); if (!f) return fail(`${t.name} has no field ${c.field}.`);
      if (c.type && f.type !== c.type) return fail(`${t.name}.${f.name} is ${f.type}, expected ${c.type}.`);
      return pass(`${t.name}.${f.name}${c.type ? ` is ${c.type}` : ' exists'}.`);
    }
    case 'primaryKey': {
      const t = p.tables().find((x) => eq(x.name, c.table)); if (!t) return fail(`No table called ${c.table}.`);
      const pk = t.fields.filter((f) => f.primaryKey).map((f) => f.name.toLowerCase()).sort();
      const want = c.fields.map((f) => f.toLowerCase()).sort();
      return pk.join(',') === want.join(',') ? pass(`Primary key of ${t.name} is ${c.fields.join(' + ')}.`) : fail(`Primary key of ${t.name} is ${pk.length ? pk.join(' + ') : '(none)'}, expected ${c.fields.join(' + ')}.`);
    }
    case 'records': {
      const t = tableName(p, c.table); if (!t) return fail(`No table called ${c.table}.`);
      const n = Number(p.db.scalar(`SELECT count(*) FROM ${q(t)}`));
      if (n < c.min) return fail(`${t} has ${n} record(s); at least ${c.min} needed.`);
      if (c.max !== undefined && n > c.max) return fail(`${t} has ${n} record(s); at most ${c.max} allowed.`);
      return pass(`${t} has ${n} record(s).`);
    }
    case 'recordExists': {
      const t = p.tables().find((x) => eq(x.name, c.table)); if (!t) return fail(`No table called ${c.table}.`);
      const f = t.fields.find((x) => eq(x.name, c.field)); if (!f) return fail(`${t.name} has no field ${c.field}.`);
      const n = Number(p.db.scalar(`SELECT count(*) FROM ${q(t.name)} WHERE lower(trim(CAST(${q(f.name)} AS TEXT))) = lower(trim(?))`, [c.value]));
      return n ? pass(`Found ${f.name} = "${c.value}" in ${t.name}.`) : fail(`No record in ${t.name} with ${f.name} = "${c.value}".`);
    }
    case 'validation': {
      const t = p.tables().find((x) => eq(x.name, c.table)); if (!t) return fail(`No table called ${c.table}.`);
      const f = t.fields.find((x) => eq(x.name, c.field)); if (!f) return fail(`${t.name} has no field ${c.field}.`);
      if (!f.validationRule?.trim()) return fail(`${t.name}.${f.name} has no validation rule.`);
      if (c.rejects === undefined) return pass(`Validation rule on ${f.name}: ${f.validationRule}.`);
      // try the invalid value in an otherwise default record (rolled back)
      const refused = sandbox(p, () => {
        try { p.db.raw.run(`UPDATE ${q(t.name)} SET ${q(f.name)} = ? WHERE rowid = (SELECT min(rowid) FROM ${q(t.name)})`, [c.rejects!] as never); }
        catch (e) { return /constraint|check|validation|rule/i.test(String((e as Error).message)); }
        return Number(p.db.scalar(`SELECT count(*) FROM ${q(t.name)}`)) === 0 ? null : false;
      });
      if (refused === null) return fail(`Add at least one record to ${t.name} so the rule can be tested.`);
      return refused ? pass(`The rule ${f.validationRule} rejects "${c.rejects}".`) : fail(`The rule ${f.validationRule} accepts "${c.rejects}", which should be rejected.`);
    }
    case 'relationship': {
      const r = p.relationships().find((x) => eq(x.primaryTable, c.primary) && eq(x.relatedTable, c.related));
      if (!r) return fail(`No relationship from ${c.primary} to ${c.related}.`);
      if (c.enforce && !r.enforce) return fail('The relationship exists but referential integrity is not enforced.');
      if (c.cascadeDelete && !r.cascadeDelete) return fail('Cascade Delete Related Records is not ticked.');
      if (c.cascadeUpdate && !r.cascadeUpdate) return fail('Cascade Update Related Fields is not ticked.');
      return pass(`${r.primaryTable} → ${r.relatedTable}${r.enforce ? ' with referential integrity' : ''}.`);
    }
    case 'queryResult': {
      const model = rowsOf(p, c.sql);
      if (typeof model === 'string') return fail(`The answer key could not run on this database (${model}). The tables it needs may be missing.`);
      const ordered = c.ordered ?? /\border\s+by\b/i.test(c.sql);
      const cands = queries(p, c.query).filter((x) => ['select', 'crosstab'].includes(x.kind));
      if (!cands.length) return fail(c.query ? `No select query called ${c.query}.` : 'No saved select query.');
      let closest = '';
      for (const x of cands) {
        const got = rowsOf(p, x.sql);
        if (typeof got === 'string') { closest ||= `${x.name}: ${got}`; continue; }
        if (sameRowsAnyColumnOrder(model.rows, got.rows, ordered, sortColumn(c.sql, model.columns))) return pass(`${x.name} returns the expected ${model.rows.length} row(s).`);
        closest ||= `${x.name} returns ${got.rows.length} row(s) × ${got.columns.length} column(s); expected ${model.rows.length} × ${model.columns.length}${ordered ? ', sorted' : ''}.`;
      }
      return fail(closest || 'No saved query returns the expected rows.');
    }
    case 'parameter': {
      const model = rowsOf(p, c.sql);
      if (typeof model === 'string') return fail(`The answer key could not run on this database (${model}).`);
      const cands = queries(p, c.query).filter((x) => x.kind === 'select' && queryParameters(p, x.sql).length > 0);
      if (!cands.length) return fail(c.query ? `${c.query} is not a parameter query (it never asks for a value).` : 'No saved query asks for a value when it runs.');
      const ordered = /\border\s+by\b/i.test(c.sql);
      let closest = '';
      for (const x of cands) {
        const vals = Object.fromEntries(queryParameters(p, x.sql).map((k) => [k, c.value]));
        const got = rowsOf(p, x.sql, vals);
        if (typeof got === 'string') { closest ||= `${x.name}: ${got}`; continue; }
        if (sameRowsAnyColumnOrder(model.rows, got.rows, ordered, sortColumn(c.sql, model.columns))) return pass(`${x.name} asks for a value and, given "${c.value}", returns the expected ${model.rows.length} row(s).`);
        closest ||= `${x.name}, given "${c.value}", returns ${got.rows.length} row(s); expected ${model.rows.length}.`;
      }
      return fail(closest);
    }
    case 'queryUses': {
      const cands = queries(p, c.query);
      if (!cands.length) return fail(c.query ? `No query called ${c.query}.` : 'No saved query.');
      const re = new RegExp(c.contains.trim().split(/\s+/).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+'), 'i');
      const hit = cands.find((x) => re.test(x.sql));
      return hit ? pass(`${hit.name} uses ${c.contains}.`) : fail(`No ${c.query ? `query ${c.query}` : 'saved query'} uses ${c.contains}.`);
    }
    case 'form': {
      const all = p.listObjects('form').map((o) => p.getForm(o.name)).filter((x): x is FormDef => !!x).filter((f) => (!c.name || eq(f.name, c.name)) && (!c.source || eq(f.recordSource, c.source)));
      if (!all.length) return fail(`No form${c.name ? ` called ${c.name}` : ''}${c.source ? ` based on ${c.source}` : ''}.`);
      const need = (c.fields ?? []).map((x) => x.toLowerCase());
      for (const f of all) {
        const bound = new Set(f.controls.map((k) => String(k.props.controlSource ?? '').toLowerCase()).filter((s) => s && !s.startsWith('=')));
        const missing = need.filter((x) => !bound.has(x));
        if (!missing.length) return pass(`${f.name} is based on ${f.recordSource}${need.length ? ` and shows ${c.fields!.join(', ')}` : ''}.`);
        if (f === all[all.length - 1]) return fail(`${f.name} has no control bound to ${missing.join(', ')}.`);
      }
      return fail('No matching form.');
    }
    case 'report': {
      const all = p.listObjects('report').map((o) => p.getReport(o.name)).filter((x): x is ReportDef => !!x).filter((r) => (!c.name || eq(r.name, c.name)) && (!c.source || eq(r.recordSource, c.source)));
      if (!all.length) return fail(`No report${c.name ? ` called ${c.name}` : ''}${c.source ? ` based on ${c.source}` : ''}.`);
      for (const r of all) {
        const grouped = !c.groupField || r.groups.some((g) => !g.isSort && eq(g.field, c.groupField!));
        const foot = r.sections.filter((s) => s.kind === 'groupFooter' || s.kind === 'reportFooter').map((s) => s.id);
        const total = !c.total || r.controls.some((k) => foot.includes(k.section) && /=\s*(sum|count|avg|min|max)\s*\(/i.test(String(k.props.controlSource ?? '')));
        if (grouped && total) return pass(`${r.name}${c.groupField ? ` is grouped on ${c.groupField}` : ''}${c.total ? ' with a total' : ''}.`);
      }
      return fail(c.groupField && c.total ? `No report grouped on ${c.groupField} with a total in a footer.` : c.groupField ? `No report grouped on ${c.groupField}.` : 'No report with a total in a group or report footer.');
    }
    case 'sql': {
      const r = rowsOf(p, c.sql);
      if (typeof r === 'string') return fail(`Not met (${r}).`);
      const v = r.rows[0]?.[0];
      return v && v !== '0' && v !== '∅' && v !== 'false' ? pass(c.label) : fail(`Not met: ${c.label}`);
    }
  }
}

export function grade(p: WowProject, tasks: ExamTask[]): GradeResult {
  const out = tasks.map((t): TaskResult => {
    let r: { ok: boolean; reason: string };
    try { r = runCheck(p, t.check); } catch (e) { r = { ok: false, reason: 'Could not be checked: ' + (e as Error).message }; }
    return { id: t.id, marks: r.ok ? t.marks : 0, max: t.marks, ok: r.ok, reason: r.reason };
  });
  return { score: out.reduce((s, x) => s + x.marks, 0), max: out.reduce((s, x) => s + x.max, 0), tasks: out };
}

/** Short teacher-facing description of a check, used in the test builder. */
export function describeCheck(c: Check): string {
  switch (c.kind) {
    case 'table': return `Table ${c.table} exists`;
    case 'field': return `${c.table}.${c.field}${c.type ? ` is ${c.type}` : ' exists'}`;
    case 'primaryKey': return `Primary key of ${c.table} is ${c.fields.join(' + ')}`;
    case 'records': return `${c.table} has at least ${c.min} record(s)${c.max !== undefined ? ` and at most ${c.max}` : ''}`;
    case 'recordExists': return `${c.table} has a record with ${c.field} = "${c.value}"`;
    case 'validation': return `${c.table}.${c.field} has a validation rule${c.rejects !== undefined ? ` that rejects "${c.rejects}"` : ''}`;
    case 'relationship': return `Relationship ${c.primary} → ${c.related}${c.enforce ? ', integrity enforced' : ''}${c.cascadeDelete ? ', cascade delete' : ''}${c.cascadeUpdate ? ', cascade update' : ''}`;
    case 'queryResult': return `A saved query${c.query ? ` named ${c.query}` : ''} returns the same rows as the answer SQL`;
    case 'queryUses': return `A saved query${c.query ? ` named ${c.query}` : ''} uses ${c.contains}`;
    case 'parameter': return `A parameter query${c.query ? ` named ${c.query}` : ''}, given "${c.value}", returns the same rows as the answer SQL`;
    case 'form': return `A form${c.name ? ` named ${c.name}` : ''}${c.source ? ` based on ${c.source}` : ''}${c.fields?.length ? ` showing ${c.fields.join(', ')}` : ''}`;
    case 'report': return `A report${c.name ? ` named ${c.name}` : ''}${c.source ? ` based on ${c.source}` : ''}${c.groupField ? ` grouped on ${c.groupField}` : ''}${c.total ? ' with a total' : ''}`;
    case 'sql': return `Custom check: ${c.label}`;
  }
}
