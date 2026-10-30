'use client';
import type { LucideIcon } from 'lucide-react';
import React, { useMemo, useState } from 'react';
import { Table, Network, FormInput, FileBarChart, Workflow, FileCode, ChevronsLeft, ChevronsRight, ChevronDown, ChevronUp, Search, Play, Pencil, ListPlus, ListX, Grid3x3 } from 'lucide-react';
import type { ObjectType } from '@/engine/types';
import { useApp } from '../store';
import { confirmBox, errorBox, promptBox, showContextMenu, type MenuItem } from '../dialogs';

const GROUPS: { type: ObjectType; label: string; icon: LucideIcon }[] = [
  { type: 'table', label: 'Tables', icon: Table }, { type: 'query', label: 'Queries', icon: Network }, { type: 'form', label: 'Forms', icon: FormInput },
  { type: 'report', label: 'Reports', icon: FileBarChart }, { type: 'macro', label: 'Macros', icon: Workflow }, { type: 'module', label: 'Modules', icon: FileCode },
];
const KIND_ICON: Record<string, LucideIcon> = { select: Network, crosstab: Grid3x3, maketable: Table, append: ListPlus, update: Pencil, delete: ListX };

export function NavPane({ openObject, runObject, actions }: { openObject: (type: ObjectType, name: string, view?: string) => void; runObject: (type: ObjectType, name: string) => void; actions: { createForm: (n: string) => void; createReport: (n: string) => void; exportOf: (n: string) => void } }) {
  const project = useApp((s) => s.project);
  const version = useApp((s) => s.version);
  const collapsed = useApp((s) => s.navCollapsed);
  const toggle = useApp((s) => s.toggleNav);
  const tabs = useApp((s) => s.tabs);
  const [search, setSearch] = useState('');
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<'all' | ObjectType>('all');
  const [sortBy, setSortBy] = useState<'name' | 'modified'>('name');
  const [sel, setSel] = useState<string | null>(null);

  const groups = useMemo(() => {
    if (!project) return [];
    return GROUPS.filter((g) => filter === 'all' || filter === g.type).map((g) => {
      let items = project.listObjects(g.type);
      if (search) items = items.filter((o) => o.name.toLowerCase().includes(search.toLowerCase()));
      if (sortBy === 'modified') items = [...items].sort((a, b) => b.modified.localeCompare(a.modified));
      return { ...g, items };
    });
  }, [project, version, search, filter, sortBy]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!project) return null;
  if (collapsed) return <div className="nav collapsed"><button className="icon-btn" onClick={toggle} title="Open the Navigation Pane (F11)" style={{ margin: '6px auto' }}><ChevronsRight size={14} /></button><div className="nav-vertical" onClick={toggle}>Navigation Pane</div></div>;

  const rename = async (type: ObjectType, name: string) => {
    if (tabs.some((t) => t.kind === type && t.name === name && t.dirty)) { await errorBox(`Save or close "${name}" before renaming it.`); return; }
    const n = await promptBox('New name:', name, `Rename ${type}`, (v) => { try { project.validateObjectName(v, type, { type, name }); return null; } catch (e) { return (e as Error).message; } });
    if (!n || n === name) return;
    try {
      project.renameObject(type, name, n.trim());
      const st = useApp.getState();
      st.tabs.filter((t) => t.kind === type && t.name === name).forEach((t) => st.updateTab(t.id, { name: n.trim(), title: n.trim() }));
      st.bump();
    } catch (e) { await errorBox(e); }
  };
  const duplicate = async (type: ObjectType, name: string) => {
    const n = await promptBox(`Paste as ${type} name:`, `Copy Of ${name}`, 'Paste As', (v) => { try { project.validateObjectName(v, type); return null; } catch (e) { return (e as Error).message; } });
    if (!n) return;
    let withData = true;
    if (type === 'table') withData = await confirmBox('Copy the data as well as the structure?\n\nYes = Structure and Data, No = Structure Only', { title: 'Paste Table As', ok: 'Structure and Data', cancel: 'Structure Only' });
    try { project.duplicateObject(type, name, n.trim(), withData); } catch (e) { await errorBox(e); }
  };
  const remove = async (type: ObjectType, name: string) => {
    const ok = await confirmBox(type === 'table' ? `Do you want to delete the table "${name}"?\n\nDeleting this object will remove it and all its records from the database. This cannot be undone.` : `Do you want to delete the ${type} "${name}"?`, { danger: true, title: 'Delete' });
    if (!ok) return;
    try {
      project.deleteObject(type, name);
      const st = useApp.getState();
      st.tabs.filter((t) => t.kind === type && t.name === name).forEach((t) => st.closeTab(t.id));
    } catch (e) { await errorBox(e); }
  };

  const menu = (e: React.MouseEvent, type: ObjectType, name: string) => {
    setSel(type + ':' + name);
    const items: MenuItem[] = [];
    if (type === 'table') items.push({ label: 'Open', onClick: () => openObject(type, name, 'datasheet') }, { label: 'Design View', onClick: () => openObject(type, name, 'design') });
    if (type === 'query') {
      const q = project.getQuery(name);
      if (q && q.kind !== 'select' && q.kind !== 'crosstab') items.push({ label: 'Run (action query)', onClick: () => runObject(type, name) });
      else items.push({ label: 'Open', onClick: () => openObject(type, name, 'datasheet') });
      items.push({ label: 'Design View', onClick: () => openObject(type, name, q?.design && !q.sqlOnly ? 'design' : 'sql') }, { label: 'SQL View', onClick: () => openObject(type, name, 'sql') });
    }
    if (type === 'form') items.push({ label: 'Open', onClick: () => openObject(type, name, 'form') }, { label: 'Design View', onClick: () => openObject(type, name, 'design') });
    if (type === 'report') items.push({ label: 'Print Preview', onClick: () => openObject(type, name, 'preview') }, { label: 'Design View', onClick: () => openObject(type, name, 'design') });
    if (type === 'macro') items.push({ label: 'Run', onClick: () => runObject(type, name) }, { label: 'Design View', onClick: () => openObject(type, name, 'design') });
    if (type === 'module') items.push({ label: 'Open', onClick: () => openObject(type, name, 'design') });
    items.push({ separator: true });
    if (type === 'table' || type === 'query') {
      items.push({ label: 'Create Form from this', onClick: () => actions.createForm(name) });
      items.push({ label: 'Create Report from this', onClick: () => actions.createReport(name) });
      items.push({ label: 'Export…', onClick: () => actions.exportOf(name) });
      items.push({ separator: true });
    }
    items.push({ label: 'Rename', onClick: () => void rename(type, name) }, { label: 'Copy (duplicate)…', onClick: () => void duplicate(type, name) }, { label: 'Delete', onClick: () => void remove(type, name) });
    showContextMenu(e, items);
  };

  const defaultOpen = (type: ObjectType, name: string) => {
    if (type === 'table') openObject(type, name, 'datasheet');
    else if (type === 'query') { const q = project.getQuery(name); if (q && q.kind !== 'select' && q.kind !== 'crosstab') runObject(type, name); else openObject(type, name, 'datasheet'); }
    else if (type === 'form') openObject(type, name, 'form');
    else if (type === 'report') openObject(type, name, 'preview');
    else if (type === 'macro') runObject(type, name);
    else openObject(type, name, 'design');
  };

  return (
    <div className="nav" aria-label="Navigation Pane" data-testid="nav-pane" tabIndex={-1}>
      <div className="nav-head">
        <select className="nav-title" style={{ border: 0, background: 'transparent', cursor: 'pointer', appearance: 'none' }} value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} aria-label="Navigation category">
          <option value="all">All WOWDB Objects</option>
          {GROUPS.map((g) => <option key={g.type} value={g.type}>{g.label}</option>)}
        </select>
        <button className="icon-btn" title={`Sort by ${sortBy === 'name' ? 'date modified' : 'name'}`} onClick={() => setSortBy(sortBy === 'name' ? 'modified' : 'name')}><ChevronDown size={14} /></button>
        <button className="icon-btn" title="Shutter Bar Open/Close (F11)" onClick={toggle}><ChevronsLeft size={14} /></button>
      </div>
      <div className="nav-search"><input placeholder="Search..." value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search objects" /><Search size={14} style={{ margin: 4, color: '#777' }} /></div>
      <div className="nav-scroll">
        {groups.map((g) => {
          const Ico = g.icon;
          const isClosed = closed.has(g.type);
          if (search && !g.items.length) return null;
          return (
            <div key={g.type}>
              <div className="nav-group" onClick={() => { const n = new Set(closed); if (n.has(g.type)) n.delete(g.type); else n.add(g.type); setClosed(n); }}>
                <span>{g.label} <span className="muted small" style={{ fontWeight: 400 }}>({g.items.length})</span></span>{isClosed ? <ChevronDown size={13} /> : <ChevronUp size={13} />}
              </div>
              {!isClosed && g.items.map((o) => {
                const k = g.type + ':' + o.name;
                const q = g.type === 'query' ? project.getQuery(o.name) : undefined;
                const QI = q ? KIND_ICON[q.kind] ?? Network : Ico;
                return (
                  <div key={o.name} className={'nav-item' + (sel === k ? ' is-sel' : '')} title={`${o.name}${q ? ` (${q.kind} query)` : ''} — modified ${new Date(o.modified).toLocaleString()}`}
                    draggable onDragStart={(e) => { e.dataTransfer.setData('application/x-wowdb-object', JSON.stringify({ type: g.type, name: o.name })); e.dataTransfer.setData('text/plain', o.name); e.dataTransfer.effectAllowed = 'copy'; }}
                    onClick={() => setSel(k)} onDoubleClick={() => defaultOpen(g.type, o.name)} onContextMenu={(e) => menu(e, g.type, o.name)}
                    onKeyDown={(e) => { if (e.key === 'Enter') defaultOpen(g.type, o.name); if (e.key === 'Delete') void remove(g.type, o.name); if (e.key === 'F2') void rename(g.type, o.name); }} tabIndex={0} data-testid={`nav-${g.type}-${o.name}`}>
                    <QI size={14} color={g.type === 'table' ? '#1f5fae' : g.type === 'query' ? '#6a3d9a' : g.type === 'form' ? '#b5651d' : g.type === 'report' ? '#2e7d32' : '#555'} />{o.name}
                    {q && q.kind !== 'select' && q.kind !== 'crosstab' && <Play size={10} color="#999" />}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
