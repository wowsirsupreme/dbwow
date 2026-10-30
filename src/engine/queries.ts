// Query engine: Query Design model → SQL, SQL → Design model, and execution
// of select / parameter / crosstab / make-table / append / update / delete queries.
import { q } from './sqlite';
import { parseCriteria, parseExpr, toSql, ExprError } from './expr';
import { WowProject, WowError, prepareParams, friendlyError, uid, stripStrings } from './project';
import type { FieldDef, QueryColumn, QueryDef, QueryDesign, QueryKind, QueryResult, TableDef } from './types';

WowProject.sqlFromDesign = (p, d, kind) => designToSql(p, d, kind);

export function emptyDesign(): QueryDesign {
  return { tables: [], joins: [], columns: [], totals: false, distinct: false, top: '' };
}
export function newColumn(field = '', table = ''): QueryColumn {
  return { id: uid('c'), field, table, show: true, criteria: ['', ''], sort: '', total: 'Group By', crosstab: '' };
}

interface Ctx { p: WowProject; d: QueryDesign; params: { prompt: string; name: string }[]; }

function tableRefName(d: QueryDesign, t: { name: string; alias?: string }) { return t.alias || t.name; }

function resolver(ctx: Ctx) {
  return (parts: string[]): string | null => {
    if (parts.length >= 2) {
      const tn = parts[parts.length - 2].toLowerCase();
      const fn = parts[parts.length - 1];
      const t = ctx.d.tables.find((x) => tableRefName(ctx.d, x).toLowerCase() === tn);
      if (t) {
        const cols = ctx.p.columnsOf(t.name);
        const real = cols.find((c) => c.toLowerCase() === fn.toLowerCase());
        return real ? `${q(tableRefName(ctx.d, t))}.${q(real)}` : null;
      }
      return null;
    }
    const fn = parts[0].toLowerCase();
    for (const t of ctx.d.tables) {
      const real = ctx.p.columnsOf(t.name).find((c) => c.toLowerCase() === fn);
      if (real) return `${q(tableRefName(ctx.d, t))}.${q(real)}`;
    }
    // alias of another column
    const al = ctx.d.columns.find((c) => splitAlias(c).alias?.toLowerCase() === fn);
    if (al) return q(splitAlias(al).alias!);
    return null;
  };
}

