'use client';
// Form View: a form bound to real records. Edits are buffered per record and
// written with INSERT/UPDATE when you move away or press Save Record, exactly
// like Access. The SQLite constraints validate every write.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Plus } from 'lucide-react';
import type { WowProject } from '@/engine/project';
import type { ControlDef, FormDef, SectionDef } from '@/engine/types';
import { coerceValue } from '@/engine/project';
import { isHosted } from '@/engine/persistence';
import { q } from '@/engine/sqlite';
import { evalControlSource, formatValue, parseCriteria, evaluate, parseExpr } from '@/engine/expr';
import { useApp } from './store';
import { useEditorCommands } from './commands';
import { confirmBox, errorBox, messageBox, askParameters } from './dialogs';
import { runAction } from './actions';
import { DataGrid, applyMask } from './DataGrid';
import { ctlStyle } from './designers/DesignCanvas';
import { ReportPreview } from './ReportPreview';

type Rec = Record<string, unknown>;

export interface FormRunnerProps {
  tabId: string; active: boolean; project: WowProject; def: FormDef;
  link?: { field: string; value: unknown }[];
  nested?: boolean;
  onClose?: () => void;
  scope?: string;
}

export function FormRunner(props: FormRunnerProps) {
  const { project: p, def, link } = props;
  const version = useApp((s) => s.version);
  const table = p.getTable(def.recordSource)?.name;
  const editable = !!table;
  const [params, setParams] = useState<Record<string, unknown> | null>(null);
  const [records, setRecords] = useState<Rec[]>([]);
  const [idx, setIdx] = useState(0);
  const [buffer, setBuffer] = useState<Rec | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState<{ field: string; value: unknown } | null>(null);
  const [filterOn, setFilterOn] = useState(true);
  const [sort, setSort] = useState<{ field: string; dir: 'ASC' | 'DESC' } | null>(null);
  const [focusField, setFocusField] = useState<string | null>(null);
  const [invalid, setInvalid] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // parameters for query record sources
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!def.recordSource) { setParams({}); return; }
      try {
        const s = p.sourceSql(def.recordSource);
        if (s.params.length) { const v = await askParameters(s.params.map((x) => x.prompt)); if (!cancelled) setParams(v ?? {}); }
        else setParams({});
      } catch (e) { setErr((e as Error).message); setParams({}); }
    })();
    return () => { cancelled = true; };
  }, [def.recordSource, p]);

  const load = useCallback(() => {
    if (params === null || !def.recordSource) { setRecords([]); return; }
    try {
      const s = p.sourceSql(def.recordSource);
      const where: string[] = []; const bind: unknown[] = [];
      for (const l of link ?? []) { if (l.value === null || l.value === undefined) where.push('0'); else { where.push(`${q(l.field)} = ?`); bind.push(l.value); } }
      if (filter && filterOn) { if (filter.value === null) where.push(`${q(filter.field)} IS NULL`); else { where.push(`${q(filter.field)} = ?`); bind.push(filter.value); } }
      const named: Record<string, unknown> = {};
      s.params.forEach((x) => { named[x.name] = params[x.prompt] ?? null; });
      let sql = `SELECT * FROM (${s.sql}) AS src${where.length ? ' WHERE ' + where.join(' AND ') : ''}`;
      if (sort) sql += ` ORDER BY ${q(sort.field)} ${sort.dir}`;
      // positional + named parameters cannot be mixed: inline named values as positional
      let final = sql; const allBind: unknown[] = [];
      if (s.params.length) {
        final = sql.replace(/:p\d+/g, (m) => { allBind.push(named[m] ?? null); return '?'; });
        // positional link/filter params come after the source params in the text
      }
      const r = p.db.all(final, [...allBind, ...bind] as never);
      setRecords(r); setErr(null);
    } catch (e) { setErr((e as Error).message); setRecords([]); }
  }, [p, def.recordSource, params, JSON.stringify(link ?? []), filter, filterOn, sort]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!buffer) load(); }, [load, version]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (idx >= records.length && records.length && !isNew) setIdx(records.length - 1); }, [records.length]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setIdx(0); setBuffer(null); setIsNew(false); }, [JSON.stringify(link ?? [])]); // eslint-disable-line react-hooks/exhaustive-deps

  const current: Rec | undefined = isNew ? {} : records[idx];
  const value = (field: string): unknown => {
    if (buffer && field in buffer) return buffer[field];
    if (!current) return null;
    if (field in current) return current[field];
    const k = Object.keys(current).find((x) => x.toLowerCase() === field.toLowerCase());
    return k ? current[k] : null;
  };
  const record: Rec = { ...(current ?? {}), ...(buffer ?? {}) };

  const setField = (field: string, v: unknown) => {
    if (!editable || !def.allowEdits && !isNew) return;
    if (!current && !isNew) { if (!def.allowAdditions) return; setIsNew(true); }
    setBuffer((b) => ({ ...(b ?? {}), [field]: v }));
    setInvalid(null);
  };

  const validateControls = (): string | null => {
    for (const c of def.controls) {
      const rule = c.props.validationRule; const src = String(c.props.controlSource ?? '');
      if (!rule || !src || src.startsWith('=')) continue;
      const v = value(src);
      if (v === null || v === undefined || v === '') continue;
      try {
        const ok = evaluate(parseCriteria(String(rule), 'validation'), { record, self: v });
        if (!ok || ok === 0) { setInvalid(c.id); return String(c.props.validationText || `The value in ${c.name} breaks the rule ${rule}.`); }
      } catch { /* ignore malformed rule */ }
    }
    return null;
  };

  const save = (): boolean => {
    if (!buffer || !table) { if (isNew && !buffer) { setIsNew(false); } return true; }
    const msg = validateControls();
    if (msg) { void messageBox(msg, 'WOWDB', 'warn'); return false; }
    try {
      if (isNew) {
        const vals: Rec = { ...buffer };
        for (const l of link ?? []) if (vals[l.field] === undefined) vals[l.field] = l.value;
        // control default values
        for (const c of def.controls) { const src = String(c.props.controlSource ?? ''); if (src && !src.startsWith('=') && c.props.defaultValue && vals[src] === undefined) { try { vals[src] = evaluate(parseExpr(String(c.props.defaultValue)), { record: vals }); } catch { /* ignore */ } } }
        const rowid = p.insertRecord(table, vals);
        setBuffer(null); setIsNew(false);
        // move to the new record after reload
        pendingRowid.current = rowid;
      } else {
        const rid = Number(current?.__rowid);
        p.updateRecord(table, rid, buffer);
        setBuffer(null);
      }
      setErr(null);
      return true;
    } catch (e) {
      setErr((e as Error).message);
      void errorBox(e, 'WOWDB - record not saved');
      return false;
    }
  };
  const pendingRowid = useRef<number | null>(null);
  useEffect(() => {
    if (pendingRowid.current !== null) {
      const i = records.findIndex((r) => Number(r.__rowid) === pendingRowid.current);
      if (i >= 0) setIdx(i);
      pendingRowid.current = null;
    }
  }, [records]);

  const go = (i: number) => {
    if (!save()) return;
    setIsNew(false);
    setIdx(Math.max(0, Math.min(records.length - 1, i)));
  };
  const newRecord = () => { if (!editable || !def.allowAdditions) return; if (!save()) return; setIsNew(true); setBuffer(null); setTimeout(() => rootRef.current?.querySelector<HTMLElement>('[data-tabstop]')?.focus(), 0); };
  const undo = () => { setBuffer(null); if (isNew) setIsNew(false); setInvalid(null); };
  const del = async () => {
    if (!table || !def.allowDeletions) return;
    if (isNew) { undo(); return; }
    if (!current) return;
    if (!(await confirmBox('You are about to delete 1 record.\n\nIf you click Yes, you won\'t be able to undo this Delete operation.\nAre you sure you want to delete this record?', { danger: true, title: 'Delete Record' }))) return;
    try { p.deleteRecords(table, [Number(current.__rowid)]); setBuffer(null); } catch (e) { void errorBox(e); }
  };
  const find = async () => {
    const { promptBox } = await import('./dialogs');
    const t = await promptBox('Find What:', '', 'Find');
    if (!t) return;
    const fields = def.controls.map((c) => String(c.props.controlSource ?? '')).filter((s) => s && !s.startsWith('='));
    for (let k = 1; k <= records.length; k++) {
      const i = (idx + k) % records.length;
      if (fields.some((f) => String(records[i][f] ?? '').toLowerCase().includes(t.toLowerCase()))) { go(i); return; }
    }
    void messageBox(`The search item "${t}" was not found.`);
  };
  const print = () => { if (isHosted()) { void messageBox('Printing is not available inside the hosted page.'); return; } window.print(); };

  const nav = { first: () => go(0), prev: () => go(idx - 1), next: () => (idx >= records.length - 1 && editable && def.allowAdditions ? newRecord() : go(idx + 1)), last: () => go(records.length - 1), newRecord, save, del: () => void del(), undo, refresh: () => { if (save()) load(); }, close: props.onClose, print };

  if (!props.nested) {
    useEditorCommands(props.tabId, props.active, { // eslint-disable-line react-hooks/rules-of-hooks
      'home.first': { run: nav.first, enabled: records.length > 0 }, 'home.prev': { run: nav.prev, enabled: idx > 0 || isNew }, 'home.next': { run: () => go(idx + 1), enabled: idx < records.length - 1 }, 'home.last': { run: nav.last, enabled: records.length > 0 },
      'home.newRecord': { run: newRecord, enabled: editable && def.allowAdditions }, 'home.saveRecord': { run: () => { save(); }, enabled: !!buffer }, 'home.undoRecord': { run: undo, enabled: !!buffer || isNew },
      'home.deleteRecord': { run: () => void del(), enabled: editable && def.allowDeletions && (!!current || isNew) }, 'home.refresh': nav.refresh,
      'home.find': () => void find(),
      'home.filterSelection': { run: () => { if (focusField) { setFilter({ field: focusField, value: value(focusField) }); setFilterOn(true); setIdx(0); } }, enabled: !!focusField && !isNew },
      'home.toggleFilter': { run: () => setFilterOn(!filterOn), enabled: !!filter, checked: !!filter && filterOn },
      'home.sortAsc': { run: () => { if (focusField && save()) setSort({ field: focusField, dir: 'ASC' }); }, enabled: !!focusField },
      'home.sortDesc': { run: () => { if (focusField && save()) setSort({ field: focusField, dir: 'DESC' }); }, enabled: !!focusField },
      'home.removeSort': { run: () => setSort(null), enabled: !!sort },
    }, props.scope ?? 'formview');
  }

  if (def.defaultView === 'Datasheet' && table) {
    const bound = new Set(def.controls.map((c) => String(c.props.controlSource ?? '').toLowerCase()).filter((x) => x && !x.startsWith('=')));
    const hidden = bound.size ? (p.getTable(table)?.fields.map((f) => f.name).filter((n) => !bound.has(n.toLowerCase())) ?? []) : [];
    return <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }} data-testid={props.nested ? 'subform-view' : 'form-view'}><DataGrid tabId={props.tabId} active={props.active && !props.nested} project={p} table={table} link={link} layout={{ hidden }} allowAdd={def.allowAdditions} allowEdit={def.allowEdits} allowDelete={def.allowDeletions} scope={props.scope ?? 'formview'} /></div>;
  }

  const sec = (k: SectionDef['kind']) => def.sections.find((s) => s.kind === k && s.visible !== false);
  const header = sec('formHeader'), detail = sec('detail'), footer = sec('formFooter');
  const continuous = def.defaultView === 'Continuous Forms';
  const ctx = { record, records };

  const renderSection = (s: SectionDef | undefined, rec: Rec, active: boolean, key?: string, onActivate?: () => void) => {
    if (!s) return null;
    return (
      <div key={key ?? s.id} className="fv-sec" style={{ height: s.height, width: def.width, background: s.backColor ?? '#fff', outline: continuous && active && s.kind === 'detail' ? '2px solid var(--accent)' : undefined, outlineOffset: -2 }} onMouseDown={onActivate}>
        {def.controls.filter((c) => c.section === s.id && c.props.visible !== false).sort((a, b) => Number(a.props.tabIndex ?? 0) - Number(b.props.tabIndex ?? 0)).map((c) => (
          <FormControl key={c.id} c={c} p={p} rec={rec} records={records} active={active} invalid={invalid === c.id}
            getValue={(f) => (active ? value(f) : rec[f])} setValue={(f, v) => { if (!active) onActivate?.(); setField(f, v); }}
            onFocusField={setFocusField} editable={editable && (def.allowEdits || isNew)} nav={nav} tabId={props.tabId} />
        ))}
      </div>
    );
  };

  return (
    <div className="fv" ref={rootRef} onKeyDown={(e) => {
      if (props.nested) return;
      if (e.key === 'PageDown') { e.preventDefault(); nav.next(); } else if (e.key === 'PageUp') { e.preventDefault(); nav.prev(); }
      else if (e.key === 'Enter' && e.shiftKey) { e.preventDefault(); save(); } else if (e.key === 'Escape') { undo(); }
    }} data-testid={props.nested ? 'subform-view' : 'form-view'}>
      {err && <div className="fv-err">{err}</div>}
      {!def.recordSource && <div className="banner info">This form is unbound (no Record Source). Set Record Source in Design View to show data.</div>}
      <div style={{ padding: props.nested ? 0 : 12, flex: 1, overflow: 'auto' }}>
        <div className="fv-form" style={{ width: def.width, background: def.backColor }}>
          {renderSection(header, record, true)}
          {continuous ? (
            <div style={{ maxHeight: props.nested ? undefined : 'none' }}>
              {records.map((r, i) => renderSection(detail, i === idx && !isNew ? { ...r, ...(buffer ?? {}) } : r, i === idx && !isNew, 'r' + String(r.__rowid ?? i), () => { if (i !== idx) go(i); }))}
              {editable && def.allowAdditions && renderSection(detail, isNew ? (buffer ?? {}) : {}, isNew, 'new', () => { if (!isNew) newRecord(); })}
            </div>
          ) : renderSection(detail, record, true)}
          {renderSection(footer, record, true)}
        </div>
      </div>
      {def.navigationButtons && (
        <div className="dg-nav">
          <span>Record:</span>
          <button onClick={nav.first} disabled={idx === 0 && !isNew} title="First record"><ChevronsLeft size={13} /></button>
          <button onClick={nav.prev} disabled={idx === 0 && !isNew} title="Previous record"><ChevronLeft size={13} /></button>
          <input className="pos" readOnly value={isNew ? `${records.length + 1} of ${records.length + 1}` : records.length ? `${idx + 1} of ${records.length}` : '0 of 0'} aria-label="Current record" />
          <button onClick={() => go(idx + 1)} disabled={idx >= records.length - 1 || isNew} title="Next record"><ChevronRight size={13} /></button>
          <button onClick={nav.last} disabled={idx >= records.length - 1 && !isNew} title="Last record"><ChevronsRight size={13} /></button>
          {editable && def.allowAdditions && <button onClick={newRecord} title="New (blank) record"><Plus size={13} /></button>}
          <span className={'flt' + (filter && filterOn ? ' on' : '')} style={{ cursor: filter ? 'pointer' : 'default' }} onClick={() => filter && setFilterOn(!filterOn)}>{filter ? (filterOn ? 'Filtered' : 'Unfiltered') : 'No Filter'}</span>
          <span style={{ flex: 1 }} />
          {buffer && <span className="muted">✎ Editing — changes are saved when you move to another record</span>}
          {!editable && def.recordSource && <span className="muted">Read-only (record source is a query)</span>}
        </div>
      )}
    </div>
  );
  void ctx;
}

