// Database Tools: documenter, dependencies, integrity checker, performance
// analyser, statistics and compact & repair — all reading the real database.
import { q } from './sqlite';
import { WowProject } from './project';
import { queryDependencies } from './queries';
import type { FormDef, ReportDef } from './types';

export interface Dependency { type: string; name: string; uses: { type: string; name: string }[]; usedBy: { type: string; name: string }[]; }

export function dependencies(p: WowProject): Dependency[] {
  const objs: Dependency[] = [];
  const add = (type: string, name: string) => { const d = { type, name, uses: [], usedBy: [] }; objs.push(d); return d; };
  const find = (name: string) => objs.find((o) => (o.type === 'table' || o.type === 'query') && o.name.toLowerCase() === name.toLowerCase());
  p.tableNames().forEach((n) => add('table', n));
  p.queries().forEach((qd) => add('query', qd.name));
  p.listObjects('form').forEach((o) => add('form', o.name));
  p.listObjects('report').forEach((o) => add('report', o.name));
  const link = (from: Dependency, to: Dependency | undefined) => {
    if (!to || to === from || from.uses.some((u) => u.type === to.type && u.name === to.name)) return;
    from.uses.push({ type: to.type, name: to.name }); to.usedBy.push({ type: from.type, name: from.name });
  };
  for (const qd of p.queries()) { const me = objs.find((o) => o.type === 'query' && o.name === qd.name)!; queryDependencies(p, qd).forEach((n) => link(me, find(n))); }
  for (const t of ['form', 'report'] as const) {
    for (const o of p.listObjects(t)) {
      const def = p.getObject<FormDef | ReportDef>(t, o.name)!.def;
      const me = objs.find((x) => x.type === t && x.name === o.name)!;
      link(me, find(def.recordSource));
      for (const c of def.controls) {
        if (c.type === 'combobox' || c.type === 'listbox') { if (c.props.rowSourceType !== 'Value List') link(me, find(String(c.props.rowSource ?? ''))); }
        if (c.type === 'subform' && c.props.sourceObject) {
          const so = String(c.props.sourceObject);
          const target = objs.find((x) => (x.type === 'form' || x.type === 'report') && x.name.toLowerCase() === so.replace(/^(form|report)\./i, '').toLowerCase());
          link(me, target);
        }
      }
    }
  }
  for (const r of p.relationships()) {
    const a = find(r.relatedTable), b = find(r.primaryTable);
    if (a && b) link(a, b);
  }
  return objs;
}

export interface Issue { severity: 'error' | 'warning' | 'info'; object: string; message: string; fix?: string; }

export function integrityCheck(p: WowProject): Issue[] {
  const out: Issue[] = [];
  const ic = p.db.query('PRAGMA integrity_check').rows.map((r) => String(r[0]));
  if (ic.length !== 1 || ic[0] !== 'ok') ic.forEach((m) => out.push({ severity: 'error', object: 'Database file', message: m }));
  const fk = p.db.query('PRAGMA foreign_key_check').rows;
  for (const r of fk) out.push({ severity: 'error', object: String(r[0]), message: `Record ${r[1]} refers to a missing record in "${r[2]}".`, fix: 'Correct or delete the record.' });
  // relationships without enforcement may still have orphans
  for (const rel of p.relationships().filter((x) => !x.enforce)) {
    const cond = rel.fields.map((f) => `c.${q(f.related)} = pt.${q(f.primary)}`).join(' AND ');
    const nn = rel.fields.map((f) => `c.${q(f.related)} IS NOT NULL`).join(' AND ');
    try {
      const n = Number(p.db.scalar(`SELECT count(*) FROM ${q(rel.relatedTable)} c WHERE ${nn} AND NOT EXISTS (SELECT 1 FROM ${q(rel.primaryTable)} pt WHERE ${cond})`));
      if (n) out.push({ severity: 'warning', object: `${rel.primaryTable} → ${rel.relatedTable}`, message: `${n} record(s) in "${rel.relatedTable}" have no matching "${rel.primaryTable}" record. Referential integrity is not enforced for this relationship.`, fix: 'Fix the records, then tick "Enforce Referential Integrity".' });
    } catch { /* ignore */ }
  }
  // catalogue vs. real schema
  for (const t of p.tables()) {
    const exists = p.db.scalar("SELECT count(*) FROM sqlite_master WHERE type='table' AND name=?", [t.name]);
    if (!exists) out.push({ severity: 'error', object: t.name, message: 'The table definition exists but the table is missing from the database file.' });
  }
  for (const qd of p.queries()) {
    if (p.viewable(qd) && !p.db.scalar("SELECT count(*) FROM sqlite_master WHERE type='view' AND name=?", [qd.name])) out.push({ severity: 'warning', object: qd.name, message: 'The saved query could not be compiled. One of its tables or fields may have been renamed or deleted.', fix: 'Open the query in SQL View and correct it.' });
  }
  for (const t of ['form', 'report'] as const) {
    for (const o of p.listObjects(t)) {
      const def = p.getObject<FormDef | ReportDef>(t, o.name)!.def;
      if (def.recordSource && !p.getTable(def.recordSource) && !p.getQuery(def.recordSource)) out.push({ severity: 'warning', object: `${t} ${o.name}`, message: `Record Source "${def.recordSource}" does not exist.` });
      const cols = def.recordSource ? p.columnsOf(def.recordSource).map((c) => c.toLowerCase()) : [];
      for (const c of def.controls) {
        const src = String(c.props.controlSource ?? '');
        if (src && !src.startsWith('=') && cols.length && !cols.includes(src.toLowerCase())) out.push({ severity: 'warning', object: `${t} ${o.name}`, message: `Control "${c.name}" is bound to "${src}", which is not a field of "${def.recordSource}".` });
      }
    }
  }
  if (!out.length) out.push({ severity: 'info', object: 'Database', message: 'No problems were found. The file passed SQLite integrity_check and all foreign keys are valid.' });
  return out;
}