/** "Total: [Qty]*[Price]" → { alias: 'Total', expr: '[Qty]*[Price]' } */
export function splitAlias(c: QueryColumn): { alias?: string; expr: string; isExpr: boolean } {
  const m = /^\s*([^:[\]"']+?)\s*:\s*(.+)$/.exec(c.field);
  if (m && !/^\w+:\/\//.test(c.field)) return { alias: m[1].trim(), expr: m[2].trim(), isExpr: true };
  if (c.alias) return { alias: c.alias, expr: c.field, isExpr: false };
  if (/[()&+\-*/]|^\s*=/.test(c.field) && !c.table) return { expr: c.field, isExpr: true };
  return { expr: c.field, isExpr: false };
}

function colExprSql(ctx: Ctx, c: QueryColumn): string {
  const a = splitAlias(c);
  if (a.expr === '*') return c.table ? `${q(c.table)}.*` : '*';
  if (!a.isExpr && c.table) {
    const t = ctx.d.tables.find((x) => tableRefName(ctx.d, x).toLowerCase() === c.table!.toLowerCase());
    if (!t) throw new WowError(`The table "${c.table}" used by field "${c.field}" is not in the query.`);
    const real = ctx.p.columnsOf(t.name).find((x) => x.toLowerCase() === a.expr.toLowerCase());
    if (!real) throw new WowError(`The field "${a.expr}" does not exist in "${c.table}".`);
    return `${q(tableRefName(ctx.d, t))}.${q(real)}`;
  }
  try {
    return toSql(parseExpr(a.expr), { resolve: resolver(ctx), params: ctx.params });
  } catch (e) {
    throw new WowError(`Problem in field "${c.field}": ${(e as Error).message}`);
  }
}

function aggName(op: string): string { return op === 'Avg' ? 'avg' : op === 'Count' ? 'count' : op === 'First' ? 'min' : op === 'Last' ? 'max' : op.toLowerCase(); }

function outputAlias(c: QueryColumn): string | undefined {
  const a = splitAlias(c);
  if (a.alias) return a.alias;
  if (a.isExpr) return undefined;
  if (c.total && !['Group By', 'Where', 'Expression'].includes(c.total)) return `${c.total}Of${a.expr}`;
  return undefined;
}

function criteriaSql(ctx: Ctx, c: QueryColumn, text: string, target: string): string {
  try {
    return toSql(parseCriteria(text), { self: target, resolve: resolver(ctx), params: ctx.params, bareAsText: true });
  } catch (e) {
    throw new WowError(`Problem in the criteria "${text}" for field "${c.field}": ${(e as Error).message}`);
  }
}

function fromClause(ctx: Ctx): string {
  const d = ctx.d;
  if (!d.tables.length) throw new WowError('Add at least one table or query to the query (Show Table).');
  const placed: string[] = [];
  const used = new Set<string>();
  const refOf = (t: { name: string; alias?: string }) => t.alias ? `${q(t.name)} AS ${q(t.alias)}` : q(t.name);
  let sql = refOf(d.tables[0]);
  placed.push(tableRefName(d, d.tables[0]).toLowerCase());
  const extraConds: string[] = [];
  let progress = true;
  while (placed.length < d.tables.length && progress) {
    progress = false;
    for (const j of d.joins) {
      if (used.has(j.id)) continue;
      const l = j.leftTable.toLowerCase(), r = j.rightTable.toLowerCase();
      const lIn = placed.includes(l), rIn = placed.includes(r);
      if (lIn && rIn) continue;
      if (!lIn && !rIn) continue;
      const newName = lIn ? j.rightTable : j.leftTable;
      const t = d.tables.find((x) => tableRefName(d, x).toLowerCase() === newName.toLowerCase());
      if (!t) continue;
      // join type is relative to left/right as drawn
      let type = j.type;
      if (!lIn) type = type === 'left' ? 'right' : type === 'right' ? 'left' : type;
      const kw = type === 'left' ? 'LEFT JOIN' : type === 'right' ? 'RIGHT JOIN' : 'INNER JOIN';
      const on = joinOn(ctx, d, j);
      for (const j2 of d.joins) {
        if (j2.id === j.id || used.has(j2.id)) continue;
        const a = j2.leftTable.toLowerCase(), b = j2.rightTable.toLowerCase();
        const nn = newName.toLowerCase();
        if ((a === nn && placed.includes(b)) || (b === nn && placed.includes(a))) { on.push(...joinOn(ctx, d, j2)); used.add(j2.id); }
      }
      sql += `\n  ${kw} ${refOf(t)} ON ${on.join(' AND ')}`;
      placed.push(newName.toLowerCase()); used.add(j.id); progress = true;
    }
  }
  for (const t of d.tables) {
    if (!placed.includes(tableRefName(d, t).toLowerCase())) { sql += `, ${refOf(t)}`; placed.push(tableRefName(d, t).toLowerCase()); }
  }
  for (const j of d.joins) if (!used.has(j.id)) extraConds.push(...joinOn(ctx, d, j));
  (ctx as Ctx & { extra?: string[] }).extra = extraConds;
  return sql;
}
function joinOn(ctx: Ctx, d: QueryDesign, j: QueryDesign['joins'][number]): string[] {
  const f = (t: string, fld: string) => {
    const tr = d.tables.find((x) => tableRefName(d, x).toLowerCase() === t.toLowerCase());
    const real = tr ? ctx.p.columnsOf(tr.name).find((c) => c.toLowerCase() === fld.toLowerCase()) ?? fld : fld;
    return `${q(t)}.${q(real)}`;
  };
  return [`${f(j.leftTable, j.leftField)} = ${f(j.rightTable, j.rightField)}`];
}

function whereParts(ctx: Ctx, opts: { havingAgg: boolean }): { where: string; having: string } {
  const d = ctx.d;
  const rows = Math.max(1, ...d.columns.map((c) => c.criteria.length));
  const whereRows: string[] = [], havingRows: string[] = [];
  for (let r = 0; r < rows; r++) {
    const w: string[] = [], h: string[] = [];
    for (const c of d.columns) {
      const text = (c.criteria[r] ?? '').trim();
      if (!text) continue;
      const isAgg = opts.havingAgg && d.totals && c.total && !['Group By', 'Where', 'Expression'].includes(c.total);
      const base = colExprSql(ctx, c);
      const target = isAgg ? `${aggName(c.total!)}(${base})` : base;
      const sql = criteriaSql(ctx, c, text, target);
      if (isAgg || (d.totals && c.total === 'Group By' && false)) h.push(sql); else w.push(sql);
    }
    if (w.length) whereRows.push(w.length > 1 ? `(${w.join(' AND ')})` : w[0]);
    if (h.length) havingRows.push(h.length > 1 ? `(${h.join(' AND ')})` : h[0]);
  }
  const extra = (ctx as Ctx & { extra?: string[] }).extra ?? [];
  let where = whereRows.length > 1 ? whereRows.map((x) => x).join('\n   OR ') : whereRows[0] ?? '';
  if (extra.length) where = [where ? `(${where})` : '', ...extra].filter(Boolean).join(' AND ');
  const having = havingRows.length > 1 ? havingRows.join(' OR ') : havingRows[0] ?? '';
  return { where, having };
}

function restoreParamSyntax(sql: string, params: { prompt: string; name: string }[]): string {
  let s = sql;
  for (const p of [...params].sort((a, b) => b.name.length - a.name.length)) s = s.split(p.name).join(`[${p.prompt}]`);
  return s;
}

/** Generate SQL (Access-style [Parameters] kept) from a design. */
export function designToSql(p: WowProject, d: QueryDesign, kind: QueryKind): string {
  const ctx: Ctx = { p, d, params: [] };
  if (kind === 'crosstab') return restoreParamSyntax(crosstabTemplate(ctx), ctx.params);
  if (kind === 'update') return restoreParamSyntax(updateSql(ctx), ctx.params);
  if (kind === 'delete') return restoreParamSyntax(deleteSql(ctx), ctx.params);
  const from = fromClause(ctx);
  const sel: string[] = [];
  const group: string[] = [];
  const order: string[] = [];
  for (const c of d.columns) {
    if (!c.field.trim()) continue;
    const base = colExprSql(ctx, c);
    const alias = outputAlias(c);
    let expr = base;
    if (d.totals && c.total) {
      if (c.total === 'Group By') group.push(base);
      else if (c.total === 'Where') { /* criteria only */ }
      else if (c.total !== 'Expression') expr = c.total === 'Count' && base.endsWith('*') ? 'count(*)' : `${aggName(c.total)}(${base})`;
    }
    const shown = c.show && !(d.totals && c.total === 'Where');
    if (shown) sel.push(alias ? `${expr} AS ${q(alias)}` : expr);
    if (c.sort) order.push(`${alias && splitAlias(c).isExpr ? q(alias) : expr} ${c.sort === 'Descending' ? 'DESC' : 'ASC'}`);
  }
  if (!sel.length) throw new WowError('The query must have at least one field shown in the results (tick Show).');
  const { where, having } = whereParts(ctx, { havingAgg: true });
  let sql = `SELECT ${d.distinct ? 'DISTINCT ' : ''}${sel.join(', ')}\nFROM ${from}`;
  if (where) sql += `\nWHERE ${where}`;
  if (d.totals && group.length) sql += `\nGROUP BY ${group.join(', ')}`;
  if (having) sql += `\nHAVING ${having}`;
  if (order.length) sql += `\nORDER BY ${order.join(', ')}`;
  const top = (d.top || '').trim();
  if (top && top.toLowerCase() !== 'all') {
    if (top.endsWith('%')) {
      const pct = parseFloat(top);
      sql += `\nLIMIT (SELECT CAST((count(*) * ${pct} + 99) / 100 AS INTEGER) FROM (SELECT ${d.distinct ? 'DISTINCT ' : ''}${sel.join(', ')} FROM ${from}${where ? ' WHERE ' + where : ''}${d.totals && group.length ? ' GROUP BY ' + group.join(', ') : ''}))`;
    } else if (/^\d+$/.test(top)) sql += `\nLIMIT ${top}`;
  }
  if (kind === 'maketable') {
    if (!d.targetTable) throw new WowError('Choose the name of the new table (Make Table → Table Name).');
    sql = `CREATE TABLE ${q(d.targetTable)} AS\n${sql}`;
  } else if (kind === 'append') {
    if (!d.targetTable) throw new WowError('Choose the table to append to (Append → Table Name).');
    const tcols = d.columns.filter((c) => c.field.trim() && c.show && !(d.totals && c.total === 'Where'));
    const targets = tcols.map((c) => c.appendTo || splitAlias(c).alias || splitAlias(c).expr);
    if (targets.some((t) => !t || t === '*')) throw new WowError('Every field in an append query needs an "Append To" field.');
    sql = `INSERT INTO ${q(d.targetTable)} (${targets.map(q).join(', ')})\n${sql}`;
  }
  return restoreParamSyntax(sql, ctx.params);
}

function singleTarget(ctx: Ctx): { name: string; ref: string } {
  const d = ctx.d;
  const name = d.targetTable || d.tables[0]?.name;
  if (!name) throw new WowError('Add the table to change to the query.');
  const t = d.tables.find((x) => x.name.toLowerCase() === name.toLowerCase());
  return { name: t?.name ?? name, ref: t ? tableRefName(d, t) : name };
}

function updateSql(ctx: Ctx): string {
  const d = ctx.d;
  const tgt = singleTarget(ctx);
  const sets = d.columns.filter((c) => c.updateTo?.trim() && (c.table ?? '').toLowerCase() === tgt.ref.toLowerCase());
  if (!sets.length) throw new WowError('Enter an "Update To" value for at least one field of the target table.');
  const setSql = sets.map((c) => {
    const v = toSql(parseExpr(c.updateTo!), { resolve: (parts) => { const r = resolver(ctx)(parts); return r ? r.replace(new RegExp('^' + escapeRe(q(tgt.ref)) + '\\.'), '') : null; }, params: ctx.params, bareAsText: true });
    return `${q(splitAlias(c).expr)} = ${v}`;
  });
  if (d.tables.length === 1) {
    const { where } = whereParts(ctx, { havingAgg: false });
    const w = where.split(`${q(tgt.ref)}.`).join('');
    return `UPDATE ${q(tgt.name)}\nSET ${setSql.join(', ')}${w ? `\nWHERE ${w}` : ''}`;
  }
  const from = fromClause(ctx);
  const { where } = whereParts(ctx, { havingAgg: false });
  return `UPDATE ${q(tgt.name)}\nSET ${setSql.join(', ')}\nWHERE rowid IN (SELECT ${q(tgt.ref)}.rowid FROM ${from}${where ? ' WHERE ' + where : ''})`;
}

function deleteSql(ctx: Ctx): string {
  const d = ctx.d;
  const tgt = singleTarget(ctx);
  const { where } = whereParts(ctx, { havingAgg: false });
  if (d.tables.length === 1) {
    const w = where.split(`${q(tgt.ref)}.`).join('');
    return `DELETE FROM ${q(tgt.name)}${w ? `\nWHERE ${w}` : ''}`;
  }
  const from = fromClause(ctx);
  return `DELETE FROM ${q(tgt.name)}\nWHERE rowid IN (SELECT ${q(tgt.ref)}.rowid FROM ${from}${where ? ' WHERE ' + where : ''})`;
}
function escapeRe(s: string) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// ---- Crosstab ----
// Stored SQL is a readable template; column headings are expanded at run time.
const XT_MARK = '/*CROSSTAB*/';
function crosstabTemplate(ctx: Ctx): string {
  const d = ctx.d;
  const rows = d.columns.filter((c) => c.crosstab === 'Row Heading');
  const col = d.columns.filter((c) => c.crosstab === 'Column Heading');
  const val = d.columns.filter((c) => c.crosstab === 'Value');
  if (!rows.length || col.length !== 1 || val.length !== 1) throw new WowError('A crosstab query needs at least one Row Heading, exactly one Column Heading and exactly one Value.');
  const v = val[0];
  if (!v.total || ['Group By', 'Where', 'Expression'].includes(v.total)) throw new WowError('The Value field of a crosstab must use an aggregate in the Total row (Sum, Count, Avg, Min or Max).');
  const from = fromClause(ctx);
  const { where } = whereParts(ctx, { havingAgg: false });
  const rowSql = rows.map((r) => ({ sql: colExprSql(ctx, r), alias: outputAlias(r) ?? splitAlias(r).expr }));
  const colSql = colExprSql(ctx, col[0]);
  const valSql = colExprSql(ctx, v);
  const meta = JSON.stringify({ rows: rowSql, col: colSql, val: valSql, agg: aggName(v.total), from, where });
  return `${XT_MARK}-- Crosstab query: one column is created for each distinct value of ${col[0].field}\n-- ${meta}\nSELECT ${rowSql.map((r) => `${r.sql} AS ${q(r.alias)}`).join(', ')}, ${colSql} AS "__pivot", ${aggName(v.total)}(${valSql}) AS "__value"\nFROM ${from}${where ? `\nWHERE ${where}` : ''}\nGROUP BY ${[...rowSql.map((r) => r.sql), colSql].join(', ')}`;
}

export function isCrosstabSql(sql: string) { return sql.startsWith(XT_MARK); }

function expandCrosstab(p: WowProject, sql: string, bind: Record<string, unknown>): string {
  const metaLine = sql.split('\n')[1]?.replace(/^--\s*/, '');
  const meta = JSON.parse(metaLine) as { rows: { sql: string; alias: string }[]; col: string; val: string; agg: string; from: string; where: string };
  const prep = (s: string) => prepareParams(s, p.knownIdentifiers()).sql;
  const heads = p.db.query(prep(`SELECT DISTINCT ${meta.col} FROM ${meta.from}${meta.where ? ' WHERE ' + meta.where : ''} ORDER BY 1`), filterBind(bind, prep(meta.from + meta.where)) as never).rows.map((r) => r[0]);
  const cols = heads.map((h) => {
    const cond = h === null ? `${meta.col} IS NULL` : `${meta.col} = ${typeof h === 'number' ? h : `'${String(h).replace(/'/g, "''")}'`}`;
    const agg = meta.agg === 'count' ? `count(CASE WHEN ${cond} THEN ${meta.val} END)` : `${meta.agg}(CASE WHEN ${cond} THEN ${meta.val} END)`;
    return `${agg} AS ${q(h === null ? '<>' : String(h))}`;
  });
  return prep(`SELECT ${meta.rows.map((r) => `${r.sql} AS ${q(r.alias)}`).join(', ')}${cols.length ? ', ' + cols.join(', ') : ''}\nFROM ${meta.from}${meta.where ? `\nWHERE ${meta.where}` : ''}\nGROUP BY ${meta.rows.map((r) => r.sql).join(', ')}`);
}
function filterBind(bind: Record<string, unknown>, sql: string) {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(bind)) if (sql.includes(k)) out[k] = bind[k];
  return out;
}

