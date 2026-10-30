'use client';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { WowProject } from '@/engine/project';
import { uid } from '@/engine/project';
import type { QueryColumn, QueryDef, QueryDesign, QueryKind, TotalOp } from '@/engine/types';
import { designToSql, emptyDesign, fieldsOfSource, newColumn, previewActionCount, queryParameters, runSql, trySqlToDesign, isCrosstabSql, type RunOutcome } from '@/engine/queries';
import { TableCanvas, type BoxDef } from '../designers/TableCanvas';
import { DataGrid } from '../DataGrid';
import { SqlEditor } from '../SqlEditor';
import { useApp, type Tab } from '../store';
import { useEditorCommands } from '../commands';
import { askParameters, confirmBox, errorBox, messageBox, openDialog, promptBox, showContextMenu } from '../dialogs';
import { useHistory } from '../useHistory';
import { JoinTypeBody, ShowTableDialog } from './RelationshipsEditor';
import { LearnTip } from '../shell/LearnTip';
import { ExpressionBuilder } from '../dialogs/ExpressionBuilder';

interface QState { kind: QueryKind; design: QueryDesign; sql: string; mode: 'design' | 'sql'; }
const TOTALS: TotalOp[] = ['Group By', 'Sum', 'Avg', 'Min', 'Max', 'Count', 'First', 'Last', 'Expression', 'Where'];

