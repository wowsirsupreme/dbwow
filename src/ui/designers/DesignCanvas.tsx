'use client';
import type { LucideIcon } from 'lucide-react';
// Shared visual designer for Forms and Reports.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as I from 'lucide-react';
import type { ControlDef, ControlType, FormDef, ReportDef, SectionDef, GroupLevel } from '@/engine/types';
import type { WowProject } from '@/engine/project';
import { uid } from '@/engine/project';
import { CONTROL_LABELS, FORM_TOOLBOX, GRID, REPORT_TOOLBOX, isBindable, newControl, newGroup, propsFor, syncGroupSections, type PropSpec } from '@/engine/objects';
import { useEditorCommands } from '../commands';
import { messageBox, openDialog, showContextMenu } from '../dialogs';
import { pickImage } from '../DataGrid';

type Def = FormDef | ReportDef;
export interface DesignCanvasProps<T extends Def> {
  tabId: string; active: boolean; project: WowProject; mode: 'form' | 'report';
  def: T; setDef: (d: T, commit?: boolean) => void;
  undo: () => void; redo: () => void; canUndo: boolean; canRedo: boolean;
  save: () => void;
}

const TOOL_ICONS: Record<ControlType, LucideIcon> = {
  label: I.Type, textbox: I.TextCursorInput, combobox: I.ChevronsUpDown, listbox: I.List, checkbox: I.CheckSquare, option: I.CircleDot, toggle: I.ToggleLeft,
  button: I.MousePointerClick, datepicker: I.Calendar, image: I.Image, line: I.Minus, rectangle: I.Square, subform: I.SquareStack, navigation: I.PanelsTopLeft,
  pagenumber: I.Hash, datetime: I.Clock,
};
const clipboard: { controls: ControlDef[] } = { controls: [] };

