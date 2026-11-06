'use client';
// Student side of practical tests: the Tests page in File, the test panel with
// timer and tasks, and the full-screen prompt.
import React, { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, ClipboardCheck, Clock, Flag, Maximize, Printer, Users, XCircle } from 'lucide-react';
import { pdfBytes, studentResultPdf } from '@/exam/print';
import { downloadBytes } from '@/engine/persistence';
import { cloudMessage } from '@/cloud/backend';
import { getBackend, useCloud } from '@/cloud/sync';
import { create } from 'zustand';
import { DEFAULT_DETAILS, PLEDGE, startWindow, type Attempt, type ClassInfo, type TestPublic } from '@/cloud/school';
import { beginAttempt, closeExam, examActive, remainingMs, requestFullscreen, snapshot, submit, useExam } from '@/exam/session';
import { loadProject } from '@/engine/persistence';
import { WowProject } from '@/engine/project';
import { useApp } from './store';
import { confirmBox, messageBox, openDialog } from './dialogs';

const fmt = (ms: number) => { const s = Math.max(0, Math.round(ms / 1000)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return (h ? `${h}:${String(m).padStart(2, '0')}` : `${m}`) + `:${String(x).padStart(2, '0')}`; };

/** Open the Take a test page, optionally with the code filled in. */
export const useTake = create<{ open: boolean; code: string }>(() => ({ open: false, code: '' }));
export function openTakeTest(code = '') { useTake.setState({ open: true, code: code.trim().toUpperCase() }); }
export async function startTestByCode(code: string): Promise<string | null> { openTakeTest(code); return null; }

const DETAILS_KEY = 'dbwow.details';
const fmtWhen = (ms: number) => new Date(ms).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** Students join by link: full name, class details, the test code and the pledge. No account needed. */
export function TakeTestPage() {
  const { open, code: initialCode } = useTake();
  const user = useCloud((s) => s.user);
  const [name, setName] = useState('');
  const [fields, setFields] = useState<string[]>(DEFAULT_DETAILS);
  const [vals, setVals] = useState<Record<string, string>>({});
  const [code, setCode] = useState('');
  const [pledge, setPledge] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setCode(initialCode); setPledge(false); setErr(null);
    try { const old = JSON.parse(localStorage.getItem(DETAILS_KEY) ?? '{}') as Record<string, string>; setVals(old); if (old.__name) setName(old.__name); } catch { /* ignore */ }
  }, [open, initialCode]);
  useEffect(() => { if (open && user && !user.anonymous && !name) setName(user.name); }, [open, user]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!open) return null;
  const close = () => useTake.setState({ open: false });
  const take = async () => {
    setErr(null);
    const full = name.trim().replace(/\s+/g, ' ');
    if (full.split(' ').length < 2) { setErr('Enter your name in full (first name and surname).'); return; }
    const miss = fields.filter((f) => !vals[f]?.trim());
    if (miss.length) { setErr(`Fill in ${miss.join(' and ')}.`); return; }
    if (!code.trim()) { setErr('Enter the test code your teacher gave you.'); return; }
    if (!pledge) { setErr('Tick the pledge to take the test.'); return; }
    const be = getBackend(); const school = be?.school;
    if (!be || !school) { setErr('Tests need the online version of DBWOW (open the link your teacher gave you).'); return; }
    setBusy(true);
    try {
      let u = useCloud.getState().user;
      if (!u || u.anonymous) { if (!be.signInAsGuest) throw new Error('Sign-in for tests is not available.'); u = await be.signInAsGuest(full); }
      const t = await school.findTest(code);
      if (!t) throw new Error('No open test has that code. Check the code with your teacher.');
      const need = t.paper?.details?.length ? t.paper.details : DEFAULT_DETAILS;
      const missing = need.filter((f) => !vals[f]?.trim());
      if (missing.length) { setFields(need); throw new Error(`This test also asks for ${missing.join(' and ')}. Fill ${missing.length > 1 ? 'them' : 'it'} in, then press Take the test again.`); }
      const details = Object.fromEntries(need.map((f) => [f, vals[f].trim()]));
      try { localStorage.setItem(DETAILS_KEY, JSON.stringify({ ...details, __name: full })); } catch { /* ignore */ }
      // carry on with an attempt already started in this browser, even after the start window
      const existing = await school.getAttempt(`${t.id}_${u.uid}`).catch(() => null);
      if (existing?.status === 'submitted') throw new Error('You have already handed in this test.');
      if (!existing) {
        const w = startWindow(t);
        if (w === 'early') throw new Error(`This test opens at ${fmtWhen(t.opensAtMs!)}. Wait until then.`);
        if (w === 'closed') throw new Error(t.closesAtMs ? `This test could only be started until ${fmtWhen(t.closesAtMs)}. It is no longer available.` : 'This test is closed.');
      }
      const { attempt, resumed } = await school.startAttempt(t, { name: full, details, pledge: PLEDGE });
      if (attempt.status === 'submitted') throw new Error('You have already handed in this test.');
      if (t.settings.requireFullscreen) requestFullscreen();
      await beginAttempt(t, attempt, resumed);
      close();
    } catch (e) { setErr(e instanceof Error && !(e as { code?: string }).code ? e.message : cloudMessage(e)); } finally { setBusy(false); }
  };
  return (
    <div className="take-cover" data-testid="take-test">
      <form className="take-box" onSubmit={(e) => { e.preventDefault(); void take(); }}>
        <h1>Take a practical test</h1>
        <p className="small muted mb-3">You do not need an account. Fill in your details exactly as your teacher wants them on your paper.</p>
        <label className="take-field">Full name (first name and surname)<input value={name} onChange={(e) => setName(e.target.value)} aria-label="Full name" autoComplete="name" autoFocus /></label>
        <div className="take-row">{fields.map((f) => <label key={f} className="take-field">{f}<input value={vals[f] ?? ''} onChange={(e) => setVals({ ...vals, [f]: e.target.value })} aria-label={f} data-testid="detail-input" /></label>)}</div>
        <label className="take-field">Test code<input className="code-input" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} aria-label="Test code" maxLength={12} /></label>
        <label className="take-pledge"><input type="checkbox" checked={pledge} onChange={(e) => setPledge(e.target.checked)} data-testid="pledge" /><span><b>My pledge.</b> {PLEDGE}</span></label>
        {err && <div className="banner warn mb-2" role="alert">{err}</div>}
        <div className="flex gap-2" style={{ alignItems: 'center' }}>
          <button className="btn btn-primary take-go" disabled={busy} data-testid="start-test">{busy ? 'Opening…' : 'Take the test'}</button>
          <button type="button" className="link" onClick={close}>Back to DBWOW</button>
        </div>
        <p className="small muted mt-3">When you press Take the test, the timer starts and DBWOW turns red. It turns green when you are ready to submit or once your work is handed in.</p>
      </form>
    </div>
  );
}

