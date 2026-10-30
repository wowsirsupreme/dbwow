'use client';
import React, { useEffect, useMemo, useState } from 'react';
import type { WowProject } from '@/engine/project';
import { DATA_TYPES, type DataType } from '@/engine/types';
import { analyse, countInvalid, findDuplicates, parseCSV, parseJSON, readWorkbook, runImport, toCSV, type ImportColumn, type ImportPlan, type ImportSummary, type SheetData, exportRows, toJSON, sqlDump, writeWorkbook, importSqlScript } from '@/engine/interchange';
import { coerceValue } from '@/engine/project';
import { autoForm, autoReport } from '@/engine/objects';
import { emptyDesign, newColumn } from '@/engine/queries';
import { downloadBytes, safeFileName, listBackups, saveBackup, loadBackup, deleteBackup, type BackupInfo } from '@/engine/persistence';
import type { FormDef, QueryDesign } from '@/engine/types';
import { highlightSql } from '../SqlEditor';

// ======================= IMPORT =======================
export interface ImportSource { fileName: string; kind: 'csv' | 'xlsx' | 'json' | 'sql'; sheets?: SheetData[]; text?: string; }

export async function readImportFile(file: File): Promise<ImportSource> {
  const n = file.name.toLowerCase();
  if (n.endsWith('.xlsx') || n.endsWith('.xls') || n.endsWith('.ods')) return { fileName: file.name, kind: 'xlsx', sheets: readWorkbook(await file.arrayBuffer()) };
  const text = await file.text();
  if (n.endsWith('.json')) return { fileName: file.name, kind: 'json', sheets: parseJSON(text) };
  if (n.endsWith('.sql')) return { fileName: file.name, kind: 'sql', text };
  return { fileName: file.name, kind: 'csv', sheets: [{ name: file.name.replace(/\.[^.]+$/, ''), rows: parseCSV(text) }] };
}

const STEPS = ['Select file', 'Preview', 'Headers', 'Destination', 'Map fields', 'Data types', 'Duplicates', 'Validate', 'Preview import', 'Confirm'];

export function ImportWizard({ p, src, close }: { p: WowProject; src: ImportSource; close: (v: ImportSummary | 'sql' | null) => void }) {
  if (src.kind === 'sql') return <SqlImport p={p} src={src} close={close} />;
  return <TabularImport p={p} src={src} close={close} />;
}