// ---------------- execution ----------------

export interface RunOutcome extends QueryResult {
  kind: 'rows' | 'changes' | 'ddl';
  message?: string;
  statement?: string;
}

/** Parameters a query will ask for when it runs. */
export function queryParameters(p: WowProject, sql: string): string[] {
  const body = isCrosstabSql(sql) ? sql.split('\n').slice(1).join('\n') : sql;
  return prepareParams(stripComments(body), p.knownIdentifiers()).params.map((x) => x.prompt);
}
function stripComments(s: string) { return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, ''); }

const PROTECTED = /\b_wow_(objects|meta)\b/i;

/** Split a script into statements (respecting quotes). */
export function splitStatements(sql: string): string[] {
  const out: string[] = [];
  let cur = '', i = 0;
  while (i < sql.length) {
    const c = sql[i];
    if (c === "'" || c === '"' || c === '`') {
      const j = (() => { let k = i + 1; while (k < sql.length) { if (sql[k] === c) { if (sql[k + 1] === c) { k += 2; continue; } return k + 1; } k++; } return sql.length; })();
      cur += sql.slice(i, j); i = j; continue;
    }
    if (c === '-' && sql[i + 1] === '-') { const j = sql.indexOf('\n', i); const e = j < 0 ? sql.length : j; cur += sql.slice(i, e); i = e; continue; }
    if (c === '/' && sql[i + 1] === '*') { const j = sql.indexOf('*/', i + 2); const e = j < 0 ? sql.length : j + 2; cur += sql.slice(i, e); i = e; continue; }
    if (c === ';') { if (stripComments(cur).trim()) out.push(cur.trim()); cur = ''; i++; continue; }
    cur += c; i++;
  }
  if (stripComments(cur).trim()) out.push(cur.trim());
  return out;
}

