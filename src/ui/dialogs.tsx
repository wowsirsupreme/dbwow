'use client';
// In-app dialog system (no browser alert/confirm/prompt). Dialogs are
// promise-based: `await confirmBox(...)`, `await promptBox(...)`.
import React, { useEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import { X, AlertTriangle, Info, HelpCircle, XCircle } from 'lucide-react';

type Render = (close: (v: unknown) => void) => React.ReactNode;
interface DialogItem { id: number; title: string; render: Render; width?: number; resolve: (v: unknown) => void; }
const useDialogs = create<{ items: DialogItem[] }>(() => ({ items: [] }));
let seq = 1;

export function openDialog<T = unknown>(title: string, render: (close: (v: T | null) => void) => React.ReactNode, width?: number): Promise<T | null> {
  return new Promise((resolve) => {
    const id = seq++;
    const item: DialogItem = { id, title, width, render: render as Render, resolve: resolve as (v: unknown) => void };
    useDialogs.setState({ items: [...useDialogs.getState().items, item] });
  });
}
function closeDialog(id: number, v: unknown) {
  const it = useDialogs.getState().items.find((d) => d.id === id);
  useDialogs.setState({ items: useDialogs.getState().items.filter((d) => d.id !== id) });
  it?.resolve(v);
}

export function DialogLayer() {
  const items = useDialogs((s) => s.items);
  return <>{items.map((d) => <DialogFrame key={d.id} item={d} />)}</>;
}

function DialogFrame({ item }: { item: DialogItem }) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const close = (v: unknown) => closeDialog(item.id, v);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); close(null); } };
    window.addEventListener('keydown', onKey, true);
    const first = ref.current?.querySelector<HTMLElement>('[data-autofocus], input, select, textarea, button.btn-primary');
    first?.focus();
    return () => window.removeEventListener('keydown', onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const startDrag = (e: React.PointerEvent) => {
    const el = ref.current; if (!el) return;
    const r = el.getBoundingClientRect();
    const ox = e.clientX - r.left, oy = e.clientY - r.top;
    const move = (ev: PointerEvent) => setPos({ x: Math.max(0, ev.clientX - ox), y: Math.max(0, ev.clientY - oy) });
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };
  return (
    <div className="dlg-backdrop" onMouseDown={(e) => e.stopPropagation()}>
      <div ref={ref} className="dlg" role="dialog" aria-label={item.title} style={{ width: item.width ?? 440, ...(pos ? { position: 'fixed', left: pos.x, top: pos.y, margin: 0 } : {}) }}>
        <div className="dlg-title" onPointerDown={startDrag}>
          <span>{item.title}</span>
          <button className="dlg-x" onClick={() => close(null)} aria-label="Close"><X size={14} /></button>
        </div>
        <div className="dlg-body">{item.render(close)}</div>
      </div>
    </div>
  );
}

const ICONS = { info: <Info size={28} className="text-blue-600" />, warn: <AlertTriangle size={28} className="text-amber-500" />, error: <XCircle size={28} className="text-red-600" />, question: <HelpCircle size={28} className="text-blue-600" /> };

export function messageBox(message: React.ReactNode, title = 'WOWDB', kind: keyof typeof ICONS = 'info'): Promise<void> {
  return openDialog<void>(title, (close) => (
    <div>
      <div className="flex gap-3 items-start"><div className="shrink-0">{ICONS[kind]}</div><div className="msg-text">{message}</div></div>
      <div className="dlg-buttons"><button className="btn btn-primary" onClick={() => close()}>OK</button></div>
    </div>
  ), 460).then(() => undefined);
}

export function errorBox(e: unknown, title = 'WOWDB') {
  const msg = e instanceof Error ? e.message : String(e);
  return messageBox(msg, title, 'error');
}

export function confirmBox(message: React.ReactNode, opts: { title?: string; ok?: string; cancel?: string; danger?: boolean; kind?: keyof typeof ICONS } = {}): Promise<boolean> {
  return openDialog<boolean>(opts.title ?? 'WOWDB', (close) => (
    <div>
      <div className="flex gap-3 items-start"><div className="shrink-0">{ICONS[opts.kind ?? (opts.danger ? 'warn' : 'question')]}</div><div className="msg-text">{message}</div></div>
      <div className="dlg-buttons">
        <button className={'btn btn-primary' + (opts.danger ? ' btn-danger' : '')} onClick={() => close(true)}>{opts.ok ?? 'Yes'}</button>
        <button className="btn" onClick={() => close(false)}>{opts.cancel ?? 'No'}</button>
      </div>
    </div>
  ), 460).then((v) => !!v);
}

