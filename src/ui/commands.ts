// Command registry. Ribbon buttons and keyboard shortcuts dispatch named
// commands. The active editor (and any components inside it, e.g. its
// datasheet) register handlers; global handlers (Create, File, External Data,
// Tools, Help) are registered by the app. A ribbon button with no handler is
// disabled, so nothing on the ribbon is inert.
import { useEffect, useRef } from 'react';
import { create } from 'zustand';

export type Cmd = (() => void) | { run: () => void; enabled?: boolean; checked?: boolean; label?: string; value?: string; set?: (v: string) => void };
export type CmdMap = Record<string, Cmd>;
type Flags = Record<string, { enabled: boolean; checked: boolean; label?: string; value?: string }>;

interface Registry { editors: Record<string, Flags>; global: Flags; }
export const useCmdState = create<Registry>(() => ({ editors: {}, global: {} }));

const scoped = new Map<string, Map<string, { current: CmdMap }>>();
const scopedFlags = new Map<string, Map<string, Flags>>();
const globalHandlers: { current: CmdMap } = { current: {} };

function flags(m: CmdMap): Flags {
  const out: Flags = {};
  for (const [k, v] of Object.entries(m)) out[k] = typeof v === 'function' ? { enabled: true, checked: false } : { enabled: v.enabled !== false, checked: !!v.checked, label: v.label, value: v.value };
  return out;
}
function same(a: unknown, b: unknown) { return JSON.stringify(a) === JSON.stringify(b); }

function publish(tabId: string) {
  const m = scopedFlags.get(tabId);
  const merged: Flags = {};
  if (m) for (const f of m.values()) Object.assign(merged, f);
  const cur = useCmdState.getState().editors[tabId];
  if (!same(cur, merged)) useCmdState.setState({ editors: { ...useCmdState.getState().editors, [tabId]: merged } });
}

/** Register commands for an editor tab (scope lets several components share a tab). */
export function useEditorCommands(tabId: string, active: boolean, map: CmdMap, scope = 'main') {
  const ref = useRef<CmdMap>(map);
  ref.current = map;
  useEffect(() => {
    if (!scoped.has(tabId)) scoped.set(tabId, new Map());
    if (!scopedFlags.has(tabId)) scopedFlags.set(tabId, new Map());
    scoped.get(tabId)!.set(scope, ref);
    return () => {
      scoped.get(tabId)?.delete(scope);
      scopedFlags.get(tabId)?.delete(scope);
      publish(tabId);
    };
  }, [tabId, scope]);
  useEffect(() => {
    const f = active ? flags(map) : {};
    const m = scopedFlags.get(tabId);
    if (!m) return;
    if (!same(m.get(scope), f)) { m.set(scope, f); publish(tabId); }
  });
}

export function useGlobalCommands(map: CmdMap) {
  globalHandlers.current = map;
  useEffect(() => {
    const f = flags(map);
    if (!same(useCmdState.getState().global, f)) useCmdState.setState({ global: f });
  });
}

function findHandler(name: string, activeTab: string | null): Cmd | undefined {
  if (activeTab) {
    const regs = scoped.get(activeTab);
    const fl = scopedFlags.get(activeTab);
    if (regs) {
      // later scopes (inner components) win over the editor's main scope
      const entries = [...regs.entries()].reverse();
      for (const [scope, ref] of entries) {
        if (fl?.get(scope)?.[name] && ref.current[name]) return ref.current[name];
      }
    }
  }
  return globalHandlers.current[name];
}

export function runCommand(name: string, activeTab: string | null): boolean {
  const h = findHandler(name, activeTab);
  if (!h) return false;
  if (typeof h === 'function') { h(); return true; }
  if (h.enabled === false) return false;
  h.run();
  return true;
}

export function hasCommand(name: string, activeTab: string | null): boolean {
  const s = useCmdState.getState();
  const f = (activeTab ? s.editors[activeTab]?.[name] : undefined) ?? s.global[name];
  return !!f && f.enabled;
}

/** Run a command and await its result (handlers may return a Promise, e.g. save → boolean). */
export async function runCommandAsync(name: string, activeTab: string | null): Promise<unknown> {
  const h = findHandler(name, activeTab);
  if (!h) return undefined;
  if (typeof h === 'function') return await (h as () => unknown)();
  if (h.enabled === false) return undefined;
  return await (h.run as () => unknown)();
}

/** Run a value command (ribbon font box, colour picker…) with a chosen value. */
export function runCommandValue(name: string, value: string, activeTab: string | null): boolean {
  const h = findHandler(name, activeTab);
  if (!h || typeof h === 'function' || h.enabled === false || !h.set) return false;
  h.set(value);
  return true;
}

/** Every command currently available, for the "Tell me what you want to do" box. */
export function availableCommands(activeTab: string | null): string[] {
  const s = useCmdState.getState();
  const out = new Set<string>();
  for (const [k, f] of Object.entries(s.global)) if (f.enabled) out.add(k);
  if (activeTab) for (const [k, f] of Object.entries(s.editors[activeTab] ?? {})) if (f.enabled) out.add(k);
  return [...out];
}