/**
 * Run SQL (one or more statements). [Prompt] parameters are bound from `values`.
 * Returns the outcome of the last statement.
 */
export function runSql(p: WowProject, sqlText: string, values: Record<string, unknown> = {}, opts: { limitRows?: number } = {}): RunOutcome {
  const t0 = performance.now();
  if (isCrosstabSql(sqlText)) {
    const prepared = prepareParams(sqlText.split('\n').slice(2).join('\n'), p.knownIdentifiers());
    const bind: Record<string, unknown> = {};
    prepared.params.forEach((x) => { bind[x.name] = values[x.prompt] ?? null; });
    // params in meta use the same [Prompt] names → map by prompt order of the whole text
    const all = prepareParams(sqlText, p.knownIdentifiers());
    all.params.forEach((x) => { bind[x.name] = values[x.prompt] ?? null; });
    const expanded = expandCrosstab(p, sqlText, bind);
    try {
      const r = p.db.query(expanded, filterBind(bind, expanded) as never);
      return { ...r, kind: 'rows', ms: performance.now() - t0, statement: expanded };
    } catch (e) { throw friendlyError(e, p, 'query'); }
  }
  const stmts = splitStatements(sqlText);
  if (!stmts.length) throw new WowError('There is no SQL to run.');
  let last: RunOutcome = { columns: [], rows: [], ms: 0, kind: 'changes', changes: 0 };
  let ddl = false;
  const inTx = stmts.length > 1;
  if (inTx) p.db.raw.run('SAVEPOINT wow_script');
  try {
    for (const raw of stmts) {
      const s = stripComments(raw).trim();
      if (PROTECTED.test(s) && !/^\s*(select|with|pragma|explain)\b/i.test(s)) throw new WowError('The WOWDB system tables (_wow_objects, _wow_meta) are protected and cannot be changed with SQL.');
      if (/^\s*(attach|detach)\b/i.test(s)) throw new WowError('ATTACH/DETACH is not available in WOWDB.');
      if (/^\s*pragma\s+(writable_schema|foreign_keys\s*=)/i.test(s)) throw new WowError('This PRAGMA is not allowed because it could damage the database.');
      // CREATE TABLE x AS SELECT → Make Table through the catalogue
      const mt = /^\s*create\s+table\s+(?:"((?:[^"]|"")+)"|\[([^\]]+)\]|(\w+))\s+as\s+([\s\S]+)$/i.exec(s);
      if (mt) {
        const name = (mt[1] ?? mt[2] ?? mt[3]).replace(/""/g, '"');
        const n = makeTable(p, name, mt[4], values);
        last = { columns: [], rows: [], ms: 0, kind: 'changes', changes: n, message: `${n} row(s) pasted into the new table "${name}".`, statement: s };
        ddl = true; continue;
      }
      const prepared = prepareParams(s, p.knownIdentifiers());
      const bind: Record<string, unknown> = {};
      prepared.params.forEach((x) => { bind[x.name] = coerceParam(values[x.prompt]); });
      const isRows = /^\s*(select|with|pragma|explain|values)\b/i.test(s) && !/^\s*with[\s\S]*\b(insert|update|delete)\b/i.test(s);
      if (isRows) {
        const sqlRun = opts.limitRows ? prepared.sql : prepared.sql;
        const r = p.db.query(sqlRun, prepared.params.length ? bind as never : undefined);
        last = { ...r, kind: 'rows', statement: s };
      } else {
        const isDdl = /^\s*(create|drop|alter)\b/i.test(s);
        p.db.raw.run(prepared.sql, prepared.params.length ? bind as never : undefined);
        const n = p.db.raw.getRowsModified();
        if (isDdl) ddl = true;
        last = { columns: [], rows: [], ms: 0, kind: isDdl ? 'ddl' : 'changes', changes: isDdl ? 0 : n, message: isDdl ? 'Statement completed.' : `${n} row(s) affected.`, statement: s };
      }
    }
    if (inTx) p.db.raw.run('RELEASE wow_script');
  } catch (e) {
    if (inTx) { try { p.db.raw.run('ROLLBACK TO wow_script'); p.db.raw.run('RELEASE wow_script'); } catch { /* ignore */ } }
    const target = /^\s*(?:insert\s+into|update|delete\s+from)\s+(?:"((?:[^"]|"")+)"|\[([^\]]+)\]|(\w+))/i.exec(stmts[stmts.length - 1]);
    const tname = target ? (target[1] ?? target[2] ?? target[3]) : undefined;
    const ctx = /^\s*delete/i.test(stmts[stmts.length - 1]) ? 'delete' : /^\s*update/i.test(stmts[stmts.length - 1]) ? 'update' : /^\s*insert/i.test(stmts[stmts.length - 1]) ? 'insert' : 'query';
    throw friendlyError(e, p, ctx, tname);
  }
  if (ddl) { p.syncCatalog(); p.recreateViews(); }
  if (last.kind !== 'rows') p.db.notify();
  return { ...last, ms: performance.now() - t0 };
}