export function DesignCanvas<T extends Def>(props: DesignCanvasProps<T>) {
  const { def, setDef, project: p, mode } = props;
  const [sel, setSel] = useState<string[]>([]);
  const [selSection, setSelSection] = useState<string | null>(null);
  const [tool, setTool] = useState<ControlType | null>(null);
  const [showFields, setShowFields] = useState(true);
  const [showProps, setShowProps] = useState(true);
  const [showGrid, setShowGrid] = useState(true);
  const [snap, setSnap] = useState(true);
  const [guides, setGuides] = useState<{ v: number[]; h: number[]; section: string } | null>(null);
  const [marquee, setMarquee] = useState<{ section: string; x: number; y: number; w: number; h: number } | null>(null);
  const [dropSec, setDropSec] = useState<string | null>(null);
  const [showGroupPane, setShowGroupPane] = useState(mode === 'report');
  const surfaceRef = useRef<HTMLDivElement>(null);
  const defRef = useRef(def); defRef.current = def;
  const report = mode === 'report' ? (def as ReportDef) : null;

  const fields = useMemo(() => { try { return def.recordSource ? p.columnsOf(def.recordSource) : []; } catch { return []; } }, [def.recordSource, p]);
  const fieldDefs = useMemo(() => p.getTable(def.recordSource)?.fields ?? [], [def.recordSource, p]);
  const visibleSections = def.sections.filter((s) => s.visible !== false || true);

  const snapv = (v: number) => (snap ? Math.round(v / GRID) * GRID : Math.round(v));
  const update = (patch: Partial<Def>, commit = true) => setDef({ ...defRef.current, ...patch } as T, commit);
  const updateControls = (fn: (c: ControlDef) => ControlDef, ids: string[] = sel, commit = true) => update({ controls: defRef.current.controls.map((c) => (ids.includes(c.id) ? fn(c) : c)) }, commit);
  const selectedControls = def.controls.filter((c) => sel.includes(c.id));
  const expandGroups = (ids: string[]) => { const groups = new Set(def.controls.filter((c) => ids.includes(c.id) && c.groupId).map((c) => c.groupId)); return [...new Set([...ids, ...def.controls.filter((c) => c.groupId && groups.has(c.groupId)).map((c) => c.id)])]; };

  // ---------- creation ----------
  const addControl = (type: ControlType, section: string, x: number, y: number, extra: Partial<ControlDef> = {}): ControlDef => {
    const c = { ...newControl(type, section, snapv(x), snapv(y), defRef.current.controls), ...extra };
    if (type === 'subform') c.props.sourceObject = '';
    return c;
  };
  const addFieldControls = (field: string, section: string, x: number, y: number) => {
    const fd = fieldDefs.find((f) => f.name === field);
    const sec = def.sections.find((s) => s.id === section)!;
    const type: ControlType = fd?.type === 'Yes/No' ? 'checkbox' : fd?.lookup && mode === 'form' ? 'combobox' : fd?.type === 'Date/Time' && mode === 'form' ? 'datepicker' : fd?.type === 'Attachment' ? 'image' : 'textbox';
    const ctl = addControl(type, section, x + (mode === 'form' || sec.kind !== 'detail' ? 120 : 0), y);
    ctl.props.controlSource = field;
    ctl.name = uniqueName(field.replace(/\s+/g, ''), defRef.current.controls);
    if (type === 'combobox' && fd?.lookup) Object.assign(ctl.props, { rowSourceType: fd.lookup.rowSourceType, rowSource: fd.lookup.rowSource, boundField: fd.lookup.boundField ?? '', displayField: fd.lookup.displayField ?? '' });
    if (fd?.type === 'Currency') { ctl.props.format = 'Currency'; ctl.props.textAlign = 'Right'; }
    if (mode === 'report') { ctl.props.borderStyle = 'Transparent'; ctl.props.backStyle = 'Transparent'; }
    const added: ControlDef[] = [];
    const lblCaption = (fd?.caption || field) + (mode === 'form' ? ':' : '');
    if (mode === 'report' && sec.kind === 'detail') {
      const ph = def.sections.find((s) => s.kind === 'pageHeader');
      if (ph) { const l = addControl('label', ph.id, x, 6); l.props.caption = fd?.caption || field; l.props.fontWeight = 'Bold'; l.w = ctl.w; l.name = uniqueName('Label_' + ctl.name, [...defRef.current.controls, ctl]); added.push(l); }
    } else {
      const l = addControl('label', section, x, y); l.props.caption = lblCaption; l.w = 112; l.name = uniqueName('Label_' + ctl.name, [...defRef.current.controls, ctl]);
      const g = uid('grp'); l.groupId = g; ctl.groupId = g;
      added.push(l);
    }
    added.push(ctl);
    const needH = Math.max(sec.height, ctl.y + ctl.h + 8);
    update({ controls: [...defRef.current.controls, ...added], sections: defRef.current.sections.map((s) => (s.id === section ? { ...s, height: needH } : s)) });
    setSel(added.map((a) => a.id)); setSelSection(null);
  };

  const placeTool = async (type: ControlType, section: string, x: number, y: number, w?: number, h?: number) => {
    const c = addControl(type, section, x, y);
    if (w && h && w > 6 && h > 6) { c.w = snapv(w); c.h = snapv(h); }
    if (type === 'image') { const img = await pickImage(); if (img) c.props.picture = img; }
    const sec = defRef.current.sections.find((s) => s.id === section)!;
    update({ controls: [...defRef.current.controls, c], sections: defRef.current.sections.map((s) => (s.id === section ? { ...s, height: Math.max(sec.height, c.y + c.h + 4) } : s)) });
    setSel([c.id]); setSelSection(null); setTool(null);
  };

  // ---------- pointer interactions ----------
  const sectionTop = (id: string) => { const el = surfaceRef.current?.querySelector(`[data-sec="${id}"]`) as HTMLElement | null; return el?.getBoundingClientRect(); };

  const onSectionPointerDown = (e: React.PointerEvent, s: SectionDef) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest('.ctl')) return;
    e.preventDefault();
    (surfaceRef.current?.parentElement as HTMLElement | null)?.focus();
    const r = sectionTop(s.id)!;
    const x0 = e.clientX - r.left, y0 = e.clientY - r.top;
    if (tool) {
      let w = 0, h = 0;
      const move = (ev: PointerEvent) => { w = ev.clientX - r.left - x0; h = ev.clientY - r.top - y0; setMarquee({ section: s.id, x: Math.min(x0, x0 + w), y: Math.min(y0, y0 + h), w: Math.abs(w), h: Math.abs(h) }); };
      const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); setMarquee(null); void placeTool(tool, s.id, Math.min(x0, x0 + w), Math.min(y0, y0 + h), Math.abs(w), Math.abs(h)); };
      window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
      return;
    }
    if (!e.shiftKey && !e.ctrlKey) { setSel([]); setSelSection(s.id); }
    const move = (ev: PointerEvent) => {
      const x1 = ev.clientX - r.left, y1 = ev.clientY - r.top;
      setMarquee({ section: s.id, x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) });
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
      const x1 = ev.clientX - r.left, y1 = ev.clientY - r.top;
      const mx = Math.min(x0, x1), my = Math.min(y0, y1), mw = Math.abs(x1 - x0), mh = Math.abs(y1 - y0);
      setMarquee(null);
      if (mw < 3 && mh < 3) return;
      const hit = defRef.current.controls.filter((c) => c.section === s.id && c.x < mx + mw && c.x + c.w > mx && c.y < my + mh && c.y + c.h > my).map((c) => c.id);
      setSel((cur) => expandGroups(e.shiftKey || e.ctrlKey ? [...new Set([...cur, ...hit])] : hit));
      if (hit.length) setSelSection(null);
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };

  const onControlPointerDown = (e: React.PointerEvent, c: ControlDef, handle?: string) => {
    if (e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    (surfaceRef.current?.parentElement as HTMLElement | null)?.focus();
    let ids = sel;
    if (!handle) {
      if (e.shiftKey || e.ctrlKey) { ids = sel.includes(c.id) ? sel.filter((x) => x !== c.id) : expandGroups([...sel, c.id]); setSel(ids); setSelSection(null); if (!ids.includes(c.id)) return; }
      else if (!sel.includes(c.id)) { ids = expandGroups([c.id]); setSel(ids); setSelSection(null); }
    }
    const start = defRef.current.controls.filter((x) => ids.includes(x.id)).map((x) => ({ ...x }));
    const primary = start.find((x) => x.id === c.id) ?? { ...c };
    const x0 = e.clientX, y0 = e.clientY;
    let moved = false;
    const others = defRef.current.controls.filter((x) => !ids.includes(x.id) && x.section === c.section);
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - x0, dy = ev.clientY - y0;
      if (!moved && Math.abs(dx) < 2 && Math.abs(dy) < 2) return;
      moved = true;
      if (handle) {
        let { x, y, w, h } = primary;
        if (handle.includes('e')) w = Math.max(6, snapv(primary.w + dx));
        if (handle.includes('s')) h = Math.max(4, snapv(primary.h + dy));
        if (handle.includes('w')) { const nx = snapv(primary.x + dx); w = Math.max(6, primary.w + primary.x - nx); x = primary.x + primary.w - w; }
        if (handle.includes('n')) { const ny = snapv(primary.y + dy); h = Math.max(4, primary.h + primary.y - ny); y = primary.y + primary.h - h; }
        setDef({ ...defRef.current, controls: defRef.current.controls.map((x2) => (x2.id === c.id ? { ...x2, x: Math.max(0, x), y: Math.max(0, y), w, h } : x2)) } as T, false);
        return;
      }
      // move with snapping + alignment guides relative to the primary control
      let nx = primary.x + dx, ny = primary.y + dy;
      const vg: number[] = [], hg: number[] = [];
      const edgesX = (o: ControlDef) => [o.x, o.x + o.w, o.x + o.w / 2];
      const edgesY = (o: ControlDef) => [o.y, o.y + o.h, o.y + o.h / 2];
      let bestX: { d: number; adj: number; line: number } | null = null, bestY: { d: number; adj: number; line: number } | null = null;
      for (const o of others) {
        const my = [nx, nx + primary.w, nx + primary.w / 2];
        for (const ex of edgesX(o)) my.forEach((m) => { const d = Math.abs(m - ex); if (d < 5 && (!bestX || d < bestX.d)) bestX = { d, adj: ex - m, line: ex }; });
        const myy = [ny, ny + primary.h, ny + primary.h / 2];
        for (const ey of edgesY(o)) myy.forEach((m) => { const d = Math.abs(m - ey); if (d < 5 && (!bestY || d < bestY.d)) bestY = { d, adj: ey - m, line: ey }; });
      }
      if (bestX) { nx += (bestX as { adj: number }).adj; vg.push((bestX as { line: number }).line); } else nx = snapv(nx);
      if (bestY) { ny += (bestY as { adj: number }).adj; hg.push((bestY as { line: number }).line); } else ny = snapv(ny);
      const ddx = nx - primary.x, ddy = ny - primary.y;
      setGuides(vg.length || hg.length ? { v: vg, h: hg, section: c.section } : null);
      setDef({ ...defRef.current, controls: defRef.current.controls.map((x2) => { const s0 = start.find((s) => s.id === x2.id); return s0 ? { ...x2, x: Math.max(0, Math.round(s0.x + ddx)), y: Math.max(0, Math.round(s0.y + ddy)) } : x2; }) } as T, false);
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
      setGuides(null);
      if (!moved) return;
      // dropped into another section?
      const el = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('[data-sec]') as HTMLElement | null;
      const target = el?.dataset.sec;
      let d = defRef.current;
      if (!handle && target && target !== c.section) {
        const fromR = sectionTop(c.section)!, toR = sectionTop(target)!;
        const shift = fromR.top - toR.top;
        d = { ...d, controls: d.controls.map((x2) => (ids.includes(x2.id) ? { ...x2, section: target, y: Math.max(0, snapv(x2.y + shift)) } : x2)) } as T;
      }
      // grow sections to fit
      d = { ...d, sections: d.sections.map((s) => { const bottom = Math.max(0, ...d.controls.filter((x2) => x2.section === s.id).map((x2) => x2.y + x2.h)); return bottom > s.height ? { ...s, height: bottom + 4 } : s; }) } as T;
      const maxRight = Math.max(...d.controls.map((x2) => x2.x + x2.w), 0);
      if (maxRight > d.width) d = { ...d, width: maxRight + 8 } as T;
      setDef(d as T, true);
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };

  const startSectionResize = (e: React.PointerEvent, s: SectionDef) => {
    e.preventDefault(); e.stopPropagation();
    const y0 = e.clientY, h0 = s.height;
    const minH = Math.max(0, ...def.controls.filter((c) => c.section === s.id).map((c) => c.y + c.h));
    const move = (ev: PointerEvent) => setDef({ ...defRef.current, sections: defRef.current.sections.map((x) => (x.id === s.id ? { ...x, height: Math.max(minH, snapv(h0 + ev.clientY - y0)) } : x)) } as T, false);
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); setDef(defRef.current, true); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };
  const startWidthResize = (e: React.PointerEvent) => {
    e.preventDefault();
    const x0 = e.clientX, w0 = def.width;
    const minW = Math.max(100, ...def.controls.map((c) => c.x + c.w));
    const move = (ev: PointerEvent) => setDef({ ...defRef.current, width: Math.max(minW, snapv(w0 + ev.clientX - x0)) } as T, false);
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); setDef(defRef.current, true); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };

  // ---------- arrange commands ----------
  const arrange = (fn: (cs: ControlDef[]) => Map<string, Partial<ControlDef>>) => {
    if (selectedControls.length < 2) return;
    const m = fn(selectedControls);
    update({ controls: def.controls.map((c) => (m.has(c.id) ? { ...c, ...m.get(c.id) } : c)) });
  };
  const alignCmd = (kind: 'left' | 'right' | 'top' | 'bottom') => arrange((cs) => {
    const v = kind === 'left' ? Math.min(...cs.map((c) => c.x)) : kind === 'right' ? Math.max(...cs.map((c) => c.x + c.w)) : kind === 'top' ? Math.min(...cs.map((c) => c.y)) : Math.max(...cs.map((c) => c.y + c.h));
    return new Map(cs.map((c) => [c.id, kind === 'left' ? { x: v } : kind === 'right' ? { x: v - c.w } : kind === 'top' ? { y: v } : { y: v - c.h }]));
  });
  const distribute = (axis: 'x' | 'y') => arrange((cs) => {
    const sorted = [...cs].sort((a, b) => a[axis] - b[axis]);
    const size = axis === 'x' ? 'w' : 'h';
    const first = sorted[0], last = sorted[sorted.length - 1];
    const total = sorted.reduce((s, c) => s + c[size], 0);
    const gap = (last[axis] + last[size] - first[axis] - total) / (sorted.length - 1);
    let pos = first[axis];
    return new Map(sorted.map((c) => { const r: [string, Partial<ControlDef>] = [c.id, { [axis]: Math.round(pos) }]; pos += c[size] + gap; return r; }));
  });
  const sameSize = (dim: 'w' | 'h') => arrange((cs) => { const v = Math.max(...cs.map((c) => c[dim])); return new Map(cs.map((c) => [c.id, { [dim]: v }])); });
  const toGrid = () => updateControls((c) => ({ ...c, x: Math.round(c.x / GRID) * GRID, y: Math.round(c.y / GRID) * GRID, w: Math.max(GRID, Math.round(c.w / GRID) * GRID), h: Math.max(4, Math.round(c.h / GRID) * GRID) }));
  const group = () => { const g = uid('grp'); updateControls((c) => ({ ...c, groupId: g })); };
  const ungroup = () => updateControls((c) => ({ ...c, groupId: undefined }));
  const zOrder = (front: boolean) => { const s = def.controls.filter((c) => sel.includes(c.id)), r = def.controls.filter((c) => !sel.includes(c.id)); update({ controls: front ? [...r, ...s] : [...s, ...r] }); };
  const del = () => { if (!sel.length) return; update({ controls: def.controls.filter((c) => !sel.includes(c.id)) }); setSel([]); };
  const copy = () => { clipboard.controls = JSON.parse(JSON.stringify(selectedControls)); };
  const paste = (offset = GRID * 2) => {
    if (!clipboard.controls.length) return;
    const targetSec = selSection ?? (selectedControls[0]?.section) ?? def.sections.find((s) => s.kind === 'detail')!.id;
    const secExists = (id: string) => def.sections.some((s) => s.id === id);
    const gmap = new Map<string, string>();
    const all = [...def.controls];
    const copies = clipboard.controls.map((c) => {
      const n: ControlDef = { ...JSON.parse(JSON.stringify(c)), id: uid('ctl'), x: c.x + offset, y: c.y + offset, section: secExists(c.section) && !selSection ? c.section : targetSec, name: uniqueName(c.name, all) };
      all.push(n);
      if (c.groupId) { if (!gmap.has(c.groupId)) gmap.set(c.groupId, uid('grp')); n.groupId = gmap.get(c.groupId); }
      return n;
    });
    update({ controls: [...def.controls, ...copies] });
    setSel(copies.map((c) => c.id));
  };
  const duplicate = () => { copy(); paste(); };
  const nudge = (dx: number, dy: number, resize: boolean) => updateControls((c) => (resize ? { ...c, w: Math.max(4, c.w + dx), h: Math.max(4, c.h + dy) } : { ...c, x: Math.max(0, c.x + dx), y: Math.max(0, c.y + dy) }), sel, true);

  const headerSection = () => def.sections.find((s) => s.kind === (mode === 'form' ? 'formHeader' : 'reportHeader'))!;
  const addTitle = () => { const h = headerSection(); const c = addControl('label', h.id, 72, 12); c.w = 360; c.h = 34; c.props = { ...c.props, caption: def.caption || def.name || (mode === 'form' ? 'Form Title' : 'Report Title'), fontSize: 18, fontWeight: 'Bold', foreColor: '#1e3a6e' }; c.name = uniqueName('Title', def.controls); update({ controls: [...def.controls, c], sections: def.sections.map((s) => (s.id === h.id ? { ...s, height: Math.max(s.height, 56), visible: true } : s)) }); setSel([c.id]); };
  const addLogo = async () => { const img = await pickImage(); if (!img) return; const h = headerSection(); const c = addControl('image', h.id, 8, 6); c.w = 56; c.h = 44; c.props.picture = img; c.props.borderStyle = 'Transparent'; c.name = uniqueName('Logo', def.controls); update({ controls: [...def.controls, c], sections: def.sections.map((s) => (s.id === h.id ? { ...s, height: Math.max(s.height, 56) } : s)) }); setSel([c.id]); };
  const addDateTime = () => { const h = headerSection(); const c = addControl('datetime', h.id, Math.max(0, def.width - 216), 16); update({ controls: [...def.controls, c] }); setSel([c.id]); };
  const addPageNumbers = () => { const f = def.sections.find((s) => s.kind === 'pageFooter') ?? def.sections.find((s) => s.kind === 'formFooter'); if (!f) return; const c = addControl('pagenumber', f.id, Math.max(0, def.width - 184), 6); update({ controls: [...def.controls, c] }); setSel([c.id]); };
  const addTotals = (fn: 'Sum' | 'Count' | 'Avg' | 'Max' | 'Min') => {
    if (!report) return;
    const src = selectedControls.find((c) => c.type === 'textbox' && c.props.controlSource && !String(c.props.controlSource).startsWith('='));
    if (!src) { void messageBox('Select a text box bound to a field in the Detail section first (for example the FeePaid text box), then choose Totals.', 'Totals'); return; }
    const field = String(src.props.controlSource);
    let r = report;
    // make sure every group has a footer
    if (r.groups.some((g) => !g.isSort && !g.footer)) r = syncGroupSections({ ...r, groups: r.groups.map((g) => (g.isSort ? g : { ...g, footer: true })) });
    const targets = r.sections.filter((s) => s.kind === 'groupFooter' || s.kind === 'reportFooter');
    const add: ControlDef[] = [];
    const all = [...r.controls];
    for (const t of targets) {
      const c = newControl('textbox', t.id, src.x, 4, all);
      c.w = src.w; c.h = 20; c.props = { ...c.props, controlSource: fn === 'Count' ? '=Count(*)' : `=${fn}([${field}])`, fontWeight: 'Bold', textAlign: 'Right', format: src.props.format, borderStyle: 'Transparent', backStyle: 'Transparent' };
      c.name = uniqueName(`${fn}Of${field}`, all); all.push(c); add.push(c);
    }
    setDef({ ...r, controls: [...r.controls, ...add], sections: r.sections.map((s) => (targets.includes(s) ? { ...s, height: Math.max(s.height, 28) } : s)) } as unknown as T, true);
    setSel(add.map((c) => c.id));
  };
  const addCalc = () => { const d = def.sections.find((s) => s.kind === 'detail')!; const c = addControl('textbox', d.id, 8, Math.max(0, d.height - 26)); c.props.controlSource = '=[Field1] * [Field2]'; c.name = uniqueName('Calc', def.controls); update({ controls: [...def.controls, c], sections: def.sections.map((s) => (s.id === d.id ? { ...s, height: s.height + (d.height < 30 ? 26 : 0) } : s)) }); setSel([c.id]); setShowProps(true); };
  const tabOrder = async () => {
    const detail = def.sections.find((s) => s.kind === 'detail')!;
    const stops = def.controls.filter((c) => c.section === detail.id && ['textbox', 'combobox', 'listbox', 'checkbox', 'option', 'toggle', 'button', 'datepicker'].includes(c.type)).sort((a, b) => Number(a.props.tabIndex ?? 0) - Number(b.props.tabIndex ?? 0));
    const res = await openDialog<string[]>('Tab Order', (close) => <TabOrderDialog items={stops} close={close} />, 360);
    if (res) update({ controls: def.controls.map((c) => { const i = res.indexOf(c.id); return i >= 0 ? { ...c, props: { ...c.props, tabIndex: i } } : c; }) });
  };
  const setPage = (patch: Partial<ReportDef['page']>) => { if (report) setDef({ ...report, page: { ...report.page, ...patch }, width: Math.min(report.width, (patch.orientation ?? report.page.orientation) === 'Landscape' ? 1123 - 2 * (patch.margin ?? report.page.margin) : 794 - 2 * (patch.margin ?? report.page.margin)) } as unknown as T, true); };

  // ---- Themes, Colors and Fonts (apply to the whole object) ----
  const applyPalette = (name: string, withFont: boolean) => {
    const th = THEMES[name]; if (!th) return;
    update({
      sections: defRef.current.sections.map((s) => ({ ...s, backColor: s.kind === 'detail' ? th.detail : (s.kind === 'pageHeader' || s.kind === 'groupHeader') ? th.band : th.header })),
      controls: defRef.current.controls.map((c) => {
        const pr = { ...c.props };
        const inHeader = defRef.current.sections.find((s) => s.id === c.section)?.kind;
        if (c.type === 'label') pr.foreColor = inHeader === 'formHeader' || inHeader === 'reportHeader' ? th.title : th.label;
        else if (c.type === 'button' || c.type === 'toggle') { pr.backColor = th.accent; pr.foreColor = '#ffffff'; pr.borderColor = th.accent; }
        else if (c.type === 'line' || c.type === 'rectangle') pr.borderColor = th.accent;
        else if (c.type !== 'image') pr.borderColor = th.border;
        if (withFont && c.type !== 'image' && c.type !== 'line' && c.type !== 'rectangle') pr.fontName = th.font;
        return { ...c, props: pr };
      }),
    });
  };
  const applyFont = (font: string) => update({ controls: defRef.current.controls.map((c) => (['image', 'line', 'rectangle', 'subform'].includes(c.type) ? c : { ...c, props: { ...c.props, fontName: font } })) });
  const insertImage = async () => {
    const img = await pickImage(); if (!img) return;
    const target = selSection ?? def.sections.find((s) => s.kind === 'detail')!.id;
    const c = addControl('image', target, 16, 8); c.w = 120; c.h = 90; c.props.picture = img; c.name = uniqueName('Image', def.controls);
    update({ controls: [...def.controls, c], sections: def.sections.map((s) => (s.id === target ? { ...s, height: Math.max(s.height, 104) } : s)) }); setSel([c.id]);
  };
  const sizeTo = (how: 'tallest' | 'shortest' | 'widest' | 'narrowest') => {
    const pick = (vals: number[]) => (how === 'tallest' || how === 'widest' ? Math.max(...vals) : Math.min(...vals));
    if (how === 'tallest' || how === 'shortest') { const h = pick(selectedControls.map((c) => c.h)); updateControls((c) => ({ ...c, h })); }
    else { const w = pick(selectedControls.map((c) => c.w)); updateControls((c) => ({ ...c, w })); }
  };
  // ---- Format tab: one value across the selection ----
  const textual = selectedControls.filter((c) => !['image', 'line', 'subform'].includes(c.type));
  const common = (k: string): string => { const vals = [...new Set(textual.map((c) => String(c.props[k] ?? '')))]; return vals.length === 1 ? vals[0] : ''; };
  const setProp = (k: string, v: string | number | boolean) => updateControls((c) => (['image', 'line', 'subform'].includes(c.type) && !['borderColor', 'borderStyle', 'backColor'].includes(k) ? c : { ...c, props: { ...c.props, [k]: v } }));
  const toggleProp = (k: string, on: string | boolean, off: string | boolean) => { const allOn = textual.length > 0 && textual.every((c) => c.props[k] === on); setProp(k, allOn ? off : on); };
  const fmtTarget = textual.length > 0;
  const objNames = def.controls.map((c) => c.name).sort((a, b) => a.localeCompare(b));

  const many = selectedControls.length >= 2;
  const any = sel.length > 0;
  const toolCmds: Record<string, { run: () => void; checked: boolean }> = {};
  for (const t of (mode === 'form' ? FORM_TOOLBOX : REPORT_TOOLBOX)) toolCmds[`fd.tool.${t}`] = { run: () => setTool(tool === t ? null : t), checked: tool === t };
  useEditorCommands(props.tabId, props.active, {
    ...toolCmds,
    'fd.fieldList': { run: () => setShowFields(!showFields), checked: showFields },
    'fd.propertySheet': { run: () => setShowProps(!showProps), checked: showProps },
    'fd.grid': { run: () => setShowGrid(!showGrid), checked: showGrid },
    'fd.snap': { run: () => setSnap(!snap), checked: snap },
    'fd.save': props.save,
    'fd.alignLeft': { run: () => alignCmd('left'), enabled: many }, 'fd.alignRight': { run: () => alignCmd('right'), enabled: many },
    'fd.alignTop': { run: () => alignCmd('top'), enabled: many }, 'fd.alignBottom': { run: () => alignCmd('bottom'), enabled: many },
    'fd.distH': { run: () => distribute('x'), enabled: selectedControls.length >= 3 }, 'fd.distV': { run: () => distribute('y'), enabled: selectedControls.length >= 3 },
    'fd.sameWidth': { run: () => sameSize('w'), enabled: many }, 'fd.sameHeight': { run: () => sameSize('h'), enabled: many },
    'fd.toGrid': { run: toGrid, enabled: any },
    'fd.group': { run: group, enabled: many }, 'fd.ungroup': { run: ungroup, enabled: selectedControls.some((c) => c.groupId) },
    'fd.front': { run: () => zOrder(true), enabled: any }, 'fd.back': { run: () => zOrder(false), enabled: any },
    'fd.duplicate': { run: duplicate, enabled: any }, 'fd.delete': { run: del, enabled: any },
    'fd.title': addTitle, 'fd.logo': () => void addLogo(), 'fd.dateTime': addDateTime,
    ...Object.fromEntries(Object.keys(THEMES).flatMap((k) => [[`fd.theme.${k}`, () => applyPalette(k, true)], [`fd.colors.${k}`, () => applyPalette(k, false)]])),
    ...Object.fromEntries(['Segoe UI', 'Calibri', 'Arial', 'Times New Roman', 'Georgia'].map((f) => [`fd.fonts.${f}`, () => applyFont(f)])),
    'fd.insertImage': () => void insertImage(),
    ...Object.fromEntries([0, 2, 5, 9].map((n) => [`fd.padding.${n}`, { run: () => setProp('padding', n), enabled: any, checked: any && selectedControls.every((c) => Number(c.props.padding ?? -1) === n) }])),
    'fd.size.tallest': { run: () => sizeTo('tallest'), enabled: many }, 'fd.size.shortest': { run: () => sizeTo('shortest'), enabled: many },
    'fd.size.widest': { run: () => sizeTo('widest'), enabled: many }, 'fd.size.narrowest': { run: () => sizeTo('narrowest'), enabled: many },
    'fd.selectAll': { run: () => { setSel(def.controls.map((c) => c.id)); setSelSection(null); }, enabled: def.controls.length > 0 },
    'fmt.select': { run: () => undefined, value: sel.length === 1 ? selectedControls[0]?.name ?? '' : '', label: objNames.join('\n'), set: (v: string) => { const c = def.controls.find((x) => x.name === v); if (c) { setSel([c.id]); setSelSection(null); } }, enabled: def.controls.length > 0 },
    'fmt.fontName': { run: () => undefined, value: common('fontName') || (fmtTarget ? 'Segoe UI' : ''), set: (v: string) => setProp('fontName', v), enabled: fmtTarget },
    'fmt.fontSize': { run: () => undefined, value: common('fontSize') || (fmtTarget && textual.every((c) => c.props.fontSize === undefined) ? '10' : ''), set: (v: string) => setProp('fontSize', Number(v)), enabled: fmtTarget },
    'fmt.bold': { run: () => toggleProp('fontWeight', 'Bold', 'Normal'), checked: fmtTarget && textual.every((c) => c.props.fontWeight === 'Bold'), enabled: fmtTarget },
    'fmt.italic': { run: () => toggleProp('italic', true, false), checked: fmtTarget && textual.every((c) => c.props.italic === true), enabled: fmtTarget },
    'fmt.underline': { run: () => toggleProp('underline', true, false), checked: fmtTarget && textual.every((c) => c.props.underline === true), enabled: fmtTarget },
    'fmt.foreColor': { run: () => undefined, value: common('foreColor'), set: (v: string) => setProp('foreColor', v), enabled: fmtTarget },
    'fmt.alignL': { run: () => setProp('textAlign', 'Left'), checked: fmtTarget && common('textAlign') === 'Left', enabled: fmtTarget },
    'fmt.alignC': { run: () => setProp('textAlign', 'Center'), checked: fmtTarget && common('textAlign') === 'Center', enabled: fmtTarget },
    'fmt.alignR': { run: () => setProp('textAlign', 'Right'), checked: fmtTarget && common('textAlign') === 'Right', enabled: fmtTarget },
    'fmt.format': { run: () => undefined, value: common('format'), set: (v: string) => setProp('format', v), enabled: fmtTarget },
    'fmt.currency': { run: () => setProp('format', 'Currency'), checked: fmtTarget && common('format') === 'Currency', enabled: fmtTarget },
    'fmt.percent': { run: () => setProp('format', 'Percent'), checked: fmtTarget && common('format') === 'Percent', enabled: fmtTarget },
    'fmt.comma': { run: () => setProp('format', 'Standard'), checked: fmtTarget && common('format') === 'Standard', enabled: fmtTarget },
    'fmt.backColor': { run: () => undefined, value: [...new Set(selectedControls.map((c) => String(c.props.backColor ?? '')))].length === 1 ? String(selectedControls[0]?.props.backColor ?? '') : '', set: (v: string) => updateControls((c) => ({ ...c, props: { ...c.props, backColor: v, backStyle: 'Normal' } })), enabled: any },
    'fmt.transparent': { run: () => updateControls((c) => ({ ...c, props: { ...c.props, backStyle: 'Transparent' } })), checked: any && selectedControls.every((c) => c.props.backStyle === 'Transparent'), enabled: any },
    'fmt.borderColor': { run: () => undefined, value: [...new Set(selectedControls.map((c) => String(c.props.borderColor ?? '')))].length === 1 ? String(selectedControls[0]?.props.borderColor ?? '') : '', set: (v: string) => updateControls((c) => ({ ...c, props: { ...c.props, borderColor: v, borderStyle: c.props.borderStyle === 'Transparent' ? 'Solid' : c.props.borderStyle } })), enabled: any },
    'fmt.borderStyle': { run: () => undefined, value: [...new Set(selectedControls.map((c) => String(c.props.borderStyle ?? '')))].length === 1 ? String(selectedControls[0]?.props.borderStyle ?? '') : '', set: (v: string) => updateControls((c) => ({ ...c, props: { ...c.props, borderStyle: v } })), enabled: any },

    ...(mode === 'form' ? { 'fd.tabOrder': () => void tabOrder() } : {}),
    ...(report ? {
      'rd.groupSort': { run: () => setShowGroupPane(!showGroupPane), checked: showGroupPane },
      'rd.totalSum': () => addTotals('Sum'), 'rd.totalCount': () => addTotals('Count'), 'rd.totalAvg': () => addTotals('Avg'), 'rd.totalMax': () => addTotals('Max'), 'rd.totalMin': () => addTotals('Min'),
      'rd.hideDetails': { run: () => update({ sections: def.sections.map((s) => (s.kind === 'detail' ? { ...s, visible: s.visible === false } : s)) }), checked: def.sections.some((s) => s.kind === 'detail' && s.visible === false) },
      'rd.pageNumbers': addPageNumbers, 'rd.calc': addCalc,
      'rd.size.A4': { run: () => setPage({ size: 'A4' }), checked: report.page.size === 'A4' }, 'rd.size.Letter': { run: () => setPage({ size: 'Letter' }), checked: report.page.size === 'Letter' },
      'rd.orient.Portrait': { run: () => setPage({ orientation: 'Portrait' }), checked: report.page.orientation === 'Portrait' }, 'rd.orient.Landscape': { run: () => setPage({ orientation: 'Landscape' }), checked: report.page.orientation === 'Landscape' },
      'rd.margin.24': { run: () => setPage({ margin: 24 }), checked: report.page.margin === 24 }, 'rd.margin.48': { run: () => setPage({ margin: 48 }), checked: report.page.margin === 48 }, 'rd.margin.96': { run: () => setPage({ margin: 96 }), checked: report.page.margin === 96 },
    } : {}),
    'home.copy': { run: copy, enabled: any }, 'home.cut': { run: () => { copy(); del(); }, enabled: any }, 'home.paste': { run: () => paste(), enabled: clipboard.controls.length > 0 },
    'home.deleteRecord': { run: del, enabled: any, label: 'Delete control' },
    undo: { run: props.undo, enabled: props.canUndo }, redo: { run: props.redo, enabled: props.canRedo },
  }, 'canvas');

  const onKeyDown = (e: React.KeyboardEvent) => {
    const t = e.target as HTMLElement;
    if (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA') return;
    const ctrl = e.ctrlKey || e.metaKey;
    const step = ctrl ? GRID : 1;
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); del(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); nudge(-step, 0, e.shiftKey); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); nudge(step, 0, e.shiftKey); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); nudge(0, -step, e.shiftKey); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); nudge(0, step, e.shiftKey); }
    else if (ctrl && e.key.toLowerCase() === 'c') { e.preventDefault(); copy(); }
    else if (ctrl && e.key.toLowerCase() === 'x') { e.preventDefault(); copy(); del(); }
    else if (ctrl && e.key.toLowerCase() === 'v') { e.preventDefault(); paste(); }
    else if (ctrl && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicate(); }
    else if (ctrl && e.key.toLowerCase() === 'a') { e.preventDefault(); setSel(def.controls.map((c) => c.id)); }
    else if (ctrl && e.key.toLowerCase() === 'z') { e.preventDefault(); props.undo(); }
    else if (ctrl && e.key.toLowerCase() === 'y') { e.preventDefault(); props.redo(); }
    else if (e.key === 'Escape') { setSel([]); setTool(null); }
  };

  const ctlMenu = (e: React.MouseEvent, c: ControlDef) => {
    if (!sel.includes(c.id)) setSel(expandGroups([c.id]));
    showContextMenu(e, [
      { label: 'Cut', onClick: () => { copy(); del(); } }, { label: 'Copy', onClick: copy }, { label: 'Paste', onClick: () => paste(), disabled: !clipboard.controls.length }, { label: 'Duplicate', onClick: duplicate }, { label: 'Delete', onClick: del },
      { separator: true }, { label: 'Align Left', onClick: () => alignCmd('left'), disabled: !many }, { label: 'Align Top', onClick: () => alignCmd('top'), disabled: !many }, { label: 'Same Width', onClick: () => sameSize('w'), disabled: !many },
      { separator: true }, { label: 'Group', onClick: group, disabled: !many }, { label: 'Ungroup', onClick: ungroup, disabled: !selectedControls.some((x) => x.groupId) },
      { label: 'Bring to Front', onClick: () => zOrder(true) }, { label: 'Send to Back', onClick: () => zOrder(false) },
      { separator: true }, { label: 'Properties', onClick: () => setShowProps(true) },
    ]);
  };

  // drag sources (toolbox / field list) → drop on section
  const onSectionDrop = (e: React.DragEvent, s: SectionDef) => {
    setDropSec(null);
    const r = sectionTop(s.id)!;
    const x = e.clientX - r.left, y = e.clientY - r.top;
    const tt = e.dataTransfer.getData('application/x-wowdb-tool');
    const ff = e.dataTransfer.getData('application/x-wowdb-dfield');
    if (tt) { e.preventDefault(); void placeTool(tt as ControlType, s.id, x, y); }
    else if (ff) { e.preventDefault(); addFieldControls(ff, s.id, x, y); }
  };

  return (
    <div className="fd" tabIndex={-1} onKeyDown={onKeyDown} style={{ outline: 'none' }}>
      <div className="toolbox-strip" aria-label="Controls toolbox">
        <div className="tb-title">Controls</div>
        <div className={'tb-item' + (tool === null ? ' on' : '')} onClick={() => setTool(null)}><I.MousePointer2 size={15} />Select</div>
        {(mode === 'form' ? FORM_TOOLBOX : REPORT_TOOLBOX).map((t) => {
          const Ico = TOOL_ICONS[t];
          return <div key={t} className={'tb-item' + (tool === t ? ' on' : '')} draggable data-tool={t} title="Drag onto the form, or click then draw on a section"
            onDragStart={(e) => { e.dataTransfer.setData('application/x-wowdb-tool', t); e.dataTransfer.effectAllowed = 'copy'; }}
            onClick={() => setTool(tool === t ? null : t)}><Ico size={15} />{CONTROL_LABELS[t]}</div>;
        })}
        {report && <><div className="tb-title" style={{ marginTop: 6 }}>Grouping</div>
          <div className="tb-item" onClick={() => setShowGroupPane(true)}><I.ListTree size={15} />Group Header</div>
          <div className="tb-item" onClick={() => setShowGroupPane(true)}><I.ListTree size={15} />Group Footer</div></>}
      </div>
      <div className="fd-center">
        <div className="fd-scroll" onPointerDown={(e) => { if (e.target === e.currentTarget) { setSel([]); setSelSection(null); } }}>
          <div className="ruler-h" style={{ width: def.width + 40 }}>
            <svg width={def.width + 40} height={18}>{Array.from({ length: Math.ceil((def.width + 40) / 8) }, (_, i) => <line key={i} x1={i * 8} x2={i * 8} y1={i % 12 === 0 ? 4 : i % 6 === 0 ? 10 : 14} y2={18} stroke="#999" strokeWidth={0.6} />)}{Array.from({ length: Math.ceil((def.width + 40) / 96) }, (_, i) => <text key={i} x={i * 96 + 2} y={10} fontSize={9} fill="#666">{i}</text>)}</svg>
          </div>
          <div ref={surfaceRef} className="fd-surface" style={{ width: def.width, marginLeft: 18 }} data-testid={`${mode}-design-surface`}>
            {visibleSections.map((s) => (
              <div key={s.id}>
                <div className={'sec-bar' + (selSection === s.id ? ' is-sel' : '')} onClick={() => { setSel([]); setSelSection(s.id); }} style={{ width: def.width }}>
                  <span className="ruler-v-cap" aria-hidden />
                  <I.ChevronDown size={12} /> {s.name}{s.visible === false ? ' (hidden)' : ''}
                </div>
                <div className="sec-wrap"><VRuler height={s.height} />
                <div className={'sec-body' + (showGrid ? ' grid' : '') + (dropSec === s.id ? ' drop-hover' : '')} data-sec={s.id} style={{ height: s.height, width: def.width, backgroundColor: s.backColor ?? '#fff', backgroundImage: showGrid ? undefined : 'none', cursor: tool ? 'crosshair' : 'default' }}
                  onPointerDown={(e) => onSectionPointerDown(e, s)}
                  onDragOver={(e) => { if (e.dataTransfer.types.includes('application/x-wowdb-tool') || e.dataTransfer.types.includes('application/x-wowdb-dfield')) { e.preventDefault(); setDropSec(s.id); } }}
                  onDragLeave={() => setDropSec(null)} onDrop={(e) => onSectionDrop(e, s)}>
                  {def.controls.filter((c) => c.section === s.id).map((c) => (
                    <div key={c.id} className={'ctl' + (sel.includes(c.id) ? ' is-sel' : '')} data-ctl={c.name} style={{ left: c.x, top: c.y, width: c.w, height: c.h, ...ctlStyle(c) }}
                      onPointerDown={(e) => onControlPointerDown(e, c)} onContextMenu={(e) => ctlMenu(e, c)} title={`${c.name} (${CONTROL_LABELS[c.type]})`}>
                      <div className="ctl-inner" style={{ justifyContent: align(c) }}>{ctlPreview(c, p)}</div>
                      {sel.includes(c.id) && sel.length === 1 && ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].map((h) => <div key={h} className={`h ${h}`} onPointerDown={(e) => onControlPointerDown(e, c, h)} />)}
                      {sel.includes(c.id) && sel.length > 1 && <div className="h mv" />}
                    </div>
                  ))}
                  {guides && guides.section === s.id && <>{guides.v.map((x, i) => <div key={'v' + i} className="guide-v" style={{ left: x }} />)}{guides.h.map((y, i) => <div key={'h' + i} className="guide-h" style={{ top: y }} />)}</>}
                  {marquee && marquee.section === s.id && <div className="marquee" style={{ left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h }} />}
                </div>
                </div>
                <div className="sec-resize" style={{ width: def.width }} onPointerDown={(e) => startSectionResize(e, s)} title="Drag to change the section height" />
              </div>
            ))}
            <div className="width-handle" style={{ left: def.width - 2 }} onPointerDown={startWidthResize} title="Drag to change the width" />
          </div>
        </div>
        {report && showGroupPane && <GroupPane def={report} fields={fields} onChange={(r) => setDef(syncGroupSections(r) as unknown as T, true)} />}
      </div>
      {showFields && (
        <div className="fieldlist" aria-label="Field List">
          <div className="ps-head">Field List</div>
          <div className="ps-sub">{def.recordSource ? <>Fields available in <b>{def.recordSource}</b>. Drag onto a section or double-click.</> : 'Set the Record Source in the Property Sheet first.'}</div>
          <div style={{ overflow: 'auto', flex: 1 }}>
            {fields.map((f) => (
              <div key={f} className="fl-item" draggable onDragStart={(e) => { e.dataTransfer.setData('application/x-wowdb-dfield', f); e.dataTransfer.effectAllowed = 'copy'; }}
                onDoubleClick={() => { const d = def.sections.find((s) => s.kind === 'detail')!; const y = Math.max(8, ...def.controls.filter((c) => c.section === d.id).map((c) => c.y + c.h + 8)); addFieldControls(f, d.id, mode === 'report' ? Math.max(0, ...def.controls.filter((c) => c.section === d.id).map((c) => c.x + c.w + 8), 0) : 16, mode === 'report' ? 2 : y); }}>
                {fieldDefs.find((x) => x.name === f)?.primaryKey ? <I.KeyRound size={12} color="#b8860b" /> : <I.Columns3 size={12} color="#888" />}{f}
              </div>
            ))}
          </div>
        </div>
      )}
      {showProps && <PropertySheet p={p} mode={mode} def={def} sel={selectedControls} section={def.sections.find((s) => s.id === selSection) ?? null}
        onSelect={(id) => { if (id === '__obj') { setSel([]); setSelSection(null); } else if (def.sections.some((s) => s.id === id)) { setSel([]); setSelSection(id); } else { setSel([id]); setSelSection(null); } }}
        onControl={(id, patch) => update({ controls: def.controls.map((c) => (c.id === id ? { ...c, ...patch, props: { ...c.props, ...(patch.props ?? {}) } } : c)) }, true)}
        onSection={(id, patch) => update({ sections: def.sections.map((s) => (s.id === id ? { ...s, ...patch } : s)) }, true)}
        onObject={(patch) => setDef({ ...def, ...patch } as T, true)} />}
    </div>
  );
}

