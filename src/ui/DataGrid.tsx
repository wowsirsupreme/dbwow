'use client';
// Datasheet View. In table mode every read is a real SQL SELECT (with ORDER BY
// and WHERE built from the sort and filter state) and every edit is a real
// INSERT/UPDATE/DELETE checked by SQLite constraints. In result mode it shows
// rows returned by a query (read-only).
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Pencil, Plus, Filter, Paperclip } from 'lucide-react';
import type { WowProject } from '@/engine/project';
import { WowError } from '@/engine/project';
import type { DatasheetLayout, FieldDef } from '@/engine/types';
import { q } from '@/engine/sqlite';
import { formatValue } from '@/engine/expr';
import { useApp } from './store';
import { useEditorCommands } from './commands';
import { confirmBox, errorBox, messageBox, openDialog, showContextMenu, type MenuItem } from './dialogs';

export interface GridColumn { name: string; field?: FieldDef; }
interface Row { rowid?: number; values: unknown[]; }
type ColFilter = { kind: 'values'; values: string[] } | { kind: 'text'; op: 'contains' | 'equals' | 'begins' | 'gt' | 'lt' | 'notnull' | 'isnull'; text: string };

export interface DataGridProps {
  tabId: string;
  active: boolean;
  project: WowProject;
  table?: string;                                 // editable table
  result?: { columns: string[]; rows: unknown[][] }; // read-only rows
  link?: { field: string; value: unknown }[];     // subform link filter
  layout?: DatasheetLayout;
  onLayout?: (l: DatasheetLayout) => void;
  allowAdd?: boolean; allowEdit?: boolean; allowDelete?: boolean;
  onSelectColumn?: (col: string | null) => void;
  compact?: boolean;
  scope?: string;
}

const ROW_H = 24;
const NUMERIC = new Set(['Number', 'Large Number', 'Currency', 'AutoNumber']);