function coerceParam(v: unknown): unknown {
  if (v === undefined || v === '') return null;
  if (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v.trim())) return Number(v);
  return v;
}

/** Make-table: infer field types from the result and create a proper WOWDB table. */
export function makeTable(p: WowProject, name: string, selectSql: string, values: Record<string, unknown> = {}): number {
  const prepared = prepareParams(selectSql.trim().replace(/;\s*$/, ''), p.knownIdentifiers());
  const bind: Record<string, unknown> = {};
  prepared.params.forEach((x) => { bind[x.name] = coerceParam(values[x.prompt]); });
  const r = p.db.query(prepared.sql, prepared.params.length ? bind as never : undefined);
  const fields: FieldDef[] = r.columns.map((c, i) => {
    const vals = r.rows.map((row) => row[i]).filter((v) => v !== null && v !== undefined);
    return { id: uid('f'), name: c, ...inferType(vals) };
  });
  if (p.getTable(name)) {
    if (p.relationships().some((x) => x.primaryTable.toLowerCase() === name.toLowerCase() || x.relatedTable.toLowerCase() === name.toLowerCase()))
      throw new WowError(`The table "${name}" has relationships, so a make-table query cannot replace it.`);
    p.deleteTable(name);
  }
  p.saveTableDesign({ name, fields });
  if (!r.rows.length) return 0;
  return p.db.transaction(() => {
    const cols = r.columns.map(q).join(', ');
    for (const row of r.rows) p.db.run(`INSERT INTO ${q(name)} (${cols}) VALUES (${r.columns.map(() => '?').join(', ')})`, row as never, true);
    return r.rows.length;
  });
}

export function inferType(vals: unknown[]): Pick<FieldDef, 'type' | 'numberSize' | 'fieldSize'> {
  if (!vals.length) return { type: 'Short Text', fieldSize: 255 };
  if (vals.every((v) => typeof v === 'number' && Number.isInteger(v))) return { type: 'Number', numberSize: 'Long Integer' };
  if (vals.every((v) => typeof v === 'number' || (typeof v === 'string' && v.trim() !== '' && !isNaN(Number(v))))) return { type: 'Number', numberSize: 'Double' };
  if (vals.every((v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2})?)?$/.test(v))) return { type: 'Date/Time' };
  const maxLen = Math.max(...vals.map((v) => String(v).length));
  return maxLen > 255 ? { type: 'Long Text' } : { type: 'Short Text', fieldSize: 255 };
}

/** Run a saved query definition. Action queries report affected rows. */
export function runQuery(p: WowProject, def: QueryDef, values: Record<string, unknown> = {}): RunOutcome {
  if (def.kind === 'maketable' && def.design?.targetTable) {
    const sel = def.sql.replace(/^\s*CREATE\s+TABLE\s+("(?:[^"]|"")+"|\[[^\]]+\]|\w+)\s+AS\s+/i, '');
    const n = makeTable(p, def.design.targetTable, sel, values);
    return { columns: [], rows: [], ms: 0, kind: 'changes', changes: n, message: `${n} row(s) pasted into the new table "${def.design.targetTable}".` };
  }
  return runSql(p, def.sql, values);
}

