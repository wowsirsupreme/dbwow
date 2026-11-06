// A student's practical test while it runs: the session (kept across reloads),
// integrity monitoring, the timer, autosaved snapshots and submission.
import { create } from 'zustand';
import { WowProject } from '@/engine/project';
import { buildSample, type SampleId } from '@/engine/samples';
import { saveProject, loadProject } from '@/engine/persistence';
import { useApp } from '@/ui/store';
import { getBackend } from '@/cloud/sync';
import { setLearningPaused } from '@/ui/learning';
import type { Attempt, AttemptEvent, Counters, TestPublic } from '@/cloud/school';
import { zeroCounters } from '@/cloud/school';

const KEY = 'dbwow.exam';
/** The test database is named after the student and the test, e.g. "Ama Mensah - Sports League: Core practical". */
export const testDbName = (t: TestPublic, a: Attempt) => `${a.name} - ${t.title}`;
let testProject: WowProject | null = null;   // the test database in memory, kept even if the student closes or deletes it
export interface ExamSession { test: TestPublic; attempt: Attempt; projectId: string; }
interface ExamStore {
  session: ExamSession | null;
  counters: Counters;
  now: number;
  phase: 'idle' | 'running' | 'submitting' | 'submitted';
  saving: boolean;
  lastSnapshot: string | null;
  error: string | null;
  flagged: Record<string, boolean>;
  ready: boolean;   // the student pressed Submit and is confirming
}
export const useExam = create<ExamStore>(() => ({ session: null, counters: zeroCounters(), now: Date.now(), phase: 'idle', saving: false, lastSnapshot: null, error: null, flagged: {}, ready: false }));

export const examActive = () => useExam.getState().phase === 'running' || useExam.getState().phase === 'submitting';
/** Learning aids (tips, Learning Mode, hints) are off during a test unless the teacher allowed them. */
export const learningLocked = () => { const s = useExam.getState(); return (s.phase === 'running' || s.phase === 'submitting') && !s.session?.test.settings.allowLearning; };
export const remainingMs = () => { const s = useExam.getState(); return s.session ? Date.parse(s.session.attempt.deadline) - s.now : 0; };

let events: AttemptEvent[] = [];
let timers: ReturnType<typeof setInterval>[] = [];
let detach: (() => void) | null = null;
let lastInput = Date.now();
let dirtySince: number | null = null;
let leftDbLogged = false;

function log(type: string, detail?: string) { events.push({ t: new Date().toISOString(), type, detail }); }
function bump(k: keyof Counters, n = 1) { useExam.setState((s) => ({ counters: { ...s.counters, [k]: s.counters[k] + n } })); }

/** Begin (or resume) a test. Opens the test database and starts monitoring. */
export async function beginAttempt(test: TestPublic, attempt: Attempt, resumed: boolean) {
  const be = getBackend()!; const school = be.school!;
  const projectId = `exam-${attempt.id}`;
  let p: WowProject | null = null;
  if (resumed) {
    const local = await loadProject(projectId);
    if (local) p = await WowProject.open(local.bytes);
    else { const snap = await school.loadAttemptSnapshot(attempt.id); if (snap) p = await WowProject.open(snap); }
  }
  if (!p) {
    if (test.start.kind === 'sample') p = await buildSample(test.start.sample as SampleId);
    else if (test.start.kind === 'file') { const b = await school.loadTestStart(test.id); if (!b) throw new Error('The starting database for this test is missing. Tell your teacher.'); p = await WowProject.open(b); }
    else p = await WowProject.create(test.title);
  }
  const bytes = p.db.export();
  await saveProject({ id: projectId, name: testDbName(test, attempt), bytes, modified: new Date().toISOString(), size: bytes.length });
  testProject = p;
  useApp.getState().setProject(p, projectId);
  useApp.getState().setBackstage(false);
  const counters = { ...zeroCounters(), ...attempt.counters };
  if (resumed) counters.reloads += 1;
  useExam.setState({ session: { test, attempt, projectId }, counters, phase: 'running', now: Date.now(), error: null, lastSnapshot: attempt.snapshotAt ?? null, flagged: {}, ready: false });
  try { localStorage.setItem(KEY, attempt.id); } catch { /* ignore */ }
  setLearningPaused(!test.settings.allowLearning);
  log(resumed ? 'resumed' : 'started', resumed ? 'The test page was reloaded or reopened.' : undefined);
  attach();
  if (!resumed) void snapshot();
  if (Date.parse(attempt.deadline) <= Date.now()) void submit(true);
}

