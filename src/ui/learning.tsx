'use client';
// Live learning layer: one shared progress store, a tracker that re-checks
// practicals and achievements whenever the database (or an unsaved table
// design) changes, the Practical panel that stays beside the student's work,
// and achievement notifications.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { create } from 'zustand';
import { Award, CheckCircle2, ChevronDown, ChevronUp, ListChecks, Lightbulb, Trophy, X } from 'lucide-react';
import type { WowProject } from '@/engine/project';
import type { TableDef } from '@/engine/types';
import { PRACTICALS, SAMPLE_EXERCISES, type Practical } from '@/learning/content';
import { ALL_ACHIEVEMENTS, XP, XP_STEP, newlyEarned, rankFor, totalXp, type Achievement, type LearnState, type Tier } from '@/learning/achievements';
import { useApp } from './store';

const KEY = 'wowdb.learning';
const KEY_ACTIVE = 'wowdb.activePractical';
const emptyState = (): LearnState => ({ quizzes: {}, steps: {}, achievements: {}, events: {} });
function load(): LearnState {
  try { const s = localStorage.getItem(KEY); if (s) return { ...emptyState(), ...(JSON.parse(s) as LearnState) }; } catch { /* storage unavailable */ }
  return emptyState();
}
function persist(s: LearnState) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* storage unavailable */ } }
function readActive(): string | null { try { return localStorage.getItem(KEY_ACTIVE); } catch { return null; } }

export const ALL_PRACTICALS: Practical[] = [...PRACTICALS, ...SAMPLE_EXERCISES];

export interface Toast { id: number; kind: 'achievement' | 'step' | 'rank'; title: string; detail: string; tier?: Tier; xp?: number; }
interface TableDraft { name: string; def: TableDef; }

interface LearningStore {
  progress: LearnState;
  activePractical: string | null;
  panelCollapsed: boolean;
  drafts: Record<string, TableDraft>;   // tabId -> unsaved table design
  toasts: Toast[];
  setProgress: (p: LearnState) => void;
  setActivePractical: (id: string | null) => void;
  setPanelCollapsed: (b: boolean) => void;
  setDraft: (tabId: string, d: TableDraft | null) => void;
  pushToast: (t: Omit<Toast, 'id'>) => void;
  dropToast: (id: number) => void;
  reset: () => void;
}
let toastSeq = 1;
export const useLearning = create<LearningStore>((set, get) => ({
  progress: typeof window === 'undefined' ? emptyState() : load(),
  activePractical: typeof window === 'undefined' ? null : readActive(),
  panelCollapsed: false,
  drafts: {},
  toasts: [],
  setProgress: (p) => { persist(p); set({ progress: p }); },
  setActivePractical: (id) => { try { if (id) localStorage.setItem(KEY_ACTIVE, id); else localStorage.removeItem(KEY_ACTIVE); } catch { /* ignore */ } set({ activePractical: id, panelCollapsed: false }); },
  setPanelCollapsed: (b) => set({ panelCollapsed: b }),
  setDraft: (tabId, d) => {
    const cur = get().drafts;
    if (!d) { if (!(tabId in cur)) return; const n = { ...cur }; delete n[tabId]; set({ drafts: n }); return; }
    if (JSON.stringify(cur[tabId]) === JSON.stringify(d)) return;
    set({ drafts: { ...cur, [tabId]: d } });
  },
  pushToast: (t) => {
    const id = toastSeq++;
    set({ toasts: [...get().toasts.slice(-3), { ...t, id }] });
    setTimeout(() => get().dropToast(id), t.kind === 'step' ? 2600 : 5200);
  },
  dropToast: (id) => set({ toasts: get().toasts.filter((x) => x.id !== id) }),
  reset: () => { const e = emptyState(); persist(e); set({ progress: e }); },
}));

/** Record an action used by achievements (import, export, pdf, sql-run …). */
export function trackEvent(name: string) {
  const s = useLearning.getState();
  const ev = { ...(s.progress.events ?? {}) };
  ev[name] = (ev[name] ?? 0) + 1;
  s.setProgress({ ...s.progress, events: ev });
  scheduleEvaluate();
}

// ---------------- step evaluation ----------------
export type StepState = { state: 'done' } | { state: 'pending'; note: string } | { state: 'open'; note: string };

/** True when a practical applies to the open database (sample exercises need their sample). */
export function practicalApplies(x: Practical, p: WowProject | null) { return !x.sample || (!!p && p.getMeta('sample') === x.sample); }

/**
 * A read-only view of the project in which unsaved table designs are visible,
 * so a step such as "Add LastName (Short Text)" can be recognised before the
 * student saves. Steps found only here are shown as "pending: save to confirm".
 */
function withDrafts(p: WowProject, drafts: TableDraft[]): WowProject | null {
  if (!drafts.length) return null;
  const named = new Map<string, TableDef>();
  const unnamed: TableDef[] = [];
  for (const d of drafts) { const n = (d.def.name || d.name).trim(); if (n) named.set(n.toLowerCase(), { ...d.def, name: n }); else unnamed.push(d.def); }
  const o = Object.create(p) as WowProject;
  o.getTable = (name: string) => {
    const k = name.toLowerCase();
    if (named.has(k)) return named.get(k);
    const real = p.getTable(name);
    if (real) return real;
    if (unnamed.length === 1) return { ...unnamed[0], name, fields: unnamed[0].fields.filter((f) => f.name.trim()) };
    return undefined;
  };
  return o;
}