/** How many rows an action query will affect (shown before running it). */
export function previewActionCount(p: WowProject, def: QueryDef, values: Record<string, unknown> = {}): number | null {
  try {
    const s = def.sql.trim();
    let countSql: string | null = null;
    let m: RegExpExecArray | null;
    if ((m = /^\s*DELETE\s+FROM\s+(\S+)([\s\S]*)$/i.exec(s))) countSql = `SELECT count(*) FROM ${m[1]}${m[2]}`;
    else if ((m = /^\s*UPDATE\s+(\S+)\s+SET[\s\S]*?(\bWHERE\b[\s\S]*)?$/i.exec(s))) countSql = `SELECT count(*) FROM ${m[1]} ${m[2] ?? ''}`;
    else if ((m = /^\s*INSERT\s+INTO\s+\S+\s*\([^)]*\)\s*([\s\S]+)$/i.exec(s))) countSql = `SELECT count(*) FROM (${m[1]})`;
    else if ((m = /^\s*CREATE\s+TABLE\s+\S+\s+AS\s+([\s\S]+)$/i.exec(s))) countSql = `SELECT count(*) FROM (${m[1]})`;
    if (!countSql) return null;
    const prepared = prepareParams(countSql, p.knownIdentifiers());
    const bind: Record<string, unknown> = {};
    prepared.params.forEach((x) => { bind[x.name] = coerceParam(values[x.prompt]); });
    return Number(p.db.scalar(prepared.sql, prepared.params.length ? bind as never : undefined));
  } catch { return null; }
}

// ---------------- SQL → Design View ----------------

type STok = { t: 'id' | 'qid' | 'str' | 'num' | 'op' | 'param' | 'eof'; v: string };
function sqlTokens(sql: string): STok[] {
  const out: STok[] = []; let i = 0;
  while (i < sql.length) {
    const c = sql[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '-' && sql[i + 1] === '-') { const j = sql.indexOf('\n', i); i = j < 0 ? sql.length : j; continue; }
    if (c === "'") { let j = i + 1, s = ''; while (j < sql.length) { if (sql[j] === "'") { if (sql[j + 1] === "'") { s += "'"; j += 2; continue; } break; } s += sql[j++]; } out.push({ t: 'str', v: s }); i = j + 1; continue; }
    if (c === '"' || c === '`') { let j = i + 1, s = ''; while (j < sql.length) { if (sql[j] === c) { if (sql[j + 1] === c) { s += c; j += 2; continue; } break; } s += sql[j++]; } out.push({ t: 'qid', v: s }); i = j + 1; continue; }
    if (c === '[') { const j = sql.indexOf(']', i); out.push({ t: 'param', v: sql.slice(i + 1, j) }); i = j + 1; continue; }
    if (/[0-9]/.test(c)) { const m = /^\d+(\.\d+)?/.exec(sql.slice(i))!; out.push({ t: 'num', v: m[0] }); i += m[0].length; continue; }
    if (/[A-Za-z_]/.test(c)) { const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(sql.slice(i))!; out.push({ t: 'id', v: m[0] }); i += m[0].length; continue; }
    const two = sql.slice(i, i + 2);
    if (['<>', '<=', '>=', '!=', '||'].includes(two)) { out.push({ t: 'op', v: two }); i += 2; continue; }
    out.push({ t: 'op', v: c }); i++;
  }
  out.push({ t: 'eof', v: '' });
  return out;
}

class Unsupported extends Error {}

/**
 * Translate a simple SELECT into Design View. Throws Unsupported when the SQL
 * uses anything the grid cannot represent exactly (the query is then kept as SQL only).
 */
