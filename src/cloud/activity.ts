// Study analytics for signed-in students. Every 15 seconds the time is
// counted as active (input in the last 60 s while DBWOW is visible), idle
// (visible but no input) or hidden (DBWOW in a background tab). Database
// changes, verified practical steps, quiz answers and SQL runs are counted
// too. Totals go to users/{uid}/days/{date} once a minute.
import { useApp } from '@/ui/store';
import { useLearning } from '@/ui/learning';
import { TOPICS } from '@/learning/content';
import { totalXp, type LearnState } from '@/learning/achievements';
import { today, type DayStats } from './school';
import { getBackend, useCloud } from './sync';

type Inc = Partial<Omit<DayStats, 'date' | 'xp'>>;
const TICK = 15;
let started = false;
let lastInput = Date.now();
let pending: Inc = {};
const add = (k: keyof Inc, n: number) => { pending[k] = (pending[k] ?? 0) + n; };

const correct = (p: LearnState) => TOPICS.reduce((n, t) => n + t.quiz.filter((q, k) => p.quizzes[`${t.id}:${k}`] === q.answer).length, 0);

export function startActivity() {
  if (started || typeof window === 'undefined') return; started = true;
  const input = () => { lastInput = Date.now(); };
  for (const ev of ['pointerdown', 'keydown', 'wheel', 'touchstart', 'mousemove']) window.addEventListener(ev, input, { passive: true, capture: true });

  setInterval(() => {
    if (!useCloud.getState().user || useCloud.getState().user?.anonymous) return;
    if (document.hidden) add('hiddenSec', TICK);
    else if (Date.now() - lastInput < 60000) add('activeSec', TICK);
    else add('idleSec', TICK);
  }, TICK * 1000);
  setInterval(() => void flush(), 60000);
  document.addEventListener('visibilitychange', () => { if (document.hidden) void flush(); });

  useApp.subscribe((s, prev) => { if (s.version !== prev.version && s.project && s.projectId === prev.projectId) add('actions', 1); });
  useLearning.subscribe((s, prev) => {
    if (s.progress === prev.progress) return;
    const a = s.progress, b = prev.progress;
    const steps = Object.values(a.steps).filter(Boolean).length - Object.values(b.steps).filter(Boolean).length;
    if (steps > 0) add('steps', steps);
    const answered = Object.keys(a.quizzes).length - Object.keys(b.quizzes).length;
    if (answered > 0) add('quizAnswered', answered);
    const good = correct(a) - correct(b);
    if (good > 0) add('quizCorrect', good);
    const sql = (a.events?.['sql-run'] ?? 0) - (b.events?.['sql-run'] ?? 0);
    if (sql > 0) add('sqlRuns', sql);
  });
  let wasUser: string | null = null;
  useCloud.subscribe((s) => { const u = s.user?.uid ?? null; if (u && u !== wasUser) add('sessions', 1); wasUser = u; });
}

export async function flush() {
  const be = getBackend();
  if (!be?.school || !useCloud.getState().user || useCloud.getState().user?.anonymous) return;
  const inc = pending; pending = {};
  if (!Object.values(inc).some(Boolean)) return;
  try { await be.school.addDay(today(), inc, totalXp(useLearning.getState().progress)); }
  catch { for (const [k, v] of Object.entries(inc)) add(k as keyof Inc, v as number); }  // try again next minute
}
