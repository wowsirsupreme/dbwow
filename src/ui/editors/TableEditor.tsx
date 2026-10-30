'use client';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { WowProject } from '@/engine/project';
import { uid } from '@/engine/project';
import type { DataType, TableDef } from '@/engine/types';
import { DataGrid } from '../DataGrid';
import { TableDesigner, uniqueFieldName } from '../designers/TableDesigner';
import { useApp, type Tab } from '../store';
import { useEditorCommands } from '../commands';
import { confirmBox, errorBox, promptBox, yesNoCancel } from '../dialogs';
import { useHistory } from '../useHistory';
import { LearnTip } from '../shell/LearnTip';

export function TableEditor({ tab, active, project: p }: { tab: Tab; active: boolean; project: WowProject }) {
  const updateTab = useApp((s) => s.updateTab);
  const version = useApp((s) => s.version);
  const initial = (): TableDef => p.getTable(tab.name) ?? { name: '', fields: tab.payload?.quick ? [{ id: uid('f'), name: 'ID', type: 'AutoNumber', primaryKey: true }] : [] };
  const hist = useHistory<TableDef>(initial());
  const def = hist.value;
  const [savedJson, setSavedJson] = useState(JSON.stringify(initial()));
  const dirty = JSON.stringify(def) !== savedJson;
  const [selCol, setSelCol] = useState<string | null>(null);
  const isNew = !tab.name;

  useEffect(() => { if (!!tab.dirty !== dirty) updateTab(tab.id, { dirty }); }, [dirty]); // eslint-disable-line react-hooks/exhaustive-deps
  // pick up external changes (e.g. rename) when not dirty
  useEffect(() => {
    if (dirty || !tab.name) return;
    const t = p.getTable(tab.name);
    if (t && JSON.stringify(t) !== savedJson) { hist.reset(t); setSavedJson(JSON.stringify(t)); }
  }, [version, tab.name]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = useCallback(async (): Promise<boolean> => {
    let name = def.name || tab.name;
    if (!name) {
      const n = await promptBox('Table Name:', p.tableNames().includes('Table1') ? `Table${p.tableNames().length + 1}` : 'Table1', 'Save As', (v) => { try { p.validateObjectName(v, 'table'); return null; } catch (e) { return (e as Error).message; } });
      if (!n) return false;
      name = n.trim();
    }
    let d: TableDef = { ...def, name, fields: def.fields.filter((f) => f.name.trim()) };
    if (!d.fields.some((f) => f.primaryKey)) {
      const r = await yesNoCancel('There is no primary key defined.\n\nAlthough a primary key isn\'t required, it\'s highly recommended. A table must have a primary key for you to define a relationship between this table and other tables in the database.\n\nDo you want to create a primary key now?', 'WOWDB');
      if (r === 'cancel') return false;
      if (r === 'yes') {
        const auto = d.fields.find((f) => f.type === 'AutoNumber');
        if (auto) d = { ...d, fields: d.fields.map((f) => (f === auto ? { ...f, primaryKey: true } : f)) };
        else d = { ...d, fields: [{ id: uid('f'), name: uniqueFieldName(d, 'ID'), type: 'AutoNumber', primaryKey: true }, ...d.fields] };
      }
    }
    if (!isNew) {
      const old = p.getTable(tab.name)!;
      const lost = old.fields.filter((o) => !d.fields.some((n) => n.id === o.id));
      const changed = old.fields.filter((o) => { const n = d.fields.find((x) => x.id === o.id); return n && n.type !== o.type; });
      const n = Number(p.db.scalar(`SELECT count(*) FROM "${tab.name.replace(/"/g, '""')}"`));
      if (n > 0 && (lost.length || changed.length)) {
        const ok = await confirmBox(`${lost.length ? `Deleted field(s): ${lost.map((f) => f.name).join(', ')} — their data will be lost.\n` : ''}${changed.length ? `Changed data type: ${changed.map((f) => f.name).join(', ')} — values that cannot be converted will stop the save.\n` : ''}\nThe table has ${n} record(s). Do you want to continue?`, { title: 'Save Table Design', danger: lost.length > 0 });
        if (!ok) return false;
      }
    }
    try {
      p.saveTableDesign(d, isNew ? undefined : tab.name);
      const saved = p.getTable(d.name)!;
      hist.reset(saved);
      setSavedJson(JSON.stringify(saved));
      updateTab(tab.id, { name: saved.name, title: saved.name, dirty: false, isNew: false });
      useApp.getState().setStatus(`Table "${saved.name}" saved.`);
      return true;
    } catch (e) {
      await errorBox(e, 'WOWDB - the table was not saved');
      return false;
    }
  }, [def, tab, p, isNew, hist, updateTab]);

  const switchView = useCallback(async (view: string) => {
    if (view === tab.view) return;
    if (view === 'datasheet' && (dirty || isNew)) {
      const ok = await confirmBox('You must first save the table.\n\nDo you want to save the table now?', { title: 'WOWDB' });
      if (!ok || !(await save())) return;
    }
    updateTab(tab.id, { view });
  }, [tab, dirty, isNew, save, updateTab]);

  // datasheet field operations (real schema changes)
  const addField = async (type: DataType) => {
    const name = await promptBox('Field name:', uniqueFieldName(def, type === 'Yes/No' ? 'Flag' : type.replace(/[^A-Za-z]/g, '') || 'Field'), 'Add Field');
    if (!name) return;
    const nd: TableDef = { ...def, fields: [...def.fields, { id: uid('f'), name: name.trim(), type, fieldSize: type === 'Short Text' ? 255 : undefined, numberSize: type === 'Number' ? 'Long Integer' : undefined, format: type === 'Currency' ? 'Currency' : type === 'Date/Time' ? 'Short Date' : undefined }] };
    try { p.saveTableDesign(nd, tab.name); const s = p.getTable(nd.name)!; hist.reset(s); setSavedJson(JSON.stringify(s)); } catch (e) { void errorBox(e); }
  };
  const deleteField = async () => {
    const col = selCol; if (!col) return;
    const f = def.fields.find((x) => x.name === col); if (!f) return;
    const ok = await confirmBox(`Do you want to permanently delete the field "${col}" and all the data in it?`, { danger: true, title: 'Delete Field' });
    if (!ok) return;
    const nd = { ...def, fields: def.fields.filter((x) => x !== f) };
    try { p.saveTableDesign(nd, tab.name); const s = p.getTable(nd.name)!; hist.reset(s); setSavedJson(JSON.stringify(s)); } catch (e) { void errorBox(e); }
  };
  const renameField = async () => {
    const col = selCol; if (!col) return;
    const n = await promptBox('Name:', col, 'Rename Field');
    if (!n || n === col) return;
    const nd = { ...def, fields: def.fields.map((x) => (x.name === col ? { ...x, name: n.trim() } : x)) };
    try { p.saveTableDesign(nd, tab.name); const s = p.getTable(nd.name)!; hist.reset(s); setSavedJson(JSON.stringify(s)); } catch (e) { void errorBox(e); }
  };

  const ds = tab.view === 'datasheet';
  useEditorCommands(tab.id, active, {
    'view.design': { run: () => void switchView('design'), checked: !ds },
    'view.datasheet': { run: () => void switchView('datasheet'), checked: ds },
    'view.toggle': () => void switchView(ds ? 'design' : 'datasheet'),
    save: () => (ds ? true : save()),
    undo: { run: hist.undo, enabled: !ds && hist.canUndo },
    redo: { run: hist.redo, enabled: !ds && hist.canRedo },
    ...(ds ? {
      'ds.addText': () => void addField('Short Text'), 'ds.addNumber': () => void addField('Number'), 'ds.addCurrency': () => void addField('Currency'),
      'ds.addDate': () => void addField('Date/Time'), 'ds.addYesNo': () => void addField('Yes/No'), 'ds.addLongText': () => void addField('Long Text'),
      'ds.deleteField': { run: () => void deleteField(), enabled: !!selCol }, 'ds.renameField': { run: () => void renameField(), enabled: !!selCol },
    } : {}),
  });

  const saveLayout = useRef<ReturnType<typeof setTimeout> | null>(null);
  return (
    <>
      <LearnTip k={ds ? 'table-datasheet' : 'table-design'} />
      {ds && tab.name ? (
        <DataGrid tabId={tab.id} active={active} project={p} table={tab.name} layout={def.datasheet}
          onLayout={(l) => { if (saveLayout.current) clearTimeout(saveLayout.current); saveLayout.current = setTimeout(() => p.saveTableLayout(tab.name, l), 300); }}
          onSelectColumn={setSelCol} />
      ) : (
        <TableDesigner tabId={tab.id} active={active} project={p} def={def} setDef={(d) => hist.set(d)} undo={hist.undo} redo={hist.redo} canUndo={hist.canUndo} canRedo={hist.canRedo} save={save} isNew={isNew} />
      )}
    </>
  );
}
