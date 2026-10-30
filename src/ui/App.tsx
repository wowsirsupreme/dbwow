'use client';
import type { LucideIcon } from 'lucide-react';
import React, { useCallback, useEffect, useState } from 'react';
import { Save, Undo2, Redo2, X, Table, Network, FormInput, FileBarChart, Workflow, FileCode, GitFork, GraduationCap, Wrench, LayoutGrid, PencilRuler, Code2, Eye, PanelsTopLeft, Printer, Settings } from 'lucide-react';
import { WowProject } from '@/engine/project';
import { loadSqlJs } from '@/engine/sqlite';
import type { ObjectType } from '@/engine/types';
import { buildSample, type SampleId } from '@/engine/samples';
import { compactAndRepair } from '@/engine/utilities';
import { autoForm, autoReport, newFormDef, newReportDef } from '@/engine/objects';
import { runQuery, queryParameters, previewActionCount } from '@/engine/queries';
import { saveProject, loadProject, deleteProject, lastOpened, rememberLast, pickFile, downloadBytes, safeFileName, setDownloadNotifier } from '@/engine/persistence';
import { useApp, saveNow, type Tab } from './store';
import { runCommand, runCommandAsync, useGlobalCommands, useCmdState } from './commands';
import { DialogLayer, ContextMenuLayer, openDialog, messageBox, errorBox, confirmBox, promptBox, yesNoCancel, askParameters } from './dialogs';
import { Ribbon, useCtxBand } from './shell/Ribbon';
import { PracticalPanel, RankBadge, Toasts, trackEvent, useLearningTracker } from './learning';
import { NavPane } from './shell/NavPane';
import { Backstage, type BackstageOps } from './shell/Backstage';
import { TableEditor } from './editors/TableEditor';
import { QueryEditor } from './editors/QueryEditor';
import { RelationshipsEditor } from './editors/RelationshipsEditor';
import { FormEditor, ReportEditor } from './editors/FormReportEditors';
import { MacroEditor, ModuleEditor, ToolView } from './editors/MiscEditors';
import { LearningCentre, SHORTCUTS } from './LearningCentre';
import { ImportWizard, readImportFile, ExportDialog, FormWizard, ReportWizard, QueryWizard, PropertiesDialog, BackupDialog, type QueryWizardResult } from './dialogs/Wizards';
import { runAction } from './actions';