export function DataGrid(props: DataGridProps) {
  const { project: p, table, result, tabId, active } = props;
  const version = useApp((s) => s.version);
  const setSelection = useApp((s) => s.setSelection);
  const tdef = table ? p.getTable(table) : undefined;
  const editable = !!tdef && props.allowEdit !== false;
  const canAdd = !!tdef && props.allowAdd !== false;
  const canDelete = !!tdef && props.allowDelete !== false;

  // ---------- columns ----------
  const baseCols: GridColumn[] = useMemo(() => {
    if (tdef) return tdef.fields.map((f) => ({ name: f.name, field: f }));
    return (result?.columns ?? []).map((c) => ({ name: c }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tdef ? JSON.stringify(tdef.fields) : '', result?.columns.join('|')]);
  const [layout, setLayout] = useState<DatasheetLayout>(props.layout ?? {});
  useEffect(() => { setLayout(props.layout ?? {}); }, [JSON.stringify(props.layout ?? {})]); // eslint-disable-line react-hooks/exhaustive-deps
  const order = useMemo(() => {
    const names = baseCols.map((c) => c.name);
    const o = (layout.order ?? []).filter((n) => names.includes(n));
    return [...o, ...names.filter((n) => !o.includes(n))];
  }, [baseCols, layout.order]);
  const visibleCols = useMemo(() => order.filter((n) => !(layout.hidden ?? []).includes(n)).map((n) => baseCols.find((c) => c.name === n)!).filter(Boolean), [order, layout.hidden, baseCols]);
  const widthOf = (c: GridColumn) => layout.widths?.[c.name] ?? defaultWidth(c);
  const saveLayout = (l: DatasheetLayout) => { setLayout(l); props.onLayout?.(l); };

  // ---------- sort / filter ----------
  const [sort, setSort] = useState<{ col: string; dir: 'ASC' | 'DESC' }[]>([]);
  const [filters, setFilters] = useState<Record<string, ColFilter>>({});
  const [filterOn, setFilterOn] = useState(true);
  const activeFilters = filterOn ? filters : {};

  // ---------- data ----------
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const lookups = useLookups(p, baseCols, version);

  const load = useCallback(() => {
    try {
      setLoadErr(null);
      if (tdef) {
        const { where, params } = buildWhere(activeFilters, baseCols, props.link);
        const ord = sort.length ? ' ORDER BY ' + sort.map((s) => `${q(s.col)} ${s.dir}`).join(', ') : ' ORDER BY rowid';
        const cols = baseCols.map((c) => q(c.name)).join(', ');
        const r = p.db.query(`SELECT rowid AS "__rowid", ${cols} FROM ${q(tdef.name)}${where}${ord}`, params as never);
        setRows(r.rows.map((row) => ({ rowid: Number(row[0]), values: row.slice(1) })));
        const linkW = buildWhere({}, baseCols, props.link);
        setTotal(Number(p.db.scalar(`SELECT count(*) FROM ${q(tdef.name)}${linkW.where}`, linkW.params as never)));
      } else if (result) {
        let rs = result.rows.map((r) => ({ values: r }));
        rs = rs.filter((r) => Object.entries(activeFilters).every(([col, f]) => matchFilter(r.values[result.columns.indexOf(col)], f)));
        if (sort.length) rs.sort((a, b) => { for (const s of sort) { const i = result.columns.indexOf(s.col); const c = cmpVals(a.values[i], b.values[i]); if (c) return s.dir === 'ASC' ? c : -c; } return 0; });
        setRows(rs); setTotal(result.rows.length);
      }
    } catch (e) { setLoadErr((e as Error).message); setRows([]); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p, tdef?.name, baseCols, result, sort, JSON.stringify(activeFilters), JSON.stringify(props.link ?? [])]);
  useEffect(() => { load(); }, [load, version]);

  // ---------- selection / editing ----------
  const [focus, setFocus] = useState({ r: 0, c: 0 });
  const [anchor, setAnchor] = useState<{ r: number; c: number } | null>(null);
  const [selRows, setSelRows] = useState<Set<number>>(new Set());
  const [editing, setEditing] = useState<{ r: number; c: number; value: string } | null>(null);
  const [pending, setPending] = useState<{ r: number; values: Record<string, unknown>; isNew: boolean } | null>(null);
  const [selCol, setSelCol] = useState<string | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const pendingRef = useRef(pending); pendingRef.current = pending;
  const rowsRef = useRef(rows); rowsRef.current = rows;
  const focusRef = useRef(focus); focusRef.current = focus;
  const editingRef = useRef(editing); editingRef.current = editing;
  const newRowIndex = rows.length;
  const rowCount = rows.length + (canAdd ? 1 : 0);

  useEffect(() => { props.onSelectColumn?.(selCol ?? visibleCols[focus.c]?.name ?? null); }, [selCol, focus.c, visibleCols]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (active) setSelection({ table, field: visibleCols[focus.c]?.name, records: total, position: Math.min(focus.r, rows.length) + 1, filtered: Object.keys(activeFilters).length > 0 });
  }, [active, focus, total, rows.length, visibleCols, table, activeFilters, setSelection]);

  const cellValue = (r: number, colName: string): unknown => {
    if (pending && pending.r === r && colName in pending.values) return pending.values[colName];
    if (r >= rows.length) return null;
    const idx = baseCols.findIndex((c) => c.name === colName);
    return rows[r].values[idx];
  };

  const readOnlyCol = (c: GridColumn) => !editable || !c.field || c.field.type === 'AutoNumber' || c.field.type === 'Calculated';

  const commitRow = useCallback((): boolean => {
    const pending = pendingRef.current; const rows = rowsRef.current;
    if (!pending || !tdef) return true;
    try {
      if (pending.isNew) {
        const vals = { ...pending.values };
        for (const l of props.link ?? []) if (vals[l.field] === undefined) vals[l.field] = l.value;
        p.insertRecord(tdef.name, vals);
      } else {
        const row = rows[pending.r];
        if (row?.rowid !== undefined) p.updateRecord(tdef.name, row.rowid, pending.values);
      }
      setPending(null); pendingRef.current = null;
      return true;
    } catch (e) {
      void errorBox(e, 'DBWOW - record not saved');
      return false;
    }
  }, [tdef, p, props.link]);

  const moveTo = (r: number, c: number, extend = false) => {
    if (editingRef.current) commitEdit();
    const pend = pendingRef.current;
    const nRows = rowsRef.current.length;
    // leaving the new-record row downwards saves it and opens a fresh new row
    if (pend && pend.isNew && r > nRows && canAdd) {
      if (!commitRow()) return;
      setAnchor(null); setSelRows(new Set());
      setFocus({ r: nRows + 1, c: Math.max(0, Math.min(visibleCols.length - 1, c)) });
      return;
    }
    const rr = Math.max(0, Math.min(nRows + (canAdd ? 1 : 0) - 1, r));
    const cc = Math.max(0, Math.min(visibleCols.length - 1, c));
    if (pend && pend.r !== rr) { if (!commitRow()) return; }
    if (extend) { if (!anchor) setAnchor(focusRef.current); } else setAnchor(null);
    setSelRows(new Set());
    setSelCol(null);
    setFocus({ r: rr, c: cc });
    scrollIntoView(rr, cc);
  };

  const scrollIntoView = (r: number, c: number) => {
    const el = gridRef.current; if (!el) return;
    const top = r * ROW_H, bottom = top + ROW_H + 26;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (bottom > el.scrollTop + el.clientHeight) el.scrollTop = bottom - el.clientHeight;
    let x = 22; for (let i = 0; i < c; i++) x += widthOf(visibleCols[i]);
    const w = visibleCols[c] ? widthOf(visibleCols[c]) : 0;
    if (x < el.scrollLeft + 22) el.scrollLeft = x - 22; else if (x + w > el.scrollLeft + el.clientWidth) el.scrollLeft = x + w - el.clientWidth;
  };

  const setPendingValue = (r: number, colName: string, v: unknown) => {
    setPending((cur) => {
      const base = cur && cur.r === r ? cur : { r, values: {}, isNew: r >= rows.length };
      return { ...base, values: { ...base.values, [colName]: v } };
    });
  };

  const beginEdit = (initial?: string) => {
    const c = visibleCols[focus.c]; if (!c || readOnlyCol(c)) return;
    if (focus.r >= rows.length && !canAdd) return;
    if (c.field?.type === 'Yes/No') { toggleYesNo(focus.r, c); return; }
    if (c.field?.type === 'Attachment') { void attach(focus.r, c); return; }
    const v = cellValue(focus.r, c.name);
    setEditing({ r: focus.r, c: focus.c, value: initial ?? editText(v, c.field) });
  };
  const commitEdit = () => {
    const editing = editingRef.current;
    if (!editing) return;
    const c = visibleCols[editing.c];
    const old = editText(cellValue(editing.r, c.name), c.field);
    if (editing.value !== old) {
      const v = editing.value === '' ? null : editing.value;
      const cur = pendingRef.current;
      const base = cur && cur.r === editing.r ? cur : { r: editing.r, values: {}, isNew: editing.r >= rowsRef.current.length };
      pendingRef.current = { ...base, values: { ...base.values, [c.name]: v } };
      setPending(pendingRef.current);
    }
    setEditing(null); editingRef.current = null;
  };
  const toggleYesNo = (r: number, c: GridColumn) => {
    if (readOnlyCol(c) || (r >= rows.length && !canAdd)) return;
    const v = cellValue(r, c.name);
    setPendingValue(r, c.name, v === 1 || v === true || v === '1' ? 0 : 1);
  };
  const attach = async (r: number, c: GridColumn) => {
    const f = await pickImage();
    if (f) setPendingValue(r, c.name, f);
  };

  // ---------- data commands ----------
  const deleteSelected = async () => {
    if (!tdef || !canDelete) return;
    const targets = selRows.size ? [...selRows] : [focus.r];
    const ids = targets.filter((r) => r < rows.length).map((r) => rows[r].rowid!).filter((x) => x !== undefined);
    if (!ids.length) { if (pending?.isNew) setPending(null); return; }
    const ok = await confirmBox(`You are about to delete ${ids.length} record(s).\n\nIf you click Yes, you won't be able to undo this Delete operation.\nAre you sure you want to delete these records?`, { danger: true, title: 'Delete Record' });
    if (!ok) return;
    try { p.deleteRecords(tdef.name, ids); setPending(null); setSelRows(new Set()); } catch (e) { void errorBox(e); }
  };
  const copySelection = (cut = false) => {
    const { r1, r2, c1, c2 } = rangeOf();
    const lines: string[] = [];
    const targetRows = selRows.size ? [...selRows].sort((a, b) => a - b) : range(r1, r2);
    const cols = selRows.size ? visibleCols : visibleCols.slice(c1, c2 + 1);
    if (selRows.size) lines.push(cols.map((c) => c.name).join('\t'));
    for (const r of targetRows) if (r < rows.length) lines.push(cols.map((c) => tsvCell(cellValue(r, c.name))).join('\t'));
    const text = lines.join('\n');
    clipboard.text = text;
    void navigator.clipboard?.writeText(text).catch(() => undefined);
    if (cut && editable && !selRows.size) {
      for (const r of targetRows) for (const c of cols) if (!readOnlyCol(c) && r < rows.length) setPendingValue(r, c.name, null);
    }
  };
  const paste = async () => {
    if (!editable) return;
    let text = clipboard.text;
    try { const t = await navigator.clipboard?.readText(); if (t) text = t; } catch { /* use internal clipboard */ }
    if (!text) return;
    if (!commitRow()) return;
    const lines = text.replace(/\r/g, '').split('\n').filter((l, i, a) => l !== '' || i < a.length - 1);
    let grid = lines.map((l) => l.split('\t'));
    if (grid.length > 1 && grid[0].every((h, i) => visibleCols[focus.c + i]?.name === h)) grid = grid.slice(1);
    const errors: string[] = [];
    let n = 0;
    grid.forEach((vals, i) => {
      const r = focus.r + i;
      const values: Record<string, unknown> = {};
      vals.forEach((v, j) => { const c = visibleCols[focus.c + j]; if (c && !readOnlyCol(c)) values[c.name] = v === '' ? null : v; });
      try {
        if (r < rows.length) p.updateRecord(tdef!.name, rows[r].rowid!, values);
        else if (canAdd) p.insertRecord(tdef!.name, { ...Object.fromEntries((props.link ?? []).map((l) => [l.field, l.value])), ...values });
        n++;
      } catch (e) { errors.push(`Row ${i + 1}: ${(e as Error).message}`); }
    });
    if (errors.length) void messageBox(`${n} row(s) pasted. ${errors.length} row(s) could not be pasted:\n\n${errors.slice(0, 12).join('\n')}${errors.length > 12 ? '\n…' : ''}`, 'Paste Errors', 'warn');
  };
  const rangeOf = () => {
    const a = anchor ?? focus;
    return { r1: Math.min(a.r, focus.r), r2: Math.max(a.r, focus.r), c1: Math.min(a.c, focus.c), c2: Math.max(a.c, focus.c) };
  };
  const inRange = (r: number, c: number) => { if (!anchor) return false; const x = rangeOf(); return r >= x.r1 && r <= x.r2 && c >= x.c1 && c <= x.c2; };

  const sortBy = (dir: 'ASC' | 'DESC' | null, colName?: string) => {
    const col = colName ?? visibleCols[focus.c]?.name; if (!col) return;
    if (!commitRow()) return;
    setSort(dir ? [{ col, dir }] : []);
  };
  const filterBySelection = (exclude = false, at?: { r: number; c: number }) => {
    const pos = at ?? focusRef.current;
    const c = visibleCols[pos.c]; if (!c || pos.r >= rows.length) return;
    const v = cellValue(pos.r, c.name);
    if (!commitRow()) return;
    if (exclude) {
      const all = distinctValues(c.name).filter((x) => x !== keyOf(v));
      setFilters({ ...filters, [c.name]: { kind: 'values', values: all } });
    } else setFilters({ ...filters, [c.name]: { kind: 'values', values: [keyOf(v)] } });
    setFilterOn(true);
  };
  const distinctValues = (col: string): string[] => {
    try {
      if (tdef) {
        const { where, params } = buildWhere({}, baseCols, props.link);
        return p.db.query(`SELECT DISTINCT ${q(col)} FROM ${q(tdef.name)}${where} ORDER BY 1 LIMIT 500`, params as never).rows.map((r) => keyOf(r[0]));
      }
      const i = result!.columns.indexOf(col);
      return [...new Set(result!.rows.map((r) => keyOf(r[i])))].sort();
    } catch { return []; }
  };
  const openFilterMenu = async (colName: string) => {
    const vals = distinctValues(colName);
    const cur = filters[colName];
    const f = await openDialog<ColFilter | 'clear'>(`Filter: ${colName}`, (close) => <FilterDialog values={vals} current={cur} close={close} display={(k) => displayKey(k, baseCols.find((c) => c.name === colName), lookups)} />, 360);
    if (!f) return;
    if (!commitRow()) return;
    const next = { ...filters };
    if (f === 'clear') delete next[colName]; else next[colName] = f;
    setFilters(next); setFilterOn(true);
  };
  const find = async (replaceMode = false) => {
    await openDialog('Find and Replace', (close) => <FindDialog replaceMode={replaceMode} close={close} editable={editable}
      onFind={(text, opts) => findNext(text, opts)} onReplace={(text, rep, opts, all) => doReplace(text, rep, opts, all)} />, 440);
  };
  const matches = (v: unknown, text: string, opts: FindOpts) => {
    const s = v === null || v === undefined ? '' : String(v);
    const a = opts.matchCase ? s : s.toLowerCase(), b = opts.matchCase ? text : text.toLowerCase();
    return opts.match === 'whole' ? a === b : opts.match === 'start' ? a.startsWith(b) : a.includes(b);
  };
  const findNext = (text: string, opts: FindOpts): boolean => {
    if (!text) return false;
    const cols = opts.scope === 'field' ? [focus.c] : visibleCols.map((_, i) => i);
    const total = rows.length * cols.length;
    let start = rows.length ? (focus.r * cols.length + Math.max(0, cols.indexOf(focus.c))) + 1 : 0;
    for (let k = 0; k < total; k++) {
      const idx = (start + k) % total;
      const r = Math.floor(idx / cols.length), c = cols[idx % cols.length];
      if (matches(cellValue(r, visibleCols[c].name), text, opts)) { moveTo(r, c); return true; }
    }
    start = 0;
    return false;
  };
  const doReplace = (text: string, rep: string, opts: FindOpts, all: boolean): number => {
    if (!tdef) return 0;
    let n = 0;
    const cols = opts.scope === 'field' ? [focus.c] : visibleCols.map((_, i) => i);
    const doOne = (r: number, c: number) => {
      const col = visibleCols[c]; if (readOnlyCol(col)) return false;
      const v = cellValue(r, col.name);
      if (!matches(v, text, opts)) return false;
      const s = String(v);
      const nv = opts.match === 'whole' ? rep : s.replace(new RegExp(escapeRe(text), opts.matchCase ? 'g' : 'gi'), rep);
      try { p.updateRecord(tdef.name, rows[r].rowid!, { [col.name]: nv }); n++; } catch (e) { void errorBox(e); return false; }
      return true;
    };
    if (all) { for (let r = 0; r < rows.length; r++) for (const c of cols) doOne(r, c); }
    else { if (!doOne(focus.r, focus.c)) findNext(text, opts); else findNext(text, opts); }
    return n;
  };

  const hideCol = (name: string) => saveLayout({ ...layout, hidden: [...(layout.hidden ?? []), name] });
  const unhide = async () => {
    const hidden = new Set(layout.hidden ?? []);
    const res = await openDialog<string[]>('Unhide Columns', (close) => <UnhideDialog cols={order} hidden={hidden} close={close} />, 300);
    if (res) saveLayout({ ...layout, hidden: res });
  };

  useEditorCommands(tabId, active, {
    'home.sortAsc': () => sortBy('ASC'), 'home.sortDesc': () => sortBy('DESC'), 'home.removeSort': { run: () => sortBy(null), enabled: sort.length > 0 },
    'home.filter': () => { const c = visibleCols[focus.c]; if (c) void openFilterMenu(c.name); },
    'home.filterSelection': { run: () => filterBySelection(), enabled: focus.r < rows.length },
    'home.toggleFilter': { run: () => setFilterOn(!filterOn), enabled: Object.keys(filters).length > 0, checked: filterOn && Object.keys(filters).length > 0 },
    'home.find': () => void find(false), 'home.replace': { run: () => void find(true), enabled: editable },
    'home.newRecord': { run: () => moveTo(newRowIndex, 0), enabled: canAdd },
    'home.saveRecord': { run: () => { commitEdit(); setTimeout(() => commitRow(), 0); }, enabled: !!pending || !!editing },
    'home.undoRecord': { run: () => { setEditing(null); setPending(null); }, enabled: !!pending || !!editing },
    'home.deleteRecord': { run: () => void deleteSelected(), enabled: canDelete && (focus.r < rows.length || selRows.size > 0) },
    'home.refresh': () => { if (commitRow()) load(); },
    'home.first': () => moveTo(0, focus.c), 'home.last': () => moveTo(rows.length - 1, focus.c),
    'home.prev': () => moveTo(focus.r - 1, focus.c), 'home.next': () => moveTo(focus.r + 1, focus.c),
    'home.copy': () => copySelection(false), 'home.cut': { run: () => copySelection(true), enabled: editable }, 'home.paste': { run: () => void paste(), enabled: editable },
    'ds.hideFields': { run: () => { const c = selCol ?? visibleCols[focus.c]?.name; if (c) hideCol(c); }, enabled: visibleCols.length > 1 },
    'ds.unhideFields': { run: () => void unhide(), enabled: (layout.hidden ?? []).length > 0 },
    'ds.resetLayout': { run: () => saveLayout({}), enabled: !!(layout.widths || layout.order || layout.hidden) },
  }, props.scope ?? 'grid');

  // ---------- keyboard ----------
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (editing) {
      if (e.key === 'Escape') { e.preventDefault(); setEditing(null); editingRef.current = null; gridRef.current?.focus(); return; }
      if (e.key === 'Enter' || e.key === 'Tab' || e.key === 'ArrowUp' || e.key === 'ArrowDown') { commitEdit(); gridRef.current?.focus(); }
      else return;
    }
    const ctrl = e.ctrlKey || e.metaKey;
    const k = e.key;
    if (k === 'ArrowDown') { e.preventDefault(); moveTo(focus.r + 1, focus.c, e.shiftKey); }
    else if (k === 'ArrowUp') { e.preventDefault(); moveTo(focus.r - 1, focus.c, e.shiftKey); }
    else if (k === 'ArrowLeft') { e.preventDefault(); moveTo(focus.r, focus.c - 1, e.shiftKey); }
    else if (k === 'ArrowRight') { e.preventDefault(); moveTo(focus.r, focus.c + 1, e.shiftKey); }
    else if (k === 'Tab' || k === 'Enter') {
      e.preventDefault();
      if (k === 'Enter' && e.shiftKey) { if (commitRow() && focus.r >= rows.length) setFocus({ r: rows.length + 1, c: 0 }); return; }
      const back = e.shiftKey;
      if (!back && focus.c + 1 >= visibleCols.length) moveTo(focus.r + 1, 0);
      else if (back && focus.c === 0) moveTo(focus.r - 1, visibleCols.length - 1);
      else moveTo(focus.r, focus.c + (back ? -1 : 1));
    }
    else if (k === 'Home') { e.preventDefault(); moveTo(ctrl ? 0 : focus.r, 0); }
    else if (k === 'End') { e.preventDefault(); moveTo(ctrl ? rowCount - 1 : focus.r, visibleCols.length - 1); }
    else if (k === 'PageDown') { e.preventDefault(); moveTo(focus.r + 15, focus.c); }
    else if (k === 'PageUp') { e.preventDefault(); moveTo(focus.r - 15, focus.c); }
    else if (k === 'F2') { e.preventDefault(); beginEdit(); }
    else if (k === 'Escape') { if (pending) { e.preventDefault(); setPending(null); } setAnchor(null); setSelRows(new Set()); }
    else if (k === 'Delete') {
      e.preventDefault();
      if (selRows.size) void deleteSelected();
      else if (editable) { const { r1, r2, c1, c2 } = rangeOf(); for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) { const col = visibleCols[c]; if (!readOnlyCol(col) && col.field?.type !== 'Yes/No') setPendingValue(r, col.name, null); } }
    }
    else if (k === ' ' && visibleCols[focus.c]?.field?.type === 'Yes/No') { e.preventDefault(); toggleYesNo(focus.r, visibleCols[focus.c]); }
    else if (ctrl && k.toLowerCase() === 'c') { e.preventDefault(); copySelection(false); }
    else if (ctrl && k.toLowerCase() === 'x') { e.preventDefault(); copySelection(true); }
    else if (ctrl && k.toLowerCase() === 'v') { e.preventDefault(); void paste(); }
    else if (ctrl && k.toLowerCase() === 'a') { e.preventDefault(); setAnchor({ r: 0, c: 0 }); setFocus({ r: Math.max(0, rows.length - 1), c: visibleCols.length - 1 }); }
    else if (k.length === 1 && !ctrl && !e.altKey) { e.preventDefault(); beginEdit(k); }
  };

  // ---------- column resize & reorder ----------
  const startResize = (e: React.PointerEvent, c: GridColumn) => {
    e.preventDefault(); e.stopPropagation();
    const x0 = e.clientX, w0 = widthOf(c);
    let w = w0;
    const move = (ev: PointerEvent) => { w = Math.max(30, w0 + ev.clientX - x0); setLayout((l) => ({ ...l, widths: { ...(l.widths ?? {}), [c.name]: w } })); };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); saveLayout({ ...layout, widths: { ...(layout.widths ?? {}), [c.name]: w } }); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };
  const autoFit = (c: GridColumn) => {
    const longest = Math.max(c.name.length, ...rows.slice(0, 300).map((r) => String(displayText(cellValueRow(r, c), c, lookups)).length));
    saveLayout({ ...layout, widths: { ...(layout.widths ?? {}), [c.name]: Math.min(420, Math.max(50, longest * 7.4 + 26)) } });
  };
  const cellValueRow = (r: Row, c: GridColumn) => r.values[baseCols.findIndex((b) => b.name === c.name)];
  const [dragCol, setDragCol] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<string | null>(null);
  const dropCol = (target: string) => {
    if (!dragCol || dragCol === target) return;
    const o = order.filter((n) => n !== dragCol);
    o.splice(o.indexOf(target), 0, dragCol);
    saveLayout({ ...layout, order: o });
  };

  const headerMenu = (e: React.MouseEvent, c: GridColumn) => {
    const items: MenuItem[] = [
      { label: 'Sort A to Z', onClick: () => sortBy('ASC', c.name) },
      { label: 'Sort Z to A', onClick: () => sortBy('DESC', c.name) },
      { label: 'Clear sort', onClick: () => sortBy(null), disabled: !sort.length },
      { separator: true },
      { label: 'Filter…', onClick: () => void openFilterMenu(c.name) },
      { label: `Clear filter from ${c.name}`, disabled: !filters[c.name], onClick: () => { const n = { ...filters }; delete n[c.name]; setFilters(n); } },
      { separator: true },
      { label: 'Field width: best fit', onClick: () => autoFit(c) },
      { label: 'Hide field', onClick: () => hideCol(c.name), disabled: visibleCols.length < 2 },
      { label: 'Unhide fields…', onClick: () => void unhide(), disabled: !(layout.hidden ?? []).length },
    ];
    showContextMenu(e, items);
  };
  const cellMenu = (e: React.MouseEvent, r: number, ci: number) => {
    if (!(focus.r === r && focus.c === ci)) moveTo(r, ci);
    const c = visibleCols[ci];
    const v = cellValue(r, c.name);
    showContextMenu(e, [
      { label: 'Cut', onClick: () => copySelection(true), disabled: !editable },
      { label: 'Copy', onClick: () => copySelection(false) },
      { label: 'Paste', onClick: () => void paste(), disabled: !editable },
      { separator: true },
      { label: 'Sort A to Z', onClick: () => sortBy('ASC', c.name) },
      { label: 'Sort Z to A', onClick: () => sortBy('DESC', c.name) },
      { separator: true },
      { label: `Equals ${shortVal(displayText(v, c, lookups))}`, onClick: () => filterBySelection(false, { r, c: ci }), disabled: r >= rows.length },
      { label: `Does Not Equal ${shortVal(displayText(v, c, lookups))}`, onClick: () => filterBySelection(true, { r, c: ci }), disabled: r >= rows.length },
      { label: 'Clear all filters', onClick: () => setFilters({}), disabled: !Object.keys(filters).length },
      { separator: true },
      { label: 'Delete Record', onClick: () => void deleteSelected(), disabled: !canDelete || r >= rows.length },
      ...(c.field?.type === 'Attachment' ? [{ separator: true } as const,
        { label: v ? 'Replace Picture…' : 'Insert Picture…', onClick: () => void attach(r, c), disabled: readOnlyCol(c) },
        { label: 'View Picture', onClick: () => viewPicture(String(v), c.name), disabled: !v },
        { label: 'Remove Picture', onClick: () => setPendingValue(r, c.name, null), disabled: !v || readOnlyCol(c) }] : []),
    ]);
  };

  // ---------- virtual rows ----------
  const [scroll, setScroll] = useState({ top: 0, h: 600 });
  useEffect(() => { const el = gridRef.current; if (el) setScroll({ top: el.scrollTop, h: el.clientHeight }); }, [rows.length]);
  const first = Math.max(0, Math.floor(scroll.top / ROW_H) - 10);
  const last = Math.min(rowCount, Math.ceil((scroll.top + scroll.h) / ROW_H) + 10);
  const tableWidth = 22 + visibleCols.reduce((s, c) => s + widthOf(c), 0);

  const rowSelectorClick = (e: React.MouseEvent, r: number) => {
    if (pending && pending.r !== r && !commitRow()) return;
    const next = new Set(e.ctrlKey || e.metaKey ? selRows : []);
    if (e.shiftKey && selRows.size) { const lastSel = [...selRows].pop()!; for (const x of range(Math.min(lastSel, r), Math.max(lastSel, r))) next.add(x); }
    else if (next.has(r)) next.delete(r); else next.add(r);
    setSelRows(next); setFocus({ r, c: focus.c }); setAnchor(null);
    gridRef.current?.focus();
  };

  const posText = `${Math.min(focus.r + 1, rowCount)} of ${rows.length}${Object.keys(activeFilters).length ? ` (filtered from ${total})` : ''}`;

  return (
    <div className="dg-wrap">
      {loadErr && <div className="banner err">{loadErr}</div>}
      <div className="dg" ref={gridRef} tabIndex={0} onKeyDown={onKeyDown} onScroll={(e) => setScroll({ top: e.currentTarget.scrollTop, h: e.currentTarget.clientHeight })} data-testid="datasheet">
        <table style={{ width: tableWidth }}>
          <colgroup><col style={{ width: 22 }} />{visibleCols.map((c) => <col key={c.name} style={{ width: widthOf(c) }} />)}</colgroup>
          <thead>
            <tr>
              <th className="corner" onClick={() => { setAnchor({ r: 0, c: 0 }); setFocus({ r: Math.max(0, rows.length - 1), c: visibleCols.length - 1 }); }} />
              {visibleCols.map((c, ci) => {
                const s = sort.find((x) => x.col === c.name);
                return (
                  <th key={c.name} className={(selCol === c.name ? 'sel-col ' : '') + (overCol === c.name ? 'drag-over' : '')} style={{ position: 'sticky' }} title={c.field ? `${c.field.type}${c.field.description ? ' — ' + c.field.description : ''}` : c.name}
                    draggable onDragStart={(e) => { setDragCol(c.name); e.dataTransfer.setData('text/plain', c.name); e.dataTransfer.effectAllowed = 'move'; }}
                    onDragOver={(e) => { if (dragCol) { e.preventDefault(); setOverCol(c.name); } }} onDragLeave={() => setOverCol(null)}
                    onDrop={(e) => { e.preventDefault(); dropCol(c.name); setDragCol(null); setOverCol(null); }} onDragEnd={() => { setDragCol(null); setOverCol(null); }}
                    onClick={() => { if (commitRow()) { setSelCol(c.name); setFocus({ r: focus.r, c: ci }); setAnchor({ r: 0, c: ci }); setFocus({ r: Math.max(0, rows.length - 1), c: ci }); } }}
                    onDoubleClick={() => autoFit(c)} onContextMenu={(e) => headerMenu(e, c)}>
                    {c.field?.primaryKey ? '🔑 ' : ''}{c.field?.caption || c.name}
                    {filters[c.name] && <Filter size={10} style={{ display: 'inline', marginLeft: 4, color: 'var(--accent)' }} />}
                    {s && <span className="sort-ind">{s.dir === 'ASC' ? '▲' : '▼'}</span>}
                    <button className="hdr-menu" onClick={(e) => { e.stopPropagation(); headerMenu(e, c); }} aria-label={`Options for ${c.name}`}><ChevronDown size={11} /></button>
                    <span className="rsz" onPointerDown={(e) => startResize(e, c)} onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => { e.stopPropagation(); autoFit(c); }} />
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {first > 0 && <tr style={{ height: first * ROW_H }}><td colSpan={visibleCols.length + 1} style={{ border: 0, padding: 0 }} /></tr>}
            {range(first, last - 1).map((r) => {
              const isNew = r >= rows.length;
              const isCur = r === focus.r;
              const dirty = pending?.r === r;
              return (
                <tr key={isNew ? 'new' : (rows[r].rowid ?? r)} className={(isCur ? 'cur ' : '') + (selRows.has(r) ? 'selrow ' : '') + (isNew ? 'newrow' : '')} style={{ height: ROW_H }}>
                  <td className="rs" onClick={(e) => rowSelectorClick(e, r)}>{dirty ? <Pencil size={11} style={{ display: 'inline' }} /> : isNew ? <Plus size={11} style={{ display: 'inline' }} /> : isCur ? '▶' : ''}</td>
                  {visibleCols.map((c, ci) => {
                    const v = cellValue(r, c.name);
                    const isEd = editing && editing.r === r && editing.c === ci;
                    const ro = readOnlyCol(c);
                    const cls = [(NUMERIC.has(c.field?.type ?? '') || (!c.field && typeof v === 'number')) ? 'num' : '', isCur && focus.c === ci && !selRows.size ? 'focus' : '', inRange(r, ci) ? 'selcell' : '', ro && tdef ? 'ro' : '', isEd ? 'editing' : '', dirty && pending && c.name in pending.values ? 'dirty' : ''].join(' ');
                    return (
                      <td key={c.name} className={cls} style={c.field?.textAlign && c.field.textAlign !== 'General' ? { textAlign: c.field.textAlign.toLowerCase() as 'left' | 'center' | 'right' } : undefined}
                        onMouseDown={(e) => { if (e.button !== 0) return; if (isEd) return; if (e.shiftKey) { if (!anchor) setAnchor(focus); setFocus({ r, c: ci }); return; } moveTo(r, ci); }}
                        onDoubleClick={() => { if (c.field?.type === 'Hyperlink' && v) return; beginEdit(); }}
                        onContextMenu={(e) => cellMenu(e, r, ci)}>
                        {isEd ? <CellEditor col={c} value={editing!.value} lookups={lookups} onChange={(val) => setEditing({ ...editing!, value: val })} onDone={() => { commitEdit(); gridRef.current?.focus(); }} />
                          : renderCell(v, c, lookups, isNew && !dirty, () => toggleYesNo(r, c))}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
            {last < rowCount && <tr style={{ height: (rowCount - last) * ROW_H }}><td colSpan={visibleCols.length + 1} style={{ border: 0, padding: 0 }} /></tr>}
          </tbody>
        </table>
        {!visibleCols.length && <div className="muted" style={{ padding: 20 }}>No fields to show.</div>}
      </div>
      <div className="dg-nav">
        <span>Record:</span>
        <button onClick={() => moveTo(0, focus.c)} disabled={focus.r === 0} title="First record"><ChevronsLeft size={13} /></button>
        <button onClick={() => moveTo(focus.r - 1, focus.c)} disabled={focus.r === 0} title="Previous record"><ChevronLeft size={13} /></button>
        <input className="pos" value={posText} readOnly onFocus={(e) => e.currentTarget.select()} aria-label="Current record" />
        <button onClick={() => moveTo(focus.r + 1, focus.c)} disabled={focus.r >= rowCount - 1} title="Next record"><ChevronRight size={13} /></button>
        <button onClick={() => moveTo(rows.length - 1, focus.c)} disabled={focus.r >= rows.length - 1} title="Last record"><ChevronsRight size={13} /></button>
        {canAdd && <button onClick={() => moveTo(newRowIndex, 0)} title="New (blank) record"><Plus size={13} /></button>}
        <span className={'flt' + (Object.keys(filters).length && filterOn ? ' on' : '')} style={{ cursor: Object.keys(filters).length ? 'pointer' : 'default' }} onClick={() => Object.keys(filters).length && setFilterOn(!filterOn)}>{Object.keys(filters).length ? (filterOn ? 'Filtered' : 'Unfiltered') : 'No Filter'}</span>
        <input className="search" placeholder="Search" onKeyDown={(e) => { if (e.key === 'Enter') { const t = e.currentTarget.value; if (!findNext(t, { match: 'any', matchCase: false, scope: 'all' })) void messageBox(`DBWOW finished searching the records. The search item "${t}" was not found.`); } }} />
        <span style={{ flex: 1 }} />
        {pending && <span className="muted">Editing record — press Shift+Enter or move to another record to save</span>}
        {!tdef && <span className="muted">{result?.rows.length ?? 0} row(s) · read-only results</span>}
      </div>
    </div>
  );
}

// ---------------- helpers ----------------
const clipboard = { text: '' };
function range(a: number, b: number) { const out: number[] = []; for (let i = a; i <= b; i++) out.push(i); return out; }
function escapeRe(s: string) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function keyOf(v: unknown) { return v === null || v === undefined ? '\u0000NULL' : String(v); }
function shortVal(s: string) { return s.length > 24 ? `"${s.slice(0, 24)}…"` : `"${s}"`; }
function tsvCell(v: unknown) { return v === null || v === undefined ? '' : String(v).replace(/[\t\n]/g, ' '); }
function cmpVals(a: unknown, b: unknown) {
  if (a === b) return 0; if (a === null || a === undefined) return -1; if (b === null || b === undefined) return 1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
}
function matchFilter(v: unknown, f: ColFilter): boolean {
  if (f.kind === 'values') return f.values.includes(keyOf(v));
  const s = v === null || v === undefined ? '' : String(v).toLowerCase(), t = f.text.toLowerCase();
  switch (f.op) {
    case 'contains': return s.includes(t); case 'equals': return s === t; case 'begins': return s.startsWith(t);
    case 'gt': return Number(v) > Number(f.text); case 'lt': return Number(v) < Number(f.text);
    case 'notnull': return v !== null && v !== undefined && v !== ''; case 'isnull': return v === null || v === undefined || v === '';
  }
}
function buildWhere(filters: Record<string, ColFilter>, cols: GridColumn[], link?: { field: string; value: unknown }[]) {
  const parts: string[] = []; const params: unknown[] = [];
  for (const l of link ?? []) { if (l.value === null || l.value === undefined) parts.push('0'); else { parts.push(`${q(l.field)} = ?`); params.push(l.value); } }
  for (const [col, f] of Object.entries(filters)) {
    if (!cols.some((c) => c.name === col)) continue;
    const c = q(col);
    if (f.kind === 'values') {
      const hasNull = f.values.includes('\u0000NULL');
      const vals = f.values.filter((v) => v !== '\u0000NULL');
      const ors: string[] = [];
      if (vals.length) { ors.push(`CAST(${c} AS TEXT) IN (${vals.map(() => '?').join(', ')})`); params.push(...vals); }
      if (hasNull) ors.push(`${c} IS NULL`);
      parts.push(ors.length ? `(${ors.join(' OR ')})` : '0');
    } else {
      switch (f.op) {
        case 'contains': parts.push(`${c} LIKE ?`); params.push(`%${f.text}%`); break;
        case 'equals': parts.push(`${c} = ?`); params.push(numOrText(f.text)); break;
        case 'begins': parts.push(`${c} LIKE ?`); params.push(`${f.text}%`); break;
        case 'gt': parts.push(`${c} > ?`); params.push(numOrText(f.text)); break;
        case 'lt': parts.push(`${c} < ?`); params.push(numOrText(f.text)); break;
        case 'notnull': parts.push(`(${c} IS NOT NULL AND ${c} <> '')`); break;
        case 'isnull': parts.push(`(${c} IS NULL OR ${c} = '')`); break;
      }
    }
  }
  return { where: parts.length ? ' WHERE ' + parts.join(' AND ') : '', params };
}
function numOrText(s: string) { return /^-?\d+(\.\d+)?$/.test(s.trim()) ? Number(s) : s; }

function defaultWidth(c: GridColumn): number {
  const t = c.field?.type;
  if (t === 'Yes/No') return 70;
  if (t === 'AutoNumber' || t === 'Number' || t === 'Large Number') return Math.max(80, c.name.length * 8 + 30);
  if (t === 'Date/Time') return 110;
  if (t === 'Long Text') return 220;
  return Math.min(220, Math.max(100, c.name.length * 8 + 34));
}

type Lookups = Record<string, { options: { value: unknown; label: string }[]; map: Map<string, string> }>;
function useLookups(p: WowProject, cols: GridColumn[], version: number): Lookups {
  return useMemo(() => {
    const out: Lookups = {};
    for (const c of cols) {
      const lk = c.field?.lookup;
      if (!lk || !lk.rowSource) continue;
      try {
        let options: { value: unknown; label: string }[] = [];
        if (lk.rowSourceType === 'Value List') options = lk.rowSource.split(';').map((s) => s.trim().replace(/^"|"$/g, '')).filter(Boolean).map((s) => ({ value: s, label: s }));
        else {
          const src = p.sourceSql(lk.rowSource);
          const rowsAll = p.db.all(src.sql);
          const bf = lk.boundField || Object.keys(rowsAll[0] ?? {}).find((k) => k !== '__rowid') || '';
          const df = lk.displayField || bf;
          options = rowsAll.map((r) => ({ value: r[bf], label: String(r[df] ?? '') }));
        }
        out[c.name] = { options, map: new Map(options.map((o) => [String(o.value), o.label])) };
      } catch { /* bad lookup definition: show raw values */ }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p, cols, version]);
}

function displayKey(k: string, c: GridColumn | undefined, lookups: Lookups) {
  if (k === '\u0000NULL') return '(Blanks)';
  if (c && lookups[c.name]) return lookups[c.name].map.get(k) ?? k;
  if (c?.field?.type === 'Yes/No') return k === '1' ? 'Yes' : 'No';
  return k;
}
function displayText(v: unknown, c: GridColumn, lookups: Lookups): string {
  if (v === null || v === undefined) return '';
  if (lookups[c.name]) return lookups[c.name].map.get(String(v)) ?? String(v);
  const f = c.field;
  if (!f) return v instanceof Uint8Array ? '(binary)' : String(v);
  if (f.type === 'Yes/No') return v ? 'Yes' : 'No';
  if (f.type === 'Attachment') return v ? '(1)' : '';
  if (f.type === 'Currency') return formatValue(v, f.format || 'Currency', f.decimalPlaces);
  if (f.type === 'Date/Time') return formatValue(v, f.format || 'Short Date');
  if (f.format || typeof f.decimalPlaces === 'number') return formatValue(v, f.format ?? '', f.decimalPlaces);
  return String(v);
}
function editText(v: unknown, f?: FieldDef): string {
  if (v === null || v === undefined) return '';
  if (f?.type === 'Date/Time') { const s = String(v); const m = /^(\d{4})-(\d{2})-(\d{2})(.*)$/.exec(s); return m ? `${m[3]}/${m[2]}/${m[1]}${m[4] ? m[4].replace(/:00$/, '') : ''}` : s; }
  return String(v);
}
function renderCell(v: unknown, c: GridColumn, lookups: Lookups, placeholder: boolean, toggle: () => void) {
  const f = c.field;
  if (placeholder) return f?.type === 'AutoNumber' ? '(New)' : f?.type === 'Yes/No' ? <input type="checkbox" className="chk" checked={false} readOnly onClick={toggle} /> : '';
  if (f?.type === 'Yes/No') return <input type="checkbox" className="chk" checked={!!v && v !== '0'} readOnly onClick={(e) => { e.stopPropagation(); toggle(); }} style={{ pointerEvents: 'auto' }} />;
  if (f?.type === 'Hyperlink' && v) { const s = String(v); const href = /^[a-z]+:/i.test(s) ? s : s.includes('@') ? `mailto:${s}` : `https://${s}`; return <a href={href} target="_blank" rel="noreferrer noopener" onClick={(e) => { if (!(e.ctrlKey || e.metaKey)) e.preventDefault(); }} title="Ctrl+click to open">{s}</a>; }
  if (f?.type === 'Attachment') { const s = String(v ?? ''); if (s.startsWith('data:image') || /^https?:\/\/.+\.(png|jpe?g|gif|webp|svg)(\?|$)/i.test(s)) return <img className="ds-thumb" src={s} alt="" title="Double-click to replace · right-click to view or remove" />; return v ? <span title="Double-click to replace"><Paperclip size={12} style={{ display: 'inline' }} /> (1)</span> : <span className="muted" title="Double-click to insert a picture"><Paperclip size={12} style={{ display: 'inline' }} /> (0)</span>; }
  return displayText(v, c, lookups);
}

function CellEditor({ col, value, lookups, onChange, onDone }: { col: GridColumn; value: string; lookups: Lookups; onChange: (v: string) => void; onDone: () => void }) {
  const ref = useRef<HTMLInputElement & HTMLSelectElement>(null);
  useEffect(() => { ref.current?.focus(); if (ref.current && 'setSelectionRange' in ref.current && ref.current.tagName === 'INPUT') { const n = value.length; try { ref.current.setSelectionRange(n, n); } catch { /* ignore */ } } }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const lk = lookups[col.name];
  if (lk) {
    return (
      <select ref={ref} value={value} onChange={(e) => onChange(e.target.value)} onBlur={onDone}>
        <option value="">{''}</option>
        {lk.options.map((o, i) => <option key={i} value={String(o.value)}>{o.label}{o.label !== String(o.value) ? `  (${o.value})` : ''}</option>)}
        {!lk.options.some((o) => String(o.value) === value) && value && <option value={value}>{value}</option>}
      </select>
    );
  }
  const f = col.field;
  const max = f?.type === 'Short Text' ? f.fieldSize ?? 255 : undefined;
  return <input ref={ref} value={value} maxLength={max} onChange={(e) => onChange(applyMask(e.target.value, f?.inputMask))} onBlur={onDone} placeholder={f?.type === 'Date/Time' ? 'dd/mm/yyyy' : f?.inputMask ?? ''} />;
}

/** Input masks: 0 = digit, 9 = optional digit, L = letter, A = letter/digit, other characters are literals. */
export function applyMask(v: string, mask?: string): string {
  if (!mask) return v;
  const m = mask.split(';')[0];
  let out = '', i = 0;
  for (const ch of m) {
    if (i >= v.length) break;
    if (ch === '0' || ch === '9') { while (i < v.length && !/\d/.test(v[i])) i++; if (i < v.length) out += v[i++]; }
    else if (ch === 'L' || ch === '?') { while (i < v.length && !/[A-Za-z]/.test(v[i])) i++; if (i < v.length) out += v[i++]; }
    else if (ch === 'A' || ch === 'a' || ch === '&') { out += v[i++]; }
    else if (ch === '>') continue;
    else { out += ch; if (v[i] === ch) i++; }
  }
  return m.startsWith('>') ? out.toUpperCase() : out;
}

/**
 * Let the user choose a picture and return it as a data URL ready to store in
 * an Attachment field. Large photos are scaled down (longest side 1024 px) and
 * re-encoded so a database with pictures stays small enough to share.
 */
export function pickImage(): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/png,image/jpeg,image/gif,image/webp,image/bmp,image/svg+xml';
    input.onchange = () => {
      const f = input.files?.[0]; if (!f) { resolve(null); return; }
      if (f.size > 15_000_000) { void messageBox('Please choose a picture smaller than 15 MB.', 'Insert Picture', 'warn'); resolve(null); return; }
      const r = new FileReader();
      r.onerror = () => resolve(null);
      r.onload = () => { void shrinkImage(String(r.result), f.type).then(resolve); };
      r.readAsDataURL(f);
    };
    input.click();
  });
}

export async function shrinkImage(dataUrl: string, type: string, maxSide = 1024, maxBytes = 350_000): Promise<string | null> {
  if (type === 'image/svg+xml' || type === 'image/gif') return dataUrl.length <= 1_400_000 ? dataUrl : (void messageBox('That picture is too large to store. Please use a PNG or JPEG photo.', 'Insert Picture', 'warn'), null);
  const img = new Image();
  const ok = await new Promise<boolean>((res) => { img.onload = () => res(true); img.onerror = () => res(false); img.src = dataUrl; });
  if (!ok) { void messageBox('This file could not be read as a picture.', 'Insert Picture', 'warn'); return null; }
  const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  if (scale === 1 && dataUrl.length * 0.75 <= maxBytes) return dataUrl;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
  const ctx = canvas.getContext('2d'); if (!ctx) return dataUrl;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  // keep PNG for small images with transparency (logos), otherwise JPEG
  if (type === 'image/png') { const png = canvas.toDataURL('image/png'); if (png.length * 0.75 <= maxBytes) return png; }
  for (const q of [0.85, 0.75, 0.6, 0.45]) { const jpg = canvas.toDataURL('image/jpeg', q); if (jpg.length * 0.75 <= maxBytes || q === 0.45) return jpg; }
  return null;
}

/** Full-size view of a stored picture. */
export function viewPicture(src: string, title: string) {
  void openDialog(title, (close) => (
    <div style={{ textAlign: 'center' }}>
      <img src={src} alt={title} style={{ maxWidth: '100%', maxHeight: '65vh', objectFit: 'contain', border: '1px solid var(--line-soft)' }} />
      <div className="small muted mt-2">{Math.round((src.length * 0.75) / 1024)} KB stored in the database</div>
      <div className="dlg-buttons"><button className="btn btn-primary" onClick={() => close(null)}>Close</button></div>
    </div>
  ), 640);
}

// ---------------- dialogs ----------------
function FilterDialog({ values, current, close, display }: { values: string[]; current?: ColFilter; close: (v: ColFilter | 'clear' | null) => void; display: (k: string) => string }) {
  const [checked, setChecked] = useState<Set<string>>(new Set(current?.kind === 'values' ? current.values : values));
  const [op, setOp] = useState<'contains' | 'equals' | 'begins' | 'gt' | 'lt' | 'notnull' | 'isnull'>(current?.kind === 'text' ? current.op : 'contains');
  const [text, setText] = useState(current?.kind === 'text' ? current.text : '');
  const [mode, setMode] = useState<'values' | 'text'>(current?.kind === 'text' ? 'text' : 'values');
  const [search, setSearch] = useState('');
  const shown = values.filter((v) => display(v).toLowerCase().includes(search.toLowerCase()));
  return (
    <div>
      <div className="tabs-mini" style={{ padding: 0, marginBottom: 6 }}>
        <button className={mode === 'values' ? 'on' : ''} onClick={() => setMode('values')}>Values</button>
        <button className={mode === 'text' ? 'on' : ''} onClick={() => setMode('text')}>Condition</button>
      </div>
      {mode === 'values' ? (
        <>
          <input className="inp w-full mb-1" placeholder="Search values" value={search} onChange={(e) => setSearch(e.target.value)} />
          <div className="list-box" style={{ height: 210 }}>
            <div onClick={() => setChecked(checked.size === values.length ? new Set() : new Set(values))}><input type="checkbox" className="chk" readOnly checked={checked.size === values.length} /> (Select All)</div>
            {shown.map((v) => <div key={v} onClick={() => { const n = new Set(checked); if (n.has(v)) n.delete(v); else n.add(v); setChecked(n); }}><input type="checkbox" className="chk" readOnly checked={checked.has(v)} /> {display(v)}</div>)}
          </div>
        </>
      ) : (
        <div className="flex gap-2">
          <select className="sel" value={op} onChange={(e) => setOp(e.target.value as typeof op)}>
            <option value="contains">Contains</option><option value="equals">Equals</option><option value="begins">Begins with</option>
            <option value="gt">Greater than</option><option value="lt">Less than</option><option value="notnull">Is not blank</option><option value="isnull">Is blank</option>
          </select>
          {op !== 'notnull' && op !== 'isnull' && <input className="inp flex-1" value={text} onChange={(e) => setText(e.target.value)} data-autofocus />}
        </div>
      )}
      <div className="dlg-buttons">
        <button className="btn" onClick={() => close('clear')}>Clear Filter</button>
        <button className="btn btn-primary" onClick={() => close(mode === 'values' ? { kind: 'values', values: [...checked] } : { kind: 'text', op, text })}>OK</button>
        <button className="btn" onClick={() => close(null)}>Cancel</button>
      </div>
    </div>
  );
}

interface FindOpts { match: 'any' | 'whole' | 'start'; matchCase: boolean; scope: 'field' | 'all'; }
function FindDialog({ replaceMode, close, onFind, onReplace, editable }: { replaceMode: boolean; close: (v: null) => void; editable: boolean; onFind: (t: string, o: FindOpts) => boolean; onReplace: (t: string, r: string, o: FindOpts, all: boolean) => number }) {
  const [tab, setTab] = useState(replaceMode ? 'replace' : 'find');
  const [text, setText] = useState('');
  const [rep, setRep] = useState('');
  const [opts, setOpts] = useState<FindOpts>({ match: 'any', matchCase: false, scope: 'all' });
  const [msg, setMsg] = useState('');
  return (
    <div>
      <div className="tabs-mini" style={{ padding: 0, marginBottom: 8 }}>
        <button className={tab === 'find' ? 'on' : ''} onClick={() => setTab('find')}>Find</button>
        {editable && <button className={tab === 'replace' ? 'on' : ''} onClick={() => setTab('replace')}>Replace</button>}
      </div>
      <div className="field-row"><label>Find What:</label><input className="inp" value={text} onChange={(e) => setText(e.target.value)} data-autofocus onKeyDown={(e) => { if (e.key === 'Enter') setMsg(onFind(text, opts) ? '' : 'Not found.'); }} /></div>
      {tab === 'replace' && <div className="field-row"><label>Replace With:</label><input className="inp" value={rep} onChange={(e) => setRep(e.target.value)} /></div>}
      <div className="field-row"><label>Look In:</label><select className="sel" value={opts.scope} onChange={(e) => setOpts({ ...opts, scope: e.target.value as FindOpts['scope'] })}><option value="field">Current field</option><option value="all">Current document</option></select></div>
      <div className="field-row"><label>Match:</label><select className="sel" value={opts.match} onChange={(e) => setOpts({ ...opts, match: e.target.value as FindOpts['match'] })}><option value="any">Any Part of Field</option><option value="whole">Whole Field</option><option value="start">Start of Field</option></select></div>
      <label className="flex items-center gap-2"><input type="checkbox" className="chk" checked={opts.matchCase} onChange={(e) => setOpts({ ...opts, matchCase: e.target.checked })} /> Match Case</label>
      {msg && <div className="muted mt-2">{msg}</div>}
      <div className="dlg-buttons">
        <button className="btn btn-primary" onClick={() => setMsg(onFind(text, opts) ? '' : `The search item "${text}" was not found.`)}>Find Next</button>
        {tab === 'replace' && <button className="btn" onClick={() => { onReplace(text, rep, opts, false); }}>Replace</button>}
        {tab === 'replace' && <button className="btn" onClick={() => setMsg(`${onReplace(text, rep, opts, true)} replacement(s) made.`)}>Replace All</button>}
        <button className="btn" onClick={() => close(null)}>Close</button>
      </div>
    </div>
  );
}

function UnhideDialog({ cols, hidden, close }: { cols: string[]; hidden: Set<string>; close: (v: string[] | null) => void }) {
  const [h, setH] = useState(new Set(hidden));
  return (
    <div>
      <div className="list-box" style={{ height: 220 }}>
        {cols.map((c) => <div key={c} onClick={() => { const n = new Set(h); if (n.has(c)) n.delete(c); else n.add(c); setH(n); }}><input type="checkbox" className="chk" readOnly checked={!h.has(c)} /> {c}</div>)}
      </div>
      <div className="dlg-buttons"><button className="btn btn-primary" onClick={() => close([...h])}>Close</button></div>
    </div>
  );
}

export { WowError };