export function sqlToDesign(p: WowProject, sql: string): QueryDesign {
  const toks = sqlTokens(sql.trim().replace(/;\s*$/, ''));
  let i = 0;
  const peek = (o = 0) => toks[i + o];
  const kw = (w: string, o = 0) => peek(o).t === 'id' && peek(o).v.toLowerCase() === w;
  const eat = (w: string) => { if (!kw(w)) throw new Unsupported(`expected ${w}`); i++; };
  const ident = (): string => { const t = peek(); if (t.t === 'id' || t.t === 'qid' || t.t === 'param') { i++; return t.v; } throw new Unsupported('identifier'); };
  const reserved = new Set(['from', 'where', 'group', 'order', 'having', 'limit', 'inner', 'left', 'right', 'join', 'on', 'as', 'and', 'or', 'union', 'select']);

  const d = emptyDesign();
  eat('select');
  if (kw('distinct')) { i++; d.distinct = true; }
  type RawCol = { toks: STok[]; alias?: string };
  const rawCols: RawCol[] = [];
  for (;;) {
    const start = i; let depth = 0;
    while (peek().t !== 'eof') {
      const t = peek();
      if (t.t === 'op' && t.v === '(') depth++;
      if (t.t === 'op' && t.v === ')') depth--;
      if (depth === 0 && ((t.t === 'op' && t.v === ',') || kw('from') || kw('as'))) break;
      i++;
    }
    const colToks = toks.slice(start, i);
    let alias: string | undefined;
    if (kw('as')) { i++; alias = ident(); }
    rawCols.push({ toks: colToks, alias });
    if (peek().t === 'op' && peek().v === ',') { i++; continue; }
    break;
  }
  eat('from');
  const addTable = (): string => {
    const name = ident();
    let alias: string | undefined;
    if (kw('as')) { i++; alias = ident(); }
    else if (peek().t === 'id' && !reserved.has(peek().v.toLowerCase())) alias = ident();
    if (!p.getTable(name) && !p.getQuery(name)) throw new Unsupported('unknown table');
    if (d.tables.some((t) => tableRefName(d, t).toLowerCase() === (alias ?? name).toLowerCase())) throw new Unsupported('dup');
    d.tables.push({ id: uid('t'), name: p.getTable(name)?.name ?? p.getQuery(name)!.name, alias: alias && alias.toLowerCase() !== name.toLowerCase() ? alias : undefined, x: 20 + d.tables.length * 220, y: 20 });
    return alias ?? name;
  };
  addTable();
  const colRef = (): [string, string] => {
    const a = ident();
    if (peek().t === 'op' && peek().v === '.') { i++; return [a, ident()]; }
    const owner = d.tables.find((t) => p.columnsOf(t.name).some((c) => c.toLowerCase() === a.toLowerCase()));
    if (!owner) throw new Unsupported('col');
    return [tableRefName(d, owner), a];
  };
  for (;;) {
    let type: 'inner' | 'left' | 'right' | null = null;
    if (kw('inner') && kw('join', 1)) { i += 2; type = 'inner'; }
    else if (kw('join')) { i++; type = 'inner'; }
    else if (kw('left')) { i++; if (kw('outer')) i++; eat('join'); type = 'left'; }
    else if (kw('right')) { i++; if (kw('outer')) i++; eat('join'); type = 'right'; }
    else if (peek().t === 'op' && peek().v === ',') { i++; addTable(); continue; }
    if (!type) break;
    const rightName = addTable();
    eat('on');
    for (;;) {
      const [lt, lf] = colRef();
      if (!(peek().t === 'op' && peek().v === '=')) throw new Unsupported('join op');
      i++;
      const [rt, rf] = colRef();
      const leftIsNew = lt.toLowerCase() === rightName.toLowerCase();
      d.joins.push(leftIsNew ? { id: uid('j'), leftTable: rt, leftField: rf, rightTable: lt, rightField: lf, type } : { id: uid('j'), leftTable: lt, leftField: lf, rightTable: rt, rightField: rf, type });
      if (kw('and')) { i++; continue; }
      break;
    }
  }
  // columns
  const resolveCol = (ct: STok[]): { table?: string; field: string } | null => {
    if (ct.length === 3 && (ct[0].t === 'id' || ct[0].t === 'qid' || ct[0].t === 'param') && ct[1].v === '.' && ct[2].t !== 'op') {
      const t = d.tables.find((x) => tableRefName(d, x).toLowerCase() === ct[0].v.toLowerCase());
      if (!t) throw new Unsupported('tbl');
      const real = p.columnsOf(t.name).find((c) => c.toLowerCase() === ct[2].v.toLowerCase());
      if (!real) throw new Unsupported('fld');
      return { table: tableRefName(d, t), field: real };
    }
    if (ct.length === 3 && ct[1].v === '.' && ct[2].v === '*') {
      const t = d.tables.find((x) => tableRefName(d, x).toLowerCase() === ct[0].v.toLowerCase());
      if (!t) throw new Unsupported('tbl');
      return { table: tableRefName(d, t), field: '*' };
    }
    if (ct.length === 1 && ct[0].v === '*') return { field: '*', table: d.tables.length === 1 ? tableRefName(d, d.tables[0]) : undefined };
    if (ct.length === 1 && (ct[0].t === 'id' || ct[0].t === 'qid' || ct[0].t === 'param')) {
      const owner = d.tables.find((t) => p.columnsOf(t.name).some((c) => c.toLowerCase() === ct[0].v.toLowerCase()));
      if (!owner) throw new Unsupported('fld');
      return { table: tableRefName(d, owner), field: p.columnsOf(owner.name).find((c) => c.toLowerCase() === ct[0].v.toLowerCase())! };
    }
    return null;
  };
  const aggs = ['sum', 'avg', 'min', 'max', 'count'];
  let anyAgg = false;
  for (const rc of rawCols) {
    const c = newColumn();
    const ct = rc.toks;
    if (ct.length >= 4 && ct[0].t === 'id' && aggs.includes(ct[0].v.toLowerCase()) && ct[1].v === '(' && ct[ct.length - 1].v === ')') {
      const inner = ct.slice(2, -1);
      const r = inner.length === 1 && inner[0].v === '*' ? { field: '*', table: undefined } : resolveCol(inner);
      if (!r) throw new Unsupported('agg');
      const op = ct[0].v.toLowerCase();
      c.total = op === 'sum' ? 'Sum' : op === 'avg' ? 'Avg' : op === 'min' ? 'Min' : op === 'max' ? 'Max' : 'Count';
      c.field = r.field; c.table = r.table ?? (d.tables.length === 1 ? tableRefName(d, d.tables[0]) : undefined);
      if (rc.alias && rc.alias !== `${c.total}Of${c.field}`) c.alias = rc.alias;
      anyAgg = true;
    } else {
      const r = resolveCol(ct);
      if (!r) throw new Unsupported('expr');
      c.field = r.field; c.table = r.table;
      if (rc.alias && rc.alias.toLowerCase() !== r.field.toLowerCase()) c.alias = rc.alias;
      else if (rc.alias) c.alias = undefined;
    }
    d.columns.push(c);
  }
  const findOrAddHidden = (table: string, field: string): QueryColumn => {
    let c = d.columns.find((x) => x.table?.toLowerCase() === table.toLowerCase() && x.field.toLowerCase() === field.toLowerCase() && (!x.total || x.total === 'Group By'));
    if (!c) { c = newColumn(field, table); c.show = false; d.columns.push(c); }
    return c;
  };
  // WHERE: OR of ANDs of simple predicates
  if (kw('where')) {
    i++;
    type Pred = { col: QueryColumn; crit: string };
    const value = (): string => {
      const t = peek();
      if (t.t === 'str') { i++; return `"${t.v.replace(/"/g, '""')}"`; }
      if (t.t === 'num') { i++; return t.v; }
      if (t.t === 'op' && t.v === '-' && peek(1).t === 'num') { i += 2; return '-' + peek(-1).v; }
      if (t.t === 'param') { i++; return `[${t.v}]`; }
      if (t.t === 'id' && t.v.toLowerCase() === 'null') { i++; return 'Null'; }
      throw new Unsupported('value');
    };
    const parsePredTail = (): string => {
      const t = peek();
      if (t.t === 'op' && ['=', '<>', '!=', '<', '>', '<=', '>='].includes(t.v)) {
        i++; const v = value();
        return t.v === '=' ? v : `${t.v === '!=' ? '<>' : t.v}${v}`;
      }
      let not = false;
      if (kw('not')) { i++; not = true; }
      if (kw('like')) { i++; const pt = peek(); if (pt.t !== 'str') throw new Unsupported('like'); i++; return `${not ? 'Not ' : ''}Like "${pt.v.replace(/%/g, '*').replace(/_/g, '?')}"`; }
      if (kw('between')) { i++; const a = value(); eat('and'); const b = value(); return `${not ? 'Not ' : ''}Between ${a} And ${b}`; }
      if (kw('in')) { i++; if (peek().v !== '(') throw new Unsupported('in'); i++; const vs: string[] = []; for (;;) { vs.push(value()); if (peek().v === ',') { i++; continue; } break; } if (peek().v !== ')') throw new Unsupported('in)'); i++; return `${not ? 'Not ' : ''}In (${vs.join(', ')})`; }
      if (!not && kw('is')) { i++; let n = false; if (kw('not')) { i++; n = true; } eat('null'); return n ? 'Is Not Null' : 'Is Null'; }
      throw new Unsupported('pred');
    };
    // boolean expression → OR of AND-lists (exactly the shape of the criteria grid)
    const parseOr = (): Pred[][] => { let rows = parseAnd(); while (kw('or')) { i++; rows = rows.concat(parseAnd()); } return rows; };
    const parseAnd = (): Pred[][] => {
      let acc: Pred[][] = [[]];
      for (;;) {
        const term = parseAtom();
        if (term.length === 1) acc = acc.map((a) => [...a, ...term[0]]);
        else if (acc.length === 1 && acc[0].length === 0) acc = term;
        else throw new Unsupported('distribution');
        if (kw('and')) { i++; if (acc.length > 1) throw new Unsupported('distribution'); continue; }
        return acc;
      }
    };
    const parseAtom = (): Pred[][] => {
      if (peek().t === 'op' && peek().v === '(') { i++; const inner = parseOr(); if (!(peek().t === 'op' && peek().v === ')')) throw new Unsupported(')'); i++; return inner; }
      if (kw('not')) throw new Unsupported('not');
      const [t, f] = colRef();
      const col = findOrAddHidden(t, f);
      return [[{ col, crit: parsePredTail() }]];
    };
    const orRows = parseOr();
    // place into criteria rows; two predicates on the same column in one row → combine with And
    orRows.forEach((row, r) => {
      for (const { col, crit } of row) {
        while (col.criteria.length <= r) col.criteria.push('');
        col.criteria[r] = col.criteria[r] ? `${col.criteria[r]} And ${crit}` : crit;
      }
    });
    d.columns.forEach((c) => { while (c.criteria.length < Math.max(2, orRows.length)) c.criteria.push(''); });
  }
  if (kw('group')) {
    i++; eat('by');
    for (;;) { colRef(); if (peek().v === ',') { i++; continue; } break; }
    anyAgg = true;
  }
  if (anyAgg) { d.totals = true; d.columns.forEach((c) => { if (!c.total) c.total = 'Group By'; }); }
  if (kw('order')) {
    i++; eat('by');
    for (;;) {
      let col: QueryColumn | undefined;
      const t0 = peek();
      if ((t0.t === 'qid' || t0.t === 'id') && !(peek(1).v === '.')) {
        const byAlias = d.columns.find((c) => (c.alias ?? '').toLowerCase() === t0.v.toLowerCase());
        if (byAlias) { i++; col = byAlias; }
      }
      if (!col) { const [t, f] = colRef(); col = findOrAddHidden(t, f); }
      let dir: 'Ascending' | 'Descending' = 'Ascending';
      if (kw('asc')) i++; else if (kw('desc')) { i++; dir = 'Descending'; }
      col.sort = dir;
      if (peek().v === ',') { i++; continue; }
      break;
    }
  }
  if (kw('limit')) { i++; const t = peek(); if (t.t !== 'num') throw new Unsupported('limit'); i++; d.top = t.v; }
  if (peek().t !== 'eof') throw new Unsupported('trailing');
  // sort order in the grid must match ORDER BY order: require sorted columns appear in grid order
  return d;
}

