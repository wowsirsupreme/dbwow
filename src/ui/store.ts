// Application state (Zustand). Database DATA is never kept here: it lives in
// SQLite and is persisted to IndexedDB. This store only tracks UI state:
// open project handle, tabs, active ribbon tab, panels and a version counter
// that components use to re-read from the database after changes.
import { create } from 'zustand';
import type { WowProject } from '@/engine/project';
import { saveProject, rememberLast } from '@/engine/persistence';

export type TabKind = 'table' | 'query' | 'form' | 'report' | 'relationships' | 'macro' | 'module' | 'learning' | 'tool';
export interface Tab {
  id: string;
  kind: TabKind;
  name: string;          // object name ('' for new unsaved)
  title: string;
  view: string;          // 'design' | 'datasheet' | 'sql' | 'form' | 'preview' | ...
  dirty?: boolean;
  isNew?: boolean;
  payload?: Record<string, unknown>;
}

interface AppState {
  project: WowProject | null;
  projectId: string | null;
  version: number;
  tabs: Tab[];
  activeTabId: string | null;
  ribbonTab: string;
  backstage: boolean;
  navCollapsed: boolean;
  learningMode: boolean;
  status: string;
  savedAt: string | null;
  saving: boolean;
  selection: { table?: string; field?: string; records?: number; position?: number; filtered?: boolean };
  setProject: (p: WowProject | null, id: string | null) => void;
  bump: () => void;
  openTab: (t: Omit<Tab, 'id'> & { id?: string }) => string;
  closeTab: (id: string) => void;
  activate: (id: string) => void;
  updateTab: (id: string, patch: Partial<Tab>) => void;
  setRibbonTab: (t: string) => void;
  setBackstage: (b: boolean) => void;
  toggleNav: () => void;
  setLearningMode: (b: boolean) => void;
  setStatus: (s: string) => void;
  setSelection: (s: AppState['selection']) => void;
}

let tabSeq = 1;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let unsub: (() => void) | null = null;

export const useApp = create<AppState>((set, get) => ({
  project: null, projectId: null, version: 0, tabs: [], activeTabId: null, ribbonTab: 'home', backstage: false,
  navCollapsed: typeof window !== 'undefined' && window.innerWidth < 700, learningMode: readPref('wowdb.learningMode', false), status: 'Ready', savedAt: null, saving: false, selection: {},
  setProject: (p, id) => {
    if (unsub) { unsub(); unsub = null; }
    if (p && id) {
      unsub = p.db.onChange(() => { useApp.setState({ version: useApp.getState().version + 1 }); scheduleSave(); }) as () => void;
      rememberLast(id);
    }
    set({ project: p, projectId: id, tabs: [], activeTabId: null, version: get().version + 1, backstage: false, ribbonTab: 'home', savedAt: p ? new Date().toLocaleTimeString() : null, selection: {} });
  },
  bump: () => set({ version: get().version + 1 }),
  openTab: (t) => {
    const existing = get().tabs.find((x) => x.kind === t.kind && t.name && x.name.toLowerCase() === t.name.toLowerCase() && !t.id);
    if (existing) {
      set({ activeTabId: existing.id, backstage: false, tabs: get().tabs.map((x) => (x.id === existing.id && t.view && t.view !== x.view ? { ...x, view: t.view } : x)) });
      return existing.id;
    }
    const id = t.id ?? 'tab' + tabSeq++;
    set({ tabs: [...get().tabs, { ...t, id } as Tab], activeTabId: id, backstage: false, ribbonTab: contextRibbon(t.kind, t.view) ?? get().ribbonTab });
    return id;
  },
  closeTab: (id) => {
    const tabs = get().tabs;
    const i = tabs.findIndex((t) => t.id === id);
    const next = tabs.filter((t) => t.id !== id);
    const active = get().activeTabId === id ? next[Math.min(i, next.length - 1)]?.id ?? null : get().activeTabId;
    set({ tabs: next, activeTabId: active });
    const at = next.find((t) => t.id === active);
    const rt = get().ribbonTab;
    if (!at && !['home', 'create', 'external', 'tools', 'help'].includes(rt)) set({ ribbonTab: 'home' });
  },
  activate: (id) => {
    const t = get().tabs.find((x) => x.id === id);
    set({ activeTabId: id, backstage: false });
    if (t) { const r = contextRibbon(t.kind, t.view); if (r && isContextual(get().ribbonTab)) set({ ribbonTab: r }); }
  },
  updateTab: (id, patch) => {
    set({ tabs: get().tabs.map((t) => (t.id === id ? { ...t, ...patch } : t)) });
    if (patch.view) { const t = get().tabs.find((x) => x.id === id); if (t && get().activeTabId === id) { const r = contextRibbon(t.kind, patch.view); if (r && (isContextual(get().ribbonTab) || get().ribbonTab === 'home')) set({ ribbonTab: r }); else if (!r && isContextual(get().ribbonTab)) set({ ribbonTab: 'home' }); } }
  },
  setRibbonTab: (t) => set({ ribbonTab: t, backstage: t === 'file' }),
  setBackstage: (b) => set({ backstage: b }),
  toggleNav: () => set({ navCollapsed: !get().navCollapsed }),
  setLearningMode: (b) => { writePref('wowdb.learningMode', b); set({ learningMode: b }); },
  setStatus: (s) => set({ status: s }),
  setSelection: (s) => { const cur = get().selection; if (JSON.stringify(cur) !== JSON.stringify(s)) set({ selection: s }); },
}));

export function contextRibbon(kind: TabKind, view: string): string | null {
  if (kind === 'table') return view === 'design' ? 'ctx-table-design' : 'ctx-table-fields';
  if (kind === 'query') return view === 'datasheet' ? null : 'ctx-query';
  if (kind === 'relationships') return 'ctx-relationships';
  if (kind === 'form') return view === 'design' ? 'ctx-form-design' : null;
  if (kind === 'report') return view === 'design' ? 'ctx-report-design' : 'ctx-print-preview';
  return null;
}
export function isContextual(t: string) { return t.startsWith('ctx-'); }

function readPref<T>(k: string, d: T): T { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } }
function writePref(k: string, v: unknown) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } }

/** Persist the current database to IndexedDB (debounced). */
export function scheduleSave(delay = 400) {
  if (saveTimer) clearTimeout(saveTimer);
  useApp.setState({ saving: true });
  saveTimer = setTimeout(() => { void saveNow(); }, delay);
}
export async function saveNow(): Promise<void> {
  const { project, projectId } = useApp.getState();
  if (!project || !projectId) return;
  try {
    const bytes = project.db.export();
    await saveProject({ id: projectId, name: project.name, bytes, modified: new Date().toISOString(), size: bytes.length });
    useApp.setState({ saving: false, savedAt: new Date().toLocaleTimeString() });
  } catch (e) {
    useApp.setState({ saving: false, status: 'Could not save to browser storage: ' + (e as Error).message });
  }
}