function TabularImport({ p, src, close }: { p: WowProject; src: ImportSource; close: (v: ImportSummary | null) => void }) {
  const sheets = src.sheets ?? [];
  const [sheetIdx, setSheetIdx] = useState(0);
  const rows = sheets[sheetIdx]?.rows ?? [];
  const [hasHeader, setHasHeader] = useState(true);
  const [step, setStep] = useState(1);
  const [cols, setCols] = useState<ImportColumn[]>(() => analyse(rows, true));
  const [mode, setMode] = useState<'new' | 'append'>('new');
  const baseName = (sheets[sheetIdx]?.name ?? 'Imported').replace(/[^A-Za-z0-9_ ]/g, '').trim() || 'Imported';
  const [table, setTable] = useState(uniqueTable(p, baseName));
  const [appendTo, setAppendTo] = useState(p.tableNames()[0] ?? '');
  const [pk, setPk] = useState<string>('add');
  const [dupKeys, setDupKeys] = useState<string[]>([]);
  const [skipDup, setSkipDup] = useState(true);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { setCols(analyse(rows, hasHeader)); setTable(uniqueTable(p, baseName)); }, [sheetIdx, hasHeader]); // eslint-disable-line react-hooks/exhaustive-deps
  // when appending, map columns to existing fields by name
  useEffect(() => {
    if (mode !== 'append') return;
    const t = p.getTable(appendTo); if (!t) return;
    setCols((cs) => cs.map((c) => { const f = t.fields.find((x) => x.name.toLowerCase() === c.source.toLowerCase() && x.type !== 'AutoNumber' && x.type !== 'Calculated'); return { ...c, target: f?.name ?? '', type: f?.type ?? c.type, numberSize: f?.numberSize }; }));
  }, [mode, appendTo]); // eslint-disable-line react-hooks/exhaustive-deps

  const body = hasHeader ? rows.slice(1) : rows;
  const target = mode === 'new' ? table : appendTo;
  const plan: ImportPlan = { rows, hasHeader, columns: cols, mode, table: target, primaryKey: mode === 'new' ? pk : 'none', duplicateKeys: dupKeys, skipDuplicates: skipDup };
  const recount = (c: ImportColumn) => ({ ...c, invalid: countInvalid(body.map((r) => r[c.index]), c) });
  const dupCount = useMemo(() => { try { return dupKeys.length ? findDuplicates(p, plan).size : 0; } catch { return 0; } }, [dupKeys, cols, mode, appendTo, rows]); // eslint-disable-line react-hooks/exhaustive-deps
  const totalInvalid = cols.filter((c) => c.target).reduce((s, c) => s + c.invalid, 0);
  const width = Math.max(0, ...rows.slice(0, 50).map((r) => r.length));

  const next = () => {
    setErr(null);
    if (step === 4) {
      if (mode === 'new') { try { p.validateObjectName(table, 'table'); } catch (e) { setErr((e as Error).message); return; } }
      else if (!p.getTable(appendTo)) { setErr('Choose a table to append to.'); return; }
    }
    if (step === 5) {
      const targets = cols.filter((c) => c.target).map((c) => c.target.toLowerCase());
      if (!targets.length) { setErr('Include at least one field.'); return; }
      if (new Set(targets).size !== targets.length) { setErr('Two columns are mapped to the same field name.'); return; }
    }
    setStep(step + 1);
  };
  const finish = () => {
    setErr(null);
    try { setSummary(runImport(p, plan)); } catch (e) { setErr((e as Error).message); }
  };

  if (summary) {
    return (
      <div>
        <h3 className="section-title">Import complete</h3>
        <p>Table <b>{summary.table}</b>{summary.created ? ' (new)' : ''}: <b>{summary.inserted}</b> of {summary.total} row(s) imported.{summary.failed.length ? ` ${summary.failed.length} row(s) were not imported:` : ' No rows were rejected.'}</p>
        {summary.failed.length > 0 && <div className="scroll-box mt-2"><table className="mini-grid" style={{ width: '100%' }}><thead><tr><th>Row</th><th>Reason</th><th>Values</th></tr></thead><tbody>{summary.failed.slice(0, 200).map((f) => <tr key={f.row}><td>{f.row}</td><td className="bad" style={{ whiteSpace: 'normal' }}>{f.reason}</td><td>{f.values.map((v) => String(v ?? '')).join(' | ')}</td></tr>)}</tbody></table></div>}
        <div className="dlg-buttons">
          {summary.failed.length > 0 && <button className="btn" onClick={() => downloadBytes(toCSV(['Row', 'Reason', ...(hasHeader ? (rows[0] ?? []).map(String) : cols.map((c) => c.source))], summary.failed.map((f) => [f.row, f.reason, ...f.values])), `${safeFileName(summary.table)}_import_errors.csv`, 'text/csv')}>Download rejected rows</button>}
          <button className="btn btn-primary" onClick={() => close(summary)}>Close</button>
        </div>
      </div>
    );
  }

  const preview = (n: number) => (
    <div className="scroll-box"><table className="mini-grid"><thead><tr>{Array.from({ length: width }, (_, i) => <th key={i}>{hasHeader ? String(rows[0]?.[i] ?? '') : `Field${i + 1}`}</th>)}</tr></thead>
      <tbody>{body.slice(0, n).map((r, i) => <tr key={i}>{Array.from({ length: width }, (_, j) => <td key={j}>{fmt(r[j])}</td>)}</tr>)}</tbody></table></div>
  );

  return (
    <div>
      <div className="wiz-steps">{STEPS.map((s, i) => <span key={s} className={i + 1 === step ? 'on' : ''}>{i + 1}. {s}</span>)}</div>
      {step === 1 && <div><p>File: <b>{src.fileName}</b> ({src.kind.toUpperCase()}) — {sheets.length} sheet(s)/table(s).</p>{sheets.length > 1 && <div className="field-row mt-2"><label>Sheet / table</label><select className="sel" value={sheetIdx} onChange={(e) => setSheetIdx(Number(e.target.value))}>{sheets.map((s, i) => <option key={i} value={i}>{s.name} ({s.rows.length} rows)</option>)}</select></div>}<p className="muted small mt-2">{rows.length} row(s) read from the file.</p></div>}
      {step === 2 && <div><p className="mb-2">Preview of the first rows:</p>{preview(12)}</div>}
      {step === 3 && <div><label className="flex items-center gap-2 mb-2"><input type="checkbox" className="chk" checked={hasHeader} onChange={(e) => setHasHeader(e.target.checked)} /> First row contains field names</label>{preview(6)}<p className="muted small mt-2">WOWDB detected {hasHeader ? 'a header row' : 'no header row'}. Untick if the first row is data.</p></div>}
      {step === 4 && <div>
        <label className="flex items-center gap-2 mb-1"><input type="radio" checked={mode === 'new'} onChange={() => setMode('new')} /> Import the data into a new table</label>
        {mode === 'new' && <div className="field-row" style={{ marginLeft: 22 }}><label>Table name</label><input className="inp" value={table} onChange={(e) => setTable(e.target.value)} /></div>}
        <label className="flex items-center gap-2 mb-1"><input type="radio" checked={mode === 'append'} disabled={!p.tableNames().length} onChange={() => setMode('append')} /> Append a copy of the records to an existing table</label>
        {mode === 'append' && <div className="field-row" style={{ marginLeft: 22 }}><label>Table</label><select className="sel" value={appendTo} onChange={(e) => setAppendTo(e.target.value)}>{p.tableNames().map((n) => <option key={n}>{n}</option>)}</select></div>}
      </div>}
      {step === 5 && <div>
        <p className="mb-2">{mode === 'new' ? 'Name each field, or untick it to skip it.' : `Choose the field in ${appendTo} for each column (blank = skip).`}</p>
        <div className="scroll-box"><table className="mini-grid" style={{ width: '100%' }}><thead><tr><th>Include</th><th>Column in file</th><th>Field in table</th><th>Sample values</th></tr></thead>
          <tbody>{cols.map((c, i) => <tr key={i}>
            <td><input type="checkbox" className="chk" checked={!!c.target} onChange={(e) => setCols(cols.map((x, k) => (k === i ? { ...x, target: e.target.checked ? (mode === 'new' ? x.source : '') : '' } : x)))} /></td>
            <td>{c.source}</td>
            <td style={{ padding: 0 }}>{mode === 'new' ? <input className="inp w-full" style={{ border: 0 }} value={c.target} onChange={(e) => setCols(cols.map((x, k) => (k === i ? { ...x, target: e.target.value } : x)))} /> : <select className="sel w-full" style={{ border: 0 }} value={c.target} onChange={(e) => { const f = p.getTable(appendTo)?.fields.find((x) => x.name === e.target.value); setCols(cols.map((x, k) => (k === i ? recount({ ...x, target: e.target.value, type: f?.type ?? x.type, numberSize: f?.numberSize }) : x))); }}><option value="">(skip)</option>{p.getTable(appendTo)?.fields.filter((f) => f.type !== 'AutoNumber' && f.type !== 'Calculated').map((f) => <option key={f.id}>{f.name}</option>)}</select>}</td>
            <td className="muted">{c.samples.slice(0, 3).map(fmt).join(', ')}</td></tr>)}</tbody></table></div>
      </div>}
      {step === 6 && <div>
        <p className="mb-2">{mode === 'new' ? 'WOWDB suggested a data type for each field from its values. Change any that are wrong.' : 'Data types come from the existing table.'}</p>
        <div className="scroll-box"><table className="mini-grid" style={{ width: '100%' }}><thead><tr><th>Field</th><th>Data type</th><th>Invalid values</th></tr></thead>
          <tbody>{cols.filter((c) => c.target).map((c) => { const i = cols.indexOf(c); return <tr key={i}><td>{c.target}</td>
            <td style={{ padding: 0 }}>{mode === 'new' ? <select className="sel w-full" style={{ border: 0 }} value={c.type === 'Number' && c.numberSize === 'Double' ? 'Number (decimal)' : c.type} onChange={(e) => { const v = e.target.value; const t: DataType = v === 'Number (decimal)' ? 'Number' : v as DataType; setCols(cols.map((x, k) => (k === i ? recount({ ...x, type: t, numberSize: v === 'Number (decimal)' ? 'Double' : t === 'Number' ? 'Long Integer' : undefined }) : x))); }}>{[...DATA_TYPES.filter((t) => t !== 'AutoNumber' && t !== 'Calculated' && t !== 'Attachment'), 'Number (decimal)'].map((t) => <option key={t}>{t}</option>)}</select> : c.type}</td>
            <td className={c.invalid ? 'bad' : ''}>{c.invalid ? `${c.invalid} value(s) will be rejected` : 'OK'}</td></tr>; })}</tbody></table></div>
      </div>}
      {step === 7 && <div>
        {mode === 'new' && <><p className="mb-1">Primary key:</p>
          <label className="flex items-center gap-2"><input type="radio" checked={pk === 'add'} onChange={() => setPk('add')} /> Let WOWDB add an AutoNumber primary key</label>
          <label className="flex items-center gap-2"><input type="radio" checked={pk !== 'add' && pk !== 'none'} onChange={() => setPk(cols.find((c) => c.target)?.target ?? 'add')} /> Choose my own primary key: <select className="sel" disabled={pk === 'add' || pk === 'none'} value={pk} onChange={(e) => setPk(e.target.value)}>{cols.filter((c) => c.target).map((c) => <option key={c.index}>{c.target}</option>)}</select></label>
          <label className="flex items-center gap-2 mb-3"><input type="radio" checked={pk === 'none'} onChange={() => setPk('none')} /> No primary key</label></>}
        <p className="mb-1">Detect duplicate records using these field(s):</p>
        <div className="list-box" style={{ height: 110 }}>{cols.filter((c) => c.target).map((c) => <div key={c.index} onClick={() => setDupKeys(dupKeys.includes(c.target) ? dupKeys.filter((x) => x !== c.target) : [...dupKeys, c.target])}><input type="checkbox" className="chk" readOnly checked={dupKeys.includes(c.target)} /> {c.target}</div>)}</div>
        {(pk !== 'add' && pk !== 'none' && !dupKeys.includes(pk)) && <button className="link small" onClick={() => setDupKeys([...dupKeys, pk])}>Check the primary key field for duplicates</button>}
        <label className="flex items-center gap-2 mt-2"><input type="checkbox" className="chk" checked={skipDup} onChange={(e) => setSkipDup(e.target.checked)} /> Skip duplicate rows (they are listed in the summary)</label>
        {dupKeys.length > 0 && <p className={dupCount ? 'err-text mt-1' : 'muted small mt-1'}>{dupCount} duplicate row(s) found{mode === 'append' ? ' (in the file or already in the table)' : ''}.</p>}
      </div>}
      {step === 8 && <div>
        <p className="mb-2">Validation: {totalInvalid ? <span className="err-text">{totalInvalid} value(s) cannot be converted to the chosen data types. Those rows will be rejected and listed — go Back to change types if needed.</span> : 'every value converts to its data type.'}</p>
        <table className="mini-grid"><thead><tr><th>Field</th><th>Type</th><th>Invalid</th></tr></thead><tbody>{cols.filter((c) => c.target).map((c) => <tr key={c.index}><td>{c.target}</td><td>{c.type}</td><td className={c.invalid ? 'bad' : ''}>{c.invalid}</td></tr>)}</tbody></table>
        <p className="muted small mt-2">Required fields, validation rules, unique indexes and relationships of the destination table are also checked by the database engine for every row.</p>
      </div>}
      {step === 9 && <div>
        <p className="mb-2">The first rows as they will be imported (invalid cells in red):</p>
        <div className="scroll-box"><table className="mini-grid"><thead><tr>{cols.filter((c) => c.target).map((c) => <th key={c.index}>{c.target}</th>)}</tr></thead>
          <tbody>{body.slice(0, 15).map((r, i) => <tr key={i}>{cols.filter((c) => c.target).map((c) => { const v = r[c.index]; let bad = false; let shown: unknown = v; try { shown = v === null || v === undefined || String(v).trim() === '' ? '' : coerceValue({ id: 'x', name: c.target, type: c.type, numberSize: c.numberSize }, v); } catch { bad = true; } return <td key={c.index} className={bad ? 'bad' : ''}>{fmt(shown)}</td>; })}</tr>)}</tbody></table></div>
      </div>}
      {step === 10 && <div>
        <p>Ready to import <b>{body.length}</b> row(s) into {mode === 'new' ? <>a new table <b>{table}</b></> : <>the existing table <b>{appendTo}</b></>}.</p>
        <ul style={{ margin: '8px 0 0 18px', listStyle: 'disc' }}>
          <li>{cols.filter((c) => c.target).length} field(s); {mode === 'new' ? (pk === 'add' ? 'an AutoNumber primary key will be added' : pk === 'none' ? 'no primary key' : `primary key: ${pk}`) : 'existing keys and rules apply'}.</li>
          <li>{totalInvalid} invalid value(s){dupKeys.length ? `; ${dupCount} duplicate row(s) ${skipDup ? 'will be skipped' : 'will be attempted'}` : ''}.</li>
          <li>Every rejected row is reported with its reason. Nothing is silently discarded.</li>
        </ul>
      </div>}
      {err && <div className="err-text mt-2">{err}</div>}
      <div className="dlg-buttons">
        <button className="btn" onClick={() => close(null)}>Cancel</button>
        <button className="btn" disabled={step === 1} onClick={() => setStep(step - 1)}>&lt; Back</button>
        {step < 10 ? <button className="btn btn-primary" onClick={next}>Next &gt;</button> : <button className="btn btn-primary" onClick={finish}>Finish</button>}
      </div>
    </div>
  );
}