export function evaluatePractical(x: Practical, p: WowProject | null, drafts: TableDraft[]): StepState[] {
  const ov = p ? withDrafts(p, drafts) : null;
  return x.steps.map((s) => {
    let r: true | string;
    try { r = s.check(p); } catch (e) { r = (e as Error).message; }
    if (r === true) return { state: 'done' };
    if (ov) { try { if (s.check(ov) === true) return { state: 'pending', note: 'Seen in your unsaved design. Save it (Ctrl+S) to confirm this step.' }; } catch { /* ignore */ } }
    return { state: 'open', note: r };
  });
}

/** Live step states for one practical (re-run on every database or draft change). */
export function useStepStates(x: Practical | undefined): StepState[] {
  const p = useApp((s) => s.project);
  const version = useApp((s) => s.version);
  const drafts = useLearning((s) => s.drafts);
  return useMemo(() => (x ? evaluatePractical(x, p, Object.values(drafts)) : []), [x, p, version, drafts]); // eslint-disable-line react-hooks/exhaustive-deps
}

// ---------------- the tracker ----------------
let evalTimer: ReturnType<typeof setTimeout> | null = null;
export function scheduleEvaluate() {
  if (evalTimer) clearTimeout(evalTimer);
  evalTimer = setTimeout(evaluateNow, 250);
}

/** Record newly verified steps for every practical that applies, then award achievements. */
export function evaluateNow() {
  evalTimer = null;
  const p = useApp.getState().project;
  const L = useLearning.getState();
  const before = L.progress;
  const steps = { ...before.steps };
  const stepToasts: Toast[] = [];
  for (const x of ALL_PRACTICALS) {
    if (!practicalApplies(x, p)) continue;
    x.steps.forEach((s, i) => {
      const k = `${x.id}:${i}`;
      if (steps[k]) return;
      let ok = false;
      try { ok = s.check(p) === true; } catch { ok = false; }
      if (ok) { steps[k] = true; stepToasts.push({ id: 0, kind: 'step', title: `Step ${i + 1} complete`, detail: x.title, xp: XP_STEP }); }
    });
  }
  let next: LearnState = { ...before, steps };
  const earned = newlyEarned(p, next);
  if (earned.length) {
    const now = new Date().toISOString();
    next = { ...next, achievements: { ...(next.achievements ?? {}), ...Object.fromEntries(earned.map((a) => [a.id, now])) } };
  }
  if (JSON.stringify(next) === JSON.stringify(before)) return;
  const rankBefore = rankFor(totalXp(before)).name;
  L.setProgress(next);
  // step toasts only for the practical the learner is working on (others are silent but recorded)
  const active = ALL_PRACTICALS.find((x) => x.id === L.activePractical);
  for (const t of stepToasts) if (active && t.detail === active.title) L.pushToast(t);
  for (const a of earned) L.pushToast({ kind: 'achievement', title: a.title, detail: a.how, tier: a.tier, xp: XP[a.tier] });
  const rankAfter = rankFor(totalXp(next)).name;
  if (rankAfter !== rankBefore) L.pushToast({ kind: 'rank', title: `New rank: ${rankAfter}`, detail: `You now have ${totalXp(next)} XP.` });
}

/** Mount once in the app: re-evaluates after every database change and quiz answer. */
export function useLearningTracker() {
  const version = useApp((s) => s.version);
  const project = useApp((s) => s.project);
  const quizzes = useLearning((s) => s.progress.quizzes);
  const first = useRef(true);
  useEffect(() => {
    // award silently on first load (no toast burst for progress made before this release)
    if (first.current) { first.current = false; const L = useLearning.getState(); const t = L.pushToast; useLearning.setState({ pushToast: () => undefined }); evaluateNow(); useLearning.setState({ pushToast: t }); return; }
    scheduleEvaluate();
  }, [version, project, quizzes]);
}

// ---------------- UI ----------------
export const TIER_COLOR: Record<Tier, string> = { bronze: '#a86b32', silver: '#8a949e', gold: '#c99a06', platinum: '#5b7fa6' };
export const TIER_LABEL: Record<Tier, string> = { bronze: 'Bronze', silver: 'Silver', gold: 'Gold', platinum: 'Platinum' };

export function TrophyIcon({ tier, size = 18, locked = false }: { tier: Tier; size?: number; locked?: boolean }) {
  return <Trophy size={size} color={locked ? '#b9b9b9' : TIER_COLOR[tier]} fill={locked ? 'none' : TIER_COLOR[tier] + '33'} aria-label={TIER_LABEL[tier] + ' trophy'} />;
}