/** Try translating SQL to design; returns null if it cannot be represented exactly. */
export function trySqlToDesign(p: WowProject, sql: string): QueryDesign | null {
  if (!/^\s*select\b/i.test(sql) || isCrosstabSql(sql)) return null;
  try {
    const d = sqlToDesign(p, sql);
    // round-trip check: regenerate and re-parse; the designs must be identical
    const regen = designToSql(p, d, 'select');
    const d2 = sqlToDesign(p, regen);
    const norm = (x: QueryDesign) => JSON.stringify({ ...x, tables: x.tables.map((t) => [t.name, t.alias]), joins: x.joins.map((j) => [j.leftTable, j.leftField, j.rightTable, j.rightField, j.type]), columns: x.columns.map((c) => [c.field, c.table, c.alias, c.sort, c.show, c.criteria.filter(Boolean), c.total]) });
    if (norm(d) !== norm(d2)) return null;
    // ORDER BY sequence must equal grid order of sorted columns
    const want = orderSignature(sql);
    const got = orderSignature(regen);
    if (want !== got) return null;
    return d;
  } catch (e) {
    if (e instanceof Unsupported || e instanceof ExprError || e instanceof WowError) return null;
    return null;
  }
}
function orderSignature(sql: string): string {
  const m = /\border\s+by\s+([\s\S]*?)(\blimit\b|$)/i.exec(stripStrings(sql));
  return m ? m[1].replace(/\s+/g, ' ').replace(/"/g, '').trim().toLowerCase().replace(/\basc\b/g, '').replace(/\s+,/g, ',').replace(/\s+$/, '') : '';
}

/** Tables (from the design) that a table-based query depends on. */
export function queryDependencies(p: WowProject, def: QueryDef): string[] {
  if (def.design) return [...new Set(def.design.tables.map((t) => t.name).concat(def.design.targetTable ? [def.design.targetTable] : []))];
  const names = [...p.tableNames(), ...p.listObjects('query').map((o) => o.name)];
  const s = def.sql.toLowerCase();
  return names.filter((n) => new RegExp(`(["\\[\\s,(]|^)${escapeRe(n.toLowerCase())}(["\\]\\s,);.]|$)`).test(s) && n.toLowerCase() !== def.name.toLowerCase());
}

/** Fields available for the query designer table box. */
export function fieldsOfSource(p: WowProject, name: string): { name: string; pk: boolean; type?: string }[] {
  const t: TableDef | undefined = p.getTable(name);
  if (t) return t.fields.map((f) => ({ name: f.name, pk: !!f.primaryKey, type: f.type }));
  return p.columnsOf(name).map((c) => ({ name: c, pk: false }));
}