// ---------------- controls ----------------
interface CtlProps {
  c: ControlDef; p: WowProject; rec: Rec; records: Rec[]; active: boolean; invalid: boolean; editable: boolean; tabId: string;
  getValue: (f: string) => unknown; setValue: (f: string, v: unknown) => void; onFocusField: (f: string | null) => void;
  nav: Parameters<typeof runAction>[2];
}

function FormControl({ c, p, rec, records, active, invalid, editable, getValue, setValue, onFocusField, nav, tabId }: CtlProps) {
  const pr = c.props;
  const src = String(pr.controlSource ?? '');
  const calc = src.startsWith('=');
  const bound = !!src && !calc;
  const enabled = pr.enabled !== false;
  const locked = !!pr.locked || !editable || !enabled;
  const style: React.CSSProperties = { left: c.x, top: c.y, width: c.w, height: c.h, ...ctlStyle(c), textAlign: String(pr.textAlign ?? 'Left').toLowerCase() as React.CSSProperties['textAlign'], display: 'flex', alignItems: 'center', opacity: enabled ? 1 : 0.6 };
  const tabIndex = pr.tabStop === false ? -1 : Number(pr.tabIndex ?? 0) + 1;
  const fieldDef = bound ? p.fieldDef(p.getTable(String(rec.__table ?? ''))?.name ?? '', src) : undefined;
  void fieldDef;
  const [local, setLocal] = useState<string | null>(null);
  const v = bound ? getValue(src) : calc ? evalControlSource(src, { record: rec, records }) : null;
  const common = { 'data-tabstop': tabIndex > 0 ? '1' : undefined, tabIndex, title: String(pr.controlTipText ?? '') || undefined, onFocus: () => onFocusField(bound ? src : null) } as const;
  const cls = 'fv-ctl' + (invalid ? ' invalid' : '');
  switch (c.type) {
    case 'label': return <div className={cls} style={style} onClick={() => pr.onClick && pr.onClick !== 'None' && void runAction(String(pr.onClick), String(pr.onClickArgument ?? ''), nav)}>{String(pr.caption ?? '')}</div>;
    case 'rectangle': return <div className={cls} style={style} />;
    case 'line': return <div className={cls} style={style}><svg width="100%" height="100%" style={{ overflow: 'visible' }}>{c.w >= c.h ? <line x1={0} y1="50%" x2="100%" y2="50%" stroke={String(pr.borderColor ?? '#000')} strokeWidth={Number(pr.borderWidth ?? 1)} /> : <line x1="50%" y1={0} x2="50%" y2="100%" stroke={String(pr.borderColor ?? '#000')} strokeWidth={Number(pr.borderWidth ?? 1)} />}</svg></div>;
    case 'image': { const img = bound ? String(v ?? '') : String(pr.picture ?? ''); return <div className={cls} style={style}>{img.startsWith('data:image') || /^https?:/.test(img) ? <img src={img} alt={c.name} style={{ width: '100%', height: '100%', objectFit: pr.sizeMode === 'Stretch' ? 'fill' : pr.sizeMode === 'Clip' ? 'none' : 'contain' }} /> : <span className="muted small" style={{ margin: 'auto' }}>{bound ? '(no image)' : ''}</span>}</div>; }
    case 'button': return <div className={cls} style={{ ...style, padding: 0 }}><button className="fv-btn" {...common} disabled={!enabled} style={{ background: String(pr.backColor ?? '#f3f3f3'), border: style.border, font: 'inherit', color: 'inherit' }} onClick={() => void runAction(String(pr.onClick ?? 'None'), String(pr.onClickArgument ?? ''), nav)}>{String(pr.caption ?? '')}</button></div>;
    case 'toggle': { const on = !!v && v !== '0'; return <div className={cls} style={{ ...style, padding: 0 }}><button className="fv-btn" {...common} disabled={locked} aria-pressed={on} style={{ background: on ? '#c9dcf2' : '#f3f3f3', border: '1px solid #8a8a8a', boxShadow: on ? 'inset 0 1px 3px rgba(0,0,0,.25)' : undefined, font: 'inherit' }} onClick={() => bound && setValue(src, on ? 0 : 1)}>{String(pr.caption ?? '')}</button></div>; }
    case 'checkbox': return <div className={cls} style={{ ...style, justifyContent: 'center', border: 'none', background: 'transparent' }}><input type="checkbox" className="chk" {...common} style={{ width: 15, height: 15 }} checked={!!v && v !== '0'} disabled={locked} onChange={(e) => bound && setValue(src, e.target.checked ? 1 : 0)} aria-label={c.name} /></div>;
    case 'option': { const ov = pr.optionValue; return <div className={cls} style={{ ...style, justifyContent: 'center', border: 'none', background: 'transparent' }}><input type="radio" {...common} checked={String(v ?? '') === String(ov ?? '')} disabled={locked} onChange={() => bound && setValue(src, ov)} aria-label={c.name} /></div>; }
    case 'combobox': case 'listbox': {
      const opts = useRowSource(p, c);
      const cur = v === null || v === undefined ? '' : String(v);
      return (
        <div className={cls} style={{ ...style, padding: 0 }}>
          <select {...common} size={c.type === 'listbox' ? Math.max(2, Math.floor(c.h / 18)) : undefined} value={cur} disabled={locked && !calc} onChange={(e) => bound && setValue(src, e.target.value === '' ? null : e.target.value)} aria-label={c.name} style={{ height: '100%' }}>
            {c.type === 'combobox' && <option value="" />}
            {opts.map((o, i) => <option key={i} value={String(o.value)}>{o.label}</option>)}
            {cur && !opts.some((o) => String(o.value) === cur) && <option value={cur}>{cur}</option>}
          </select>
        </div>
      );
    }
    case 'datepicker': {
      const iso = v ? String(v).slice(0, 10) : '';
      return <div className={cls} style={{ ...style, padding: 0 }}><input type="date" {...common} value={iso} readOnly={locked} onChange={(e) => bound && setValue(src, e.target.value || null)} aria-label={c.name} /></div>;
    }
    case 'textbox': {
      const fmt = String(pr.format ?? '');
      const display = calc ? formatValue(v, fmt, pr.decimalPlaces === undefined || pr.decimalPlaces === 'Auto' ? undefined : Number(pr.decimalPlaces)) : v === null || v === undefined ? '' : local !== null ? local : fmt && !active ? formatValue(v, fmt) : String(v);
      const multiline = c.h > 30;
      const onChange = (t: string) => { const m = applyMask(t, pr.inputMask ? String(pr.inputMask) : undefined); setLocal(null); setValue(src, m === '' ? null : m); };
      if (multiline && !calc) return <div className={cls} style={{ ...style, padding: 0, alignItems: 'stretch' }}><textarea {...common} value={display} readOnly={locked || calc} onChange={(e) => onChange(e.target.value)} aria-label={c.name} style={{ resize: 'none', padding: 3 }} /></div>;
      return <div className={cls} style={{ ...style, padding: 0 }}><input {...common} value={display} readOnly={locked || calc || !bound} onChange={(e) => onChange(e.target.value)} aria-label={c.name} placeholder={pr.inputMask ? String(pr.inputMask) : undefined} /></div>;
    }
    case 'subform': {
      const so = String(pr.sourceObject ?? '');
      const masters = String(pr.linkMasterFields ?? '').split(';').map((s) => s.trim()).filter(Boolean);
      const children = String(pr.linkChildFields ?? '').split(';').map((s) => s.trim()).filter(Boolean);
      const linkVals = children.map((ch, i) => ({ field: ch, value: rec[masters[i] ?? ch] ?? null }));
      const sub = p.getForm(so.replace(/^Form\./i, ''));
      return (
        <div className={cls} style={{ ...style, padding: 0, overflow: 'auto', alignItems: 'stretch', flexDirection: 'column' }}>
          {sub ? <FormRunner tabId={tabId} active={false} project={p} def={sub} link={linkVals.length ? linkVals : undefined} nested scope={'sub-' + c.id} />
            : p.getTable(so) ? <DataGrid tabId={tabId} active={false} project={p} table={p.getTable(so)!.name} link={linkVals.length ? linkVals : undefined} scope={'sub-' + c.id} compact />
              : <span className="muted small" style={{ margin: 'auto' }}>Subform: set Source Object</span>}
        </div>
      );
    }
    case 'navigation': return <NavigationControl c={c} p={p} style={style} tabId={tabId} />;
    default: return null;
  }
}