function SqlImport({ p, src, close }: { p: WowProject; src: ImportSource; close: (v: 'sql' | null) => void }) {
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const text = src.text ?? '';
  return (
    <div>
      <p className="mb-2">SQL script <b>{src.fileName}</b> ({text.split(';').filter((s) => s.trim()).length} statement(s)). It runs inside one transaction: if any statement fails, nothing is changed.</p>
      <pre className="scroll-box" style={{ fontFamily: 'ui-monospace, Consolas, monospace', fontSize: 12, padding: 8, whiteSpace: 'pre-wrap', maxHeight: 280 }}>{highlightSql(text.slice(0, 20000))}{text.length > 20000 ? '\n…' : ''}</pre>
      {err && <div className="banner err mt-2">{err}</div>}
      {done && <div className="banner ok mt-2">{done}</div>}
      <div className="dlg-buttons">
        {!done && <button className="btn btn-primary" onClick={() => { try { const r = importSqlScript(p, text); setDone(`Script completed. ${r.added.length ? `New objects: ${r.added.join(', ')}.` : 'No new tables were created.'}`); } catch (e) { setErr((e as Error).message); } }}>Run script</button>}
        <button className="btn" onClick={() => close(done ? 'sql' : null)}>{done ? 'Close' : 'Cancel'}</button>
      </div>
    </div>
  );
}