function uniqueName(base: string, all: ControlDef[]) {
  const names = new Set(all.map((c) => c.name.toLowerCase()));
  if (!names.has(base.toLowerCase())) return base;
  let i = 1; while (names.has(`${base}${i}`.toLowerCase())) i++;
  return `${base}${i}`;
}
function align(c: ControlDef) { const a = String(c.props.textAlign ?? 'Left'); return a === 'Center' ? 'center' : a === 'Right' ? 'flex-end' : 'flex-start'; }

export function ctlStyle(c: ControlDef): React.CSSProperties {
  const pr = c.props;
  const border = pr.borderStyle && pr.borderStyle !== 'Transparent' ? `${pr.borderWidth ?? 1}px ${pr.borderStyle === 'Dashes' ? 'dashed' : pr.borderStyle === 'Dots' ? 'dotted' : 'solid'} ${pr.borderColor ?? '#808080'}` : undefined;
  const st: React.CSSProperties = {
    fontFamily: pr.fontName ? `'${pr.fontName}', 'Segoe UI', sans-serif` : undefined, fontSize: pr.fontSize ? `${pr.fontSize}pt` : undefined,
    fontWeight: pr.fontWeight === 'Bold' ? 700 : pr.fontWeight === 'Semi-bold' ? 600 : 400, fontStyle: pr.italic ? 'italic' : undefined, textDecoration: pr.underline ? 'underline' : undefined,
    color: pr.foreColor as string | undefined, background: pr.backStyle === 'Transparent' ? 'transparent' : (pr.backColor as string | undefined),
    border, padding: pr.padding !== undefined ? Number(pr.padding) : c.type === 'line' ? 0 : '0 3px', opacity: pr.visible === false ? 0.45 : 1,
  };
  if (c.type === 'line') { st.border = 'none'; st.background = 'transparent'; }
  if (c.type === 'rectangle') st.background = pr.backStyle === 'Transparent' ? 'transparent' : (pr.backColor as string);
  return st;
}

