'use client';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { WowProject } from '@/engine/project';
import { uid } from '@/engine/project';
import type { FieldDef, RelationshipDef } from '@/engine/types';
import { TableCanvas, type BoxDef } from '../designers/TableCanvas';
import { useApp, type Tab } from '../store';
import { useEditorCommands } from '../commands';
import { confirmBox, errorBox, messageBox, openDialog, showContextMenu } from '../dialogs';
import { LearnTip } from '../shell/LearnTip';

interface Layout { tables: { name: string; x: number; y: number }[]; zoom: number; }

export function RelationshipsEditor({ tab, active, project: p }: { tab: Tab; active: boolean; project: WowProject }) {
  const version = useApp((s) => s.version);
  const [layout, setLayout] = useState<Layout>(() => initialLayout(p));
  const [selLink, setSelLink] = useState<string | null>(null);
  const [selBox, setSelBox] = useState<string | null>(null);
  const rels = useMemo(() => p.relationships(), [p, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const tableNames = useMemo(() => p.tableNames(), [p, version]); // eslint-disable-line react-hooks/exhaustive-deps

  // drop tables that no longer exist (renamed/deleted)
  useEffect(() => {
    setLayout((l) => ({ ...l, tables: l.tables.filter((t) => tableNames.some((n) => n.toLowerCase() === t.name.toLowerCase())).map((t) => ({ ...t, name: tableNames.find((n) => n.toLowerCase() === t.name.toLowerCase())! })) }));
  }, [tableNames]);

  const persist = useCallback((l: Layout) => { p.saveLayout('Relationships', l); }, [p]);
  const update = (l: Layout, save = true) => { setLayout(l); if (save) persist(l); };

  const boxes: BoxDef[] = layout.tables.map((t) => ({ id: t.name, name: t.name, x: t.x, y: t.y }));
  const links = rels.filter((r) => layout.tables.some((t) => t.name === r.primaryTable) && layout.tables.some((t) => t.name === r.relatedTable)).flatMap((r) => {
    const type = p.relationshipType(r);
    return r.fields.map((f, i) => ({
      id: r.name + (i ? '#' + i : ''), from: { box: r.primaryTable, field: f.primary }, to: { box: r.relatedTable, field: f.related },
      fromLabel: r.enforce ? '1' : undefined, toLabel: r.enforce ? (type === 'One-To-One' ? '1' : '∞') : undefined, dashed: !r.enforce,
    }));
  });

  const addTables = (names: string[], at?: { x: number; y: number }) => {
    const existing = new Set(layout.tables.map((t) => t.name.toLowerCase()));
    const add = names.filter((n) => !existing.has(n.toLowerCase()));
    if (!add.length) return;
    let x = at?.x ?? 30 + (layout.tables.length % 5) * 230, y = at?.y ?? 30 + Math.floor(layout.tables.length / 5) * 240;
    const tables = [...layout.tables];
    for (const n of add) { tables.push({ name: n, x, y }); x += 230; if (x > 1100) { x = 30; y += 240; } }
    update({ ...layout, tables });
  };

  const fieldsOf = (b: BoxDef) => (p.getTable(b.name)?.fields ?? []).map((f) => ({ name: f.name, pk: !!f.primaryKey, type: f.type }));

  const editRelationship = async (init: Partial<RelationshipDef> & { primaryTable: string; relatedTable: string; fields: { primary: string; related: string }[] }, existing?: RelationshipDef) => {
    await openDialog('Edit Relationships', (close) => <EditRelDialog p={p} init={init} existing={existing} close={close} />, 560);
  };

  const onFieldLink = (from: { box: BoxDef; field: string }, to: { box: BoxDef; field: string }) => {
    let a = from, b = to;
    const ua = p.isUnique(a.box.name, [a.field]), ub = p.isUnique(b.box.name, [b.field]);
    if (!ua && ub) { a = to; b = from; }
    const ex = rels.find((r) => r.primaryTable === a.box.name && r.relatedTable === b.box.name && r.fields.length === 1 && r.fields[0].primary.toLowerCase() === a.field.toLowerCase() && r.fields[0].related.toLowerCase() === b.field.toLowerCase());
    void editRelationship(ex ?? { primaryTable: a.box.name, relatedTable: b.box.name, fields: [{ primary: a.field, related: b.field }], enforce: true }, ex);
  };

  const relOfLink = (id: string | null) => (id ? rels.find((r) => r.name === id.split('#')[0]) : undefined);
  const deleteSelected = async () => {
    const r = relOfLink(selLink);
    if (r) {
      const ok = await confirmBox(`Are you sure you want to permanently delete the selected relationship (${r.primaryTable} → ${r.relatedTable})${r.enforce ? '?\n\nThe FOREIGN KEY constraint will be removed from the database' : ''}?`, { danger: true, title: 'Delete Relationship' });
      if (!ok) return;
      try { p.deleteRelationship(r.name); setSelLink(null); } catch (e) { void errorBox(e); }
    } else if (selBox) {
      update({ ...layout, tables: layout.tables.filter((t) => t.name !== selBox) }); setSelBox(null);
    }
  };

  const showTable = async () => {
    const res = await openDialog<string[]>('Show Table', (close) => <ShowTableDialog names={tableNames.filter((n) => !layout.tables.some((t) => t.name === n))} close={close} />, 340);
    if (res) addTables(res);
  };
  const junction = async () => {
    const res = await openDialog<string>('Create Junction Table', (close) => <JunctionDialog p={p} close={close} />, 460);
    if (res) { addTables([res]); useApp.getState().setStatus(`Junction table "${res}" created with two enforced one-to-many relationships.`); }
  };
  const report = () => {
    useApp.getState().openTab({ kind: 'tool', name: 'Relationships Report', title: 'Relationships Report', view: 'relreport' });
  };

  useEditorCommands(tab.id, active, {
    'rel.showTable': () => void showTable(),
    'rel.clear': { run: async () => { if (await confirmBox('Are you sure you want to clear the layout?\n\nThis only removes the tables from this window. Relationships are not deleted.')) update({ ...layout, tables: [] }); }, enabled: layout.tables.length > 0 },
    'rel.all': () => addTables([...new Set(rels.flatMap((r) => [r.primaryTable, r.relatedTable]))]),
    'rel.direct': { run: () => { if (!selBox) return; addTables([...new Set(rels.filter((r) => r.primaryTable === selBox || r.relatedTable === selBox).flatMap((r) => [r.primaryTable, r.relatedTable]))]); }, enabled: !!selBox },
    'rel.hideTable': { run: () => { if (selBox) update({ ...layout, tables: layout.tables.filter((t) => t.name !== selBox) }); }, enabled: !!selBox },
    'rel.edit': { run: () => { const r = relOfLink(selLink); if (r) void editRelationship(r, r); else void editRelationship({ primaryTable: tableNames[0] ?? '', relatedTable: tableNames[1] ?? tableNames[0] ?? '', fields: [{ primary: '', related: '' }], enforce: true }); }, enabled: tableNames.length > 0 },
    'rel.junction': { run: () => void junction(), enabled: tableNames.length >= 2 },
    'rel.report': report,
    'rel.zoomIn': () => update({ ...layout, zoom: Math.min(2, +(layout.zoom + 0.1).toFixed(2)) }),
    'rel.zoomOut': () => update({ ...layout, zoom: Math.max(0.4, +(layout.zoom - 0.1).toFixed(2)) }),
    'rel.save': () => { persist(layout); useApp.getState().setStatus('Relationship layout saved.'); },
    'home.deleteRecord': { run: () => void deleteSelected(), enabled: !!selLink || !!selBox, label: 'Delete' },
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }} tabIndex={0} onKeyDown={(e) => { if (e.key === 'Delete') void deleteSelected(); }}>
      <LearnTip k="relationships" />
      <TableCanvas testId="relationships-canvas" boxes={boxes} fieldsOf={fieldsOf} links={links} zoom={layout.zoom} setZoom={(z) => update({ ...layout, zoom: z })}
        selectedBox={selBox} selectedLink={selLink} onSelectBox={setSelBox} onSelectLink={setSelLink}
        onMove={(id, x, y, done) => { const l = { ...layout, tables: layout.tables.map((t) => (t.name === id ? { ...t, x, y } : t)) }; update(l, done); }}
        onRemoveBox={(id) => update({ ...layout, tables: layout.tables.filter((t) => t.name !== id) })}
        onFieldLink={onFieldLink}
        validLinkTarget={(a, b) => { if (a.box.id === b.box.id) return false; const fa = p.getTable(a.box.name)?.fields.find((f) => f.name === a.field); const fb = p.getTable(b.box.name)?.fields.find((f) => f.name === b.field); return !!fa && !!fb && sameClass(fa, fb); }}
        onLinkDblClick={(id) => { const r = relOfLink(id); if (r) void editRelationship(r, r); }}
        onLinkContext={(id, e) => { const r = relOfLink(id); if (!r) return; showContextMenu(e, [{ label: 'Edit Relationship…', onClick: () => void editRelationship(r, r) }, { label: 'Delete', onClick: () => void deleteSelected() }]); }}
        onBoxContext={(id, e) => showContextMenu(e, [{ label: 'Hide Table', onClick: () => update({ ...layout, tables: layout.tables.filter((t) => t.name !== id) }) }, { label: 'Show Direct Relationships', onClick: () => addTables([...new Set(rels.filter((r) => r.primaryTable === id || r.relatedTable === id).flatMap((r) => [r.primaryTable, r.relatedTable]))]) }, { label: 'Open in Design View', onClick: () => useApp.getState().openTab({ kind: 'table', name: id, title: id, view: 'design' }) }])}
        onDropObject={(name, x, y) => { if (p.getTable(name)) addTables([name], { x, y }); else void messageBox('Only tables can be added to the Relationships window.'); }}
        emptyText="Drag tables here from the Navigation Pane, or click Show Table on the ribbon. Then drag a primary key field onto the matching field in another table to create a relationship." />
      <div className="banner info" style={{ borderTop: '1px solid #c5d9f1', borderBottom: 0 }}>
        {rels.length} relationship(s). Solid lines with 1 / ∞ are enforced by the database engine; dashed lines are not enforced. Double-click a line to edit it, select it and press Delete to remove it.
      </div>
    </div>
  );
}

function initialLayout(p: WowProject): Layout {
  const saved = p.getLayout<Layout>('Relationships');
  if (saved) return { zoom: saved.zoom ?? 1, tables: saved.tables.filter((t) => p.getTable(t.name)) };
  const names = [...new Set(p.relationships().flatMap((r) => [r.primaryTable, r.relatedTable]))];
  return { zoom: 1, tables: names.map((n, i) => ({ name: n, x: 30 + (i % 4) * 240, y: 30 + Math.floor(i / 4) * 250 })) };
}

function sameClass(a: FieldDef, b: FieldDef) {
  const c = (f: FieldDef) => (f.type === 'AutoNumber' || f.type === 'Large Number' || (f.type === 'Number' && !['Single', 'Double', 'Decimal'].includes(f.numberSize ?? 'Long Integer')) ? 'int' : f.type === 'Number' ? 'real' : ['Short Text', 'Long Text', 'Hyperlink'].includes(f.type) ? 'text' : f.type);
  return c(a) === c(b);
}

function EditRelDialog({ p, init, existing: existingProp, close }: { p: WowProject; init: Partial<RelationshipDef> & { primaryTable: string; relatedTable: string; fields: { primary: string; related: string }[] }; existing?: RelationshipDef; close: (v: unknown) => void }) {
  const [existing, setExisting] = useState(existingProp);
  const [pt, setPt] = useState(init.primaryTable);
  const [rt, setRt] = useState(init.relatedTable);
  const [pairs, setPairs] = useState(init.fields.length ? init.fields : [{ primary: '', related: '' }]);
  const [enforce, setEnforce] = useState(init.enforce ?? true);
  const [cu, setCu] = useState(init.cascadeUpdate ?? false);
  const [cd, setCd] = useState(init.cascadeDelete ?? false);
  const [join, setJoin] = useState<RelationshipDef['joinType']>(init.joinType ?? 'inner');
  const [err, setErr] = useState<string | null>(null);
  const tables = p.tableNames();
  const pf = p.getTable(pt)?.fields ?? [], rf = p.getTable(rt)?.fields ?? [];
  const valid = pairs.filter((x) => x.primary && x.related);
  const relType = valid.length ? p.relationshipType({ primaryTable: pt, relatedTable: rt, fields: valid }) : 'Indeterminate';
  const create = () => {
    setErr(null);
    try {
      p.saveRelationship({ id: existing?.id, name: existing?.name, primaryTable: pt, relatedTable: rt, fields: valid, enforce, cascadeUpdate: cu, cascadeDelete: cd, joinType: join });
      close(true);
    } catch (e) { setErr((e as Error).message); }
  };
  const joinDialog = async () => {
    const v = await openDialog<RelationshipDef['joinType']>('Join Properties', (c) => <JoinTypeBody left={pt} right={rt} lf={valid[0]?.primary ?? ''} rf={valid[0]?.related ?? ''} value={join} close={c} />, 520);
    if (v) setJoin(v);
  };
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 110px', gap: 8 }}>
        <div>
          <div className="small mb-1">Table/Query:</div>
          <select className="sel w-full" value={pt} disabled={!!existing} onChange={(e) => { setPt(e.target.value); setPairs([{ primary: '', related: '' }]); }}>{tables.map((t) => <option key={t}>{t}</option>)}</select>
        </div>
        <div>
          <div className="small mb-1">Related Table/Query:</div>
          <select className="sel w-full" value={rt} disabled={!!existing} onChange={(e) => { setRt(e.target.value); setPairs([{ primary: '', related: '' }]); }}>{tables.map((t) => <option key={t}>{t}</option>)}</select>
        </div>
        <div style={{ gridRow: 'span 3', display: 'flex', flexDirection: 'column', gap: 6, paddingTop: 18 }}>
          <button className="btn btn-primary" onClick={create} disabled={!valid.length}>{existing ? 'OK' : 'Create'}</button>
          <button className="btn" onClick={() => close(null)}>Cancel</button>
          <button className="btn" onClick={() => void joinDialog()} disabled={!valid.length}>Join Type…</button>
          <button className="btn" title="Start a new relationship between any two tables" onClick={() => { setExisting(undefined); setPairs([{ primary: '', related: '' }]); setEnforce(true); setCu(false); setCd(false); setJoin('inner'); setErr(null); }}>Create New…</button>
        </div>
        <div style={{ gridColumn: 'span 2' }} className="scroll-box">
          <table className="mini-grid" style={{ width: '100%' }}>
            <tbody>
              {[...pairs, { primary: '', related: '' }].map((x, i) => (
                <tr key={i}>
                  <td style={{ padding: 0 }}><select className="sel w-full" style={{ border: 0 }} value={x.primary} onChange={(e) => { const n = [...pairs]; n[i] = { ...(n[i] ?? { related: '' }), primary: e.target.value }; setPairs(n.filter((y) => y.primary || y.related)); }}><option value="" />{pf.map((f) => <option key={f.id}>{f.name}</option>)}</select></td>
                  <td style={{ padding: 0 }}><select className="sel w-full" style={{ border: 0 }} value={x.related} onChange={(e) => { const n = [...pairs]; n[i] = { ...(n[i] ?? { primary: '' }), related: e.target.value }; setPairs(n.filter((y) => y.primary || y.related)); }}><option value="" />{rf.map((f) => <option key={f.id}>{f.name}</option>)}</select></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ gridColumn: 'span 2', border: '1px solid var(--line-soft)', padding: 8 }}>
          <label className="flex items-center gap-2 mb-1"><input type="checkbox" className="chk" checked={enforce} onChange={(e) => setEnforce(e.target.checked)} /> Enforce Referential Integrity</label>
          <label className="flex items-center gap-2 mb-1" style={{ opacity: enforce ? 1 : 0.5 }}><input type="checkbox" className="chk" disabled={!enforce} checked={enforce && cu} onChange={(e) => setCu(e.target.checked)} /> Cascade Update Related Fields</label>
          <label className="flex items-center gap-2" style={{ opacity: enforce ? 1 : 0.5 }}><input type="checkbox" className="chk" disabled={!enforce} checked={enforce && cd} onChange={(e) => setCd(e.target.checked)} /> Cascade Delete Related Records</label>
        </div>
        <div style={{ gridColumn: 'span 2' }} className="flex gap-3 items-center"><span>Relationship Type:</span><b>{relType}</b><span className="muted small">Join: {join === 'inner' ? 'only matching rows' : join === 'left' ? `all ${pt}` : `all ${rt}`}</span></div>
      </div>
      {relType === 'Indeterminate' && enforce && valid.length > 0 && <div className="err-text mt-2">The field in "{pt}" is not a primary key or unique index, so referential integrity cannot be enforced. Choose the table with the key as the first table.</div>}
      {err && <div className="banner err mt-2" style={{ border: '1px solid #f1b8b3' }}>{err}</div>}
    </div>
  );
}

export function JoinTypeBody({ left, right, lf, rf, value, close }: { left: string; right: string; lf: string; rf: string; value: 'inner' | 'left' | 'right'; close: (v: 'inner' | 'left' | 'right' | null) => void }) {
  const [v, setV] = useState(value);
  return (
    <div>
      <div className="field-row"><label>Left Table Name</label><b>{left}{lf ? `.${lf}` : ''}</b></div>
      <div className="field-row"><label>Right Table Name</label><b>{right}{rf ? `.${rf}` : ''}</b></div>
      {(['inner', 'left', 'right'] as const).map((k, i) => (
        <label key={k} className="flex gap-2 items-start mb-2"><input type="radio" checked={v === k} onChange={() => setV(k)} /> <span>{i + 1}: {k === 'inner' ? `Only include rows where the joined fields from both tables are equal.` : k === 'left' ? `Include ALL records from '${left}' and only those records from '${right}' where the joined fields are equal.` : `Include ALL records from '${right}' and only those records from '${left}' where the joined fields are equal.`}</span></label>
      ))}
      <div className="dlg-buttons"><button className="btn btn-primary" onClick={() => close(v)}>OK</button><button className="btn" onClick={() => close(null)}>Cancel</button></div>
    </div>
  );
}

export function ShowTableDialog({ names, queries, close }: { names: string[]; queries?: string[]; close: (v: string[] | null) => void }) {
  const [tabSel, setTab] = useState<'tables' | 'queries' | 'both'>('tables');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const list = tabSel === 'tables' ? names : tabSel === 'queries' ? queries ?? [] : [...names, ...(queries ?? [])];
  return (
    <div>
      {queries && <div className="tabs-mini" style={{ padding: 0, marginBottom: 4 }}>{(['tables', 'queries', 'both'] as const).map((t) => <button key={t} className={tabSel === t ? 'on' : ''} onClick={() => setTab(t)}>{t === 'tables' ? 'Tables' : t === 'queries' ? 'Queries' : 'Both'}</button>)}</div>}
      <div className="list-box" style={{ height: 220 }}>
        {list.map((n) => <div key={n} className={sel.has(n) ? 'on' : ''} onClick={(e) => { const s = new Set(e.ctrlKey || e.metaKey || e.shiftKey ? sel : []); if (s.has(n)) s.delete(n); else s.add(n); setSel(s); }} onDoubleClick={() => close([n])}>{n}</div>)}
        {!list.length && <div className="muted">Nothing to add.</div>}
      </div>
      <div className="muted small mt-1">Ctrl+click to select several. You can also drag objects from the Navigation Pane.</div>
      <div className="dlg-buttons"><button className="btn btn-primary" disabled={!sel.size} onClick={() => close([...sel])}>Add Selected</button><button className="btn" onClick={() => close(null)}>Close</button></div>
    </div>
  );
}

function JunctionDialog({ p, close }: { p: WowProject; close: (v: string | null) => void }) {
  const tables = p.tables().filter((t) => t.fields.filter((f) => f.primaryKey).length === 1);
  const [a, setA] = useState(tables[0]?.name ?? '');
  const [b, setB] = useState(tables[1]?.name ?? '');
  const [name, setName] = useState(tables[0] && tables[1] ? `${tables[0].name}${tables[1].name}` : 'Junction');
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (a && b) setName(`${a}${b}`); }, [a, b]);
  const create = () => {
    setErr(null);
    try {
      const ta = p.getTable(a)!, tb = p.getTable(b)!;
      if (a === b) throw new Error('Choose two different tables.');
      const ka = ta.fields.find((f) => f.primaryKey)!, kb = tb.fields.find((f) => f.primaryKey)!;
      const fk = (f: FieldDef, n: string): FieldDef => ({ id: uid('f'), name: n, type: f.type === 'AutoNumber' ? 'Number' : f.type, numberSize: f.type === 'AutoNumber' ? 'Long Integer' : f.numberSize, fieldSize: f.fieldSize, primaryKey: true, required: true });
      const na = ka.name, nb = kb.name === ka.name ? `${b}${kb.name}` : kb.name;
      p.saveTableDesign({ name, description: `Junction table: ${a} ∞–∞ ${b}`, fields: [fk(ka, na), fk(kb, nb)] });
      p.saveRelationship({ primaryTable: a, relatedTable: name, fields: [{ primary: ka.name, related: na }], enforce: true, cascadeUpdate: true, cascadeDelete: true, joinType: 'inner' });
      p.saveRelationship({ primaryTable: b, relatedTable: name, fields: [{ primary: kb.name, related: nb }], enforce: true, cascadeUpdate: true, cascadeDelete: true, joinType: 'inner' });
      close(name);
    } catch (e) { setErr((e as Error).message); }
  };
  return (
    <div>
      <p className="mb-2">A many-to-many relationship is stored with a junction table that holds the primary key of each table. WOWDB creates the table with a composite primary key and two enforced one-to-many relationships.</p>
      <div className="field-row"><label>First table</label><select className="sel" value={a} onChange={(e) => setA(e.target.value)}>{tables.map((t) => <option key={t.name}>{t.name}</option>)}</select></div>
      <div className="field-row"><label>Second table</label><select className="sel" value={b} onChange={(e) => setB(e.target.value)}>{tables.map((t) => <option key={t.name}>{t.name}</option>)}</select></div>
      <div className="field-row"><label>Junction table name</label><input className="inp" value={name} onChange={(e) => setName(e.target.value)} /></div>
      {err && <div className="err-text">{err}</div>}
      <div className="dlg-buttons"><button className="btn btn-primary" onClick={create} disabled={!a || !b || !name.trim()}>Create</button><button className="btn" onClick={() => close(null)}>Cancel</button></div>
    </div>
  );
}