function newId() { return 'db_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

export default function App() {
  useLearningTracker();
  const project = useApp((s) => s.project);
  const backstage = useApp((s) => s.backstage);
  const tabs = useApp((s) => s.tabs);
  const activeTabId = useApp((s) => s.activeTabId);
  const [booting, setBooting] = useState(true);
  const [bootErr, setBootErr] = useState<string | null>(null);

  // ---------- database lifecycle ----------
  const adopt = useCallback(async (p: WowProject, id: string, persist = true) => {
    if (persist) { const bytes = p.db.export(); await saveProject({ id, name: p.name, bytes, modified: new Date().toISOString(), size: bytes.length }); }
    useApp.getState().setProject(p, id);
  }, []);

  const confirmCloseAll = async (): Promise<boolean> => {
    for (const t of useApp.getState().tabs.filter((x) => x.dirty)) {
      useApp.getState().activate(t.id);
      const r = await yesNoCancel(`Do you want to save changes to the design of ${t.kind} '${t.title || 'Untitled'}'?`);
      if (r === 'cancel') return false;
      if (r === 'yes') { const ok = await runCommandAsync('save', t.id); if (ok === false) return false; }
    }
    return true;
  };

  const ops: BackstageOps = {
    newBlank: async () => {
      if (project && !(await confirmCloseAll())) return;
      const name = await promptBox('File Name:', 'Database1', 'Blank database', (v) => (v.trim() ? null : 'Enter a name.'));
      if (!name) return;
      try { const p = await WowProject.create(name.trim()); await adopt(p, newId()); useApp.getState().setStatus(`Created ${name}.`); } catch (e) { void errorBox(e); }
    },
    newSample: async (sid) => {
      if (project && !(await confirmCloseAll())) return;
      try { useApp.getState().setStatus('Building sample database…'); const p = await buildSample(sid as SampleId); await adopt(p, newId()); trackEvent(`sample:${sid}`); useApp.getState().openTab({ kind: 'relationships', name: 'Relationships', title: 'Relationships', view: 'design' }); useApp.getState().setStatus(`${p.name} sample created — fictional data only.`); } catch (e) { void errorBox(e); }
    },
    openStored: async (id) => {
      if (id === useApp.getState().projectId) { useApp.getState().setBackstage(false); return; }
      if (project && !(await confirmCloseAll())) return;
      try { const s = await loadProject(id); if (!s) throw new Error('That database was not found in browser storage.'); const p = await WowProject.open(s.bytes); await adopt(p, id, false); } catch (e) { void errorBox(e, 'Could not open the database'); }
    },
    openFile: async () => {
      const f = await pickFile('.dbwow,.wowdb,.db,.sqlite,.sqlite3,.db3');
      if (!f) return;
      if (project && !(await confirmCloseAll())) return;
      try {
        const bytes = new Uint8Array(await f.arrayBuffer());
        const head = new TextDecoder().decode(bytes.slice(0, 15));
        if (head !== 'SQLite format 3') throw new Error(`"${f.name}" is not a SQLite / DBWOW database file.`);
        const p = await WowProject.open(bytes);
        if (!p.getMeta('name') || p.getMeta('name') === 'Imported database') p.setMeta('name', f.name.replace(/\.[^.]+$/, ''), true);
        const integ = String(p.db.scalar('PRAGMA integrity_check'));
        await adopt(p, newId());
        if (integ !== 'ok') void messageBox(`The file opened, but SQLite reported problems: ${integ}\n\nUse Database Tools > Compact & Repair.`, 'DBWOW', 'warn');
      } catch (e) { void errorBox(e, 'Could not open the file'); }
    },
    save: async () => { const id = useApp.getState().activeTabId; if (id) await runCommandAsync('save', id); await saveNow(); useApp.getState().setStatus('All changes saved.'); },
    saveAs: async () => {
      if (!project) return;
      if (!(await confirmCloseAll())) return;
      const name = await promptBox('Save database as:', `${project.name} copy`, 'Save As');
      if (!name) return;
      const p2 = await WowProject.open(project.db.export());
      p2.setMeta('name', name.trim(), true);
      await adopt(p2, newId());
      useApp.getState().setStatus(`Saved as "${name}". You are now working in the copy.`);
    },
    downloadCopy: () => { if (project) { downloadBytes(project.db.export(), `${safeFileName(project.name)}.dbwow`, 'application/x-sqlite3'); trackEvent('backup'); useApp.getState().setStatus('Downloaded a .dbwow file (a standard SQLite database).'); } },
    properties: async () => {
      if (!project) return;
      const r = await openDialog<{ name: string; description: string }>('Database Properties', (close) => <PropertiesDialog p={project} close={close} />, 520);
      if (r) { project.setMeta('name', r.name); project.setMeta('description', r.description); }
    },
    backup: () => { const s = useApp.getState(); if (s.project && s.projectId) void openDialog('Back Up Database', (close) => <BackupDialog p={s.project!} projectId={s.projectId!} mode="backup" close={close} />, 620); },
    restore: async () => {
      const s = useApp.getState(); if (!s.project || !s.projectId) return;
      const bytes = await openDialog<Uint8Array | 'done'>('Restore Database', (close) => <BackupDialog p={s.project!} projectId={s.projectId!} mode="restore" close={close} />, 620);
      if (bytes instanceof Uint8Array) { if (!(await confirmCloseAll())) return; const p = await WowProject.open(bytes); await adopt(p, s.projectId); useApp.getState().setStatus('Database restored from backup.'); }
    },
    compact: async () => {
      if (!project) return;
      if (!(await confirmCloseAll())) return;
      try { const r = compactAndRepair(project); await saveNow(); void messageBox(`Compact & Repair finished.\n\nSize before: ${(r.before / 1024).toFixed(1)} KB\nSize after: ${(r.after / 1024).toFixed(1)} KB\nIntegrity check: ${r.integrity}`, 'Compact & Repair'); } catch (e) { void errorBox(e); }
    },
    exportDb: () => { if (project) void openDialog<string>('Export', (close) => <ExportDialog p={project} close={close} />, 460).then((m) => { if (m) { useApp.getState().setStatus(m); trackEvent('export'); } }); },
    print: () => {
      const t = useApp.getState().tabs.find((x) => x.id === useApp.getState().activeTabId);
      useApp.getState().setBackstage(false);
      if (t?.kind === 'report') { useApp.getState().updateTab(t.id, { view: 'preview' }); setTimeout(() => runCommand('pp.print', t.id), 300); }
      else void messageBox('Open a report in Print Preview to print it. Forms and tool views can be printed with your browser\'s print command.', 'Print');
    },
    close: async () => { if (await confirmCloseAll()) { await saveNow(); rememberLast(null); useApp.getState().setProject(null, null); useApp.getState().setBackstage(true); } },
    deleteStored: async (id, name) => {
      if (!(await confirmBox(`Permanently delete "${name}" from this browser?\n\nDownload a copy first if you want to keep it.`, { danger: true }))) return;
      await deleteProject(id);
      if (id === useApp.getState().projectId) { rememberLast(null); useApp.getState().setProject(null, null); useApp.getState().setBackstage(true); }
      useApp.getState().bump();
    },
    learning: () => openLearning('topic:intro'),
  };

  useEffect(() => { setDownloadNotifier((m) => void messageBox(m, 'Save file', 'warn')); }, []);
  // test/inspection hook (used by the automated browser acceptance tests)
  useEffect(() => { (window as unknown as { __WOWDB__: unknown }).__WOWDB__ = { store: useApp }; }, []);

  // boot: reopen the last database
  useEffect(() => {
    (async () => {
      try { await loadSqlJs(); }
      catch (e) { setBootErr(`The SQLite engine could not start in this browser (${(e as Error).message}). DBWOW needs WebAssembly. Try an up-to-date Chrome, Edge or Firefox, or open the portable DBWOW file directly.`); setBooting(false); return; }
      try {
        const id = lastOpened();
        if (id) { const s = await loadProject(id); if (s) { const p = await WowProject.open(s.bytes); useApp.getState().setProject(p, id); } }
      } catch (e) { setBootErr((e as Error).message); }
      setBooting(false);
      if (!useApp.getState().project) useApp.getState().setBackstage(true);
    })();
    const beforeUnload = () => { void saveNow(); };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, []);

  // ---------- opening objects ----------
  const openObject = (type: ObjectType, name: string, view?: string) => {
    const v = view ?? (type === 'table' ? 'datasheet' : type === 'query' ? 'datasheet' : type === 'form' ? 'form' : type === 'report' ? 'preview' : 'design');
    if (type === 'query' && v === 'datasheet') {
      const q = project?.getQuery(name);
      if (q) { useApp.getState().openTab({ kind: 'query', name: q.name, title: q.name, view: q.design && !q.sqlOnly ? 'design' : 'sql', payload: { autorun: true } }); return; }
    }
    useApp.getState().openTab({ kind: type as Tab['kind'], name, title: name, view: v });
  };
  const runObject = async (type: ObjectType, name: string) => {
    if (!project) return;
    if (type === 'macro') { const m = project.getMacro(name); if (m) for (const a of m.actions) await runAction(a.action, a.argument); return; }
    if (type === 'query') {
      const q = project.getQuery(name); if (!q) return;
      const prompts = queryParameters(project, q.sql);
      const vals = prompts.length ? await askParameters(prompts) : {};
      if (!vals) return;
      const n = previewActionCount(project, q, vals);
      if (!(await confirmBox(`You are about to run an action query (${q.kind}) that will modify ${n ?? 'some'} record(s) in your table.\n\nAre you sure you want to run this type of action query?`, { danger: true }))) return;
      try { const r = runQuery(project, q, vals); void messageBox(r.message ?? 'Done.'); } catch (e) { void errorBox(e); }
    }
  };
  const openLearning = (section: string) => { const id = useApp.getState().openTab({ kind: 'learning', name: 'Learning Centre', title: 'Learning Centre', view: 'learn', payload: { section } }); useApp.getState().updateTab(id, { payload: { section } }); };
  const openTool = (view: string, title: string) => useApp.getState().openTab({ kind: 'tool', name: title, title, view });

  const activeTab = tabs.find((t) => t.id === activeTabId);
  const sourceGuess = (): string | undefined => {
    const t = activeTab;
    if (t && (t.kind === 'table' || t.kind === 'query') && t.name) return t.name;
    return undefined;
  };

  const createForm = (src?: string) => {
    if (!project) return;
    const s = src ?? sourceGuess() ?? project.tableNames()[0];
    if (!s) { void messageBox('Create a table first, then select it in the Navigation Pane and click Create > Form.'); return; }
    const name = uniqueObjName(project, 'form', `frm${s.replace(/\s+/g, '')}`);
    const def = autoForm(project, s, name);
    project.saveForm(def);
    openObject('form', name, 'form');
  };
  const createReport = (src?: string) => {
    if (!project) return;
    const s = src ?? sourceGuess() ?? project.tableNames()[0];
    if (!s) { void messageBox('Create a table or query first.'); return; }
    const name = uniqueObjName(project, 'report', `rpt${s.replace(/\s+/g, '')}`);
    project.saveReport(autoReport(project, s, name));
    openObject('report', name, 'preview');
  };
  const doImport = async (accept: string) => {
    if (!project) return;
    const f = await pickFile(accept);
    if (!f) return;
    try {
      const src = await readImportFile(f);
      if (src.kind !== 'sql' && !(src.sheets ?? []).some((s) => s.rows.length)) { void messageBox('The file contains no rows to import.', 'Import', 'warn'); return; }
      const res = await openDialog('Import Wizard — ' + f.name, (close) => <ImportWizard p={project} src={src} close={close} />, 760);
      if (res && typeof res === 'object' && 'table' in res) { const sm = res as { table: string; inserted: number }; useApp.getState().setStatus(`Imported ${sm.inserted} row(s) into ${sm.table}.`); trackEvent('import'); openObject('table', sm.table, 'datasheet'); }
    } catch (e) { void errorBox(e, 'Import failed'); }
  };
  const doExport = (format?: 'csv' | 'xlsx' | 'json' | 'sql', source?: string) => { if (project) void openDialog<string>('Export', (close) => <ExportDialog p={project} initialSource={source ?? sourceGuess()} initialFormat={format} close={close} />, 460).then((m) => { if (m) { useApp.getState().setStatus(m); trackEvent('export'); } }); };

  const has = !!project;
  useGlobalCommands({
    'create.table': { run: () => useApp.getState().openTab({ kind: 'table', name: '', title: 'Table1', view: 'design', payload: { quick: true } }), enabled: has },
    'create.tableDesign': { run: () => useApp.getState().openTab({ kind: 'table', name: '', title: 'Table1', view: 'design' }), enabled: has },
    'create.queryDesign': { run: () => useApp.getState().openTab({ kind: 'query', name: '', title: 'Query1', view: 'design' }), enabled: has },
    'create.sql': { run: () => useApp.getState().openTab({ kind: 'query', name: '', title: 'Query1', view: 'sql', payload: { sqlMode: true, sql: '' } }), enabled: has },
    'create.queryWizard': { run: async () => { if (!project) return; const r = await openDialog<QueryWizardResult>('Query Wizard', (close) => <QueryWizard p={project} close={close} />, 600); if (!r) return; useApp.getState().openTab({ kind: 'query', name: '', title: r.name, view: r.sql ? 'sql' : 'design', payload: r.sql ? { sql: r.sql, sqlMode: true } : { design: r.design } }); }, enabled: has },
    'create.form': { run: () => createForm(), enabled: has },
    'create.formDesign': { run: () => useApp.getState().openTab({ kind: 'form', name: '', title: 'Form1', view: 'design', payload: { def: newFormDef('', sourceGuess() ?? '') } }), enabled: has },
    'create.formWizard': { run: async () => { if (!project) return; const d = await openDialog('Form Wizard', (close) => <FormWizard p={project} initialSource={sourceGuess()} close={close} />, 560); if (d) { project.saveForm(d as never); openObject('form', (d as { name: string }).name, 'form'); } }, enabled: has },
    'create.report': { run: () => createReport(), enabled: has },
    'create.reportDesign': { run: () => useApp.getState().openTab({ kind: 'report', name: '', title: 'Report1', view: 'design', payload: { def: newReportDef('', sourceGuess() ?? '') } }), enabled: has },
    'create.reportWizard': { run: async () => { if (!project) return; const d = await openDialog('Report Wizard', (close) => <ReportWizard p={project} initialSource={sourceGuess()} close={close} />, 580); if (d) { project.saveReport(d as never); openObject('report', (d as { name: string }).name, 'preview'); } }, enabled: has },
    'create.relationships': { run: () => useApp.getState().openTab({ kind: 'relationships', name: 'Relationships', title: 'Relationships', view: 'design' }), enabled: has },
    'tools.relationships': { run: () => useApp.getState().openTab({ kind: 'relationships', name: 'Relationships', title: 'Relationships', view: 'design' }), enabled: has },
    'create.macro': { run: () => useApp.getState().openTab({ kind: 'macro', name: '', title: 'Macro1', view: 'design' }), enabled: has },
    'create.module': { run: () => useApp.getState().openTab({ kind: 'module', name: '', title: 'Module1', view: 'design' }), enabled: has },
    'ext.importWizard': { run: () => void doImport('.csv,.txt,.tsv,.xlsx,.xls,.ods,.json,.sql'), enabled: has },
    'ext.importCsv': { run: () => void doImport('.csv,.txt,.tsv'), enabled: has },
    'ext.importExcel': { run: () => void doImport('.xlsx,.xls,.ods'), enabled: has },
    'ext.importJson': { run: () => void doImport('.json'), enabled: has },
    'ext.importSql': { run: () => void doImport('.sql,.txt'), enabled: has },
    'ext.openSqlite': ops.openFile,
    'ext.exportWizard': { run: () => doExport(), enabled: has },
    'ext.exportCsv': { run: () => doExport('csv'), enabled: has }, 'ext.exportExcel': { run: () => doExport('xlsx'), enabled: has },
    'ext.exportJson': { run: () => doExport('json'), enabled: has }, 'ext.exportSql': { run: () => doExport('sql'), enabled: has },
    'ext.exportWorkbook': { run: () => doExport('xlsx'), enabled: has },
    'ext.exportPdf': { run: () => { const t = activeTab; if (t?.kind === 'report' && t.name) { useApp.getState().updateTab(t.id, { view: 'preview' }); setTimeout(() => runCommand('ext.exportPdf', t.id), 300); } else void messageBox('Open a report (Print Preview) to export it as PDF.', 'Export PDF'); }, enabled: has },
    'tools.compact': { run: ops.compact, enabled: has },
    'tools.documenter': { run: () => openTool('documenter', 'Database Documenter'), enabled: has },
    'tools.dependencies': { run: () => openTool('dependencies', 'Object Dependencies'), enabled: has },
    'tools.performance': { run: () => openTool('performance', 'Performance Analyzer'), enabled: has },
    'tools.integrity': { run: () => openTool('integrity', 'Integrity Checker'), enabled: has },
    'tools.statistics': { run: () => openTool('statistics', 'Database Statistics'), enabled: has },
    'tools.backup': { run: ops.backup, enabled: has }, 'tools.restore': { run: ops.restore, enabled: has },
    'help.learning': () => openLearning('topic:intro'), 'help.tutorials': () => openLearning('prac:schooldb'), 'help.exercises': () => openLearning('prac:lib-b'),
    'help.sqlref': () => openLearning('ref:sql'), 'help.shortcuts': () => openLearning('ref:keys'),
    'help.learningMode': { run: () => useApp.getState().setLearningMode(!useApp.getState().learningMode), checked: useApp.getState().learningMode },
    'help.about': () => void messageBox(<div><b>DBWOW</b> — an educational database development environment inspired by desktop database applications.<br /><br />Real relational engine: SQLite {project ? String(project.db.scalar('select sqlite_version()')) : ''} compiled to WebAssembly. Your databases are stored in this browser and can be downloaded as standard SQLite files.<br /><br />Created for classroom teaching and practical database training (WOW Sir). Not affiliated with Microsoft; &quot;Access&quot; is a trademark of Microsoft Corporation.<br /><br />Non-commercial educational project.</div>, 'About DBWOW'),
    'file.new': ops.newBlank, 'file.open': () => { useApp.getState().setBackstage(true); },
    save: { run: () => ops.save(), enabled: has },
  });

  // ---------- keyboard shortcuts ----------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const st = useApp.getState();
      const tab = st.activeTabId;
      const ctrl = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      const inField = (e.target as HTMLElement)?.matches?.('input, textarea, select, [contenteditable]');
      if (ctrl && k === 's') { e.preventDefault(); void ops.save(); return; }
      if (ctrl && k === 'o') { e.preventDefault(); st.setBackstage(true); return; }
      if (ctrl && (k === 'n') && (e.altKey || !e.shiftKey)) { e.preventDefault(); void ops.newBlank(); return; }
      if (ctrl && k === 'f' && !e.shiftKey) { e.preventDefault(); runCommand('home.find', tab); return; }
      if (ctrl && k === 'h') { e.preventDefault(); runCommand('home.replace', tab); return; }
      if ((ctrl && k === 'w') || (ctrl && e.key === 'F4')) { e.preventDefault(); if (tab) void closeTabSafe(tab); return; }
      if (e.key === 'F5') { e.preventDefault(); if (!runCommand('q.run', tab)) runCommand('home.refresh', tab); return; }
      if (e.key === 'F1') { e.preventDefault(); const t = st.tabs.find((x) => x.id === tab); openLearning(t?.kind === 'query' ? 'topic:queries' : t?.kind === 'form' ? 'topic:forms' : t?.kind === 'report' ? 'topic:reports' : t?.kind === 'relationships' ? 'topic:rel' : t?.kind === 'table' ? 'topic:tables' : 'topic:intro'); return; }
      if (e.key === 'F11') { e.preventDefault(); st.toggleNav(); return; }
      if (e.key === 'F6') { e.preventDefault(); const nav = document.querySelector<HTMLElement>('[data-testid="nav-pane"] .nav-item, [data-testid="nav-pane"] input'); const ws = document.querySelector<HTMLElement>('.doc-pane:not(.hidden) [tabindex], .doc-pane:not(.hidden) input'); if (document.activeElement?.closest('[data-testid="nav-pane"]')) ws?.focus(); else nav?.focus(); return; }
      if (!inField && ctrl && k === 'z') { if (runCommand('undo', tab)) e.preventDefault(); return; }
      if (!inField && ctrl && k === 'y') { if (runCommand('redo', tab)) e.preventDefault(); return; }
      if (e.key === 'Escape' && st.backstage && st.project) { st.setBackstage(false); st.setRibbonTab('home'); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const closeTabSafe = async (id: string) => {
    const t = useApp.getState().tabs.find((x) => x.id === id);
    if (!t) return;
    if (t.dirty) {
      const r = await yesNoCancel(`Do you want to save changes to the design of ${t.kind} '${t.title || 'Untitled'}'?`);
      if (r === 'cancel') return;
      if (r === 'yes') { const ok = await runCommandAsync('save', id); if (ok === false) return; if (useApp.getState().tabs.find((x) => x.id === id)?.dirty) return; }
    }
    useApp.getState().closeTab(id);
  };

  if (booting) return <div className="empty-ws" style={{ height: '100vh' }}>Starting DBWOW…</div>;
  if (bootErr && !project) return <div className="empty-ws" style={{ height: '100vh', padding: 24 }}><div style={{ maxWidth: 560 }}><h1 style={{ fontSize: 22, color: 'var(--accent-dark)', marginBottom: 10 }}>DBWOW</h1><p>{bootErr}</p></div></div>;

  return (
    <div className="app">
      <TitleBar onSave={() => void ops.save()} />
      {(project || !backstage) && <Ribbon />}
      <div className="main" style={{ position: 'relative' }}>
        {bootErr && <div className="banner err">{bootErr}</div>}
        {project && <NavPane openObject={openObject} runObject={(t, n) => void runObject(t, n)} actions={{ createForm: (n) => createForm(n), createReport: (n) => createReport(n), exportOf: (n) => doExport(undefined, n) }} />}
        <Workspace closeTab={(id) => void closeTabSafe(id)} openSample={(id) => void ops.newSample(id)} />
        {(backstage || !project) && <Backstage ops={ops} />}
      </div>
      {project && <PracticalPanel openInCentre={(id) => openLearning(`prac:${id}`)} openSample={(id) => void ops.newSample(id)} />}
      <Toasts />
      <StatusBar />
      <DialogLayer />
      <ContextMenuLayer />
    </div>
  );
}

function uniqueObjName(p: WowProject, type: string, base: string) { let n = base, i = 1; while (p.nameInUse(n)) n = `${base}${++i}`; void type; return n; }

function TitleBar({ onSave }: { onSave: () => void }) {
  const project = useApp((s) => s.project);
  const saving = useApp((s) => s.saving);
  const savedAt = useApp((s) => s.savedAt);
  const activeTabId = useApp((s) => s.activeTabId);
  const learningMode = useApp((s) => s.learningMode);
  const cs = useCmdState();
  const band = useCtxBand((s) => s.band);
  const titleRef = React.useRef<HTMLDivElement>(null);
  const [titleLeft, setTitleLeft] = React.useState<number | null>(null);
  React.useLayoutEffect(() => { const l = titleRef.current?.getBoundingClientRect().left ?? null; if (l !== titleLeft) setTitleLeft(l); });
  const activeTitle = useApp((s) => s.tabs.find((t) => t.id === s.activeTabId)?.title ?? '');
  const can = (c: string) => { const f = (activeTabId ? cs.editors[activeTabId]?.[c] : undefined) ?? cs.global[c]; return !!f && f.enabled; };
  return (
    <div className="titlebar">
      <div className="brand"><span className="brand-mark">W</span>DBWOW</div>
      <div className="qat" aria-label="Quick Access Toolbar">
        <button title="Save (Ctrl+S)" disabled={!project} onClick={onSave}><Save size={15} /></button>
        <button title="Undo (Ctrl+Z)" disabled={!can('undo')} onClick={() => runCommand('undo', activeTabId)}><Undo2 size={15} /></button>
        <button title="Redo (Ctrl+Y)" disabled={!can('redo')} onClick={() => runCommand('redo', activeTabId)}><Redo2 size={15} /></button>
      </div>
      {band && <div className="ctx-band" style={{ left: band.left, width: band.width }} aria-hidden>{band.label}</div>}
      <div className="title-text" ref={titleRef} style={band && titleLeft !== null && band.left + band.width > window.innerWidth / 2 - 160 ? { textAlign: 'left', paddingLeft: Math.max(0, band.left + band.width + 24 - titleLeft) } : undefined}>{project ? `${activeTitle ? activeTitle + ' : ' : ''}${project.name} : Database — DBWOW` : 'DBWOW — Educational Database Environment'}</div>
      <div className="title-right">
        {project && <span title="Your changes are stored in this browser automatically"><span className={'save-dot' + (saving ? ' busy' : '')} /><span className="hide-sm">{saving ? 'Saving…' : savedAt ? `Saved ${savedAt}` : ''}</span></span>}
        <RankBadge onOpen={() => { const id = useApp.getState().openTab({ kind: 'learning', name: 'Learning Centre', title: 'Learning Centre', view: 'learn', payload: { section: 'ach:all' } }); useApp.getState().updateTab(id, { payload: { section: 'ach:all' } }); }} />
        <button className="qat" style={{ background: 'transparent', border: 0, color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }} title="Learning Mode shows contextual tips in every designer" onClick={() => useApp.getState().setLearningMode(!learningMode)}><GraduationCap size={15} /><span className="hide-sm">{learningMode ? 'Learning Mode: On' : 'Learning Mode: Off'}</span></button>
        <button style={{ background: 'transparent', border: 0, color: '#fff', cursor: 'pointer' }} title="Options" onClick={() => { useApp.getState().setRibbonTab('file'); }}><Settings size={15} /></button>
      </div>
    </div>
  );
}

const TAB_ICONS: Record<string, LucideIcon> = { table: Table, query: Network, form: FormInput, report: FileBarChart, relationships: GitFork, macro: Workflow, module: FileCode, learning: GraduationCap, tool: Wrench };

function Workspace({ closeTab, openSample }: { closeTab: (id: string) => void; openSample: (id: string) => void }) {
  const tabs = useApp((s) => s.tabs);
  const activeTabId = useApp((s) => s.activeTabId);
  const activate = useApp((s) => s.activate);
  const project = useApp((s) => s.project);
  if (!project) return <div className="workspace" />;
  return (
    <div className="workspace">
      {tabs.length > 0 && (
        <div className="doc-tabs" role="tablist">
          {tabs.map((t) => { const Ico = TAB_ICONS[t.kind]; return (
            <div key={t.id} className={'doc-tab' + (t.id === activeTabId ? ' active' : '')} onClick={() => activate(t.id)} onMouseDown={(e) => { if (e.button === 1) { e.preventDefault(); closeTab(t.id); } }} title={t.title} role="tab" data-testid={`doctab-${t.title}`}>
              <Ico size={13} /><span className="nm">{t.title || 'Untitled'}{t.dirty ? ' *' : ''}</span>
              <button className="x" onClick={(e) => { e.stopPropagation(); closeTab(t.id); }} aria-label={`Close ${t.title}`}><X size={12} /></button>
            </div>
          ); })}
        </div>
      )}
      <div className="doc-body">
        {!tabs.length && <div className="empty-ws"><div><div style={{ fontSize: 16, marginBottom: 6 }}>{project.name}</div><div>Open an object from the Navigation Pane, or use the <b>CREATE</b> tab to build a table, query, form or report.</div><div className="small mt-2">New to databases? Open <button className="link" onClick={() => runCommand('help.learning', null)}>the Learning Centre</button>.</div></div></div>}
        {tabs.map((t) => (
          <div key={t.id} className={'doc-pane' + (t.id === activeTabId ? '' : ' hidden')}>
            <Editor tab={t} active={t.id === activeTabId} openSample={openSample} />
          </div>
        ))}
      </div>
    </div>
  );
}

function Editor({ tab, active, openSample }: { tab: Tab; active: boolean; openSample: (id: string) => void }) {
  const project = useApp((s) => s.project)!;
  const updateTab = useApp((s) => s.updateTab);
  // auto-run queries opened from the Navigation Pane
  useEffect(() => {
    if (tab.kind === 'query' && tab.payload?.autorun) { updateTab(tab.id, { payload: { ...tab.payload, autorun: false } }); setTimeout(() => runCommand('view.datasheet', tab.id), 50); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  switch (tab.kind) {
    case 'table': return <TableEditor tab={tab} active={active} project={project} />;
    case 'query': return <QueryEditor tab={tab} active={active} project={project} />;
    case 'relationships': return <RelationshipsEditor tab={tab} active={active} project={project} />;
    case 'form': return <FormEditor tab={tab} active={active} project={project} />;
    case 'report': return <ReportEditor tab={tab} active={active} project={project} />;
    case 'macro': return <MacroEditor tab={tab} active={active} project={project} />;
    case 'module': return <ModuleEditor tab={tab} active={active} project={project} />;
    case 'learning': return <LearningCentre tab={tab} project={project} openSample={openSample} />;
    case 'tool': return <ToolView tab={tab} project={project} />;
  }
}

const VIEW_NAMES: Record<string, string> = { design: 'Design View', datasheet: 'Datasheet View', sql: 'SQL View', form: 'Form View', preview: 'Print Preview', learn: 'Learning Centre' };

function StatusBar() {
  const status = useApp((s) => s.status);
  const sel = useApp((s) => s.selection);
  const tabs = useApp((s) => s.tabs);
  const activeTabId = useApp((s) => s.activeTabId);
  const t = tabs.find((x) => x.id === activeTabId);
  const cs = useCmdState();
  const band = useCtxBand((s) => s.band);
  const titleRef = React.useRef<HTMLDivElement>(null);
  const [titleLeft, setTitleLeft] = React.useState<number | null>(null);
  React.useLayoutEffect(() => { const l = titleRef.current?.getBoundingClientRect().left ?? null; if (l !== titleLeft) setTitleLeft(l); });
  const activeTitle = useApp((s) => s.tabs.find((t) => t.id === s.activeTabId)?.title ?? '');
  const can = (c: string) => { const f = (activeTabId ? cs.editors[activeTabId]?.[c] : undefined); return !!f && f.enabled; };
  const views: [string, string, LucideIcon][] = [['view.datasheet', 'Datasheet View', LayoutGrid], ['view.form', 'Form View', PanelsTopLeft], ['view.preview', 'Print Preview', Printer], ['view.sql', 'SQL View', Code2], ['view.design', 'Design View', PencilRuler]];
  return (
    <div className="statusbar" role="status">
      <span className="sp">{t ? `${VIEW_NAMES[t.view] ?? ''}${t.view === 'design' ? '. F6 = Switch panes.' : ''} ` : ''}{status}</span>
      {t && t.view === 'datasheet' && sel.records !== undefined && <span>{sel.filtered ? 'Filtered · ' : ''}{sel.records} record(s)</span>}
      {views.filter(([c]) => can(c)).map(([c, label, Ico]) => <button key={c} title={label} className={cs.editors[activeTabId!]?.[c]?.checked ? 'on' : ''} onClick={() => runCommand(c, activeTabId)}><Ico size={14} /></button>)}
      <span className="hide-sm" style={{ opacity: 0.8 }}><Eye size={12} style={{ display: 'inline' }} /> {SHORTCUTS.length} shortcuts · F1 Help</span>
    </div>
  );
}