function ctlPreview(c: ControlDef, p: WowProject): React.ReactNode {
  const pr = c.props;
  switch (c.type) {
    case 'label': return String(pr.caption ?? '');
    case 'textbox': case 'datepicker': return <span style={{ color: '#333' }}>{String(pr.controlSource || 'Unbound')}</span>;
    case 'combobox': return <><span style={{ flex: 1 }}>{String(pr.controlSource || 'Unbound')}</span><I.ChevronDown size={12} /></>;
    case 'listbox': return <span style={{ alignSelf: 'flex-start' }}>{String(pr.controlSource || 'Unbound')} ▤</span>;
    case 'checkbox': return <span style={{ width: 13, height: 13, border: '1px solid #555', background: '#fff', display: 'inline-block', margin: 'auto' }} />;
    case 'option': return <span style={{ width: 13, height: 13, border: '1px solid #555', borderRadius: '50%', background: '#fff', display: 'inline-block', margin: 'auto' }} />;
    case 'toggle': case 'button': return <span style={{ width: '100%', textAlign: 'center' }}>{String(pr.caption ?? '')}</span>;
    case 'image': return pr.picture ? <img src={String(pr.picture)} alt="" style={{ width: '100%', height: '100%', objectFit: pr.sizeMode === 'Stretch' ? 'fill' : pr.sizeMode === 'Clip' ? 'none' : 'contain' }} /> : <span className="muted" style={{ margin: 'auto', fontSize: 11 }}>{pr.controlSource ? `[${pr.controlSource}]` : 'Image'}</span>;
    case 'line': return <svg width="100%" height="100%" style={{ overflow: 'visible' }}>{c.w >= c.h ? <line x1={0} y1="50%" x2="100%" y2="50%" stroke={String(pr.borderColor ?? '#000')} strokeWidth={Number(pr.borderWidth ?? 1)} /> : <line x1="50%" y1={0} x2="50%" y2="100%" stroke={String(pr.borderColor ?? '#000')} strokeWidth={Number(pr.borderWidth ?? 1)} />}</svg>;
    case 'rectangle': return null;
    case 'subform': { const so = String(pr.sourceObject ?? ''); return <span className="muted" style={{ margin: 'auto', textAlign: 'center', whiteSpace: 'normal' }}>{so ? `Subform: ${so}` : 'Subform (set Source Object)'}{so && !p.getForm(so) && !p.getTable(so) && !p.getQuery(so) && !p.getReport(so) ? ' ⚠' : ''}</span>; }
    case 'navigation': return <span className="muted" style={{ alignSelf: 'flex-start', padding: 4 }}>{String(pr.navTargets || 'Navigation: add targets').split(/\n|;/).filter(Boolean).map((t) => `[ ${t.replace(/^(form|report):/i, '')} ]`).join(' ')}</span>;
    case 'pagenumber': return '="Page " & [Page] & " of " & [Pages]';
    case 'datetime': return '=Date()';
  }
}

