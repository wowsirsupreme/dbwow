'use client';
import React, { useCallback, useEffect, useState } from 'react';
import type { WowProject } from '@/engine/project';
import type { FormDef, ReportDef } from '@/engine/types';
import { newFormDef, newReportDef } from '@/engine/objects';
import { DesignCanvas } from '../designers/DesignCanvas';
import { FormRunner } from '../FormRunner';
import { ReportPreview } from '../ReportPreview';
import { useApp, type Tab } from '../store';
import { useEditorCommands } from '../commands';
import { confirmBox, errorBox, promptBox } from '../dialogs';
import { useHistory } from '../useHistory';
import { LearnTip } from '../shell/LearnTip';
import { DataGrid } from '../DataGrid';

function useObjectEditor<T extends FormDef | ReportDef>(tab: Tab, p: WowProject, kind: 'form' | 'report') {
  const updateTab = useApp((s) => s.updateTab);
  const load = (): T => {
    const existing = tab.name ? (kind === 'form' ? p.getForm(tab.name) : p.getReport(tab.name)) : undefined;
    if (existing) return existing as T;
    if (tab.payload?.def) return tab.payload.def as T;
    return (kind === 'form' ? newFormDef('', String(tab.payload?.recordSource ?? '')) : newReportDef('', String(tab.payload?.recordSource ?? ''))) as T;
  };
  const hist = useHistory<T>(load());
  const [savedJson, setSavedJson] = useState(() => (tab.name ? JSON.stringify(load()) : ''));
  const dirty = JSON.stringify(hist.value) !== savedJson;
  useEffect(() => { if (!!tab.dirty !== dirty) updateTab(tab.id, { dirty }); }, [dirty]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = useCallback(async (): Promise<boolean> => {
    let name = tab.name;
    const label = kind === 'form' ? 'Form' : 'Report';
    if (!name) {
      const suggested = hist.value.name || `${label}${p.listObjects(kind).length + 1}`;
      const n = await promptBox(`${label} Name:`, suggested, 'Save As', (v) => { try { p.validateObjectName(v, kind); return null; } catch (e) { return (e as Error).message; } });
      if (!n) return false;
      name = n.trim();
    }
    const def = { ...hist.value, name, caption: hist.value.caption || name } as T;
    try {
      if (kind === 'form') p.saveForm(def as FormDef, tab.name || undefined); else p.saveReport(def as ReportDef, tab.name || undefined);
      hist.reset(def); setSavedJson(JSON.stringify(def));
      updateTab(tab.id, { name, title: name, dirty: false, isNew: false });
      useApp.getState().setStatus(`${label} "${name}" saved.`);
      return true;
    } catch (e) { await errorBox(e, `The ${kind} was not saved`); return false; }
  }, [tab, p, kind, hist, updateTab]);

  return { hist, save, dirty };
}

export function FormEditor({ tab, active, project: p }: { tab: Tab; active: boolean; project: WowProject }) {
  const { hist, save, dirty } = useObjectEditor<FormDef>(tab, p, 'form');
  const updateTab = useApp((s) => s.updateTab);
  const def = hist.value;
  const view = tab.view;
  const switchView = async (v: string) => {
    if (v === view) return;
    if (v !== 'design' && dirty) {
      const ok = await confirmBox('Save changes to the form design before switching view?', { title: 'DBWOW' });
      if (ok && !(await save())) return;
      if (!ok && !tab.name) return;
    }
    updateTab(tab.id, { view: v });
  };
  useEditorCommands(tab.id, active, {
    'view.design': { run: () => void switchView('design'), checked: view === 'design' },
    'view.form': { run: () => void switchView('form'), checked: view === 'form' },
    'view.datasheet': { run: () => void switchView('datasheet'), checked: view === 'datasheet', enabled: !!p.getTable(def.recordSource) || !!p.getQuery(def.recordSource) },
    'view.toggle': () => void switchView(view === 'design' ? 'form' : 'design'),
    save: () => save(),
  });
  const close = () => useApp.getState().closeTab(tab.id);
  const liveDef = tab.name ? (p.getForm(tab.name) ?? def) : def;
  return (
    <>
      <LearnTip k={view === 'design' ? 'form-design' : 'form-view'} />
      {view === 'design' && <DesignCanvas tabId={tab.id} active={active} project={p} mode="form" def={def} setDef={(d, commit) => (commit ? hist.commit(d) : hist.set(d, { merge: true }))} undo={hist.undo} redo={hist.redo} canUndo={hist.canUndo} canRedo={hist.canRedo} save={() => void save()} />}
      {view === 'form' && <FormRunner tabId={tab.id} active={active} project={p} def={dirty ? def : liveDef} onClose={close} />}
      {view === 'datasheet' && (p.getTable(def.recordSource) ? <DataGrid tabId={tab.id} active={active} project={p} table={p.getTable(def.recordSource)!.name} allowAdd={def.allowAdditions} allowEdit={def.allowEdits} allowDelete={def.allowDeletions} />
        : <FormRunner tabId={tab.id} active={active} project={p} def={{ ...def, defaultView: 'Continuous Forms' }} onClose={close} />)}
    </>
  );
}

export function ReportEditor({ tab, active, project: p }: { tab: Tab; active: boolean; project: WowProject }) {
  const { hist, save, dirty } = useObjectEditor<ReportDef>(tab, p, 'report');
  const updateTab = useApp((s) => s.updateTab);
  const def = hist.value;
  const view = tab.view;
  const switchView = (v: string) => { if (v !== view) updateTab(tab.id, { view: v }); };
  useEditorCommands(tab.id, active, {
    'view.design': { run: () => switchView('design'), checked: view === 'design' },
    'view.preview': { run: () => switchView('preview'), checked: view === 'preview' },
    'view.toggle': () => switchView(view === 'design' ? 'preview' : 'design'),
    save: () => save(),
    ...(view === 'preview' ? {
      'rd.size.A4': { run: () => hist.commit({ ...def, page: { ...def.page, size: 'A4' } }), checked: def.page.size === 'A4' },
      'rd.size.Letter': { run: () => hist.commit({ ...def, page: { ...def.page, size: 'Letter' } }), checked: def.page.size === 'Letter' },
      'rd.orient.Portrait': { run: () => hist.commit({ ...def, page: { ...def.page, orientation: 'Portrait' } }), checked: def.page.orientation === 'Portrait' },
      'rd.orient.Landscape': { run: () => hist.commit({ ...def, page: { ...def.page, orientation: 'Landscape' } }), checked: def.page.orientation === 'Landscape' },
    } : {}),
  });
  void dirty;
  return (
    <>
      <LearnTip k={view === 'design' ? 'report-design' : 'report-preview'} />
      {view === 'design' && <DesignCanvas tabId={tab.id} active={active} project={p} mode="report" def={def} setDef={(d, commit) => (commit ? hist.commit(d) : hist.set(d, { merge: true }))} undo={hist.undo} redo={hist.redo} canUndo={hist.canUndo} canRedo={hist.canRedo} save={() => void save()} />}
      {view === 'preview' && <ReportPreview project={p} def={def} tabId={tab.id} active={active} onClose={() => switchView('design')} />}
    </>
  );
}
