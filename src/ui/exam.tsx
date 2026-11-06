'use client';
// Student side of practical tests: the Tests page in File, the test panel with
// timer and tasks, and the full-screen prompt.
import React, { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, ClipboardCheck, Clock, Flag, Maximize, Printer, Users, XCircle } from 'lucide-react';
import { pdfBytes, studentResultPdf } from '@/exam/print';
import { downloadBytes } from '@/engine/persistence';
import { cloudMessage } from '@/cloud/backend';
import { getBackend, useCloud } from '@/cloud/sync';
import type { Attempt, ClassInfo, TestPublic } from '@/cloud/school';
import { beginAttempt, closeExam, examActive, remainingMs, requestFullscreen, snapshot, submit, useExam } from '@/exam/session';
import { loadProject } from '@/engine/persistence';
import { WowProject } from '@/engine/project';
import { useApp } from './store';
import { confirmBox, messageBox, openDialog } from './dialogs';
import { openAuthDialog } from './cloud';

const fmt = (ms: number) => { const s = Math.max(0, Math.round(ms / 1000)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return (h ? `${h}:${String(m).padStart(2, '0')}` : `${m}`) + `:${String(x).padStart(2, '0')}`; };

/** Ask for a test code, show the rules, then start. */
export async function startTestByCode(code: string): Promise<string | null> {
  const be = getBackend(); const school = be?.school;
  if (!school) return 'Tests need the online version of DBWOW.';
  if (!useCloud.getState().user) { const ok = await openAuthDialog('signin'); if (!ok) return null; }
  let t: TestPublic | null;
  try { t = await school.findTest(code); } catch (e) { return cloudMessage(e); }
  if (!t) return 'No open test has that code. Check the code, or ask your teacher whether the test is open.';
  const marks = t.tasks.reduce((s, x) => s + x.marks, 0);
  const go = await openDialog<boolean>(t.title, (close) => (
    <div style={{ maxWidth: 520 }} data-testid="test-intro">
      <p className="mb-2"><b>{t!.durationMin} minutes</b> · {t!.tasks.length} tasks · {marks} marks{t!.ownerName ? ` · set by ${t!.ownerName}` : ''}</p>
      {t!.instructions && <p className="mb-3" style={{ whiteSpace: 'pre-wrap' }}>{t!.instructions}</p>}
      <div className="banner info mb-2" style={{ border: '1px solid #c5d9f1' }}>
        <b>Before you start</b>
        <ul className="small" style={{ margin: '4px 0 0 18px', listStyle: 'disc' }}>
          <li>The timer starts now and keeps running if you close the page. You can come back to it.</li>
          <li>Your work is saved to your teacher automatically. Submit when you finish; it is handed in automatically when time runs out.</li>
          <li>Your teacher can see if you switch to another tab or app{t!.settings.requireFullscreen ? ', leave full screen' : ''}, or paste text.</li>
          {!t!.settings.allowLearning && <li>The Learning Centre and hints are closed during the test.</li>}
        </ul>
      </div>
      <div className="dlg-buttons"><button className="btn btn-primary" onClick={() => close(true)} data-testid="start-test">Start the test</button><button className="btn" onClick={() => close(null)}>Not now</button></div>
    </div>
  ), 560);
  if (!go) return null;
  try {
    const { attempt, resumed } = await school.startAttempt(t);
    if (attempt.status === 'submitted') return 'You have already handed in this test.';
    if (t.settings.requireFullscreen) requestFullscreen();
    await beginAttempt(t, attempt, resumed);
    return null;
  } catch (e) { return cloudMessage(e); }
}

/** The test panel shown during (and just after) a test. */
export function ExamPanel() {
  const { session, phase, counters, saving, lastSnapshot, error, flagged } = useExam();
  const now = useExam((s) => s.now);
  const projectId = useApp((s) => s.projectId);
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
            <button className="btn btn-sm btn-primary" disabled={phase !== 'running'} data-testid="submit-test" onClick={async () => { if (await confirmBox(`Hand in "${test.title}" now? You cannot change it afterwards.${Object.values(flagged).some(Boolean) ? '\n\nYou still have flagged tasks.' : ''}`, { title: 'Submit test', ok: 'Submit', cancel: 'Keep working' })) void submit(false); }}>{phase === 'submitting' ? 'Submitting…' : 'Submit'}</button>
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
  const [busy, setBusy] = useState(false);
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
      name: a.name, email: a.email, status: 'handed in', submittedAt: a.submittedAt, autoSubmitted: a.autoSubmitted,
      score: raw, max: a.max ?? res.reduce((s, r) => s + r.max, 0), adjust: a.teacherAdjust, comment: a.comment,
      tasks: res.map((r, i) => ({ text: t?.tasks.find((x) => x.id === r.id)?.text ?? `Task ${i + 1}`, marks: r.marks, max: r.max, ok: r.ok, reason: r.reason })),
    });
    downloadBytes(pdfBytes(doc), `${a.testTitle ?? 'Test'} result.pdf`, 'application/pdf');
  };
  const refresh = () => { if (!school || !user) return; void school.isTeacher().then(setTeacher).catch(() => undefined); void school.myClasses().then(setClasses).catch(() => undefined); void school.myAttempts().then(setAttempts).catch(() => setAttempts([])); };
  useEffect(refresh, [user]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!available || !school) return <div><h1>Tests</h1><p>Practical tests are available on the online version of DBWOW, with an account.</p></div>;
  if (!user) return <div><h1>Tests</h1><p className="mb-3">You need to sign in to take a practical test, so your work and marks go to your teacher.</p><button className="btn btn-primary" onClick={goAccount}>Register or sign in</button></div>;
  if (examActive()) return <div><h1>Tests</h1><p>You are in a test. Use the test panel to submit.</p></div>;
  return (
    <div style={{ maxWidth: 760 }}>
      <h1>Tests</h1>
      {teacher && <div className="banner info mb-3" style={{ border: '1px solid #c5d9f1' }}>You are a teacher. <button className="btn btn-sm btn-primary" onClick={openTeacher} data-testid="open-teacher">Open the Teacher dashboard</button></div>}
      <h2 style={{ marginTop: 0 }}>Take a practical test</h2>
      <form className="flex gap-2 mb-1" onSubmit={async (e) => { e.preventDefault(); setBusy(true); setMsg(await startTestByCode(code)); setBusy(false); }}>
        <input className="code-input" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="Test code" aria-label="Test code" maxLength={12} />
        <button className="btn btn-primary" disabled={!code.trim() || busy} data-testid="find-test">{busy ? 'Opening…' : 'Start'}</button>
      </form>
      <p className="small muted mb-3">Your teacher gives you the code when the test opens.</p>
      {msg && <div className="banner warn mb-3" role="alert">{msg}</div>}

      <h2>My classes</h2>
      {classes.length > 0 && <ul className="mb-2">{classes.map((c) => <li key={c.id}><Users size={13} style={{ display: 'inline', marginRight: 5 }} />{c.name} <span className="muted small">({c.ownerName})</span></li>)}</ul>}
      <form className="flex gap-2 mb-3" onSubmit={async (e) => { e.preventDefault(); try { const c = await school.joinClass(classCode); setClassCode(''); setMsg(`You joined ${c.name}.`); refresh(); } catch (er) { setMsg(cloudMessage(er)); } }}>
        <input className="code-input" value={classCode} onChange={(e) => setClassCode(e.target.value.toUpperCase())} placeholder="Class code" aria-label="Class code" maxLength={12} />
        <button className="btn" disabled={!classCode.trim()} data-testid="join-class">Join class</button>
      </form>

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