export function QueryEditor({ tab, active, project: p }: { tab: Tab; active: boolean; project: WowProject }) {
  const updateTab = useApp((s) => s.updateTab);
  const version = useApp((s) => s.version);
  const init = (): QState => {
    const d = tab.name ? p.getQuery(tab.name) : undefined;
    if (d) return { kind: d.kind, design: d.design ?? emptyDesign(), sql: d.sql, mode: d.design && !d.sqlOnly ? 'design' : 'sql' };
    const seeded = (tab.payload?.design as QueryDesign | undefined) ?? emptyDesign();
    return { kind: (tab.payload?.kind as QueryKind) ?? 'select', design: seeded, sql: (tab.payload?.sql as string) ?? '', mode: tab.payload?.sqlMode ? 'sql' : 'design' };
  };
  const hist = useHistory<QState>(init());
  const st = hist.value;
  const [savedJson, setSavedJson] = useState(() => tab.name ? JSON.stringify(init()) : '');
  const dirty = JSON.stringify(st) !== savedJson && (!!tab.name || st.design.tables.length > 0 || st.sql.trim() !== '');
  useEffect(() => { if (!!tab.dirty !== dirty) updateTab(tab.id, { dirty }); }, [dirty]); // eslint-disable-line react-hooks/exhaustive-deps

  const [result, setResult] = useState<RunOutcome | null>(null);
  const [runErr, setRunErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selBox, setSelBox] = useState<string | null>(null);
  const [selJoin, setSelJoin] = useState<string | null>(null);
  const [selCol, setSelCol] = useState<number | null>(null);
  const [extraOr, setExtraOr] = useState(0);
  const [showTableNames, setShowTableNames] = useState(true);
  const [focusCell, setFocusCell] = useState<{ col: number; row: string } | null>(null);
  const [critRow, setCritRow] = useState<number | null>(null);
  const [topH, setTopH] = useState(46);

  const design = st.design;
  const setDesign = (d: QueryDesign, commit = false) => { const ns = { ...st, design: d, sql: safeSql(p, d, st.kind) ?? st.sql }; if (commit) hist.commit(ns); else hist.set(ns); };
  const genSql = useMemo(() => { try { return { sql: designToSql(p, design, st.kind), err: null as string | null }; } catch (e) { return { sql: '', err: (e as Error).message }; } }, [p, design, st.kind, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const currentSql = st.mode === 'design' ? genSql.sql : st.sql;

  // ---------- design operations ----------
  const withTable = (d: QueryDesign, name: string, x?: number, y?: number): QueryDesign => {
    if (!p.getTable(name) && !p.getQuery(name)) return d;
    if (tab.name && name.toLowerCase() === tab.name.toLowerCase()) { void messageBox('A query cannot use itself as a source.'); return d; }
    let alias: string | undefined;
    const sameCount = d.tables.filter((t) => t.name.toLowerCase() === name.toLowerCase()).length;
    if (sameCount) alias = `${name}_${sameCount}`;
    const ref = { id: uid('t'), name: p.getTable(name)?.name ?? p.getQuery(name)!.name, alias, x: x ?? 20 + d.tables.length * 210, y: y ?? 20 };
    const refName = alias ?? ref.name;
    const joins = [...d.joins];
    for (const r of p.relationships()) {
      for (const t of d.tables) {
        const tn = t.alias ?? t.name;
        if (r.primaryTable === t.name && r.relatedTable === ref.name) joins.push({ id: uid('j'), leftTable: tn, leftField: r.fields[0].primary, rightTable: refName, rightField: r.fields[0].related, type: r.joinType ?? 'inner' });
        else if (r.relatedTable === t.name && r.primaryTable === ref.name) joins.push({ id: uid('j'), leftTable: refName, leftField: r.fields[0].primary, rightTable: tn, rightField: r.fields[0].related, type: r.joinType ?? 'inner' });
      }
    }
    return { ...d, tables: [...d.tables, ref], joins };
  };
  const addTable = (name: string, x?: number, y?: number) => setDesign(withTable(design, name, x, y), true);
  const removeTable = (id: string) => {
    const t = design.tables.find((x) => x.id === id); if (!t) return;
    const n = t.alias ?? t.name;
    setDesign({ ...design, tables: design.tables.filter((x) => x.id !== id), joins: design.joins.filter((j) => j.leftTable !== n && j.rightTable !== n), columns: design.columns.filter((c) => c.table !== n) }, true);
  };
  const insertColumn = (field: string, table: string, at?: number) => {
    const c = newColumn(field, table);
    if (design.totals) c.total = 'Group By';
    if (st.kind === 'append' && design.targetTable) { const tf = p.getTable(design.targetTable)?.fields.find((f) => f.name.toLowerCase() === field.toLowerCase()); if (tf) c.appendTo = tf.name; }
    const cols = [...design.columns];
    cols.splice(at === undefined ? cols.length : Math.max(0, Math.min(cols.length, at)), 0, c);
    setDesign({ ...design, columns: cols }, true);
  };
  const updateCol = (i: number, patch: Partial<QueryColumn>) => {
    const cols = [...design.columns];
    if (i >= cols.length) { cols.push({ ...newColumn(), ...(design.totals ? { total: 'Group By' as TotalOp } : {}), ...patch }); }
    else cols[i] = { ...cols[i], ...patch };
    setDesign({ ...design, columns: cols });
  };
  const deleteColumn = (i: number) => setDesign({ ...design, columns: design.columns.filter((_, k) => k !== i) }, true);
  const moveColumn = (from: number, to: number) => {
    const cols = [...design.columns]; const [c] = cols.splice(from, 1); cols.splice(to > from ? to - 1 : to, 0, c);
    setDesign({ ...design, columns: cols }, true);
  };

  const setKind = async (k: QueryKind) => {
    let target = design.targetTable;
    if ((k === 'maketable' || k === 'append') && !target) {
      const v = k === 'maketable' ? await promptBox('Table Name (new table):', 'NewTable', 'Make Table') : await openDialog<string>('Append', (close) => <PickTable p={p} close={close} />, 340);
      if (!v) return;
      target = v;
    }
    if ((k === 'update' || k === 'delete') && !target) target = design.tables[0]?.name;
    const ns: QState = { ...st, kind: k, mode: 'design', design: { ...design, targetTable: target, totals: k === 'crosstab' ? true : k === 'select' ? design.totals : false } };
    if (k === 'crosstab') ns.design.columns = ns.design.columns.map((c, i) => ({ ...c, total: c.total ?? 'Group By', crosstab: c.crosstab || (i === 0 ? 'Row Heading' : i === 1 ? 'Column Heading' : i === 2 ? 'Value' : '') }));
    ns.sql = safeSql(p, ns.design, k) ?? st.sql;
    hist.commit(ns);
  };

  // ---------- run / views ----------
  const runSelect = useCallback(async (): Promise<boolean> => {
    setRunErr(null); setNotice(null);
    const sqlRun = st.kind === 'select' || st.kind === 'crosstab' ? currentSql : (() => { try { return designToSql(p, design, 'select'); } catch { return ''; } })();
    if (!sqlRun) { setRunErr(genSql.err ?? 'There is nothing to run yet. Add tables and fields, or write SQL.'); return false; }
    const prompts = queryParameters(p, sqlRun);
    const vals = prompts.length ? await askParameters(prompts) : {};
    if (!vals) return false;
    try {
      const r = runSql(p, sqlRun, vals);
      setResult(r);
      if (r.kind !== 'rows') setNotice(r.message ?? null);
      useApp.getState().setStatus(`Query returned ${r.rows.length} row(s) in ${r.ms.toFixed(1)} ms.`);
      return true;
    } catch (e) { setRunErr((e as Error).message); return false; }
  }, [st.kind, currentSql, p, design, genSql.err]);

  const runAction = async () => {
    const def: QueryDef = { name: tab.name || 'Query', kind: st.kind, sql: currentSql, design };
    if (!currentSql) { setRunErr(genSql.err ?? 'There is nothing to run.'); return; }
    const prompts = queryParameters(p, currentSql);
    const vals = prompts.length ? await askParameters(prompts) : {};
    if (!vals) return;
    const n = previewActionCount(p, def, vals);
    const verb = st.kind === 'delete' ? 'delete' : st.kind === 'update' ? 'update' : st.kind === 'append' ? 'append' : 'paste';
    const msg = st.kind === 'maketable' ? `You are about to paste ${n ?? 'the'} row(s) into a new table "${design.targetTable}".${p.getTable(design.targetTable ?? '') ? `\n\nThe existing table "${design.targetTable}" will be deleted first.` : ''}` : `You are about to ${verb} ${n ?? 'the matching'} row(s).`;
    if (!(await confirmBox(`${msg}\n\nOnce you click Yes, you can't use the Undo command to reverse the changes.\nAre you sure you want to continue?`, { title: 'WOWDB', danger: st.kind === 'delete' || st.kind === 'maketable' }))) return;
    try {
      const { runQuery } = await import('@/engine/queries');
      const r = runQuery(p, def, vals);
      setNotice(r.message ?? 'Done.');
      void messageBox(r.message ?? 'Done.', 'Query complete');
    } catch (e) { void errorBox(e, 'Query failed'); }
  };

  const switchView = async (view: 'design' | 'sql' | 'datasheet') => {
    if (view === 'datasheet') { if (await runSelect()) updateTab(tab.id, { view: 'datasheet' }); return; }
    if (view === 'sql') {
      if (st.mode === 'design') hist.commit({ ...st, mode: 'sql', sql: genSql.sql || st.sql });
      updateTab(tab.id, { view: 'sql' });
      return;
    }
    // to design
    if (st.mode === 'sql') {
      if (!st.sql.trim()) { hist.commit({ ...st, mode: 'design', design: emptyDesign() }); updateTab(tab.id, { view: 'design' }); return; }
      if (st.sql.trim() === genSql.sql.trim()) { hist.commit({ ...st, mode: 'design' }); updateTab(tab.id, { view: 'design' }); return; }
      const d = trySqlToDesign(p, st.sql);
      if (!d) { setNotice('This SQL cannot be shown exactly in Design View (for example it uses subqueries, UNION, functions or other advanced features). It is kept as SQL so its meaning does not change.'); return; }
      hist.commit({ ...st, mode: 'design', design: d, kind: 'select' });
      setNotice(null);
    }
    updateTab(tab.id, { view: 'design' });
  };

  const save = async (saveAs = false): Promise<boolean> => {
    let name = tab.name;
    if (!name || saveAs) {
      const n = await promptBox('Query Name:', saveAs && name ? `Copy of ${name}` : `Query${p.listObjects('query').length + 1}`, saveAs ? 'Save As' : 'Save As', (v) => { try { p.validateObjectName(v, 'query', name && !saveAs ? { type: 'query', name } : undefined); return null; } catch (e) { return (e as Error).message; } });
      if (!n) return false;
      name = n.trim();
    }
    const sql = st.mode === 'design' ? genSql.sql : st.sql;
    if (st.mode === 'design' && genSql.err) { await errorBox(genSql.err, 'The query was not saved'); return false; }
    const kind: QueryKind = st.mode === 'sql' ? detectKind(sql, st.kind) : st.kind;
    const designOk = st.mode === 'design' || (st.sql.trim() === genSql.sql.trim() && !genSql.err);
    const def: QueryDef = { name, kind, sql, design: designOk ? design : trySqlToDesign(p, sql) ?? undefined, sqlOnly: !designOk && !trySqlToDesign(p, sql) };
    try {
      p.saveQuery(def, saveAs ? undefined : tab.name || undefined);
      const ns = { ...st, kind };
      hist.reset(ns); setSavedJson(JSON.stringify(ns));
      if (saveAs && tab.name) useApp.getState().openTab({ kind: 'query', name, title: name, view: tab.view });
      else updateTab(tab.id, { name, title: name, dirty: false, isNew: false });
      useApp.getState().setStatus(`Query "${name}" saved${p.viewable(def) ? ' (also created as a database view)' : ''}.`);
      return true;
    } catch (e) { await errorBox(e, 'The query was not saved'); return false; }
  };

  // re-run results when data changes while showing datasheet
  const lastVersion = useRef(version);
  useEffect(() => {
    if (tab.view === 'datasheet' && result && version !== lastVersion.current && queryParameters(p, currentSql).length === 0) {
      try { setResult(runSql(p, st.kind === 'select' || st.kind === 'crosstab' ? currentSql : designToSql(p, design, 'select'))); } catch { /* keep old */ }
    }
    lastVersion.current = version;
  }, [version]); // eslint-disable-line react-hooks/exhaustive-deps

  const view = (tab.view === 'design' && st.mode === 'sql' ? 'sql' : tab.view) as 'design' | 'sql' | 'datasheet';
  const isAction = st.kind !== 'select' && st.kind !== 'crosstab';
  const top = (v: string) => ({ run: () => setDesign({ ...design, top: v }, true), checked: (design.top || 'all') === v, enabled: view === 'design' && st.kind === 'select' });
  useEditorCommands(tab.id, active, {
    'view.design': { run: () => void switchView('design'), checked: view === 'design' },
    'view.sql': { run: () => void switchView('sql'), checked: view === 'sql' },
    'view.datasheet': { run: () => void switchView('datasheet'), checked: view === 'datasheet' },
    'view.toggle': () => void switchView(view === 'datasheet' ? 'design' : 'datasheet'),
    'q.run': () => { if (isAction) void runAction(); else void switchView('datasheet'); },
    'q.type.select': { run: () => void setKind('select'), checked: st.kind === 'select', enabled: st.mode === 'design' },
    'q.type.maketable': { run: () => void setKind('maketable'), checked: st.kind === 'maketable', enabled: st.mode === 'design' },
    'q.type.append': { run: () => void setKind('append'), checked: st.kind === 'append', enabled: st.mode === 'design' },
    'q.type.update': { run: () => void setKind('update'), checked: st.kind === 'update', enabled: st.mode === 'design' },
    'q.type.crosstab': { run: () => void setKind('crosstab'), checked: st.kind === 'crosstab', enabled: st.mode === 'design' },
    'q.type.delete': { run: () => void setKind('delete'), checked: st.kind === 'delete', enabled: st.mode === 'design' },
    'q.showTable': { run: () => void showTableDlg(), enabled: view === 'design' },
    'q.insertColumn': { run: () => { const cols = [...design.columns]; cols.splice(selCol ?? cols.length, 0, newColumn()); setDesign({ ...design, columns: cols }, true); }, enabled: view === 'design' },
    'q.deleteColumn': { run: () => { if (selCol !== null) deleteColumn(selCol); }, enabled: view === 'design' && selCol !== null && selCol < design.columns.length },
    'q.builder': { run: () => void builder(), enabled: view === 'design' },
    'q.totals': { run: () => setDesign({ ...design, totals: !design.totals, columns: design.columns.map((c) => ({ ...c, total: c.total ?? 'Group By' })) }, true), checked: design.totals, enabled: view === 'design' && (st.kind === 'select' || st.kind === 'maketable' || st.kind === 'append') },
    'q.distinct': { run: () => setDesign({ ...design, distinct: !design.distinct }, true), checked: design.distinct, enabled: view === 'design' && st.kind === 'select' },
    'q.parameters': () => { const ps = queryParameters(p, currentSql); void messageBox(ps.length ? `This query asks for:\n\n${ps.map((x) => '• ' + x).join('\n')}\n\nType a parameter in the Criteria row inside square brackets, e.g. [Enter class].` : 'This query has no parameters. Type a prompt in square brackets in the Criteria row, e.g. [Enter town], to create one.', 'Query Parameters'); },
    'q.saveAs': () => void save(true),
    'q.insertRows': { run: () => {
      const k = focusCell?.row === 'criteria' ? critRow : null;
      if (k === null) { setExtraOr((n) => n + 1); return; }
      setDesign({ ...design, columns: design.columns.map((c) => { const cr = [...c.criteria]; while (cr.length < k) cr.push(''); cr.splice(k, 0, ''); return { ...c, criteria: cr }; }) }, true);
    }, enabled: view === 'design' },
    'q.deleteRows': { run: () => {
      const k = critRow ?? 0;
      setDesign({ ...design, columns: design.columns.map((c) => { const cr = [...c.criteria]; cr.splice(k, 1); return { ...c, criteria: cr.length ? cr : [''] }; }) }, true);
      setExtraOr((n) => Math.max(0, n - 1));
    }, enabled: view === 'design' && focusCell?.row === 'criteria' },
    'q.tableNames': { run: () => setShowTableNames(!showTableNames), checked: showTableNames, enabled: view === 'design' },
    'q.union': { run: () => {
      const names = design.tables.map((t) => t.name);
      const first = genSql.sql && !genSql.err ? genSql.sql.replace(/;\s*$/, '') : `SELECT ${names[0] ? '*' : 'Field1'} FROM ${names[0] ? `[${names[0]}]` : 'Table1'}`;
      const sql = `${first}\nUNION\nSELECT ${names[1] ? '*' : 'Field1'} FROM ${names[1] ? `[${names[1]}]` : 'Table2'}`;
      hist.commit({ ...st, mode: 'sql', kind: 'select', sql }); updateTab(tab.id, { view: 'sql' });
      setNotice('Union query: each SELECT must return the same number of columns. UNION removes duplicate rows; use UNION ALL to keep them. Union queries are written in SQL View.');
    }, enabled: true },
    'q.dataDefinition': { run: () => {
      hist.commit({ ...st, mode: 'sql', kind: 'select', sql: 'CREATE TABLE NewTable (\n  NewTableID INTEGER PRIMARY KEY AUTOINCREMENT,\n  Name TEXT NOT NULL,\n  Created TEXT DEFAULT CURRENT_TIMESTAMP\n);' }); updateTab(tab.id, { view: 'sql' });
      setNotice('Data definition query: CREATE TABLE, ALTER TABLE, CREATE INDEX and DROP statements change the database structure. Click Run to execute; the new objects appear in the Navigation Pane.');
    }, enabled: true },
    'q.top.all': top('all'), 'q.top.5': top('5'), 'q.top.25': top('25'), 'q.top.100': top('100'), 'q.top.5p': top('5%'), 'q.top.25p': top('25%'),
    save: () => save(false),
    undo: { run: hist.undo, enabled: hist.canUndo && view !== 'datasheet' },
    redo: { run: hist.redo, enabled: hist.canRedo && view !== 'datasheet' },
  });

  async function showTableDlg() {
    const res = await openDialog<string[]>('Show Table', (close) => <ShowTableDialog names={p.tableNames()} queries={p.listObjects('query').map((o) => o.name).filter((n) => n !== tab.name)} close={close} />, 340);
    if (res) { let d = design; for (const n of res) d = withTable(d, n); setDesign(d, true); }
  }
  async function builder() {
    const fields = design.tables.flatMap((t) => fieldsOfSource(p, t.name).map((f) => `[${t.alias ?? t.name}].[${f.name}]`));
    const col = selCol ?? design.columns.length;
    const cur = design.columns[col];
    const res = await openDialog<string>('Expression Builder', (close) => <ExpressionBuilder initial={focusCell?.row === 'criteria' && cur ? cur.criteria[0] : cur?.field ?? ''} fields={fields} close={close} />, 640);
    if (res === null) return;
    if (focusCell?.row === 'criteria' && cur) { const cr = [...cur.criteria]; cr[0] = res; updateCol(col, { criteria: cr }); }
    else updateCol(col, { field: /^[^:[\]"']+:/.test(res) ? res : `Expr${col + 1}: ${res}`, table: '' });
  }

  const boxes: BoxDef[] = design.tables.map((t) => ({ id: t.id, name: t.name, label: t.alias ? `${t.alias} (${t.name})` : t.name, x: t.x, y: t.y }));
  const idOf = (refName: string) => design.tables.find((t) => (t.alias ?? t.name).toLowerCase() === refName.toLowerCase())?.id ?? '';
  const links = design.joins.map((j) => ({ id: j.id, from: { box: idOf(j.leftTable), field: j.leftField }, to: { box: idOf(j.rightTable), field: j.rightField }, kind: j.type }));

  const editJoin = async (id: string) => {
    const j = design.joins.find((x) => x.id === id); if (!j) return;
    const v = await openDialog<'inner' | 'left' | 'right'>('Join Properties', (close) => <JoinTypeBody left={j.leftTable} right={j.rightTable} lf={j.leftField} rf={j.rightField} value={j.type} close={close} />, 520);
    if (v) setDesign({ ...design, joins: design.joins.map((x) => (x.id === id ? { ...x, type: v } : x)) }, true);
  };

  const rowsShown: string[] = showTableNames ? ['field', 'table'] : ['field'];
  if (design.totals || st.kind === 'crosstab') rowsShown.push('total');
  if (st.kind === 'crosstab') rowsShown.push('crosstab');
  if (st.kind === 'update') rowsShown.push('updateTo');
  if (st.kind === 'append') rowsShown.push('appendTo');
  if (st.kind !== 'update' && st.kind !== 'delete') rowsShown.push('sort');
  if (st.kind !== 'update' && st.kind !== 'delete' && st.kind !== 'crosstab') rowsShown.push('show');
  const orCount = Math.max(2 + extraOr, ...design.columns.map((c) => c.criteria.length));
  for (let i = 0; i < orCount; i++) rowsShown.push('crit' + i);
  const ROW_LABEL: Record<string, string> = { field: 'Field:', table: 'Table:', total: 'Total:', crosstab: 'Crosstab:', updateTo: 'Update To:', appendTo: 'Append To:', sort: 'Sort:', show: 'Show:' };
  const gridCols = [...design.columns, newColumn()];
  const allSources = design.tables.map((t) => t.alias ?? t.name);
  const fieldOptions = design.tables.flatMap((t) => ['*', ...fieldsOfSource(p, t.name).map((f) => f.name)].map((f) => ({ t: t.alias ?? t.name, f })));
  const targetFields = design.targetTable ? (p.getTable(design.targetTable)?.fields.map((f) => f.name) ?? []) : [];
  const [dragColIdx, setDragColIdx] = useState<number | null>(null);

  const cell = (c: QueryColumn, i: number, row: string) => {
    const isPh = i >= design.columns.length;
    const focus = () => { setSelCol(i); setFocusCell({ col: i, row: row.startsWith('crit') ? 'criteria' : row }); setCritRow(row.startsWith('crit') ? Number(row.slice(4)) : null); };
    switch (row) {
      case 'field': return <><input list={`qf-${tab.id}`} value={c.field} onFocus={focus} onChange={(e) => { const v = e.target.value; const m = fieldOptions.find((o) => `${o.t}.${o.f}` === v); if (m) updateCol(i, { field: m.f, table: m.t }); else { const own = !c.table && fieldOptions.find((o) => o.f.toLowerCase() === v.toLowerCase()); updateCol(i, own ? { field: own.f, table: own.t } : { field: v }); } }} aria-label={`Field ${i + 1}`} /></>;
      case 'table': return <select value={c.table ?? ''} onFocus={focus} onChange={(e) => updateCol(i, { table: e.target.value })} disabled={isPh && !c.field}><option value="" />{allSources.map((s) => <option key={s}>{s}</option>)}</select>;
      case 'total': return <select value={c.total ?? 'Group By'} onFocus={focus} onChange={(e) => updateCol(i, { total: e.target.value as TotalOp })}>{TOTALS.map((t) => <option key={t}>{t}</option>)}</select>;
      case 'crosstab': return <select value={c.crosstab ?? ''} onFocus={focus} onChange={(e) => updateCol(i, { crosstab: e.target.value as QueryColumn['crosstab'] })}><option value="">(not shown)</option><option>Row Heading</option><option>Column Heading</option><option>Value</option></select>;
      case 'updateTo': return <input value={c.updateTo ?? ''} onFocus={focus} placeholder={isPh ? '' : 'e.g. [Price]*1.1'} onChange={(e) => updateCol(i, { updateTo: e.target.value })} />;
      case 'appendTo': return <select value={c.appendTo ?? ''} onFocus={focus} onChange={(e) => updateCol(i, { appendTo: e.target.value })}><option value="" />{targetFields.map((f) => <option key={f}>{f}</option>)}</select>;
      case 'sort': return <select value={c.sort ?? ''} onFocus={focus} onChange={(e) => updateCol(i, { sort: e.target.value as QueryColumn['sort'] })}><option value="">(not sorted)</option><option>Ascending</option><option>Descending</option></select>;
      case 'show': return isPh ? null : <div className="center" style={{ textAlign: 'center' }}><input type="checkbox" className="chk" checked={c.show} onFocus={focus} onChange={(e) => updateCol(i, { show: e.target.checked })} aria-label={`Show ${c.field}`} /></div>;
      default: {
        const k = Number(row.slice(4));
        return <input value={c.criteria[k] ?? ''} onFocus={focus} aria-label={`${k === 0 ? 'Criteria' : 'Or'} ${i + 1}`} onChange={(e) => { const cr = [...c.criteria]; while (cr.length <= k) cr.push(''); cr[k] = e.target.value; if (k === cr.length - 1 && e.target.value) cr.push(''); updateCol(i, { criteria: cr }); }} />;
      }
    }
  };

  return (
    <div className="qd">
      <LearnTip k={view === 'design' ? 'query-design' : view === 'sql' ? 'query-sql' : 'query-datasheet'} />
      {notice && <div className="banner warn">{notice}<span style={{ flex: 1 }} /><button className="link" onClick={() => setNotice(null)}>Dismiss</button></div>}
      {runErr && view !== 'datasheet' && <div className="banner err">{runErr}<span style={{ flex: 1 }} /><button className="link" onClick={() => setRunErr(null)}>Dismiss</button></div>}
      {isAction && view === 'design' && <div className="banner info">{st.kind === 'maketable' ? `Make Table query: results will be written to a new table "${design.targetTable}".` : st.kind === 'append' ? `Append query: rows will be added to "${design.targetTable}". Choose the target field in the Append To row.` : st.kind === 'update' ? `Update query on "${design.targetTable ?? design.tables[0]?.name ?? ''}": type the new value or expression in the Update To row.` : `Delete query: matching records in "${design.targetTable ?? design.tables[0]?.name ?? ''}" will be deleted.`} Click Run to execute it. Datasheet View previews the affected rows.
        {(st.kind === 'update' || st.kind === 'delete') && design.tables.length > 1 && <> Target: <select className="sel" value={design.targetTable ?? ''} onChange={(e) => setDesign({ ...design, targetTable: e.target.value }, true)}>{design.tables.map((t) => <option key={t.id}>{t.name}</option>)}</select></>}
      </div>}
      {view === 'design' && (
        <>
          <div className="qd-top" style={{ flex: `0 0 ${topH}%` }}>
            <TableCanvas testId="query-canvas" boxes={boxes} fieldsOf={(b) => fieldsOfSource(p, b.name)} links={links} zoom={1} showStar
              selectedBox={selBox} selectedLink={selJoin} onSelectBox={setSelBox} onSelectLink={setSelJoin}
              onMove={(id, x, y, done) => setDesign({ ...design, tables: design.tables.map((t) => (t.id === id ? { ...t, x, y } : t)) }, done)}
              onRemoveBox={removeTable}
              onFieldLink={(a, b) => { const ta = design.tables.find((t) => t.id === a.box.id)!, tb = design.tables.find((t) => t.id === b.box.id)!; setDesign({ ...design, joins: [...design.joins, { id: uid('j'), leftTable: ta.alias ?? ta.name, leftField: a.field, rightTable: tb.alias ?? tb.name, rightField: b.field, type: 'inner' }] }, true); }}
              onFieldDblClick={(b, f) => { const t = design.tables.find((x) => x.id === b.id)!; insertColumn(f, t.alias ?? t.name); }}
              onFieldDropOutside={(info, target) => {
                const t = design.tables.find((x) => x.id === info.box.id)!;
                const col = target?.closest('[data-qgrid-col]') as HTMLElement | null;
                if (col) { insertColumn(info.field, t.alias ?? t.name, Number(col.dataset.qgridCol)); return true; }
                if (target?.closest('.qd-bottom')) { insertColumn(info.field, t.alias ?? t.name); return true; }
                return false;
              }}
              onLinkDblClick={(id) => void editJoin(id)}
              onLinkContext={(id, e) => showContextMenu(e, [{ label: 'Join Properties…', onClick: () => void editJoin(id) }, { label: 'Delete', onClick: () => setDesign({ ...design, joins: design.joins.filter((j) => j.id !== id) }, true) }])}
              onBoxContext={(id, e) => showContextMenu(e, [{ label: 'Remove Table', onClick: () => removeTable(id) }, { label: 'Add all fields (*)', onClick: () => { const t = design.tables.find((x) => x.id === id)!; insertColumn('*', t.alias ?? t.name); } }])}
              onDropObject={(name, x, y) => addTable(name, x, y)}
              emptyText="Drag tables or queries here from the Navigation Pane, or click Show Table. Then drag fields down into the grid (or double-click them)." />
          </div>
          <div className="qd-splitter" onPointerDown={(e) => {
            const host = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect();
            const move = (ev: PointerEvent) => setTopH(Math.max(15, Math.min(80, ((ev.clientY - host.top) / host.height) * 100)));
            const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
            window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
          }} />
          <div className="qd-bottom" onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); hist.undo(); } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); hist.redo(); } }}>
            <datalist id={`qf-${tab.id}`}>{fieldOptions.map((o) => <option key={o.t + o.f} value={`${o.t}.${o.f}`} />)}</datalist>
            <table className="qgrid" data-testid="query-grid">
              <tbody>
                <tr className="colhdr"><th className="rowhead" />{gridCols.map((c, i) => (
                  <td key={c.id} data-qgrid-col={i} className={'colsel' + (selCol === i ? ' on' : '')} draggable={i < design.columns.length}
                    onClick={() => setSelCol(i)} onDragStart={(e) => { setDragColIdx(i); e.dataTransfer.setData('text/plain', String(i)); }}
                    onDragOver={(e) => { if (dragColIdx !== null) e.preventDefault(); }} onDrop={(e) => { e.preventDefault(); if (dragColIdx !== null) moveColumn(dragColIdx, i); setDragColIdx(null); }}
                    onContextMenu={(e) => { if (i >= design.columns.length) return; setSelCol(i); showContextMenu(e, [{ label: 'Insert Column', onClick: () => { const cols = [...design.columns]; cols.splice(i, 0, newColumn()); setDesign({ ...design, columns: cols }, true); } }, { label: 'Delete Column', onClick: () => deleteColumn(i) }, { label: 'Build…', onClick: () => void builder() }]); }}
                    title="Click to select the column, drag to move it" />
                ))}</tr>
                {rowsShown.map((row) => (
                  <tr key={row}>
                    <th className="rowhead">{ROW_LABEL[row] ?? (row === 'crit0' ? 'Criteria:' : row === 'crit1' ? 'or:' : '')}</th>
                    {gridCols.map((c, i) => <td key={c.id} data-qgrid-col={i} style={selCol === i ? { background: 'var(--accent-soft)' } : undefined}>{cell(c, i, row)}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
            {genSql.err && design.columns.some((c) => c.field) && <div className="muted small" style={{ padding: '6px 10px' }}>⚠ {genSql.err}</div>}
          </div>
        </>
      )}
      {view === 'sql' && (
        <>
          {st.mode === 'sql' && !trySqlToDesignCached(p, st.sql) && st.sql.trim() && <div className="banner info">SQL-only query: this statement is kept exactly as written. Design View is available for simple SELECT queries.</div>}
          <SqlEditor value={st.mode === 'design' ? genSql.sql : st.sql} testId="sql-editor" onChange={(v) => hist.set({ ...st, mode: 'sql', sql: v, kind: detectKind(v, st.kind) })} onRun={() => { if (isAction || !/^\s*(select|with|pragma|explain|values)/i.test(st.sql) && st.mode === 'sql') void runScript(); else void switchView('datasheet'); }} />
          {result && result.kind !== 'rows' && notice === null && <div className="banner ok">{result.message}</div>}
          <div className="banner" style={{ borderTop: '1px solid var(--line)', borderBottom: 0, background: '#fafafa' }}>
            <button className="btn btn-sm btn-primary" onClick={() => { if (st.mode === 'sql' && !/^\s*(select|with|pragma|explain|values)/i.test(st.sql)) void runScript(); else if (isAction) void runAction(); else void switchView('datasheet'); }}>Run (Ctrl+Enter)</button>
            <span className="muted small">Write any SQLite SQL: SELECT, INSERT, UPDATE, DELETE, CREATE TABLE … Use [Prompt] for parameters. Several statements can be separated with ;</span>
          </div>
        </>
      )}
      {view === 'datasheet' && (
        <>
          {runErr && <div className="banner err">{runErr}</div>}
          {result ? (result.kind === 'rows' ? <DataGrid tabId={tab.id} active={active} project={p} result={{ columns: result.columns, rows: result.rows }} />
            : <div className="banner ok">{result.message}</div>) : <div className="empty-ws">Run the query to see results.</div>}
          {result && <div className="banner" style={{ borderTop: '1px solid var(--line)', borderBottom: 0, background: '#fafafa' }}><span className="small muted">{result.rows.length} row(s) · {result.ms.toFixed(1)} ms{isAction ? ' · preview of rows the action query will affect' : ''}</span></div>}
        </>
      )}
    </div>
  );

  async function runScript() {
    setRunErr(null); setNotice(null);
    const prompts = queryParameters(p, st.sql);
    const vals = prompts.length ? await askParameters(prompts) : {};
    if (!vals) return;
    if (/^\s*(delete|drop|update)\b/i.test(st.sql) && !(await confirmBox('This statement changes or deletes data and cannot be undone. Run it?', { danger: true }))) return;
    try {
      const r = runSql(p, st.sql, vals);
      setResult(r);
      if (r.kind === 'rows') updateTab(tab.id, { view: 'datasheet' }); else setNotice(`${r.message} (${r.ms.toFixed(1)} ms)`);
    } catch (e) { setRunErr((e as Error).message); }
  }
}

const parseCache = new Map<string, boolean>();
function trySqlToDesignCached(p: WowProject, sql: string): boolean {
  const k = sql;
  if (!parseCache.has(k)) { parseCache.set(k, !!trySqlToDesign(p, sql)); if (parseCache.size > 50) parseCache.delete(parseCache.keys().next().value as string); }
  return parseCache.get(k)!;
}
function safeSql(p: WowProject, d: QueryDesign, k: QueryKind): string | null { try { return designToSql(p, d, k); } catch { return null; } }
export function detectKind(sql: string, fallback: QueryKind): QueryKind {
  if (isCrosstabSql(sql)) return 'crosstab';
  const s = sql.replace(/--[^\n]*/g, '').trim();
  if (/^select|^with/i.test(s)) return 'select';
  if (/^insert/i.test(s)) return 'append';
  if (/^update/i.test(s)) return 'update';
  if (/^delete/i.test(s)) return 'delete';
  if (/^create\s+table\s+\S+\s+as\s/i.test(s)) return 'maketable';
  return fallback === 'crosstab' ? 'select' : fallback;
}

function PickTable({ p, close }: { p: WowProject; close: (v: string | null) => void }) {
  const [t, setT] = useState(p.tableNames()[0] ?? '');
  return (
    <div>
      <div className="field-row"><label>Append to table</label><select className="sel" value={t} onChange={(e) => setT(e.target.value)}>{p.tableNames().map((n) => <option key={n}>{n}</option>)}</select></div>
      <div className="dlg-buttons"><button className="btn btn-primary" disabled={!t} onClick={() => close(t)}>OK</button><button className="btn" onClick={() => close(null)}>Cancel</button></div>
    </div>
  );
}