// ---------------- Property Sheet ----------------
function PropertySheet({ p, mode, def, sel, section, onSelect, onControl, onSection, onObject }: {
  p: WowProject; mode: 'form' | 'report'; def: Def; sel: ControlDef[]; section: SectionDef | null;
  onSelect: (id: string) => void; onControl: (id: string, patch: Partial<ControlDef>) => void; onSection: (id: string, patch: Partial<SectionDef>) => void; onObject: (patch: Partial<Def>) => void;
}) {
  const [cat, setCat] = useState<'Format' | 'Data' | 'Event' | 'Other' | 'All'>('All');
  const c = sel.length === 1 ? sel[0] : null;
  const sources = [...p.tableNames(), ...p.listObjects('query').map((o) => o.name)];
  const fields = def.recordSource ? p.columnsOf(def.recordSource) : [];
  const objName = mode === 'form' ? 'Form' : 'Report';
  const curId = c ? c.id : section ? section.id : '__obj';
  return (
    <div className="ps" aria-label="Property Sheet" data-testid="property-sheet">
      <div className="ps-head">Property Sheet</div>
      <div className="ps-sub">Selection type: {c ? CONTROL_LABELS[c.type] : sel.length > 1 ? `${sel.length} controls` : section ? 'Section' : objName}</div>
      <select className="sel ps-sel" value={curId} onChange={(e) => onSelect(e.target.value)} aria-label="Object">
        <option value="__obj">{objName}</option>
        {def.sections.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        {def.controls.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
      </select>
      <div className="tabs-mini">{(['Format', 'Data', 'Event', 'Other', 'All'] as const).map((k) => <button key={k} className={cat === k ? 'on' : ''} onClick={() => setCat(k)}>{k}</button>)}</div>
      <div className="prop-table">
        {c ? propsFor(c.type).filter((s) => cat === 'All' || s.cat === cat).map((s) => <PropEditor key={s.key} spec={s} c={c} p={p} fields={fields} onChange={(patch) => onControl(c.id, patch)} />)
          : sel.length > 1 ? <MultiProps sel={sel} cat={cat} onChange={(patch) => sel.forEach((x) => onControl(x.id, { props: patch }))} />
            : section ? <SectionProps s={section} mode={mode} cat={cat} onChange={(patch) => onSection(section.id, patch)} />
              : <ObjectProps def={def} mode={mode} cat={cat} sources={sources} onChange={onObject} />}
      </div>
    </div>
  );
}

function Row({ label, children, help }: { label: string; children: React.ReactNode; help?: string }) {
  return <div className="prop-row" title={help}><label>{label}</label><div>{children}</div></div>;
}

function PropEditor({ spec, c, p, fields, onChange }: { spec: PropSpec; c: ControlDef; p: WowProject; fields: string[]; onChange: (patch: Partial<ControlDef>) => void }) {
  const geo = ['x', 'y', 'w', 'h', 'name'].includes(spec.key);
  const val = geo ? (c as unknown as Record<string, unknown>)[spec.key] : c.props[spec.key];
  const set = (v: unknown) => onChange(geo ? ({ [spec.key]: spec.key === 'name' ? String(v) : Math.max(spec.key === 'x' || spec.key === 'y' ? 0 : 2, Number(v) || 0) } as Partial<ControlDef>) : { props: { [spec.key]: v as string } });
  let input: React.ReactNode;
  switch (spec.kind) {
    case 'bool': input = <select value={val === false ? 'No' : val === undefined && ['visible', 'enabled', 'tabStop'].includes(spec.key) ? 'Yes' : val ? 'Yes' : 'No'} onChange={(e) => set(e.target.value === 'Yes')}><option>Yes</option><option>No</option></select>; break;
    case 'select': input = <select value={String(val ?? '')} onChange={(e) => set(/^\d+$/.test(e.target.value) && spec.key !== 'decimalPlaces' ? Number(e.target.value) : e.target.value)}>{(spec.options ?? []).map((o) => <option key={o} value={o}>{o || '(none)'}</option>)}{val !== undefined && !(spec.options ?? []).includes(String(val)) && <option value={String(val)}>{String(val)}</option>}</select>; break;
    case 'color': input = <><input type="color" value={/^#[0-9a-f]{6}$/i.test(String(val ?? '')) ? String(val) : '#ffffff'} onChange={(e) => set(e.target.value)} /><input value={String(val ?? '')} onChange={(e) => set(e.target.value)} /></>; break;
    case 'number': input = <input type="number" value={Number(val ?? 0)} onChange={(e) => set(e.target.value)} />; break;
    case 'field': input = <><input list={`flds-${c.id}`} value={String(val ?? '')} onChange={(e) => set(e.target.value)} placeholder="Field or =expression" /><datalist id={`flds-${c.id}`}>{fields.map((f) => <option key={f} value={f} />)}</datalist></>; break;
    case 'source': input = c.props.rowSourceType === 'Value List' ? <input value={String(val ?? '')} onChange={(e) => set(e.target.value)} placeholder="A;B;C" /> : <select value={String(val ?? '')} onChange={(e) => { const src = e.target.value; const t = p.getTable(src); const pk = t?.fields.find((f) => f.primaryKey)?.name ?? ''; const disp = t?.fields.find((f) => f.type === 'Short Text')?.name ?? pk; onChange({ props: { rowSource: src, boundField: String(c.props.boundField || pk), displayField: String(c.props.displayField || disp) } }); }}><option value="" />{[...p.tableNames(), ...p.listObjects('query').map((o) => o.name)].map((s) => <option key={s}>{s}</option>)}</select>; break;
    case 'object': input = <select value={String(val ?? '')} onChange={(e) => set(e.target.value)}><option value="" />{p.listObjects('form').map((o) => <option key={'f' + o.name} value={o.name}>Form.{o.name}</option>)}{p.tableNames().map((n) => <option key={'t' + n} value={n}>Table.{n}</option>)}{p.listObjects('query').map((o) => <option key={'q' + o.name} value={o.name}>Query.{o.name}</option>)}</select>; break;
    case 'image': input = <><span className="ro" style={{ flex: 1 }}>{val ? '(image)' : '(none)'}</span><button className="btn btn-sm" onClick={async () => { const img = await pickImage(); if (img) set(img); }}>…</button>{!!val && <button className="btn btn-sm" onClick={() => set('')}>×</button>}</>; break;
    case 'longtext': input = <textarea rows={3} value={String(val ?? '')} onChange={(e) => set(e.target.value)} style={{ height: 60 }} placeholder="form:frmStudents&#10;report:rptFees" />; break;
    default: input = <input value={String(val ?? '')} onChange={(e) => set(e.target.value)} />;
  }
  return <Row label={spec.label} help={spec.help}>{input}</Row>;
}

function MultiProps({ sel, cat, onChange }: { sel: ControlDef[]; cat: string; onChange: (patch: ControlDef['props']) => void }) {
  const common = ['fontName', 'fontSize', 'fontWeight', 'foreColor', 'backColor', 'textAlign', 'borderStyle', 'borderColor'];
  const specs = propsFor(sel[0].type).filter((s) => common.includes(s.key) && (cat === 'All' || s.cat === cat));
  const fake: ControlDef = { ...sel[0], props: Object.fromEntries(common.map((k) => [k, sel.every((x) => x.props[k] === sel[0].props[k]) ? sel[0].props[k] : undefined])) };
  return <>{specs.map((s) => <PropEditor key={s.key} spec={s} c={fake} p={null as unknown as WowProject} fields={[]} onChange={(patch) => onChange(patch.props ?? {})} />)}<div className="muted small" style={{ padding: 6 }}>Changes apply to all {sel.length} selected controls.</div></>;
}

function SectionProps({ s, mode, cat, onChange }: { s: SectionDef; mode: 'form' | 'report'; cat: string; onChange: (p: Partial<SectionDef>) => void }) {
  const show = (c: string) => cat === 'All' || cat === c;
  return (
    <>
      {show('Other') && <Row label="Name"><span className="ro">{s.name}</span></Row>}
      {show('Format') && <Row label="Height"><input type="number" value={s.height} onChange={(e) => onChange({ height: Math.max(0, Number(e.target.value) || 0) })} /></Row>}
      {show('Format') && <Row label="Back Color"><input type="color" value={s.backColor ?? '#ffffff'} onChange={(e) => onChange({ backColor: e.target.value })} /><input value={s.backColor ?? ''} onChange={(e) => onChange({ backColor: e.target.value })} /></Row>}
      {show('Format') && <Row label="Visible"><select value={s.visible === false ? 'No' : 'Yes'} onChange={(e) => onChange({ visible: e.target.value === 'Yes' })}><option>Yes</option><option>No</option></select></Row>}
      {mode === 'report' && show('Format') && <Row label="Force New Page"><select value={s.forceNewPage ?? 'None'} onChange={(e) => onChange({ forceNewPage: e.target.value as SectionDef['forceNewPage'] })}><option>None</option><option>Before Section</option><option>After Section</option></select></Row>}
      {mode === 'report' && show('Format') && <Row label="Keep Together"><select value={s.keepTogether === false ? 'No' : 'Yes'} onChange={(e) => onChange({ keepTogether: e.target.value === 'Yes' })}><option>Yes</option><option>No</option></select></Row>}
    </>
  );
}

function ObjectProps({ def, mode, cat, sources, onChange }: { def: Def; mode: 'form' | 'report'; cat: string; sources: string[]; onChange: (p: Partial<Def>) => void }) {
  const show = (c: string) => cat === 'All' || cat === c;
  const f = mode === 'form' ? (def as FormDef) : null;
  const r = mode === 'report' ? (def as ReportDef) : null;
  return (
    <>
      {show('Data') && <Row label="Record Source" help="The table or query that supplies the records"><select value={def.recordSource} onChange={(e) => onChange({ recordSource: e.target.value })} aria-label="Record Source"><option value="">(none - unbound)</option>{sources.map((s) => <option key={s}>{s}</option>)}</select></Row>}
      {show('Format') && <Row label="Caption"><input value={def.caption ?? ''} onChange={(e) => onChange({ caption: e.target.value })} /></Row>}
      {show('Format') && <Row label="Width"><input type="number" value={def.width} onChange={(e) => onChange({ width: Math.max(100, Number(e.target.value) || 100) })} /></Row>}
      {f && show('Format') && <Row label="Default View"><select value={f.defaultView} onChange={(e) => onChange({ defaultView: e.target.value as FormDef['defaultView'] } as Partial<FormDef>)}><option>Single Form</option><option>Continuous Forms</option><option>Datasheet</option></select></Row>}
      {f && show('Format') && <Row label="Navigation Buttons"><select value={f.navigationButtons ? 'Yes' : 'No'} onChange={(e) => onChange({ navigationButtons: e.target.value === 'Yes' } as Partial<FormDef>)}><option>Yes</option><option>No</option></select></Row>}
      {f && show('Data') && <Row label="Allow Additions"><select value={f.allowAdditions ? 'Yes' : 'No'} onChange={(e) => onChange({ allowAdditions: e.target.value === 'Yes' } as Partial<FormDef>)}><option>Yes</option><option>No</option></select></Row>}
      {f && show('Data') && <Row label="Allow Edits"><select value={f.allowEdits ? 'Yes' : 'No'} onChange={(e) => onChange({ allowEdits: e.target.value === 'Yes' } as Partial<FormDef>)}><option>Yes</option><option>No</option></select></Row>}
      {f && show('Data') && <Row label="Allow Deletions"><select value={f.allowDeletions ? 'Yes' : 'No'} onChange={(e) => onChange({ allowDeletions: e.target.value === 'Yes' } as Partial<FormDef>)}><option>Yes</option><option>No</option></select></Row>}
      {r && show('Format') && <Row label="Page Size"><select value={r.page.size} onChange={(e) => onChange({ page: { ...r.page, size: e.target.value as 'A4' | 'Letter' } } as Partial<ReportDef>)}><option>A4</option><option>Letter</option></select></Row>}
      {r && show('Format') && <Row label="Orientation"><select value={r.page.orientation} onChange={(e) => onChange({ page: { ...r.page, orientation: e.target.value as 'Portrait' | 'Landscape' } } as Partial<ReportDef>)}><option>Portrait</option><option>Landscape</option></select></Row>}
      {r && show('Format') && <Row label="Margins (px)"><input type="number" value={r.page.margin} onChange={(e) => onChange({ page: { ...r.page, margin: Math.max(0, Number(e.target.value) || 0) } } as Partial<ReportDef>)} /></Row>}
    </>
  );
}

function GroupPane({ def, fields, onChange }: { def: ReportDef; fields: string[]; onChange: (r: ReportDef) => void }) {
  const set = (i: number, patch: Partial<GroupLevel>) => onChange({ ...def, groups: def.groups.map((g, k) => (k === i ? { ...g, ...patch } : g)) });
  const move = (i: number, d: number) => { const g = [...def.groups]; const j = i + d; if (j < 0 || j >= g.length) return; [g[i], g[j]] = [g[j], g[i]]; onChange({ ...def, groups: g, sections: def.sections.map((s) => s.groupIndex === i ? { ...s, groupIndex: j } : s.groupIndex === j ? { ...s, groupIndex: i } : s) }); };
  return (
    <div className="gs-pane" data-testid="group-sort-pane">
      <div className="flex items-center gap-2 mb-1"><b className="small">Group, Sort, and Total</b><span className="muted small">Records are grouped and sorted in this order. Group headers/footers appear as sections above.</span></div>
      {def.groups.map((g, i) => (
        <div key={g.id} className="gs-row">
          <span style={{ width: 74 }}>{g.isSort ? 'Sort by' : 'Group on'}</span>
          <select className="sel" value={g.field} onChange={(e) => set(i, { field: e.target.value })} aria-label="Group field">{!fields.includes(g.field) && <option>{g.field}</option>}{fields.map((f) => <option key={f}>{f}</option>)}</select>
          <select className="sel" value={g.order} onChange={(e) => set(i, { order: e.target.value as GroupLevel['order'] })}><option value="Ascending">smallest to largest</option><option value="Descending">largest to smallest</option></select>
          {!g.isSort && <label className="flex items-center gap-1 small"><input type="checkbox" className="chk" checked={g.header} onChange={(e) => set(i, { header: e.target.checked })} /> with a header section</label>}
          {!g.isSort && <label className="flex items-center gap-1 small"><input type="checkbox" className="chk" checked={g.footer} onChange={(e) => set(i, { footer: e.target.checked })} /> with a footer section</label>}
          <button className="icon-btn" onClick={() => move(i, -1)} title="Move up"><I.ChevronUp size={13} /></button>
          <button className="icon-btn" onClick={() => move(i, 1)} title="Move down"><I.ChevronDown size={13} /></button>
          <button className="icon-btn" onClick={() => onChange({ ...def, groups: def.groups.filter((_, k) => k !== i), sections: def.sections.filter((s) => s.groupIndex !== i).map((s) => (s.groupIndex !== undefined && s.groupIndex > i ? { ...s, groupIndex: s.groupIndex - 1 } : s)) })} title="Delete"><I.X size={13} /></button>
        </div>
      ))}
      <div className="flex gap-2 mt-1">
        <button className="btn btn-sm" disabled={!fields.length} onClick={() => onChange({ ...def, groups: [...def.groups, newGroup(fields[0])] })}>Add a group</button>
        <button className="btn btn-sm" disabled={!fields.length} onClick={() => onChange({ ...def, groups: [...def.groups, newGroup(fields[0], true)] })}>Add a sort</button>
      </div>
    </div>
  );
}

function TabOrderDialog({ items, close }: { items: ControlDef[]; close: (v: string[] | null) => void }) {
  const [order, setOrder] = useState(items.map((i) => i.id));
  const [sel, setSel] = useState<string | null>(null);
  const mv = (d: number) => { if (!sel) return; const i = order.indexOf(sel); const j = i + d; if (j < 0 || j >= order.length) return; const o = [...order]; [o[i], o[j]] = [o[j], o[i]]; setOrder(o); };
  return (
    <div>
      <div className="small mb-1">Custom Order (Detail section):</div>
      <div className="list-box" style={{ height: 220 }}>{order.map((id) => { const c = items.find((x) => x.id === id)!; return <div key={id} className={sel === id ? 'on' : ''} onClick={() => setSel(id)}>{c.name}</div>; })}</div>
      <div className="dlg-buttons" style={{ justifyContent: 'space-between' }}>
        <div className="flex gap-2"><button className="btn btn-sm" onClick={() => mv(-1)}>Move Up</button><button className="btn btn-sm" onClick={() => mv(1)}>Move Down</button><button className="btn btn-sm" onClick={() => setOrder([...items].sort((a, b) => a.y - b.y || a.x - b.x).map((c) => c.id))}>Auto Order</button></div>
        <div className="flex gap-2"><button className="btn btn-primary" onClick={() => close(order)}>OK</button><button className="btn" onClick={() => close(null)}>Cancel</button></div>
      </div>
    </div>
  );
}

export { useCallback, useEffect };

const THEMES: Record<string, { header: string; band: string; detail: string; title: string; label: string; accent: string; border: string; font: string }> = {
  wowdb: { header: '#dbe6f4', band: '#eef3fa', detail: '#ffffff', title: '#1e3a6e', label: '#1f1f1f', accent: '#1f5fae', border: '#a6a6a6', font: 'Segoe UI' },
  slate: { header: '#d9dde3', band: '#eceef1', detail: '#ffffff', title: '#2e3a4a', label: '#2e3a4a', accent: '#4a5a70', border: '#9aa3ae', font: 'Calibri' },
  forest: { header: '#d8eadb', band: '#edf5ee', detail: '#ffffff', title: '#1f5130', label: '#1f2f24', accent: '#2e7d46', border: '#9fb7a5', font: 'Calibri' },
  sunset: { header: '#f7e0cc', band: '#fbefe5', detail: '#ffffff', title: '#8a3b12', label: '#3a2418', accent: '#c25a1c', border: '#c9ab96', font: 'Georgia' },
  mono: { header: '#e6e6e6', band: '#f3f3f3', detail: '#ffffff', title: '#111111', label: '#111111', accent: '#444444', border: '#8c8c8c', font: 'Arial' },
};

/** Vertical ruler beside a section: a tick every 1/8 inch, numbers every inch from the section top (as Access does). */
function VRuler({ height }: { height: number }) {
  const ticks = Math.ceil(height / 12);
  return (
    <svg className="ruler-v" width={18} height={height} aria-hidden>
      {Array.from({ length: ticks + 1 }, (_, i) => <line key={i} x1={i % 8 === 0 ? 4 : i % 4 === 0 ? 9 : 13} x2={18} y1={i * 12} y2={i * 12} stroke="#999" strokeWidth={0.6} />)}
      {Array.from({ length: Math.floor(height / 96) }, (_, i) => <text key={i} x={3} y={(i + 1) * 96 + 3} fontSize={9} fill="#666">{i + 1}</text>)}
    </svg>
  );
}