export function performanceAnalysis(p: WowProject): Issue[] {
  const out: Issue[] = [];
  for (const t of p.tables()) {
    if (!t.fields.some((f) => f.primaryKey)) out.push({ severity: 'warning', object: t.name, message: 'This table has no primary key.', fix: 'Set a primary key so records can be identified and related.' });
    const n = Number(p.db.scalar(`SELECT count(*) FROM ${q(t.name)}`));
    if (n > 1000 && t.fields.filter((f) => f.indexed && f.indexed !== 'No').length === 0) out.push({ severity: 'info', object: t.name, message: `${n} records and no indexes on non-key fields.`, fix: 'Index fields that you often search or sort on.' });
  }
  for (const r of p.relationships()) {
    const t = p.getTable(r.relatedTable);
    for (const f of r.fields) {
      const fd = t?.fields.find((x) => x.name.toLowerCase() === f.related.toLowerCase());
      const isPk = fd?.primaryKey && t!.fields.filter((x) => x.primaryKey)[0]?.name === fd.name;
      if (fd && !isPk && (!fd.indexed || fd.indexed === 'No')) out.push({ severity: 'info', object: `${r.relatedTable}.${fd.name}`, message: 'Foreign key field is not indexed.', fix: 'Set Indexed: Yes (Duplicates OK) to speed up joins.' });
    }
  }
  for (const qd of p.queries()) {
    if (!p.viewable(qd)) continue;
    try {
      const plan = p.db.query(`EXPLAIN QUERY PLAN SELECT * FROM ${q(qd.name)}`).rows.map((r) => String(r[3]));
      const scans = plan.filter((x) => /^SCAN /.test(x) && !/USING/.test(x));
      if (scans.length) out.push({ severity: 'info', object: `Query ${qd.name}`, message: `Plan: ${plan.join('; ')}`, fix: scans.length > 1 ? 'Several full table scans: index the join or criteria fields.' : undefined });
    } catch { /* ignore */ }
  }
  if (!out.length) out.push({ severity: 'info', object: 'Database', message: 'No performance suggestions.' });
  return out;
}

export interface TableStats { name: string; records: number; fields: number; indexes: { name: string; unique: boolean; columns: string[] }[]; }
export function statistics(p: WowProject): { tables: TableStats[]; queries: number; forms: number; reports: number; relationships: number; sizeBytes: number; pageCount: number } {
  const tables = p.tables().map((t) => {
    const idx = p.db.all<{ name: string; unique: number }>(`PRAGMA index_list(${q(t.name)})`).map((i) => ({
      name: i.name, unique: !!i.unique, columns: p.db.all<{ name: string }>(`PRAGMA index_info(${q(i.name)})`).map((c) => c.name),
    }));
    return { name: t.name, records: Number(p.db.scalar(`SELECT count(*) FROM ${q(t.name)}`)), fields: t.fields.length, indexes: idx };
  });
  const pageCount = Number(p.db.scalar('PRAGMA page_count'));
  const pageSize = Number(p.db.scalar('PRAGMA page_size'));
  return { tables, queries: p.listObjects('query').length, forms: p.listObjects('form').length, reports: p.listObjects('report').length, relationships: p.relationships().length, sizeBytes: pageCount * pageSize, pageCount };
}