function useRowSource(p: WowProject, c: ControlDef) {
  const version = useApp((s) => s.version);
  return useMemo(() => {
    const t = String(c.props.rowSourceType ?? 'Table/Query'), src = String(c.props.rowSource ?? '');
    if (!src) return [];
    if (t === 'Value List') return src.split(';').map((s) => s.trim().replace(/^"|"$/g, '')).filter(Boolean).map((s) => ({ value: s, label: s }));
    try {
      const rows = p.db.all(p.sourceSql(src).sql);
      const keys = Object.keys(rows[0] ?? {}).filter((k) => k !== '__rowid');
      const bf = String(c.props.boundField || keys[0] || ''), df = String(c.props.displayField || keys[1] || bf);
      return rows.map((r) => ({ value: r[bf], label: String(r[df] ?? '') }));
    } catch { return []; }
  }, [p, c.props.rowSourceType, c.props.rowSource, c.props.boundField, c.props.displayField, version]);
}

function NavigationControl({ c, p, style, tabId }: { c: ControlDef; p: WowProject; style: React.CSSProperties; tabId: string }) {
  const targets = String(c.props.navTargets ?? '').split(/\n|;/).map((s) => s.trim()).filter(Boolean).map((s) => { const m = /^(form|report):(.+)$/i.exec(s); return m ? { kind: m[1].toLowerCase() as 'form' | 'report', name: m[2].trim() } : { kind: p.getReport(s) ? 'report' as const : 'form' as const, name: s }; });
  const [i, setI] = useState(0);
  const t = targets[i];
  return (
    <div className="fv-ctl" style={{ ...style, flexDirection: 'column', alignItems: 'stretch', padding: 0, overflow: 'hidden' }}>
      <div style={{ display: 'flex', gap: 2, background: '#eef3fa', borderBottom: '1px solid #c5d9f1', padding: '3px 3px 0' }}>
        {targets.map((x, k) => <button key={k} onClick={() => setI(k)} style={{ border: '1px solid #b5cfee', borderBottom: 0, background: k === i ? '#fff' : '#dbe7f6', padding: '3px 10px', cursor: 'pointer', fontSize: 12 }}>{x.name}</button>)}
        {!targets.length && <span className="muted small" style={{ padding: 4 }}>Add Navigation Targets in the Property Sheet</span>}
      </div>
      <div style={{ flex: 1, overflow: 'auto' }}>
        {t && t.kind === 'form' && p.getForm(t.name) && <FormRunner tabId={tabId} active={false} project={p} def={p.getForm(t.name)!} nested scope={`nav-${c.id}-${i}`} />}
        {t && t.kind === 'report' && p.getReport(t.name) && <ReportPreview project={p} def={p.getReport(t.name)!} embedded />}
        {t && !p.getForm(t.name) && !p.getReport(t.name) && <div className="muted small" style={{ padding: 8 }}>"{t.name}" was not found.</div>}
      </div>
    </div>
  );
}

export { coerceValue };