/** After a reload: carry on with an unfinished attempt kept in this browser. */
export async function resumeFromStorage(): Promise<boolean> {
  let id: string | null = null;
  try { id = localStorage.getItem(KEY); } catch { return false; }
  const school = getBackend()?.school; if (!id || !school) return false;
  if (useExam.getState().session?.attempt.id === id) return true;   // already running (started in this page)
  try {
    const a = await school.getAttempt(id);
    if (!a || a.status !== 'in-progress') { localStorage.removeItem(KEY); return false; }
    const t = await school.getTest(a.testId); if (!t) return false;
    await beginAttempt(t, a, true);
    return true;
  } catch { return false; }
}

function attach() {
  detach?.();
  const onVis = () => {
    if (document.hidden) { bump('tabSwitches'); log('tab-hidden', 'Switched to another tab or app.'); void flushMonitor(); }
    else log('tab-visible');
  };
  let blurTimer: ReturnType<typeof setTimeout> | null = null;
  const onBlur = () => { blurTimer = setTimeout(() => { if (!document.hidden) { bump('focusLost'); log('focus-lost', 'Another window was in front of DBWOW.'); } }, 400); };
  const onFocus = () => { if (blurTimer) clearTimeout(blurTimer); };
  const onFs = () => { if (!document.fullscreenElement && useExam.getState().session?.test.settings.requireFullscreen && useExam.getState().phase === 'running') { bump('fullscreenExits'); log('fullscreen-exit'); } };
  const onPaste = (e: ClipboardEvent) => { const n = e.clipboardData?.getData('text')?.length ?? 0; bump('pastes'); bump('pastedChars', n); log('paste', `${n} characters`); };
  const onCopy = () => { bump('copies'); log('copy'); };
  const onInput = () => { lastInput = Date.now(); };
  document.addEventListener('visibilitychange', onVis);
  window.addEventListener('blur', onBlur); window.addEventListener('focus', onFocus);
  document.addEventListener('fullscreenchange', onFs);
  document.addEventListener('paste', onPaste, true); document.addEventListener('copy', onCopy, true);
  for (const ev of ['pointerdown', 'keydown', 'wheel', 'mousemove']) window.addEventListener(ev, onInput, { passive: true, capture: true });
  const unsubApp = useApp.subscribe((s, prev) => {
    const sess = useExam.getState().session; if (!sess) return;
    if (s.projectId === sess.projectId && s.project) testProject = s.project;
    if (s.version !== prev.version && s.projectId === sess.projectId) { bump('actions'); dirtySince ??= Date.now(); }
    if (s.projectId !== sess.projectId && !leftDbLogged) { leftDbLogged = true; log('left-test-database', s.project ? `Opened ${s.project.name}.` : 'Closed the test database.'); }
    // during the test only the test database may be open: bring it straight back
    if (s.projectId !== sess.projectId && useExam.getState().phase === 'running') void backToTestDb();
    if (s.projectId === sess.projectId) leftDbLogged = false;
  });
  const onUnload = () => { log('page-closed'); void flushMonitor(); };
  window.addEventListener('beforeunload', onUnload);
  timers = [
    setInterval(() => {
      useExam.setState({ now: Date.now() });
      if (document.hidden) bump('hiddenSec');
      else if (Date.now() - lastInput < 60000) bump('activeSec'); else bump('idleSec');
      if (useExam.getState().phase === 'running' && remainingMs() <= 0) void submit(true);
    }, 1000),
    setInterval(() => void flushMonitor(), 20000),
    setInterval(() => { if (dirtySince) void snapshot(); }, 45000),
  ];
  detach = () => {
    document.removeEventListener('visibilitychange', onVis);
    window.removeEventListener('blur', onBlur); window.removeEventListener('focus', onFocus);
    document.removeEventListener('fullscreenchange', onFs);
    document.removeEventListener('paste', onPaste, true); document.removeEventListener('copy', onCopy, true);
    for (const ev of ['pointerdown', 'keydown', 'wheel', 'mousemove']) window.removeEventListener(ev, onInput, { capture: true } as EventListenerOptions);
    window.removeEventListener('beforeunload', onUnload);
    unsubApp(); timers.forEach(clearInterval); timers = []; detach = null;
  };
}