/** A bar across the top of the window showing how much of the test time is left. */
export function ExamTimeBar() {
  const { session, phase } = useExam(); const now = useExam((s) => s.now);
  if (!session || phase === 'idle') return null;
  const total = session.test.durationMin * 60000;
  const left = phase === 'submitted' ? 0 : Math.max(0, Date.parse(session.attempt.deadline) - now);
  const pct = Math.max(0, Math.min(100, (left / total) * 100));
  return (
    <div className="exam-bar" role="progressbar" aria-label="Time left" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)} data-testid="time-bar">
      <div className="exam-bar-fill" style={{ width: `${phase === 'submitted' ? 100 : pct}%` }} />
      <span className="exam-bar-text">{phase === 'submitted' ? 'Handed in' : `${fmt(left)} left`}</span>
    </div>
  );
}

/** Red while a test runs; green when the student is ready to submit and after hand-in. */
export function useExamTheme() {
  const phase = useExam((s) => s.phase); const ready = useExam((s) => s.ready);
  useEffect(() => {
    const el = document.documentElement;
    el.classList.toggle('exam-red', phase === 'running' && !ready);
    el.classList.toggle('exam-green', phase === 'submitting' || phase === 'submitted' || (phase === 'running' && ready));
    return () => { el.classList.remove('exam-red', 'exam-green'); };
  }, [phase, ready]);
}

