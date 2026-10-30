'use client';
import { isHosted } from '@/engine/persistence';
import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, Play, ChevronUp, ChevronDown } from 'lucide-react';
import type { WowProject } from '@/engine/project';
import type { MacroDef, ModuleDef } from '@/engine/types';
import { MACRO_ACTIONS } from '@/engine/objects';
import { runSql, splitStatements } from '@/engine/queries';
import { dependencies, documenterHtml, integrityCheck, performanceAnalysis, statistics, type Issue } from '@/engine/utilities';
import { useApp, type Tab } from '../store';
import { useEditorCommands } from '../commands';
import { errorBox, promptBox, confirmBox } from '../dialogs';
import { runAction } from '../actions';
import { SqlEditor } from '../SqlEditor';
import { DataGrid } from '../DataGrid';

function useSimpleSave<T extends { name: string }>(tab: Tab, p: WowProject, kind: 'macro' | 'module', value: T, initialJson: string) {
  const updateTab = useApp((s) => s.updateTab);
  const [saved, setSaved] = useState(initialJson);
  const dirty = JSON.stringify(value) !== saved;
  useEffect(() => { if (!!tab.dirty !== dirty) updateTab(tab.id, { dirty }); }, [dirty]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = async () => {
    let name = tab.name;
    if (!name) { const n = await promptBox(`${kind === 'macro' ? 'Macro' : 'Module'} Name:`, `${kind === 'macro' ? 'Macro' : 'Module'}${p.listObjects(kind).length + 1}`, 'Save As', (v) => { try { p.validateObjectName(v, kind); return null; } catch (e) { return (e as Error).message; } }); if (!n) return false; name = n.trim(); }
    const def = { ...value, name };
    try { if (kind === 'macro') p.saveMacro(def as unknown as MacroDef, tab.name || undefined); else p.saveModule(def as unknown as ModuleDef, tab.name || undefined); setSaved(JSON.stringify(def)); updateTab(tab.id, { name, title: name, dirty: false }); return true; }
    catch (e) { await errorBox(e); return false; }
  };
  return { save, dirty };
}

export function MacroEditor({ tab, active, project: p }: { tab: Tab; active: boolean; project: WowProject }) {
  const initial = p.getMacro(tab.name) ?? { name: '', actions: [{ action: 'MessageBox', argument: 'Hello from DBWOW' }] };
  const [def, setDef] = useState<MacroDef>(initial);
  const { save } = useSimpleSave(tab, p, 'macro', def, tab.name ? JSON.stringify(initial) : '');
  const run = async () => { for (const a of def.actions) await runAction(a.action, a.argument); };
  useEditorCommands(tab.id, active, { save: () => save() });
  const set = (i: number, patch: Partial<MacroDef['actions'][number]>) => setDef({ ...def, actions: def.actions.map((a, k) => (k === i ? { ...a, ...patch } : a)) });
  const objectsFor = (action: string) => action === 'OpenForm' ? p.listObjects('form').map((o) => o.name) : action === 'OpenReport' ? p.listObjects('report').map((o) => o.name) : action === 'OpenTable' ? p.tableNames() : action === 'RunQuery' || action === 'OpenQuery' ? p.listObjects('query').map((o) => o.name) : [];
  return (
    <div style={{ padding: 16, overflow: 'auto', height: '100%' }}>
      <p className="muted mb-3">A macro runs a list of built-in actions in order. Macros can open objects, run saved queries and show messages; they never run arbitrary code. Attach a macro to a command button with On Click = Run Macro.</p>
      <table className="mini-grid" style={{ minWidth: 620 }}>
        <thead><tr><th style={{ width: 30 }}>#</th><th style={{ width: 200 }}>Action</th><th style={{ width: 300 }}>Argument</th><th /></tr></thead>
        <tbody>
          {def.actions.map((a, i) => (
            <tr key={i}>
              <td>{i + 1}</td>
              <td style={{ padding: 0 }}><select className="sel w-full" style={{ border: 0 }} value={a.action} onChange={(e) => set(i, { action: e.target.value, argument: '' })}>{MACRO_ACTIONS.map((m) => <option key={m}>{m}</option>)}</select></td>
              <td style={{ padding: 0 }}>{objectsFor(a.action).length ? <select className="sel w-full" style={{ border: 0 }} value={a.argument} onChange={(e) => set(i, { argument: e.target.value })}><option value="" />{objectsFor(a.action).map((o) => <option key={o}>{o}</option>)}</select> : <input className="inp w-full" style={{ border: 0 }} value={a.argument} onChange={(e) => set(i, { argument: e.target.value })} placeholder={a.action === 'MessageBox' ? 'Message text' : ''} />}</td>
              <td className="flex gap-1">
                <button className="icon-btn" title="Move up" onClick={() => { if (i === 0) return; const x = [...def.actions]; [x[i - 1], x[i]] = [x[i], x[i - 1]]; setDef({ ...def, actions: x }); }}><ChevronUp size={13} /></button>
                <button className="icon-btn" title="Move down" onClick={() => { if (i === def.actions.length - 1) return; const x = [...def.actions]; [x[i + 1], x[i]] = [x[i], x[i + 1]]; setDef({ ...def, actions: x }); }}><ChevronDown size={13} /></button>
                <button className="icon-btn" title="Delete action" onClick={() => setDef({ ...def, actions: def.actions.filter((_, k) => k !== i) })}><Trash2 size={13} /></button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex gap-2 mt-3">
        <button className="btn" onClick={() => setDef({ ...def, actions: [...def.actions, { action: 'OpenForm', argument: '' }] })}><Plus size={13} style={{ display: 'inline' }} /> Add New Action</button>
        <button className="btn btn-primary" onClick={() => void run()}><Play size={13} style={{ display: 'inline' }} /> Run</button>
        <button className="btn" onClick={() => void save()}>Save</button>
      </div>
    </div>
  );
}

export function ModuleEditor({ tab, active, project: p }: { tab: Tab; active: boolean; project: WowProject }) {
  const initial = p.getModule(tab.name) ?? { name: '', notes: "-- SQL module: a saved script of SQL statements.\n-- Run executes every statement in order inside one transaction.\n\nSELECT name AS TableName FROM sqlite_master WHERE type = 'table' AND name NOT LIKE '\\_wow\\_%' ESCAPE '\\';\n" };
  const [def, setDef] = useState<ModuleDef>(initial);
  const [out, setOut] = useState<{ columns: string[]; rows: unknown[][] } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const { save } = useSimpleSave(tab, p, 'module', def, tab.name ? JSON.stringify(initial) : '');
  const run = async () => {
    setErr(null); setMsg(null);
    if (/\b(delete|drop|update)\b/i.test(def.notes) && !(await confirmBox('This script changes or deletes data. Run it?', { danger: true }))) return;
    try { const r = runSql(p, def.notes); if (r.kind === 'rows') { setOut({ columns: r.columns, rows: r.rows }); setMsg(`${splitStatements(def.notes).length} statement(s) run · ${r.rows.length} row(s) · ${r.ms.toFixed(1)} ms`); } else { setOut(null); setMsg(`${r.message} (${r.ms.toFixed(1)} ms)`); } }
    catch (e) { setErr((e as Error).message); }
  };
  useEditorCommands(tab.id, active, { save: () => save(), 'q.run': () => void run() });
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="banner info">SQL Module: write SQL statements separated by ; and press Run (Ctrl+Enter). Modules are DBWOW&apos;s safe alternative to VBA: only SQL runs, inside the database.</div>
      <div style={{ flex: '1 1 50%', minHeight: 120, display: 'flex' }}><SqlEditor value={def.notes} onChange={(v) => setDef({ ...def, notes: v })} onRun={() => void run()} /></div>
      <div className="banner" style={{ borderTop: '1px solid var(--line)', background: '#fafafa' }}><button className="btn btn-sm btn-primary" onClick={() => void run()}>Run</button><button className="btn btn-sm" onClick={() => void save()}>Save</button>{msg && <span className="small muted">{msg}</span>}</div>
      {err && <div className="banner err">{err}</div>}
      {out && <div style={{ flex: '1 1 50%', minHeight: 100, display: 'flex', flexDirection: 'column' }}><DataGrid tabId={tab.id} active={active} project={p} result={out} /></div>}
    </div>
  );
}

export function ToolView({ tab, project: p }: { tab: Tab; project: WowProject }) {
  const version = useApp((s) => s.version);
  const content = useMemo(() => {
    switch (tab.view) {
      case 'documenter': return <div className="doc-html" dangerouslySetInnerHTML={{ __html: documenterHtml(p) }} />;
      case 'integrity': return <Issues title="Integrity Checker" intro="Checks the SQLite file (PRAGMA integrity_check), all foreign keys, relationships that are not enforced, and every saved object's references." issues={integrityCheck(p)} />;
      case 'performance': return <Issues title="Performance Analyzer" intro="Suggestions based on keys, indexes and SQLite query plans (EXPLAIN QUERY PLAN)." issues={performanceAnalysis(p)} />;
      case 'dependencies': {
        const deps = dependencies(p);
        return (
          <div className="doc-html">
            <h1>Object Dependencies</h1>
            <table><thead><tr><th>Object</th><th>Uses</th><th>Used by</th></tr></thead>
              <tbody>{deps.map((d) => <tr key={d.type + d.name}><td><b>{d.name}</b> <span className="muted">({d.type})</span></td><td>{d.uses.map((u) => `${u.name} (${u.type})`).join(', ') || '—'}</td><td>{d.usedBy.map((u) => `${u.name} (${u.type})`).join(', ') || '—'}</td></tr>)}</tbody></table>
          </div>
        );
      }
      case 'statistics': {
        const s = statistics(p);
        return (
          <div className="doc-html">
            <h1>Database Statistics</h1>
            <p>File size: {(s.sizeBytes / 1024).toFixed(1)} KB ({s.pageCount} pages) · Tables: {s.tables.length} · Queries: {s.queries} · Forms: {s.forms} · Reports: {s.reports} · Relationships: {s.relationships}</p>
            <table><thead><tr><th>Table</th><th>Records</th><th>Fields</th><th>Indexes</th></tr></thead>
              <tbody>{s.tables.map((t) => <tr key={t.name}><td>{t.name}</td><td style={{ textAlign: 'right' }}>{t.records}</td><td style={{ textAlign: 'right' }}>{t.fields}</td><td>{t.indexes.map((i) => `${i.name}${i.unique ? ' (unique)' : ''}: ${i.columns.join(', ')}`).join('; ') || '—'}</td></tr>)}</tbody></table>
          </div>
        );
      }
      case 'relreport': {
        return (
          <div className="doc-html">
            <h1>Relationships for {p.name}</h1>
            <table><thead><tr><th>Primary table</th><th>Related table</th><th>Fields</th><th>Type</th><th>Referential integrity</th></tr></thead>
              <tbody>{p.relationships().map((r) => <tr key={r.name}><td>{r.primaryTable}</td><td>{r.relatedTable}</td><td>{r.fields.map((f) => `${f.primary} → ${f.related}`).join(', ')}</td><td>{p.relationshipType(r)}</td><td>{r.enforce ? `Enforced${r.cascadeUpdate ? ', cascade update' : ''}${r.cascadeDelete ? ', cascade delete' : ''}` : 'Not enforced'}</td></tr>)}</tbody></table>
            {p.tables().map((t) => <div key={t.name}><h2>{t.name}</h2><p>{t.fields.map((f) => `${f.primaryKey ? '🔑' : ''}${f.name}`).join(' · ')}</p></div>)}
          </div>
        );
      }
      default: return null;
    }
  }, [tab.view, p, version]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div style={{ height: '100%', overflow: 'auto', padding: '16px 24px' }}>
      <div className="flex gap-2 mb-2">{!isHosted() && <button className="btn btn-sm" onClick={() => window.print()}>Print</button>}<span className="muted small">Live view: refreshes automatically when the database changes.</span></div>
      <div className="print-area">{content}</div>
    </div>
  );
}

function Issues({ title, intro, issues }: { title: string; intro: string; issues: Issue[] }) {
  const col = { error: '#b3261e', warning: '#9a6700', info: '#1f5fae' };
  return (
    <div className="doc-html">
      <h1>{title}</h1>
      <p className="muted">{intro}</p>
      <table><thead><tr><th>Severity</th><th>Object</th><th>Finding</th><th>Suggested fix</th></tr></thead>
        <tbody>{issues.map((i, k) => <tr key={k}><td style={{ color: col[i.severity], fontWeight: 600 }}>{i.severity}</td><td>{i.object}</td><td>{i.message}</td><td>{i.fix ?? ''}</td></tr>)}</tbody></table>
    </div>
  );
}