let returning = false;
async function backToTestDb() {
  const sess = useExam.getState().session; if (!sess || returning) return;
  returning = true;
  try {
    let p = testProject;
    if (!p) { const l = await loadProject(sess.projectId); if (l) p = await WowProject.open(l.bytes); }
    if (!p) { const snap = await getBackend()?.school?.loadAttemptSnapshot(sess.attempt.id).catch(() => null); if (snap) p = await WowProject.open(snap); }
    if (!p || useApp.getState().projectId === sess.projectId) return;
    const bytes = p.db.export();   // put it back in this browser too, in case it was deleted
    await saveProject({ id: sess.projectId, name: testDbName(sess.test, sess.attempt), bytes, modified: new Date().toISOString(), size: bytes.length });
    useApp.getState().setProject(p, sess.projectId);
    useApp.getState().setStatus('During the test only your test database can be open.');
  } finally { returning = false; }
}

/** Send counters and buffered events to the cloud. */
export async function flushMonitor() {
  const s = useExam.getState(); const school = getBackend()?.school;
  if (!s.session || !school) return;
  const batch = events; events = [];
  try {
    await school.updateAttempt(s.session.attempt.id, { counters: s.counters, lastSeen: new Date().toISOString() });
    await school.logEvents(s.session.attempt.id, batch);
  } catch { events = [...batch, ...events]; }
}

/** Upload the student's current test database. */
export async function snapshot() {
  const s = useExam.getState(); const school = getBackend()?.school;
  const { project, projectId } = useApp.getState();
  if (!s.session || !school || projectId !== s.session.projectId || !project) return;
  useExam.setState({ saving: true });
  try {
    await school.saveAttemptSnapshot(s.session.attempt.id, project.db.export());
    dirtySince = null;
    useExam.setState({ saving: false, lastSnapshot: new Date().toISOString(), error: null });
  } catch (e) { useExam.setState({ saving: false, error: 'Could not save to the cloud: ' + (e as Error).message + '. Your work is kept in this browser; keep working.' }); }
}

/** Hand the test in. auto = time ran out. */
export async function submit(auto = false) {
  const s = useExam.getState(); const school = getBackend()?.school;
  if (!s.session || !school || s.phase !== 'running') return;
  useExam.setState({ phase: 'submitting' });
  log(auto ? 'auto-submitted' : 'submitted', auto ? 'Time ran out.' : undefined);
  // make sure the test database is the one being saved
  if (useApp.getState().projectId !== s.session.projectId) {
    if (testProject) useApp.getState().setProject(testProject, s.session.projectId);
    else { const local = await loadProject(s.session.projectId); if (local) useApp.getState().setProject(await WowProject.open(local.bytes), s.session.projectId); }
  }
  await snapshot();
  try {
    await school.updateAttempt(s.session.attempt.id, { status: 'submitted', submittedAt: new Date().toISOString(), autoSubmitted: auto, counters: useExam.getState().counters, lastSeen: new Date().toISOString() });
    await school.logEvents(s.session.attempt.id, events); events = [];
    useExam.setState({ phase: 'submitted' });
    setLearningPaused(false);
    try { localStorage.removeItem(KEY); } catch { /* ignore */ }
    detach?.();
    if (document.fullscreenElement) await document.exitFullscreen().catch(() => undefined);
  } catch (e) {
    useExam.setState({ phase: 'running', ready: false, error: 'Submitting failed: ' + (e as Error).message + '. Check your connection and press Submit again.' });
  }
}

/** Close the finished-test panel. */
export function closeExam() { testProject = null; detach?.(); setLearningPaused(false); useExam.setState({ session: null, phase: 'idle', counters: zeroCounters(), flagged: {}, ready: false }); }

export function requestFullscreen() { if (!document.fullscreenElement) void document.documentElement.requestFullscreen?.().catch(() => undefined); }