function uniqueTable(p: WowProject, base: string) { let n = base.replace(/\s+/g, '') || 'Imported'; let i = 1; while (p.nameInUse(n)) n = `${base.replace(/\s+/g, '')}${++i}`; return n; }
function fmt(v: unknown) { return v === null || v === undefined ? '' : String(v).slice(0, 60); }

// ======================= EXPORT =======================
export function ExportDialog({ p, initialSource, initialFormat, close }: { p: WowProject; initialSource?: string; initialFormat?: 'csv' | 'xlsx' | 'json' | 'sql'; close: (v: string | null) => void }) {
  const sources = [...p.tableNames(), ...p.queries().filter((q) => q.kind === 'select').map((q) => q.name)];
  const [source, setSource] = useState(initialSource && sources.includes(initialSource) ? initialSource : sources[0] ?? '');
  const [format, setFormat] = useState<'csv' | 'xlsx' | 'json' | 'sql'>(initialFormat ?? 'csv');
  const [whole, setWhole] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const run = () => {
    setErr(null);
    try {
      const base = safeFileName(whole ? p.name : source);
      if (format === 'sql') { downloadBytes(sqlDump(p, whole ? undefined : [source].filter((s) => p.getTable(s))), `${base}.sql`, 'application/sql'); if (!whole && !p.getTable(source)) throw new Error('SQL export of a query: choose a table, or tick "Whole database".'); }
      else if (format === 'xlsx') {
        const list = whole ? p.tableNames() : [source];
        downloadBytes(writeWorkbook(list.map((n) => ({ name: n, ...exportRows(p, n) }))), `${base}.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      } else if (format === 'json') {
        if (whole) { const obj: Record<string, unknown> = {}; for (const n of p.tableNames()) { const r = exportRows(p, n); obj[n] = JSON.parse(toJSON(r.columns, r.rows)); } downloadBytes(JSON.stringify({ database: p.name, tables: obj }, null, 2), `${base}.json`, 'application/json'); }
        else { const r = exportRows(p, source); downloadBytes(toJSON(r.columns, r.rows), `${base}.json`, 'application/json'); }
      } else { const r = exportRows(p, source); downloadBytes('﻿' + toCSV(r.columns, r.rows), `${base}.csv`, 'text/csv'); }
      close(`${whole ? 'Database' : source} exported as ${format.toUpperCase()}.`);
    } catch (e) { setErr((e as Error).message); }
  };
  return (
    <div>
      <div className="field-row"><label>Export</label><select className="sel" value={source} disabled={whole} onChange={(e) => setSource(e.target.value)}>{sources.map((s) => <option key={s}>{s}</option>)}</select></div>
      <div className="field-row"><label>File format</label><select className="sel" value={format} onChange={(e) => setFormat(e.target.value as typeof format)}><option value="csv">CSV (comma separated)</option><option value="xlsx">Excel workbook (.xlsx)</option><option value="json">JSON</option><option value="sql">SQL script</option></select></div>
      {format !== 'csv' && <label className="flex items-center gap-2"><input type="checkbox" className="chk" checked={whole} onChange={(e) => setWhole(e.target.checked)} /> Whole database (every table{format === 'sql' ? ', with structure, keys, relationships and views' : ''})</label>}
      <p className="muted small mt-2">Reports are exported to PDF from Print Preview (External Data &gt; PDF).</p>
      {err && <div className="err-text mt-2">{err}</div>}
      <div className="dlg-buttons"><button className="btn btn-primary" disabled={!source && !whole} onClick={run}>Export</button><button className="btn" onClick={() => close(null)}>Cancel</button></div>
    </div>
  );
}

// ======================= FORM / REPORT / QUERY WIZARDS =======================
function FieldPicker({ all, chosen, setChosen }: { all: string[]; chosen: string[]; setChosen: (v: string[]) => void }) {
  const [a, setA] = useState<string | null>(null), [b, setB] = useState<string | null>(null);
  const avail = all.filter((f) => !chosen.includes(f));
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 44px 1fr', gap: 6, alignItems: 'center' }}>
      <div><div className="small mb-1">Available Fields:</div><div className="list-box">{avail.map((f) => <div key={f} className={a === f ? 'on' : ''} onClick={() => setA(f)} onDoubleClick={() => setChosen([...chosen, f])}>{f}</div>)}</div></div>
      <div className="flex" style={{ flexDirection: 'column', gap: 4 }}>
        <button className="btn btn-sm" onClick={() => a && setChosen([...chosen, a])}>&gt;</button>
        <button className="btn btn-sm" onClick={() => setChosen([...all])}>&gt;&gt;</button>
        <button className="btn btn-sm" onClick={() => b && setChosen(chosen.filter((x) => x !== b))}>&lt;</button>
        <button className="btn btn-sm" onClick={() => setChosen([])}>&lt;&lt;</button>
      </div>
      <div><div className="small mb-1">Selected Fields:</div><div className="list-box">{chosen.map((f) => <div key={f} className={b === f ? 'on' : ''} onClick={() => setB(f)} onDoubleClick={() => setChosen(chosen.filter((x) => x !== f))}>{f}</div>)}</div></div>
    </div>
  );
}

export function FormWizard({ p, initialSource, close }: { p: WowProject; initialSource?: string; close: (v: FormDef | null) => void }) {
  const sources = [...p.tableNames(), ...p.listObjects('query').map((o) => o.name)];
  const [source, setSource] = useState(initialSource && sources.includes(initialSource) ? initialSource : sources[0] ?? '');
  const all = useMemo(() => p.columnsOf(source), [p, source]);
  const [chosen, setChosen] = useState<string[]>(all);
  useEffect(() => setChosen(p.columnsOf(source)), [source, p]);
  const [layout, setLayout] = useState<FormDef['defaultView']>('Single Form');
  const [title, setTitle] = useState(`frm${source}`);
  useEffect(() => setTitle(`frm${source}`), [source]);
  const [err, setErr] = useState<string | null>(null);
  return (
    <div>
      <div className="field-row"><label>Tables/Queries</label><select className="sel" value={source} onChange={(e) => setSource(e.target.value)}>{sources.map((s) => <option key={s}>{s}</option>)}</select></div>
      <FieldPicker all={all} chosen={chosen} setChosen={setChosen} />
      <div className="field-row mt-3"><label>Layout</label><select className="sel" value={layout} onChange={(e) => setLayout(e.target.value as FormDef['defaultView'])}><option value="Single Form">Columnar (one record at a time)</option><option value="Continuous Forms">Tabular (continuous)</option><option value="Datasheet">Datasheet</option></select></div>
      <div className="field-row"><label>Form name</label><input className="inp" value={title} onChange={(e) => setTitle(e.target.value)} /></div>
      {err && <div className="err-text">{err}</div>}
      <div className="dlg-buttons"><button className="btn btn-primary" disabled={!chosen.length} onClick={() => { try { p.validateObjectName(title, 'form'); close(autoForm(p, source, title.trim(), chosen, layout)); } catch (e) { setErr((e as Error).message); } }}>Finish</button><button className="btn" onClick={() => close(null)}>Cancel</button></div>
    </div>
  );
}

export function ReportWizard({ p, initialSource, close }: { p: WowProject; initialSource?: string; close: (v: ReturnType<typeof autoReport> | null) => void }) {
  const sources = [...p.tableNames(), ...p.queries().filter((q) => q.kind === 'select').map((q) => q.name)];
  const [source, setSource] = useState(initialSource && sources.includes(initialSource) ? initialSource : sources[0] ?? '');
  const all = useMemo(() => p.columnsOf(source), [p, source]);
  const [chosen, setChosen] = useState<string[]>(all);
  useEffect(() => setChosen(p.columnsOf(source)), [source, p]);
  const [group, setGroup] = useState('');
  const [sort, setSort] = useState('');
  const [totals, setTotals] = useState<string[]>([]);
  const [orient, setOrient] = useState<'Portrait' | 'Landscape'>('Portrait');
  const [title, setTitle] = useState(`rpt${source}`);
  useEffect(() => { setTitle(`rpt${source}`); setGroup(''); setSort(''); setTotals([]); }, [source]);
  const t = p.getTable(source);
  const numeric = chosen.filter((f) => { const fd = t?.fields.find((x) => x.name === f); return fd ? ['Number', 'Currency', 'Large Number'].includes(fd.type) || (fd.type === 'Calculated' && (fd.resultType === 'Number' || fd.resultType === 'Currency')) : /amount|fee|price|total|qty|quantity|score|count|sum/i.test(f); });
  const [err, setErr] = useState<string | null>(null);
  return (
    <div>
      <div className="field-row"><label>Tables/Queries</label><select className="sel" value={source} onChange={(e) => setSource(e.target.value)}>{sources.map((s) => <option key={s}>{s}</option>)}</select></div>
      <FieldPicker all={all} chosen={chosen} setChosen={setChosen} />
      <div className="field-row mt-3"><label>Group by</label><select className="sel" value={group} onChange={(e) => setGroup(e.target.value)}><option value="">(no grouping)</option>{chosen.map((f) => <option key={f}>{f}</option>)}</select></div>
      <div className="field-row"><label>Sort by</label><select className="sel" value={sort} onChange={(e) => setSort(e.target.value)}><option value="">(none)</option>{chosen.filter((f) => f !== group).map((f) => <option key={f}>{f}</option>)}</select></div>
      {numeric.length > 0 && <div className="field-row"><label>Sum totals for</label><div className="flex gap-3" style={{ flexWrap: 'wrap' }}>{numeric.map((f) => <label key={f} className="flex items-center gap-1"><input type="checkbox" className="chk" checked={totals.includes(f)} onChange={(e) => setTotals(e.target.checked ? [...totals, f] : totals.filter((x) => x !== f))} /> {f}</label>)}</div></div>}
      <div className="field-row"><label>Orientation</label><select className="sel" value={orient} onChange={(e) => setOrient(e.target.value as 'Portrait' | 'Landscape')}><option>Portrait</option><option>Landscape</option></select></div>
      <div className="field-row"><label>Report name</label><input className="inp" value={title} onChange={(e) => setTitle(e.target.value)} /></div>
      {err && <div className="err-text">{err}</div>}
      <div className="dlg-buttons"><button className="btn btn-primary" disabled={!chosen.length} onClick={() => { try { p.validateObjectName(title, 'report'); close(autoReport(p, source, title.trim(), { fields: chosen, groupBy: group || undefined, sortBy: sort || undefined, totals, orientation: orient })); } catch (e) { setErr((e as Error).message); } }}>Finish</button><button className="btn" onClick={() => close(null)}>Cancel</button></div>
    </div>
  );
}

export interface QueryWizardResult { design?: QueryDesign; sql?: string; name: string; }
export function QueryWizard({ p, close }: { p: WowProject; close: (v: QueryWizardResult | null) => void }) {
  const [kind, setKind] = useState<'simple' | 'dups' | 'unmatched'>('simple');
  const sources = [...p.tableNames(), ...p.listObjects('query').map((o) => o.name)];
  const [source, setSource] = useState(sources[0] ?? '');
  const [source2, setSource2] = useState(sources[1] ?? sources[0] ?? '');
  const all = useMemo(() => p.columnsOf(source), [p, source]);
  const all2 = useMemo(() => p.columnsOf(source2), [p, source2]);
  const [chosen, setChosen] = useState<string[]>([]);
  useEffect(() => setChosen([]), [source]);
  const [match1, setMatch1] = useState(''); const [match2, setMatch2] = useState('');
  const [name, setName] = useState('');
  useEffect(() => { setName(kind === 'simple' ? `${source} Query` : kind === 'dups' ? `Find duplicates for ${source}` : `${source} Without Matching ${source2}`); }, [kind, source, source2]);
  const finish = () => {
    if (kind === 'simple') {
      const d = emptyDesign(); d.tables.push({ id: 't1', name: source, x: 20, y: 20 }); chosen.forEach((f) => d.columns.push(newColumn(f, source)));
      close({ design: d, name });
    } else if (kind === 'dups') {
      const cols = chosen.map((c) => `"${c}"`).join(', ');
      close({ name, sql: `SELECT ${cols}, COUNT(*) AS NumberOfDups\nFROM "${source}"\nGROUP BY ${cols}\nHAVING COUNT(*) > 1\nORDER BY NumberOfDups DESC` });
    } else {
      const d = emptyDesign(); d.tables.push({ id: 't1', name: source, x: 20, y: 20 }, { id: 't2', name: source2, x: 260, y: 20 });
      d.joins.push({ id: 'j1', leftTable: source, leftField: match1, rightTable: source2, rightField: match2, type: 'left' });
      all.forEach((f) => d.columns.push(newColumn(f, source)));
      const c = newColumn(match2, source2); c.show = false; c.criteria = ['Is Null', '']; d.columns.push(c);
      close({ design: d, name });
    }
  };
  return (
    <div>
      <div className="flex gap-4 mb-3">
        <label className="flex items-center gap-1"><input type="radio" checked={kind === 'simple'} onChange={() => setKind('simple')} /> Simple Query Wizard</label>
        <label className="flex items-center gap-1"><input type="radio" checked={kind === 'dups'} onChange={() => setKind('dups')} /> Find Duplicates</label>
        <label className="flex items-center gap-1"><input type="radio" checked={kind === 'unmatched'} onChange={() => setKind('unmatched')} /> Find Unmatched</label>
      </div>
      <div className="field-row"><label>{kind === 'unmatched' ? 'Records in' : 'Tables/Queries'}</label><select className="sel" value={source} onChange={(e) => setSource(e.target.value)}>{sources.map((s) => <option key={s}>{s}</option>)}</select></div>
      {kind !== 'unmatched' && <FieldPicker all={all} chosen={chosen} setChosen={setChosen} />}
      {kind === 'unmatched' && <>
        <div className="field-row"><label>that have no match in</label><select className="sel" value={source2} onChange={(e) => setSource2(e.target.value)}>{sources.map((s) => <option key={s}>{s}</option>)}</select></div>
        <div className="field-row"><label>Matching fields</label><div className="flex gap-2"><select className="sel" value={match1} onChange={(e) => setMatch1(e.target.value)}><option value="" />{all.map((f) => <option key={f}>{f}</option>)}</select>=<select className="sel" value={match2} onChange={(e) => setMatch2(e.target.value)}><option value="" />{all2.map((f) => <option key={f}>{f}</option>)}</select></div></div>
        <p className="muted small">Example: Classes with no Students — a LEFT JOIN with "Is Null" criteria.</p>
      </>}
      <div className="field-row mt-2"><label>Query name</label><input className="inp" value={name} onChange={(e) => setName(e.target.value)} /></div>
      <div className="dlg-buttons"><button className="btn btn-primary" disabled={kind === 'unmatched' ? !match1 || !match2 : !chosen.length} onClick={finish}>Finish</button><button className="btn" onClick={() => close(null)}>Cancel</button></div>
    </div>
  );
}

// ======================= DATABASE PROPERTIES / BACKUP =======================
export function PropertiesDialog({ p, close }: { p: WowProject; close: (v: { name: string; description: string } | null) => void }) {
  const [name, setName] = useState(p.name);
  const [desc, setDesc] = useState(p.getMeta('description') ?? '');
  const size = Number(p.db.scalar('PRAGMA page_count')) * Number(p.db.scalar('PRAGMA page_size'));
  return (
    <div>
      <div className="field-row"><label>Database name</label><input className="inp" value={name} onChange={(e) => setName(e.target.value)} /></div>
      <div className="field-row"><label>Description</label><textarea className="inp" rows={3} value={desc} onChange={(e) => setDesc(e.target.value)} /></div>
      <div className="field-row"><label>Created</label><span>{p.getMeta('created') ? new Date(p.getMeta('created')!).toLocaleString() : '—'}</span></div>
      <div className="field-row"><label>Size</label><span>{(size / 1024).toFixed(1)} KB</span></div>
      <div className="field-row"><label>Contents</label><span>{p.tableNames().length} tables · {p.listObjects('query').length} queries · {p.listObjects('form').length} forms · {p.listObjects('report').length} reports · {p.relationships().length} relationships</span></div>
      <div className="field-row"><label>Engine</label><span>SQLite {String(p.db.scalar('select sqlite_version()'))} (WebAssembly)</span></div>
      <div className="dlg-buttons"><button className="btn btn-primary" onClick={() => close({ name: name.trim() || p.name, description: desc })}>OK</button><button className="btn" onClick={() => close(null)}>Cancel</button></div>
    </div>
  );
}

export function BackupDialog({ p, projectId, mode, close }: { p: WowProject; projectId: string; mode: 'backup' | 'restore'; close: (v: Uint8Array | 'done' | null) => void }) {
  const [list, setList] = useState<BackupInfo[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const refresh = () => { void listBackups(projectId).then(setList); };
  useEffect(refresh, [projectId]);
  const backup = async (download: boolean) => {
    const bytes = p.db.export();
    const d = new Date(); const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}_${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
    await saveBackup(projectId, `${p.name} ${stamp}`, bytes);
    if (download) downloadBytes(bytes, `${safeFileName(p.name)}_${stamp}.wowdb`, 'application/x-sqlite3');
    setMsg(`Backup created${download ? ' and downloaded' : ''}.`); refresh();
  };
  return (
    <div>
      {mode === 'backup' ? <p className="mb-2">A backup is a complete copy of the database file (data, design, queries, forms, reports and layouts).</p> : <p className="mb-2">Choose a backup to restore. The current database is replaced by the backup (a safety backup of the current state is made first).</p>}
      {mode === 'backup' && <div className="flex gap-2 mb-3"><button className="btn btn-primary" onClick={() => void backup(true)}>Back up and download .wowdb</button><button className="btn" onClick={() => void backup(false)}>Back up in browser only</button></div>}
      <div className="small mb-1">Backups of this database stored in this browser:</div>
      <div className="scroll-box"><table className="mini-grid" style={{ width: '100%' }}><thead><tr><th>Name</th><th>Created</th><th>Size</th><th /></tr></thead>
        <tbody>{list.map((b) => <tr key={b.id}><td>{b.name}</td><td>{new Date(b.created).toLocaleString()}</td><td>{(b.size / 1024).toFixed(0)} KB</td><td className="flex gap-1">
          {mode === 'restore' && <button className="btn btn-sm btn-primary" onClick={async () => { const bytes = await loadBackup(b.id); if (bytes) { await saveBackup(projectId, `${p.name} (before restore)`, p.db.export()); close(bytes); } }}>Restore</button>}
          <button className="btn btn-sm" onClick={async () => { const bytes = await loadBackup(b.id); if (bytes) downloadBytes(bytes, `${safeFileName(b.name)}.wowdb`); }}>Download</button>
          <button className="btn btn-sm" onClick={async () => { await deleteBackup(b.id); refresh(); }}>Delete</button></td></tr>)}
          {!list.length && <tr><td colSpan={4} className="muted">No backups yet.</td></tr>}</tbody></table></div>
      {mode === 'restore' && <p className="muted small mt-2">To restore from a file, use File &gt; Open and choose the .wowdb file.</p>}
      {msg && <div className="banner ok mt-2">{msg}</div>}
      <div className="dlg-buttons"><button className="btn" onClick={() => close(msg ? 'done' : null)}>Close</button></div>
    </div>
  );
}