/** Yes / No / Cancel (e.g. "Do you want to save changes?") */
export function yesNoCancel(message: React.ReactNode, title = 'WOWDB'): Promise<'yes' | 'no' | 'cancel'> {
  return openDialog<'yes' | 'no' | 'cancel'>(title, (close) => (
    <div>
      <div className="flex gap-3 items-start"><div className="shrink-0">{ICONS.question}</div><div className="msg-text">{message}</div></div>
      <div className="dlg-buttons">
        <button className="btn btn-primary" onClick={() => close('yes')}>Yes</button>
        <button className="btn" onClick={() => close('no')}>No</button>
        <button className="btn" onClick={() => close('cancel')}>Cancel</button>
      </div>
    </div>
  ), 460).then((v) => v ?? 'cancel');
}

export function promptBox(label: string, initial = '', title = 'WOWDB', validate?: (v: string) => string | null): Promise<string | null> {
  return openDialog<string>(title, (close) => <PromptBody label={label} initial={initial} validate={validate} close={close} />, 400);
}
function PromptBody({ label, initial, validate, close }: { label: string; initial: string; validate?: (v: string) => string | null; close: (v: string | null) => void }) {
  const [v, setV] = useState(initial);
  const [err, setErr] = useState<string | null>(null);
  const ok = () => { const e = validate?.(v) ?? null; if (e) { setErr(e); return; } close(v); };
  return (
    <div>
      <label className="block mb-1">{label}</label>
      <input className="inp w-full" value={v} onChange={(e) => { setV(e.target.value); setErr(null); }} onKeyDown={(e) => { if (e.key === 'Enter') ok(); }} data-autofocus onFocus={(e) => e.currentTarget.select()} />
      {err && <div className="err-text mt-1">{err}</div>}
      <div className="dlg-buttons"><button className="btn btn-primary" onClick={ok}>OK</button><button className="btn" onClick={() => close(null)}>Cancel</button></div>
    </div>
  );
}

/** Ask for parameter values (parameter queries). */
export async function askParameters(prompts: string[]): Promise<Record<string, string> | null> {
  const out: Record<string, string> = {};
  for (const p of prompts) {
    const v = await openDialog<string>('Enter Parameter Value', (close) => <PromptBody label={p} initial="" close={close} />, 360);
    if (v === null) return null;
    out[p] = v;
  }
  return out;
}

// ---------------- context menu ----------------
export interface MenuItem { label?: string; onClick?: () => void; disabled?: boolean; separator?: boolean; icon?: React.ReactNode; checked?: boolean; }
const useMenu = create<{ menu: { x: number; y: number; items: MenuItem[] } | null }>(() => ({ menu: null }));
export function showContextMenu(e: { clientX: number; clientY: number; preventDefault?: () => void; stopPropagation?: () => void }, items: MenuItem[]) {
  e.preventDefault?.(); e.stopPropagation?.();
  useMenu.setState({ menu: { x: e.clientX, y: e.clientY, items } });
}
export function ContextMenuLayer() {
  const menu = useMenu((s) => s.menu);
  const ref = useRef<HTMLDivElement>(null);
  const [adj, setAdj] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => {
    if (!menu) return;
    const close = () => useMenu.setState({ menu: null });
    const t = setTimeout(() => { window.addEventListener('mousedown', close); window.addEventListener('blur', close); window.addEventListener('wheel', close); }, 0);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => { clearTimeout(t); window.removeEventListener('mousedown', close); window.removeEventListener('blur', close); window.removeEventListener('wheel', close); window.removeEventListener('keydown', onKey); };
  }, [menu]);
  useEffect(() => {
    if (!menu || !ref.current) { setAdj(null); return; }
    const r = ref.current.getBoundingClientRect();
    setAdj({ x: Math.min(menu.x, window.innerWidth - r.width - 4), y: Math.min(menu.y, window.innerHeight - r.height - 4) });
  }, [menu]);
  if (!menu) return null;
  return (
    <div ref={ref} className="ctx-menu" style={{ left: adj?.x ?? menu.x, top: adj?.y ?? menu.y }} onMouseDown={(e) => e.stopPropagation()}>
      {menu.items.map((it, i) => it.separator ? <div key={i} className="ctx-sep" /> : (
        <button key={i} className="ctx-item" disabled={it.disabled} onClick={() => { useMenu.setState({ menu: null }); it.onClick?.(); }}>
          <span className="ctx-icon">{it.checked ? '✓' : it.icon}</span>{it.label}
        </button>
      ))}
    </div>
  );
}