export function Toasts() {
  const toasts = useLearning((s) => s.toasts);
  const drop = useLearning((s) => s.dropToast);
  if (!toasts.length) return null;
  return (
    <div className="lt-toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={'lt-toast ' + t.kind} onClick={() => drop(t.id)}>
          <div className="lt-toast-icon">{t.kind === 'achievement' && t.tier ? <TrophyIcon tier={t.tier} size={26} /> : t.kind === 'rank' ? <Award size={24} color="#1f5fae" /> : <CheckCircle2 size={20} color="#3c8d40" />}</div>
          <div style={{ minWidth: 0 }}>
            <div className="lt-toast-kicker">{t.kind === 'achievement' ? `${TIER_LABEL[t.tier!]} achievement unlocked` : t.kind === 'rank' ? 'Rank up' : 'Practical'}</div>
            <div className="lt-toast-title">{t.title}{t.xp ? <span className="lt-xp">+{t.xp} XP</span> : null}</div>
            <div className="lt-toast-detail">{t.detail}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

/** Rank and XP shown in the title bar; opens the Achievements page. */
export function RankBadge({ onOpen }: { onOpen: () => void }) {
  const progress = useLearning((s) => s.progress);
  const xp = totalXp(progress);
  const r = rankFor(xp);
  const n = ALL_ACHIEVEMENTS.filter((a) => progress.achievements?.[a.id]).length;
  return (
    <button className="rank-badge" title={`${r.name}: ${xp} XP, ${n} of ${ALL_ACHIEVEMENTS.length} achievements. Click to see your trophies.`} onClick={onOpen} data-testid="rank-badge">
      <Trophy size={14} /><span className="hide-sm">{r.name}</span><span className="rank-xp">{xp} XP</span>
    </button>
  );
}

/** The practical checklist that stays beside the student's work. */
export function PracticalPanel({ openInCentre, openSample }: { openInCentre: (id: string) => void; openSample: (id: string) => void }) {
  const activeId = useLearning((s) => s.activePractical);
  const collapsed = useLearning((s) => s.panelCollapsed);
  const setCollapsed = useLearning((s) => s.setPanelCollapsed);
  const setActive = useLearning((s) => s.setActivePractical);
  const progress = useLearning((s) => s.progress);
  const project = useApp((s) => s.project);
  const x = ALL_PRACTICALS.find((p) => p.id === activeId);
  const states = useStepStates(x);
  const [hint, setHint] = useState<number | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const firstOpen = states.findIndex((s) => s.state !== 'done');
  useEffect(() => { listRef.current?.querySelector('.pp-step.current')?.scrollIntoView({ block: 'nearest' }); }, [firstOpen]);
  if (!x || !project) return null;
  const done = states.filter((s) => s.state === 'done').length;
  const applies = practicalApplies(x, project);
  const xp = totalXp(progress);
  const r = rankFor(xp);
  return (
    <div className={'pp' + (collapsed ? ' collapsed' : '')} data-testid="practical-panel" aria-label="Practical checklist">
      <div className="pp-head" onClick={() => setCollapsed(!collapsed)}>
        <ListChecks size={15} />
        <div className="pp-title"><b>{x.title}</b><span className="muted"> · {done}/{x.steps.length}</span></div>
        <button className="icon-btn" title={collapsed ? 'Expand' : 'Collapse'} onClick={(e) => { e.stopPropagation(); setCollapsed(!collapsed); }}>{collapsed ? <ChevronUp size={14} /> : <ChevronDown size={14} />}</button>
        <button className="icon-btn" title="Close the checklist (your progress is kept)" onClick={(e) => { e.stopPropagation(); setActive(null); }}><X size={14} /></button>
      </div>
      <div className="pp-bar"><div style={{ width: `${Math.round((done / x.steps.length) * 100)}%` }} /></div>
      {!collapsed && <>
        {!applies && x.sample && <div className="pp-warn">This practical uses the {x.sample} sample database. <button className="link" onClick={() => openSample(x.sample!)}>Open a fresh copy</button></div>}
        <div className="pp-list" ref={listRef}>
          {x.steps.map((s, i) => {
            const st = states[i];
            const cls = st?.state === 'done' ? 'done' : st?.state === 'pending' ? 'pending' : i === firstOpen ? 'current' : '';
            return (
              <div key={i} className={'pp-step ' + cls} data-step={i}>
                <div className="pp-num">{st?.state === 'done' ? '✓' : i + 1}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div>{s.text}</div>
                  {st && st.state !== 'done' && (i === firstOpen || st.state === 'pending') && applies && <div className="pp-note">{st.note}</div>}
                  {hint === i && <div className="pp-hint">Hint: {s.hint}</div>}
                </div>
                {st?.state !== 'done' && <button className="icon-btn" title="Hint" onClick={() => setHint(hint === i ? null : i)}><Lightbulb size={13} /></button>}
              </div>
            );
          })}
          {done === x.steps.length && <div className="pp-complete"><Trophy size={15} color="#c99a06" /> Practical complete. Every step was verified against your database.</div>}
        </div>
        <div className="pp-foot">
          <span><Award size={13} /> {r.name} · {xp} XP</span>
          <button className="link" onClick={() => openInCentre(x.id)}>Open in Learning Centre</button>
        </div>
      </>}
    </div>
  );
}