/** The test panel shown during (and just after) a test. */
export function ExamPanel() {
  const { session, phase, counters, saving, lastSnapshot, error, flagged } = useExam();
  const now = useExam((s) => s.now);
  const projectId = useApp((s) => s.projectId);
  useExamTheme();
  const [fs, setFs] = useState(true);
  useEffect(() => { const f = () => setFs(!!document.fullscreenElement); f(); document.addEventListener('fullscreenchange', f); return () => document.removeEventListener('fullscreenchange', f); }, []);
  if (!session) return null;
  const { test } = session;
  const left = remainingMs(); void now;
  const marks = test.tasks.reduce((s, x) => s + x.marks, 0);
  const onTestDb = projectId === session.projectId;
  if (phase === 'submitted') return (
    <div className="xp done" data-testid="exam-panel">
      <div className="xp-head"><ClipboardCheck size={15} /><b style={{ flex: 1 }}>{test.title}</b></div>
      <div style={{ padding: 12 }}>
        <p className="mb-2"><CheckCircle2 size={15} color="#3c8d40" style={{ display: 'inline', verticalAlign: -3 }} /> Handed in. Your teacher will mark it and release the results; you will see them in File &gt; Tests.</p>
        <button className="btn btn-primary" onClick={closeExam} data-testid="close-exam">Close</button>
      </div>
    </div>
  );
  return (
    <>
      {test.settings.requireFullscreen && !fs && phase === 'running' && (
        <div className="xp-cover" data-testid="fullscreen-cover">
          <div className="xp-cover-box">
            <Maximize size={28} color="#1f5fae" />
            <h2>This test runs in full screen</h2>
            <p className="mb-3">Leaving full screen is recorded for your teacher. Your timer is still running.</p>
            <button className="btn btn-primary" onClick={requestFullscreen} data-testid="return-fullscreen">Return to full screen</button>
          </div>
        </div>
      )}
      <div className="xp" data-testid="exam-panel">
        <div className={'xp-head' + (left < 5 * 60000 ? ' low' : '')}>
          <ClipboardCheck size={15} /><b style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{test.title}</b>
          <span className="xp-timer" data-testid="exam-timer" aria-live="off"><Clock size={13} /> {fmt(left)}</span>
        </div>
        {!onTestDb && <div className="xp-warn"><AlertTriangle size={13} /> You are not in the test database. <button className="link" onClick={async () => { const l = await loadProject(session.projectId); if (l) useApp.getState().setProject(await WowProject.open(l.bytes), session.projectId); }}>Go back to it</button></div>}
        {error && <div className="xp-warn">{error}</div>}
        <div className="xp-list">
          {test.instructions && <div className="xp-instr">{test.instructions}</div>}
          {test.tasks.map((t, i) => (
            <div key={t.id} className={'xp-task' + (flagged[t.id] ? ' flag' : '')}>
              <div className="xp-num">{i + 1}</div>
              <div style={{ flex: 1, whiteSpace: 'pre-wrap' }}>{t.text}<span className="xp-marks"> [{t.marks}]</span></div>
              <button className="icon-btn" title={flagged[t.id] ? 'Unflag' : 'Flag to come back to'} onClick={() => useExam.setState((s) => ({ flagged: { ...s.flagged, [t.id]: !s.flagged[t.id] } }))}><Flag size={13} color={flagged[t.id] ? '#c25a1c' : '#999'} fill={flagged[t.id] ? '#c25a1c' : 'none'} /></button>
            </div>
          ))}
        </div>
        <div className="xp-foot">
          <span className="small muted">{saving ? 'Saving…' : lastSnapshot ? `Saved ${new Date(lastSnapshot).toLocaleTimeString()}` : 'Not saved yet'} · {marks} marks{counters.tabSwitches ? ` · ${counters.tabSwitches} tab switch${counters.tabSwitches > 1 ? 'es' : ''} recorded` : ''}</span>
          <span style={{ display: 'flex', gap: 6 }}>
            <button className="btn btn-sm" onClick={() => void snapshot()} disabled={saving || phase !== 'running'}>Save now</button>
            <button className="btn btn-sm btn-primary" disabled={phase !== 'running'} data-testid="submit-test" onClick={async () => { useExam.setState({ ready: true }); if (await confirmBox(`Hand in "${test.title}" now? You cannot change it afterwards.${Object.values(flagged).some(Boolean) ? '\n\nYou still have flagged tasks.' : ''}`, { title: 'Ready to submit?', ok: 'Submit', cancel: 'Keep working' })) void submit(false); else useExam.setState({ ready: false }); }}>{phase === 'submitting' ? 'Submitting…' : 'Submit'}</button>
          </span>
        </div>
      </div>
    </>
  );
}