export function compactAndRepair(p: WowProject): { before: number; after: number; integrity: string } {
  const before = Number(p.db.scalar('PRAGMA page_count')) * Number(p.db.scalar('PRAGMA page_size'));
  p.db.raw.run('VACUUM;');
  p.db.raw.run('PRAGMA foreign_keys = ON;');
  p.recreateViews();
  const after = Number(p.db.scalar('PRAGMA page_count')) * Number(p.db.scalar('PRAGMA page_size'));
  const integrity = String(p.db.scalar('PRAGMA integrity_check'));
  p.db.notify();
  return { before, after, integrity };
}

/** Database Documenter: a full description of every object (as HTML for printing). */
export function documenterHtml(p: WowProject): string {
  const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
  const parts: string[] = [`<h1>${esc(p.name)} — Database Documenter</h1><p>Generated ${esc(new Date().toLocaleString())}</p>`];
  for (const t of p.tables()) {
    const n = p.db.scalar(`SELECT count(*) FROM ${q(t.name)}`);
    parts.push(`<h2>Table: ${esc(t.name)}</h2><p>${esc(t.description ?? '')} Records: ${esc(n)}</p><table><tr><th>Field</th><th>Type</th><th>Size</th><th>Required</th><th>Indexed</th><th>Validation</th><th>Description</th></tr>` +
      t.fields.map((f) => `<tr><td>${f.primaryKey ? '🔑 ' : ''}${esc(f.name)}</td><td>${esc(f.type)}${f.type === 'Calculated' ? ' = ' + esc(f.expression) : ''}</td><td>${esc(f.type === 'Short Text' ? f.fieldSize ?? 255 : f.type === 'Number' ? f.numberSize ?? 'Long Integer' : '')}</td><td>${f.required ? 'Yes' : 'No'}</td><td>${esc(f.indexed ?? 'No')}</td><td>${esc(f.validationRule ?? '')}</td><td>${esc(f.description ?? '')}</td></tr>`).join('') + '</table>');
    parts.push(`<pre>${esc(p.createTableSql(t))}</pre>`);
  }
  if (p.relationships().length) {
    parts.push('<h2>Relationships</h2><table><tr><th>Primary</th><th>Related</th><th>Fields</th><th>Type</th><th>Integrity</th></tr>' +
      p.relationships().map((r) => `<tr><td>${esc(r.primaryTable)}</td><td>${esc(r.relatedTable)}</td><td>${r.fields.map((f) => esc(f.primary + ' = ' + f.related)).join(', ')}</td><td>${esc(p.relationshipType(r))}</td><td>${r.enforce ? 'Enforced' + (r.cascadeUpdate ? ', cascade update' : '') + (r.cascadeDelete ? ', cascade delete' : '') : 'Not enforced'}</td></tr>`).join('') + '</table>');
  }
  for (const qd of p.queries()) parts.push(`<h2>Query: ${esc(qd.name)}</h2><p>Type: ${esc(qd.kind)}</p><pre>${esc(qd.sql)}</pre>`);
  for (const t of ['form', 'report'] as const) {
    for (const o of p.listObjects(t)) {
      const d = p.getObject<FormDef | ReportDef>(t, o.name)!.def;
      parts.push(`<h2>${t === 'form' ? 'Form' : 'Report'}: ${esc(o.name)}</h2><p>Record Source: ${esc(d.recordSource)}. Sections: ${d.sections.map((s) => esc(s.name)).join(', ')}. Controls: ${d.controls.length}.</p><table><tr><th>Control</th><th>Type</th><th>Section</th><th>Source / Caption</th></tr>` +
        d.controls.map((c) => `<tr><td>${esc(c.name)}</td><td>${esc(c.type)}</td><td>${esc(d.sections.find((s) => s.id === c.section)?.name)}</td><td>${esc(c.props.controlSource ?? c.props.caption ?? '')}</td></tr>`).join('') + '</table>');
    }
  }
  return parts.join('\n');
}