/** File > Tests: enter a code, join a class, see results. */
export function TestsPage({ goAccount, openTeacher }: { goAccount: () => void; openTeacher: () => void }) {
  const { available, user } = useCloud();
  const [code, setCode] = useState('');
  const [classCode, setClassCode] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const busy = false;
  const [teacher, setTeacher] = useState(false);
  const [classes, setClasses] = useState<ClassInfo[]>([]);
  const [attempts, setAttempts] = useState<(Attempt & { testTitle?: string })[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const school = getBackend()?.school;
  const printMine = async (a: Attempt & { testTitle?: string }) => {
    let t: TestPublic | null = null; try { t = (await school?.getTest(a.testId)) ?? null; } catch { /* wording not available */ }
    const res = a.taskResults ?? [];
    const raw = res.reduce((s, r) => s + r.marks, 0);
    const doc = studentResultPdf(a.testTitle ?? t?.title ?? 'Practical test', {
      name: a.name, email: a.email, details: a.details, status: 'handed in', submittedAt: a.submittedAt, autoSubmitted: a.autoSubmitted,
      score: raw, max: a.max ?? res.reduce((s, r) => s + r.max, 0), adjust: a.teacherAdjust, comment: a.comment,
      tasks: res.map((r, i) => ({ text: t?.tasks.find((x) => x.id === r.id)?.text ?? `Task ${i + 1}`, marks: r.marks, max: r.max, ok: r.ok, reason: r.reason })),
    }, t?.paper);
    downloadBytes(pdfBytes(doc), `${a.testTitle ?? 'Test'} result.pdf`, 'application/pdf');
  };
  const guest = !!user?.anonymous;
  const refresh = () => { if (!school || !user) return; if (!guest) { void school.isTeacher().then(setTeacher).catch(() => undefined); void school.myClasses().then(setClasses).catch(() => undefined); } void school.myAttempts().then(setAttempts).catch(() => setAttempts([])); };
  useEffect(refresh, [user]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!available || !school) return <div><h1>Tests</h1><p>Practical tests are available on the online version of DBWOW, with an account.</p></div>;
  if (!user) return <div><h1>Tests</h1><p className="mb-3">You do not need an account to take a practical test. You will give your full name, class and section, and the test code.</p><button className="btn btn-primary" onClick={() => openTakeTest()} data-testid="open-take">Take a test</button><p className="small muted mt-3">Students with an account can <button className="link" onClick={goAccount}>sign in</button> to see their classes and released results here.</p></div>;
  if (examActive()) return <div><h1>Tests</h1><p>You are in a test. Use the test panel to submit.</p></div>;
  return (
    <div style={{ maxWidth: 760 }}>
      <h1>Tests</h1>
      {teacher && <div className="banner info mb-3" style={{ border: '1px solid #c5d9f1' }}>You are a teacher. <button className="btn btn-sm btn-primary" onClick={openTeacher} data-testid="open-teacher">Open the Teacher dashboard</button></div>}
      <h2 style={{ marginTop: 0 }}>Take a practical test</h2>
      {guest && <p className="small muted mb-2">You are taking tests without an account as {user.name}. Results of tests taken in this browser appear below once your teacher releases them.</p>}
      <form className="flex gap-2 mb-1" onSubmit={(e) => { e.preventDefault(); openTakeTest(code); }}>
        <input className="code-input" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="Test code" aria-label="Test code" maxLength={12} />
        <button className="btn btn-primary" disabled={!code.trim() || busy} data-testid="find-test">{busy ? 'Opening…' : 'Start'}</button>
      </form>
      <p className="small muted mb-3">Your teacher gives you the code when the test opens.</p>
      {msg && <div className="banner warn mb-3" role="alert">{msg}</div>}

      {!guest && <>
      <h2>My classes</h2>
      {classes.length > 0 && <ul className="mb-2">{classes.map((c) => <li key={c.id}><Users size={13} style={{ display: 'inline', marginRight: 5 }} />{c.name} <span className="muted small">({c.ownerName})</span></li>)}</ul>}
      <form className="flex gap-2 mb-3" onSubmit={async (e) => { e.preventDefault(); try { const c = await school.joinClass(classCode); setClassCode(''); setMsg(`You joined ${c.name}.`); refresh(); } catch (er) { setMsg(cloudMessage(er)); } }}>
        <input className="code-input" value={classCode} onChange={(e) => setClassCode(e.target.value.toUpperCase())} placeholder="Class code" aria-label="Class code" maxLength={12} />
        <button className="btn" disabled={!classCode.trim()} data-testid="join-class">Join class</button>
      </form>
      </>}

      <h2>My results</h2>
      <p className="small muted mb-2">Click a marked test to see each task. You can print the result sheet.</p>
      {attempts === null && <p className="muted">Loading…</p>}
      {attempts?.length === 0 && <p className="muted">No tests taken yet.</p>}
      {attempts?.map((a) => (
        <div key={a.id} className="res-row" data-testid="my-result">
          <div className="flex items-center gap-2" style={{ cursor: a.taskResults ? 'pointer' : 'default' }} onClick={() => setOpen(open === a.id ? null : a.id)}>
            <b style={{ flex: 1 }}>{a.testTitle ?? a.testId}</b>
            <span className="small muted">{new Date(a.startedAt).toLocaleDateString()}</span>
            {a.status === 'in-progress' ? <span className="tag">In progress</span> : a.score !== undefined ? <span className="tag ok" data-testid="my-score">{a.score} / {a.max}</span> : <span className="tag">Waiting for marks</span>}
          </div>
          {open === a.id && a.taskResults && <div className="mt-2">{a.taskResults.map((r, i) => (
            <div key={r.id} className="small flex gap-2" style={{ padding: '2px 0' }}>{r.ok ? <CheckCircle2 size={14} color="#3c8d40" /> : <XCircle size={14} color="#a4262c" />}<span style={{ flex: 1 }}>Task {i + 1}: {r.reason}</span><b>{r.marks}/{r.max}</b></div>
          ))}
            {a.teacherAdjust ? <div className="small mt-1">Teacher adjustment: {a.teacherAdjust > 0 ? '+' : ''}{a.teacherAdjust}</div> : null}
            {a.comment ? <div className="small mt-1">Teacher&apos;s comment: {a.comment}</div> : null}
            <button className="btn btn-sm mt-2" data-testid="print-my-result" onClick={() => void printMine(a)}><Printer size={13} /> Print or save as PDF</button>
          </div>}
        </div>
      ))}
    </div>
  );
}

export { messageBox };
