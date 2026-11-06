'use client';
// Teacher dashboard: classes, test builder, live monitor, results and student analytics.
import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowDown, ArrowUp, BarChart3, CheckCircle2, ClipboardList, Copy, Download, Eye, Plus, Printer, RefreshCw, Trash2, Users, Wand2, XCircle } from 'lucide-react';
import { cloudMessage } from '@/cloud/backend';
import { getBackend, useCloud } from '@/cloud/sync';
import { DEFAULT_DETAILS, newCode, today, zeroCounters, type PaperSettings, type Attempt, type AttemptEvent, type ClassInfo, type DayStats, type Member, type StoredGrade, type TestKey, type TestPublic } from '@/cloud/school';
import { describeCheck, grade, type Check, type ExamTask, type GradeResult } from '@/exam/checks';
import { WowProject, uid } from '@/engine/project';
import { SAMPLE_LIST, buildSample, type SampleId } from '@/engine/samples';
import { LEVELS, readyTest, startDatabase, taskLibrary, type LevelId, type LibTask } from '@/exam/library';
import { pdfBytes, resultsPdf, type PrintStudent } from '@/exam/print';
import { blocksToDocx, blocksToPdf, logoFromFile, markScheme, questionPaper, spreadMarks, type PaperInfo } from '@/exam/paper';
import { saveProject } from '@/engine/persistence';
import { downloadBytes } from '@/engine/persistence';
import type { DataType } from '@/engine/types';
import { totalXp, rankFor, ALL_ACHIEVEMENTS, type LearnState } from '@/learning/achievements';
import { useApp } from './store';
import { confirmBox, messageBox, openDialog, promptBox } from './dialogs';

type Section = { k: 'classes' } | { k: 'tests' } | { k: 'edit'; id: string | null } | { k: 'monitor'; id: string } | { k: 'results'; id: string } | { k: 'students' };

export function TeacherDashboard() {
  const user = useCloud((s) => s.user);
  const school = getBackend()?.school;
  const [ok, setOk] = useState<boolean | null>(null);
  const [sec, setSec] = useState<Section>({ k: 'tests' });
  const [classes, setClasses] = useState<ClassInfo[]>([]);
  const [tests, setTests] = useState<TestPublic[]>([]);
  const reload = () => { if (!school) return; void school.listClasses().then(setClasses).catch(() => undefined); void school.listTests().then(setTests).catch(() => undefined); };
  useEffect(() => { if (!school || !user) { setOk(false); return; } void school.isTeacher().then((t) => { setOk(t); if (t) reload(); }).catch(() => setOk(false)); }, [user]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!school || !user) return <div className="tz-empty">Sign in with a teacher account to use the Teacher dashboard.</div>;
  if (ok === null) return <div className="tz-empty">Checking teacher access…</div>;
  if (!ok) return <NotTeacher />;
  const nav = (label: string, s: Section, icon: React.ReactNode, active: boolean) => <button className={'tz-nav' + (active ? ' on' : '')} onClick={() => { setSec(s); reload(); }}>{icon}{label}</button>;
  return (
    <div className="tz" data-testid="teacher">
      <div className="tz-side">
        <div className="tz-title">Teacher</div>
        {nav('Tests', { k: 'tests' }, <ClipboardList size={14} />, ['tests', 'edit', 'monitor', 'results'].includes(sec.k))}
        {nav('Classes', { k: 'classes' }, <Users size={14} />, sec.k === 'classes')}
        {nav('Student progress', { k: 'students' }, <BarChart3 size={14} />, sec.k === 'students')}
      </div>
      <div className="tz-main">
        {sec.k === 'classes' && <ClassesView classes={classes} reload={reload} />}
        {sec.k === 'tests' && <TestsList tests={tests} classes={classes} go={setSec} reload={reload} />}
        {sec.k === 'edit' && <TestEditor id={sec.id} classes={classes} done={(id) => { reload(); setSec(id ? { k: 'tests' } : { k: 'tests' }); }} />}
        {sec.k === 'monitor' && <Monitor test={tests.find((t) => t.id === sec.id)} go={setSec} />}
        {sec.k === 'results' && <Results test={tests.find((t) => t.id === sec.id)} classes={classes} go={setSec} reload={reload} />}
        {sec.k === 'students' && <StudentsView classes={classes} tests={tests} />}
      </div>
    </div>
  );
}

function NotTeacher() {
  const user = useCloud((s) => s.user)!;
  const be = getBackend()!;
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div className="tz-empty" style={{ maxWidth: 620 }}>
      <h2>Teacher access</h2>
      <p className="mb-2">This account ({user.email}) is not a teacher account.</p>
      {!user.emailVerified && <p className="mb-2">If this is the school&apos;s teacher address, verify it first: <button className="btn btn-sm" onClick={async () => { try { await be.sendVerification?.(); setMsg(`A verification link was sent to ${user.email}. Open it, then press "I have verified".`); } catch (e) { setMsg(cloudMessage(e)); } }}>Send verification email</button> <button className="btn btn-sm" onClick={async () => { const u = await be.refreshUser?.(); if (u) useCloud.setState({ user: u }); }}>I have verified</button></p>}
      <p className="small muted">An existing teacher can add other teachers from Classes &gt; Add a teacher.</p>
      {msg && <div className="banner info mt-2">{msg}</div>}
    </div>
  );
}

// ---------------------------------------------------------------- classes
function ClassesView({ classes, reload }: { classes: ClassInfo[]; reload: () => void }) {
  const school = getBackend()!.school!;
  const [sel, setSel] = useState<string | null>(classes[0]?.id ?? null);
  const [members, setMembers] = useState<Member[] | null>(null);
  useEffect(() => { if (!sel) return; setMembers(null); void school.classMembers(sel).then(setMembers).catch(() => setMembers([])); }, [sel]); // eslint-disable-line react-hooks/exhaustive-deps
  const cls = classes.find((c) => c.id === sel);
  return (
    <div>
      <div className="tz-head"><h1>Classes</h1>
        <button className="btn btn-primary" data-testid="new-class" onClick={async () => { const n = await promptBox('Class name:', '', 'New class', (v) => (v.trim() ? null : 'Enter a name.')); if (!n) return; const c = await school.createClass(n); reload(); setSel(c.id); }}><Plus size={13} /> New class</button>
        <button className="btn" onClick={async () => { const e = await promptBox('Email of the teacher to add (they must have registered):', '', 'Add a teacher'); if (!e) return; try { await school.addTeacher(e); void messageBox(`${e} is now a teacher.`, 'Add a teacher'); } catch (er) { void messageBox(cloudMessage(er), 'Add a teacher', 'warn'); } }}>Add a teacher</button>
      </div>
      {!classes.length && <p className="muted">No classes yet. Create one, then give students its code: they enter it in File &gt; Tests &gt; Join class.</p>}
      <div className="tz-chips">{classes.map((c) => <button key={c.id} className={'tz-chip' + (c.id === sel ? ' on' : '')} onClick={() => setSel(c.id)}>{c.name}</button>)}</div>
      {cls && <div className="mt-3">
        <div className="tz-code">Class code <b data-testid="class-code">{cls.code}</b> <button className="icon-btn" title="Copy" onClick={() => void navigator.clipboard?.writeText(cls.code)}><Copy size={13} /></button>
          <button className="btn btn-sm" style={{ marginLeft: 'auto' }} onClick={async () => { if (await confirmBox(`Delete the class ${cls.name}? Students' work and test results are kept.`, { danger: true })) { await school.deleteClass(cls.id); setSel(null); reload(); } }}><Trash2 size={13} /> Delete class</button></div>
        <table className="tz-table mt-2"><thead><tr><th>Student</th><th>Email</th><th>Joined</th><th /></tr></thead><tbody>
          {members?.map((m) => <tr key={m.uid}><td>{m.name}</td><td>{m.email}</td><td>{new Date(m.joined).toLocaleDateString()}</td><td><button className="icon-btn" title="Remove from class" onClick={async () => { if (await confirmBox(`Remove ${m.name} from ${cls.name}?`)) { await school.removeMember(cls.id, m.uid); setMembers(members.filter((x) => x.uid !== m.uid)); } }}><Trash2 size={13} /></button></td></tr>)}
          {members?.length === 0 && <tr><td colSpan={4} className="muted">No students yet.</td></tr>}
        </tbody></table>
      </div>}
    </div>
  );
}

// ---------------------------------------------------------------- school and paper settings
const PAPER_KEY = 'dbwow.paper';
function paperDefaults(): PaperSettings {
  try { const d = JSON.parse(localStorage.getItem(PAPER_KEY) ?? 'null') as Partial<PaperSettings> | null; if (d) return { school: d.school ?? '', logo: d.logo, details: d.details?.length ? d.details : DEFAULT_DETAILS }; } catch { /* ignore */ }
  return { school: '', details: DEFAULT_DETAILS };
}
function PaperFields({ t, setT, marks, spread }: { t: TestPublic; setT: (t: TestPublic) => void; marks: number; spread: (n: number) => void }) {
  const p = t.paper ?? { school: '', details: DEFAULT_DETAILS };
  const set = (patch: Partial<PaperSettings>) => setT({ ...t, paper: { ...p, ...patch } });
  const [detailText, setDetailText] = useState(p.details.join(', '));
  const want = p.totalMarks;
  return (
    <div className="tz-paper mt-3">
      <h2 style={{ margin: '0 0 6px' }}>School and paper</h2>
      <div className="tz-form">
        <label>School name<input value={p.school} onChange={(e) => set({ school: e.target.value })} aria-label="School name" placeholder="Printed at the top of every paper" /></label>
        <label>Logo
          <span className="flex gap-2" style={{ alignItems: 'center' }}>
            {p.logo && <img src={p.logo} alt="School logo" style={{ height: 34, border: '1px solid var(--line)' }} data-testid="logo-preview" />}
            <input type="file" accept="image/png,image/jpeg,image/gif,image/webp" aria-label="Logo" style={{ border: 0, padding: 0 }} onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; try { set({ logo: await logoFromFile(f) }); } catch (er) { void messageBox((er as Error).message, 'Logo', 'warn'); } e.target.value = ''; }} />
            {p.logo && <button className="link small" onClick={() => set({ logo: undefined })}>Remove</button>}
          </span>
        </label>
        <label>Total marks for the paper<input type="number" min={1} max={500} value={want ?? ''} placeholder={`${marks} (the tasks added up)`} onChange={(e) => set({ totalMarks: e.target.value === '' ? undefined : Math.max(1, Number(e.target.value) || 1) })} aria-label="Total marks" /></label>
        <label>Students fill in before starting<input value={detailText} onChange={(e) => { setDetailText(e.target.value); set({ details: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) }); }} aria-label="Student details" placeholder="Class, Section" /><span className="small muted">Separate with commas, e.g. Class, Section, Index number. Their name comes from their account.</span></label>
      </div>
      {want !== undefined && want !== marks && <div className="banner warn mt-1">The tasks add up to {marks} marks, not {want}. <button className="btn btn-sm" onClick={() => spread(want)} data-testid="spread-marks">Spread the marks to make {want}</button> <span className="small">(keeps the proportions, whole marks, at least 1 per task)</span></div>}
      {want !== undefined && want === marks && <p className="small muted mt-1">The tasks add up to {want} marks.</p>}
    </div>
  );
}

// ---------------------------------------------------------------- printed papers
/** Describe what students start with, including the tables of a supplied database. */
async function paperInfo(test: TestPublic, classes: ClassInfo[]): Promise<PaperInfo> {
  const className = classes.find((c) => c.id === test.classId)?.name;
  let p: WowProject | null = null; let startLabel: string;
  try {
    if (test.start.kind === 'blank') startLabel = 'You start with a new, empty database. You create everything yourself.';
    else if (test.start.kind === 'sample') { const info = SAMPLE_LIST.find((x) => x.id === (test.start as { sample: string }).sample); startLabel = `You start with a copy of the ${info?.name ?? 'sample'} database (fictional data). Its tables are listed below.`; p = await buildSample((test.start as { sample: SampleId }).sample); }
    else { startLabel = `You start with the database "${test.start.name}". Its tables are listed below.`; const b = test.id ? await getBackend()!.school!.loadTestStart(test.id) : null; if (b) p = await WowProject.open(b); }
  } catch { startLabel = 'You start with the database your teacher has prepared.'; }
  const tables = p?.tables().map((t) => ({ name: t.name, records: Number(p!.db.scalar(`SELECT count(*) FROM "${t.name.replace(/"/g, '""')}"`)), fields: t.fields.map((f) => ({ name: f.name, type: f.type, key: !!f.primaryKey })) }));
  return { test, className, startLabel, tables };
}
async function printPaper(test: TestPublic, classes: ClassInfo[]) {
  const pick = await openDialog<{ what: 'paper' | 'scheme'; fmt: 'pdf' | 'docx'; tables: boolean }>('Print the test', (close) => <PaperDialog close={close} />, 520);
  if (!pick) return;
  try {
    const info = await paperInfo(test, classes);
    if (!pick.tables) info.tables = undefined;
    let blocks;
    if (pick.what === 'scheme') { const key = await getBackend()!.school!.getKey(test.id); if (!key) throw new Error('The marking key is missing.'); blocks = markScheme(info, key); }
    else blocks = questionPaper(info);
    const name = `${test.title} ${pick.what === 'scheme' ? 'mark scheme' : 'question paper'}`;
    const foot = pick.what === 'scheme' ? `${test.title}: mark scheme (confidential)` : test.title;
    if (pick.fmt === 'pdf') await downloadBytes(pdfBytes(blocksToPdf(blocks, foot)), `${name}.pdf`, 'application/pdf');
    else await downloadBytes(await blocksToDocx(blocks, foot), `${name}.docx`, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  } catch (e) { void messageBox(cloudMessage(e), 'Print the test', 'warn'); }
}
function PaperDialog({ close }: { close: (v: { what: 'paper' | 'scheme'; fmt: 'pdf' | 'docx'; tables: boolean } | null) => void }) {
  const [what, setWhat] = useState<'paper' | 'scheme'>('paper');
  const [fmt, setFmt] = useState<'pdf' | 'docx'>('pdf');
  const [tables, setTables] = useState(true);
  return (
    <div>
      <p className="small mb-2"><b>Question paper</b>: for students, before or during the test. Instructions, time, marks, the database provided and every task with its marks.</p>
      <p className="small mb-2"><b>Mark scheme</b>: for teachers only. Each task, its marks, how DBWOW checks it and the answer SQL.</p>
      <div className="flex gap-3 mb-2"><label className="chk"><input type="radio" name="pw" checked={what === 'paper'} onChange={() => setWhat('paper')} /> Question paper</label><label className="chk"><input type="radio" name="pw" checked={what === 'scheme'} onChange={() => setWhat('scheme')} /> Mark scheme</label></div>
      <div className="flex gap-3 mb-2"><label className="chk"><input type="radio" name="pf" checked={fmt === 'pdf'} onChange={() => setFmt('pdf')} /> PDF</label><label className="chk"><input type="radio" name="pf" checked={fmt === 'docx'} onChange={() => setFmt('docx')} /> Word (.docx, editable)</label></div>
      {what === 'paper' && <label className="chk small"><input type="checkbox" checked={tables} onChange={(e) => setTables(e.target.checked)} /> List the tables and fields of the starting database</label>}
      <div className="dlg-buttons"><button className="btn btn-primary" onClick={() => close({ what, fmt, tables })} data-testid="paper-go">Download</button><button className="btn" onClick={() => close(null)}>Cancel</button></div>
    </div>
  );
}

// ---------------------------------------------------------------- tests list
function TestsList({ tests, classes, go, reload }: { tests: TestPublic[]; classes: ClassInfo[]; go: (s: Section) => void; reload: () => void }) {
  const school = getBackend()!.school!;
  const cname = (id: string | null) => classes.find((c) => c.id === id)?.name ?? 'Any student with the code';
  return (
    <div>
      <div className="tz-head"><h1>Practical tests</h1><button className="btn btn-primary" data-testid="new-test" onClick={() => go({ k: 'edit', id: null })}><Plus size={13} /> New test</button></div>
      {!tests.length && <p className="muted">No tests yet. A test is a set of tasks students complete in a database; DBWOW marks them against your marking key.</p>}
      <table className="tz-table"><thead><tr><th>Test</th><th>Class</th><th>Time</th><th>Marks</th><th>Code</th><th>Status</th><th /></tr></thead><tbody>
        {tests.map((t) => (
          <tr key={t.id} data-testid="test-row">
            <td><b>{t.title}</b><div className="small muted">{t.tasks.length} tasks{t.resultsReleased ? ' · results released' : ''}</div></td>
            <td>{cname(t.classId)}</td><td>{t.durationMin} min</td><td>{t.tasks.reduce((s, x) => s + x.marks, 0)}</td>
            <td><b className="mono" data-testid="test-code">{t.code}</b></td>
            <td><span className={'tag ' + (t.status === 'open' ? 'ok' : '')}>{t.status === 'open' ? 'Open' : t.status === 'closed' ? 'Closed' : 'Draft'}</span></td>
            <td className="tz-actions">
              {t.status !== 'open' ? <button className="btn btn-sm btn-primary" data-testid="open-test" onClick={async () => { await school.setTestStatus(t.id, 'open'); reload(); }}>Open</button> : <button className="btn btn-sm" onClick={async () => { if (await confirmBox('Close this test? Students who have not started cannot start; anyone working can still submit.')) { await school.setTestStatus(t.id, 'closed'); reload(); } }}>Close</button>}
              <button className="btn btn-sm" onClick={() => go({ k: 'monitor', id: t.id })} data-testid="monitor-test">Live monitor</button>
              <button className="btn btn-sm" onClick={() => go({ k: 'results', id: t.id })} data-testid="results-test">Results</button>
              <button className="btn btn-sm" onClick={() => go({ k: 'edit', id: t.id })}>Edit</button>
              <button className="btn btn-sm" onClick={() => void printPaper(t, classes)} data-testid="print-paper" title="Question paper and mark scheme (PDF or Word)"><Printer size={12} /> Paper</button>
              <button className="icon-btn" title="Delete test" onClick={async () => { if (await confirmBox(`Delete "${t.title}"? Attempts already made are kept, but the test and its marking key are removed.`, { danger: true })) { await school.deleteTest(t.id); reload(); } }}><Trash2 size={13} /></button>
            </td>
          </tr>
        ))}
      </tbody></table>
    </div>
  );
}

// ---------------------------------------------------------------- test editor
type DraftTask = ExamTask;
const CHECK_KINDS: { kind: Check['kind']; label: string }[] = [
  { kind: 'table', label: 'Table exists' }, { kind: 'field', label: 'Field exists (and data type)' }, { kind: 'primaryKey', label: 'Primary key' },
  { kind: 'records', label: 'Number of records' }, { kind: 'recordExists', label: 'A record with a value' }, { kind: 'validation', label: 'Validation rule' },
  { kind: 'relationship', label: 'Relationship' }, { kind: 'queryResult', label: 'Query gives the right rows (answer SQL)' }, { kind: 'queryUses', label: 'Query uses a feature (e.g. GROUP BY)' }, { kind: 'parameter', label: 'Parameter query gives the right rows' },
  { kind: 'form', label: 'Form' }, { kind: 'report', label: 'Report (grouping, totals)' }, { kind: 'sql', label: 'Custom SQL check (advanced)' },
];
const TYPES: DataType[] = ['Short Text', 'Long Text', 'Number', 'Date/Time', 'Currency', 'AutoNumber', 'Yes/No', 'Hyperlink', 'Attachment', 'Calculated'];
function blankCheck(kind: Check['kind']): Check {
  switch (kind) {
    case 'table': return { kind, table: '' };
    case 'field': return { kind, table: '', field: '' };
    case 'primaryKey': return { kind, table: '', fields: [] };
    case 'records': return { kind, table: '', min: 1 };
    case 'recordExists': return { kind, table: '', field: '', value: '' };
    case 'validation': return { kind, table: '', field: '' };
    case 'relationship': return { kind, primary: '', related: '', enforce: true };
    case 'queryResult': return { kind, sql: '' };
    case 'queryUses': return { kind, contains: 'GROUP BY' };
    case 'parameter': return { kind, sql: '', value: '' };
    case 'form': return { kind };
    case 'report': return { kind };
    case 'sql': return { kind, sql: '', label: '' };
  }
}
/** Tasks for building a database from a blank start. */
const BLANK_BANK: { group: string; tasks: Omit<DraftTask, 'id'>[] }[] = [
  { group: 'Create a Students table', tasks: [
    { text: 'Create a table called Students.', marks: 1, check: { kind: 'table', table: 'Students' } },
    { text: 'Add StudentID as an AutoNumber field and make it the primary key.', marks: 2, check: { kind: 'primaryKey', table: 'Students', fields: ['StudentID'] } },
    { text: 'Add FirstName and LastName as Short Text fields.', marks: 1, check: { kind: 'field', table: 'Students', field: 'LastName', type: 'Short Text' } },
    { text: 'Add DateOfBirth as a Date/Time field.', marks: 1, check: { kind: 'field', table: 'Students', field: 'DateOfBirth', type: 'Date/Time' } },
    { text: 'Enter at least 5 students.', marks: 2, check: { kind: 'records', table: 'Students', min: 5 } },
  ] },
  { group: 'Relationships', tasks: [
    { text: 'Create a Classes table with ClassID as its primary key.', marks: 1, check: { kind: 'primaryKey', table: 'Classes', fields: ['ClassID'] } },
    { text: 'Link Classes to Students (one-to-many) and enforce referential integrity.', marks: 2, check: { kind: 'relationship', primary: 'Classes', related: 'Students', enforce: true } },
  ] },
  { group: 'Validation', tasks: [
    { text: 'Add a validation rule so a Score must be between 0 and 100.', marks: 2, check: { kind: 'validation', table: 'Results', field: 'Score', rejects: '150' } },
  ] },
  { group: 'Queries (School sample)', tasks: [
    { text: 'Create a query that shows the first name and last name of students who live in Accra.', marks: 3, check: { kind: 'queryResult', sql: "SELECT FirstName, LastName FROM Students WHERE Town = 'Accra'" } },
    { text: 'Create a query that lists every student sorted by LastName (A to Z).', marks: 2, check: { kind: 'queryResult', sql: 'SELECT * FROM Students ORDER BY LastName' } },
    { text: 'Create a totals query showing how many students are in each class.', marks: 3, check: { kind: 'queryUses', contains: 'GROUP BY' } },
  ] },
  { group: 'Forms and reports', tasks: [
    { text: 'Create a form based on Students showing FirstName and LastName.', marks: 2, check: { kind: 'form', source: 'Students', fields: ['FirstName', 'LastName'] } },
    { text: 'Create a report grouped by class with a total in the group footer.', marks: 3, check: { kind: 'report', total: true } },
  ] },
];

function TestEditor({ id, classes, done }: { id: string | null; classes: ClassInfo[]; done: (id: string | null) => void }) {
  const school = getBackend()!.school!;
  const user = useCloud((s) => s.user)!;
  const project = useApp((s) => s.project);
  const [loaded, setLoaded] = useState(!id);
  const [t, setT] = useState<TestPublic>(() => ({ id: '', title: '', instructions: '', classId: classes[0]?.id ?? null, durationMin: 45, status: 'draft', code: newCode(), tasks: [], start: { kind: 'blank' }, settings: { requireFullscreen: true, allowLearning: false }, ownerUid: user.uid, ownerName: user.name, created: new Date().toISOString(), resultsReleased: false, paper: paperDefaults() }));
  const [tasks, setTasks] = useState<DraftTask[]>([]);
  const [startFrom, setStartFrom] = useState<'keep' | 'current' | 'ready'>('keep');
  const [readyBytes, setReadyBytes] = useState<Uint8Array | null>(null);
  const [solvers, setSolvers] = useState<Record<string, LibTask['solve']>>({});
  const [model, setModel] = useState<WowProject | null>(null);
  const [making, setMaking] = useState(false);
  const [preview, setPreview] = useState<GradeResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!id) return;
    void Promise.all([school.getTest(id), school.getKey(id)]).then(([pub, key]) => {
      if (pub) { setT(pub); setTasks(pub.tasks.map((x) => ({ ...x, check: key?.tasks.find((k) => k.id === x.id)?.check ?? blankCheck('table') }))); }
      setLoaded(true);
    });
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!loaded) return <p className="muted">Loading…</p>;
  const setTask = (i: number, patch: Partial<DraftTask>) => setTasks(tasks.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const marks = tasks.reduce((s, x) => s + x.marks, 0);
  const useLib = (lib: LibTask[], sample: SampleId, start: WowProject | null) => {
    setSolvers((old) => ({ ...old, ...Object.fromEntries(lib.map((x) => [x.id, x.solve])) }));
    if (start) {
      const b = start.db.export(); setReadyBytes(b); setStartFrom('ready');
      setT((cur) => ({ ...cur, start: { kind: 'file', name: `${SAMPLE_LIST.find((x) => x.id === sample)!.name} (without queries, forms and reports)`, size: b.length } }));
    }
    setModel(null); setPreview(null);
    return lib.map(({ id: tid, text, marks: m, check }) => ({ id: tid, text, marks: m, check }));
  };
  const pickReady = async () => {
    const pick = await openDialog<{ sample: SampleId; level: LevelId }>('Ready-made tests', (close) => <ReadyPicker close={close} />, 680);
    if (!pick) return;
    if (tasks.length && !(await confirmBox('Replace the tasks in this test with the ready-made test?'))) return;
    const r = await readyTest(pick.sample, pick.level);
    const list = useLib(r.tasks, pick.sample, r.start);
    setT((cur) => ({ ...cur, title: r.title, instructions: r.instructions, durationMin: r.durationMin }));
    setTasks(list);
  };
  /** The starting database as bytes, whichever kind of start the test uses. */
  const startBytes = async (): Promise<Uint8Array | null> => {
    if (t.start.kind === 'blank') return (await WowProject.create(t.title || 'Model answer')).db.export();
    if (t.start.kind === 'sample') return (await buildSample(t.start.sample as SampleId)).db.export();
    if (startFrom === 'ready') return readyBytes;
    if (startFrom === 'current') return project?.db.export() ?? null;
    return id ? school.loadTestStart(id) : null;
  };
  const buildModel = async () => {
    setErr(null); setMaking(true);
    try {
      const b = await startBytes(); if (!b) throw new Error('The starting database is not available.');
      const m = await WowProject.open(b);
      const missing: number[] = [];
      tasks.forEach((x, i) => { const f = solvers[x.id]; if (f) { try { f(m); } catch { missing.push(i + 1); } } else missing.push(i + 1); });
      setModel(m); setPreview(grade(m, tasks));
      if (missing.length) setErr(`No model answer for task${missing.length > 1 ? 's' : ''} ${missing.join(', ')} (tasks you wrote or changed yourself). Open the model answer, complete ${missing.length > 1 ? 'them' : 'it'}, then try the key again.`);
    } catch (e) { setErr((e as Error).message); } finally { setMaking(false); }
  };
  const openModel = async () => {
    if (!model) return;
    const mid = 'model-' + uid('m'); const b = model.db.export();
    await saveProject({ id: mid, name: `${t.title || 'Test'} (model answer)`, bytes: b, modified: new Date().toISOString(), size: b.length });
    useApp.getState().setProject(model, mid);
  };
  const save = async () => {
    setErr(null);
    if (!t.title.trim()) { setErr('Give the test a title.'); return; }
    if (!tasks.length) { setErr('Add at least one task.'); return; }
    const want = t.paper?.totalMarks;
    if (want && want !== marks) { setErr(`The tasks add up to ${marks} marks but the paper's total is ${want}. Press "Spread the marks" or change the task marks.`); return; }
    const bad = tasks.findIndex((x) => !x.text.trim());
    if (bad >= 0) { setErr(`Task ${bad + 1} has no wording.`); return; }
    setSaving(true);
    try {
      let start = t.start; let bytes: Uint8Array | undefined;
      if (t.start.kind === 'file' && startFrom === 'current') {
        if (!project) throw new Error('Open the database students should start from, then save again.');
        bytes = project.db.export(); start = { kind: 'file', name: project.name, size: bytes.length };
      }
      if (t.start.kind === 'file' && startFrom === 'ready' && readyBytes) { bytes = readyBytes; start = { kind: 'file', name: t.start.name, size: bytes.length }; }
      const paper: PaperSettings = { school: t.paper?.school.trim() ?? '', details: (t.paper?.details ?? DEFAULT_DETAILS).map((x) => x.trim()).filter(Boolean), ...(t.paper?.logo ? { logo: t.paper.logo } : {}), ...(t.paper?.totalMarks ? { totalMarks: t.paper.totalMarks } : {}) };
      try { localStorage.setItem(PAPER_KEY, JSON.stringify({ school: paper.school, logo: paper.logo, details: paper.details })); } catch { /* ignore */ }
      const pub: TestPublic = { ...t, paper, start, tasks: tasks.map(({ id: tid, text, marks: m }) => ({ id: tid, text: text.trim(), marks: m })) };
      const key: TestKey = { tasks: tasks.map(({ id: tid, check }) => ({ id: tid, check })) };
      const newId = await school.saveTest(pub, key, bytes);
      done(newId);
    } catch (e) { setErr(cloudMessage(e)); } finally { setSaving(false); }
  };
  return (
    <div style={{ maxWidth: 980 }}>
      <div className="tz-head"><h1>{id ? 'Edit test' : 'New practical test'}</h1>
        <button className="btn btn-primary" onClick={() => void pickReady()} data-testid="ready-made"><Wand2 size={13} /> Use a ready-made test</button>
      </div>
      {!id && !tasks.length && <p className="small muted mb-2">Start from a ready-made test for any of the {SAMPLE_LIST.length} sample databases (Core, Extended or Full paper), or add your own tasks below.</p>}
      <div className="tz-form">
        <label>Title<input value={t.title} onChange={(e) => setT({ ...t, title: e.target.value })} aria-label="Test title" /></label>
        <label>Class<select value={t.classId ?? ''} onChange={(e) => setT({ ...t, classId: e.target.value || null })} aria-label="Class"><option value="">Any student with the code</option>{classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label>Time allowed (minutes)<input type="number" min={5} max={300} value={t.durationMin} onChange={(e) => setT({ ...t, durationMin: Math.max(1, Number(e.target.value) || 1) })} aria-label="Duration" /></label>
        <label>Test code<input value={t.code} onChange={(e) => setT({ ...t, code: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10) })} aria-label="Code" /></label>
        <label className="span2">Instructions for students<textarea rows={3} value={t.instructions} onChange={(e) => setT({ ...t, instructions: e.target.value })} aria-label="Instructions" /></label>
        <label>Students start with
          <select value={t.start.kind === 'sample' ? `sample:${t.start.sample}` : t.start.kind} onChange={(e) => { const v = e.target.value; setT({ ...t, start: v === 'blank' ? { kind: 'blank' } : v === 'file' ? { kind: 'file', name: project?.name ?? '', size: 0 } : { kind: 'sample', sample: v.slice(7) } }); if (v === 'file') setStartFrom('current'); else if (startFrom === 'ready') setStartFrom('keep'); }} aria-label="Starting database">
            <option value="blank">A blank database</option>
            {SAMPLE_LIST.map((s) => <option key={s.id} value={`sample:${s.id}`}>The {s.name} sample</option>)}
            <option value="file">{startFrom === 'ready' ? t.start.kind === 'file' && t.start.name : `The database I have open now${project ? ` (${project.name})` : ''}`}</option>
          </select>
        </label>
        <div className="tz-checks">
          <label className="chk"><input type="checkbox" checked={t.settings.requireFullscreen} onChange={(e) => setT({ ...t, settings: { ...t.settings, requireFullscreen: e.target.checked } })} /> Full screen (exits are recorded)</label>
          <label className="chk"><input type="checkbox" checked={t.settings.allowLearning} onChange={(e) => setT({ ...t, settings: { ...t.settings, allowLearning: e.target.checked } })} /> Allow the Learning Centre during the test</label>
        </div>
      </div>
      {startFrom === 'ready' && t.start.kind === 'file' && <p className="small muted mt-1">Students start with: {t.start.name}. It is saved with the test when you press Save test.</p>}
      {t.start.kind === 'file' && t.start.size > 0 && startFrom === 'keep' && <p className="small muted mt-1">Saved starting database: {t.start.name} ({Math.round(t.start.size / 1024)} KB). <button className="link" onClick={() => setStartFrom('current')}>Replace it with the database open now</button></p>}

      <PaperFields t={t} setT={setT} marks={marks} spread={(n) => { const m = spreadMarks(tasks.map((x) => x.marks), n); setTasks(tasks.map((x, i) => ({ ...x, marks: m[i] }))); }} />
      <div className="tz-head mt-3"><h2 style={{ margin: 0 }}>Tasks <span className="muted small">{tasks.length} tasks · {marks} marks</span></h2>
        <button className="btn" data-testid="add-task" onClick={() => setTasks([...tasks, { id: uid('task'), text: '', marks: 1, check: blankCheck('table') }])}><Plus size={13} /> Add task</button>
        <button className="btn" onClick={async () => {
          const defSample = t.start.kind === 'sample' ? t.start.sample : (t.start.kind === 'file' && SAMPLE_LIST.find((x) => t.start.kind === 'file' && t.start.name.startsWith(x.name))?.id) || (t.start.kind === 'blank' ? 'blank' : 'school');
          const pick = await openDialog<BankPick>('Task bank', (close) => <TaskBank close={close} initial={defSample as SampleId | 'blank'} canSetStart={t.start.kind === 'blank' && !tasks.length} />, 720);
          if (!pick?.tasks.length) return;
          if (pick.lib) setTasks([...tasks, ...useLib(pick.tasks as LibTask[], pick.sample as SampleId, pick.setStart ? pick.start : null)]);
          else setTasks([...tasks, ...pick.tasks.map((x) => ({ ...x, id: uid('task') }))]);
        }} data-testid="task-bank">Add from task bank</button>
      </div>
      {tasks.map((x, i) => (
        <div key={x.id} className="tz-task" data-testid="task-edit">
          <div className="tz-task-num">{i + 1}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="flex gap-2">
              <textarea rows={2} style={{ flex: 1 }} value={x.text} placeholder="What the student must do" onChange={(e) => setTask(i, { text: e.target.value })} aria-label={`Task ${i + 1} wording`} />
              <label className="small" style={{ width: 70 }}>Marks<input type="number" min={0} max={50} value={x.marks} onChange={(e) => setTask(i, { marks: Math.max(0, Number(e.target.value) || 0) })} aria-label={`Task ${i + 1} marks`} /></label>
            </div>
            <CheckEditor check={x.check} onChange={(c) => setTask(i, { check: c })} />
            {preview && <div className={'small mt-1 ' + (preview.tasks[i]?.ok ? 'ok-text' : 'bad-text')}>{preview.tasks[i]?.ok ? '✓' : '✗'} {preview.tasks[i]?.reason}</div>}
          </div>
          <div className="tz-task-tools">
            <button className="icon-btn" title="Move up" disabled={i === 0} onClick={() => { const n = [...tasks]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; setTasks(n); }}><ArrowUp size={13} /></button>
            <button className="icon-btn" title="Move down" disabled={i === tasks.length - 1} onClick={() => { const n = [...tasks]; [n[i + 1], n[i]] = [n[i], n[i + 1]]; setTasks(n); }}><ArrowDown size={13} /></button>
            <button className="icon-btn" title="Delete task" onClick={() => setTasks(tasks.filter((_, j) => j !== i))}><Trash2 size={13} /></button>
          </div>
        </div>
      ))}
      <div className="flex gap-2 mt-3" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
        <button className="btn btn-primary" onClick={() => void save()} disabled={saving} data-testid="save-test">{saving ? 'Saving…' : 'Save test'}</button>
        <button className="btn" onClick={() => done(null)}>Cancel</button>
        <button className="btn" disabled={!tasks.length || making} title="Run the model answers on the starting database and mark the result" onClick={() => void buildModel()} data-testid="build-model">{making ? 'Building…' : 'Build a model answer and try the key'}</button>
        <button className="btn" disabled={!project || !tasks.length} title={project ? `Mark the database open now (${project.name}) with this key` : 'Open a database first'} onClick={() => { setModel(null); setPreview(grade(project!, tasks)); }} data-testid="try-key">Try the key on {project ? `"${project.name}"` : 'the open database'}</button>
        {preview && <span className="small" data-testid="key-preview"><b>{preview.score} / {preview.max}</b> on {model ? 'the model answer' : project?.name}.</span>}
        {model && <button className="link small" onClick={() => void openModel()}>Open the model answer</button>}
      </div>
      {err && <div className="banner err mt-2">{err}</div>}
    </div>
  );
}

interface BankPick { tasks: (LibTask | Omit<DraftTask, 'id'>)[]; lib: boolean; sample: SampleId | 'blank'; setStart: boolean; start: WowProject | null; }
function TaskBank({ close, initial, canSetStart }: { close: (v: BankPick | null) => void; initial: SampleId | 'blank'; canSetStart: boolean }) {
  const [sample, setSample] = useState<SampleId | 'blank'>(initial);
  const [lib, setLib] = useState<{ start: WowProject; tasks: LibTask[] } | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [setStart, setSetStart] = useState(canSetStart);
  useEffect(() => {
    setSel(new Set()); setLib(null);
    if (sample === 'blank') return;
    let live = true;
    void startDatabase(sample).then((p) => { if (live) setLib({ start: p, tasks: taskLibrary(sample, p, Math.floor(Math.random() * 1e9)) }); });
    return () => { live = false; };
  }, [sample]);
  const groups: { group: string; items: { k: string; text: string; marks: number; check: Check }[] }[] = sample === 'blank'
    ? BLANK_BANK.map((g, gi) => ({ group: g.group, items: g.tasks.map((t, ti) => ({ k: `${gi}:${ti}`, ...t })) }))
    : [...new Set((lib?.tasks ?? []).map((t) => t.group))].map((g) => ({ group: g, items: lib!.tasks.filter((t) => t.group === g).map((t) => ({ k: t.id, text: t.text, marks: t.marks, check: t.check })) }));
  const done = () => {
    if (sample === 'blank') close({ tasks: groups.flatMap((g) => g.items).filter((x) => sel.has(x.k)).map(({ text, marks, check }) => ({ text, marks, check })), lib: false, sample, setStart: false, start: null });
    else close({ tasks: lib!.tasks.filter((x) => sel.has(x.id)), lib: true, sample, setStart, start: lib!.start });
  };
  return (
    <div>
      <div className="flex gap-2 mb-2" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
        <label className="small">Database<select value={sample} onChange={(e) => setSample(e.target.value as SampleId | 'blank')} aria-label="Bank database" style={{ marginLeft: 6 }}>
          <option value="blank">Blank database (build it from scratch)</option>
          {SAMPLE_LIST.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select></label>
        {sample !== 'blank' && <button className="link small" onClick={() => setSel(new Set(lib?.tasks.map((x) => x.id)))}>Tick all</button>}
      </div>
      <p className="small muted mb-2">{sample === 'blank' ? 'Tick tasks to add.' : 'Values (towns, prices, dates, letters) are picked from the data each time you open the bank.'} You can change wording, marks and checks afterwards.</p>
      <div style={{ maxHeight: '52vh', overflow: 'auto' }}>
        {sample !== 'blank' && !lib && <p className="muted">Preparing tasks…</p>}
        {groups.map((g) => (
          <div key={g.group} className="mb-2"><b className="small">{g.group}</b>
            {g.items.map((t) => (
              <label key={t.k} className="chk" style={{ display: 'flex', gap: 6, padding: '3px 0' }}><input type="checkbox" data-testid="bank-task" checked={sel.has(t.k)} onChange={(e) => { const n = new Set(sel); if (e.target.checked) n.add(t.k); else n.delete(t.k); setSel(n); }} /><span>{t.text} <span className="muted small">[{t.marks}] · {describeCheck(t.check)}</span></span></label>
            ))}
          </div>
        ))}
      </div>
      {sample !== 'blank' && <label className="chk small mt-2"><input type="checkbox" checked={setStart} onChange={(e) => setSetStart(e.target.checked)} /> Students start with this database (its saved queries, forms and reports removed)</label>}
      <div className="dlg-buttons"><button className="btn btn-primary" disabled={!sel.size} onClick={done} data-testid="bank-add">Add {sel.size || ''} task{sel.size === 1 ? '' : 's'}</button><button className="btn" onClick={() => close(null)}>Cancel</button></div>
    </div>
  );
}

function ReadyPicker({ close }: { close: (v: { sample: SampleId; level: LevelId } | null) => void }) {
  const [sample, setSample] = useState<SampleId>('school');
  const [level, setLevel] = useState<LevelId>('core');
  const L = LEVELS.find((x) => x.id === level)!;
  return (
    <div>
      <p className="small muted mb-2">Every ready-made test starts students in a copy of the sample (its saved queries, forms and reports removed) and comes with a marking key and model answers. Values such as towns, prices and dates are picked from the data, so each test you make is a little different.</p>
      <div className="ready-grid">
        {SAMPLE_LIST.map((x) => <button key={x.id} className={'ready-db' + (x.id === sample ? ' on' : '')} onClick={() => setSample(x.id)} data-testid={`ready-${x.id}`}><b>{x.name}</b><span className="small muted">{x.description}</span></button>)}
      </div>
      <div className="flex gap-2 mt-2" style={{ flexWrap: 'wrap' }}>
        {LEVELS.map((x) => <label key={x.id} className="chk"><input type="radio" name="lvl" checked={level === x.id} onChange={() => setLevel(x.id)} /> {x.name} ({x.keys.length} tasks, {x.minutes} min)</label>)}
      </div>
      <p className="small mt-1">{L.about}</p>
      <div className="dlg-buttons"><button className="btn btn-primary" onClick={() => close({ sample, level })} data-testid="ready-use">Use this test</button><button className="btn" onClick={() => close(null)}>Cancel</button></div>
    </div>
  );
}

function CheckEditor({ check, onChange }: { check: Check; onChange: (c: Check) => void }) {
  const set = (patch: Record<string, unknown>) => onChange({ ...check, ...patch } as Check);
  const txt = (k: string, label: string, w = 140) => <label className="small">{label}<input style={{ width: w }} value={String((check as Record<string, unknown>)[k] ?? '')} onChange={(e) => set({ [k]: e.target.value })} aria-label={label} /></label>;
  const box = (k: string, label: string) => <label className="chk small"><input type="checkbox" checked={!!(check as Record<string, unknown>)[k]} onChange={(e) => set({ [k]: e.target.checked })} /> {label}</label>;
  return (
    <div className="tz-check">
      <label className="small">Marked by<select value={check.kind} onChange={(e) => onChange(blankCheck(e.target.value as Check['kind']))} aria-label="Check type">{CHECK_KINDS.map((k) => <option key={k.kind} value={k.kind}>{k.label}</option>)}</select></label>
      {check.kind === 'table' && txt('table', 'Table')}
      {check.kind === 'field' && <>{txt('table', 'Table')}{txt('field', 'Field')}<label className="small">Data type<select value={check.type ?? ''} onChange={(e) => set({ type: e.target.value || undefined })}><option value="">Any</option>{TYPES.map((x) => <option key={x}>{x}</option>)}</select></label></>}
      {check.kind === 'primaryKey' && <>{txt('table', 'Table')}<label className="small">Key field(s), comma separated<input style={{ width: 180 }} value={check.fields.join(', ')} onChange={(e) => set({ fields: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })} /></label></>}
      {check.kind === 'records' && <>{txt('table', 'Table')}<label className="small">At least<input type="number" style={{ width: 60 }} value={check.min} onChange={(e) => set({ min: Number(e.target.value) || 0 })} /></label><label className="small">At most (optional)<input type="number" style={{ width: 70 }} value={check.max ?? ''} onChange={(e) => set({ max: e.target.value === '' ? undefined : Number(e.target.value) })} /></label></>}
      {check.kind === 'recordExists' && <>{txt('table', 'Table')}{txt('field', 'Field')}{txt('value', 'Value')}</>}
      {check.kind === 'validation' && <>{txt('table', 'Table')}{txt('field', 'Field')}{txt('rejects', 'Must reject (optional)', 90)}</>}
      {check.kind === 'relationship' && <>{txt('primary', 'One side (primary table)')}{txt('related', 'Many side (related table)')}{box('enforce', 'Integrity enforced')}{box('cascadeUpdate', 'Cascade update')}{box('cascadeDelete', 'Cascade delete')}</>}
      {check.kind === 'queryResult' && <><label className="small" style={{ flex: 1, minWidth: 260 }}>Answer SQL (run on the student&apos;s own data)<textarea rows={2} className="mono" value={check.sql} onChange={(e) => set({ sql: e.target.value })} aria-label="Answer SQL" /></label>{txt('query', 'Query name (optional)')}{box('ordered', 'Order matters')}</>}
      {check.kind === 'queryUses' && <>{txt('contains', 'SQL must contain')}{txt('query', 'Query name (optional)')}</>}
      {check.kind === 'parameter' && <><label className="small" style={{ flex: 1, minWidth: 260 }}>Answer SQL (with the value written in)<textarea rows={2} className="mono" value={check.sql} onChange={(e) => set({ sql: e.target.value })} aria-label="Answer SQL" /></label>{txt('value', 'Value to enter', 100)}{txt('query', 'Query name (optional)')}</>}
      {check.kind === 'form' && <>{txt('source', 'Based on (optional)')}{txt('name', 'Form name (optional)')}<label className="small">Must show fields<input style={{ width: 180 }} value={(check.fields ?? []).join(', ')} onChange={(e) => set({ fields: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })} /></label></>}
      {check.kind === 'report' && <>{txt('source', 'Based on (optional)')}{txt('groupField', 'Grouped on (optional)')}{box('total', 'Has a total in a footer')}</>}
      {check.kind === 'sql' && <><label className="small" style={{ flex: 1, minWidth: 260 }}>SQL that returns 1 when met<textarea rows={2} className="mono" value={check.sql} onChange={(e) => set({ sql: e.target.value })} /></label>{txt('label', 'Describe it', 200)}</>}
      <div className="small muted" style={{ flexBasis: '100%' }}>{describeCheck(check)}</div>
    </div>
  );
}

// ---------------------------------------------------------------- live monitor
const secs = (n: number) => (n >= 3600 ? `${Math.floor(n / 3600)}h ${Math.round((n % 3600) / 60)}m` : `${Math.round(n / 60)}m`);
function concern(c: Attempt['counters']) {
  const out: string[] = [];
  if (c.tabSwitches >= 3) out.push(`${c.tabSwitches} tab switches`);
  if (c.fullscreenExits >= 2) out.push(`${c.fullscreenExits} full-screen exits`);
  if (c.pastedChars >= 200) out.push(`${c.pastedChars} characters pasted`);
  if (c.hiddenSec >= 120) out.push(`${secs(c.hiddenSec)} away from the test`);
  const t = c.activeSec + c.idleSec;
  if (t > 600 && c.activeSec / t < 0.3) out.push('mostly idle');
  return out;
}
function Monitor({ test, go }: { test?: TestPublic; go: (s: Section) => void }) {
  const school = getBackend()!.school!;
  const [list, setList] = useState<Attempt[]>([]);
  const [progress, setProgress] = useState<Record<string, GradeResult>>({});
  const [now, setNow] = useState(Date.now());
  const [marking, setMarking] = useState(false);
  useEffect(() => { if (!test) return; return school.watchAttempts(test.id, setList); }, [test?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const i = setInterval(() => setNow(Date.now()), 5000); return () => clearInterval(i); }, []);
  if (!test) return <p className="muted">Test not found.</p>;
  const markNow = async () => {
    setMarking(true);
    try {
      const key = await school.getKey(test.id); if (!key) return;
      const tasks = test.tasks.map((x) => ({ ...x, check: key.tasks.find((k) => k.id === x.id)!.check }));
      const out: Record<string, GradeResult> = {};
      for (const a of list) { const b = await school.loadAttemptSnapshot(a.id); if (b) { const p = await WowProject.open(b); out[a.id] = grade(p, tasks); } }
      setProgress(out);
    } finally { setMarking(false); }
  };
  const sorted = [...list].sort((a, b) => a.name.localeCompare(b.name));
  const working = list.filter((a) => a.status === 'in-progress').length;
  return (
    <div>
      <div className="tz-head"><h1>{test.title}: live</h1>
        <span className="small muted">Code <b className="mono">{test.code}</b> · {test.status} · {list.length} started · {working} working · {list.length - working} handed in</span>
        <button className="btn" onClick={() => void markNow()} disabled={marking || !list.length} data-testid="mark-progress"><RefreshCw size={13} /> {marking ? 'Marking…' : 'Mark latest saves'}</button>
        <button className="btn" onClick={() => go({ k: 'results', id: test.id })}>Results</button>
      </div>
      <p className="small muted mb-2">Updates live. Online = activity in the last minute. Counts are tab switches (another tab or app), focus losses (another window in front), full-screen exits and pastes. Rows with possible concerns are highlighted; they are prompts to look, not proof of cheating.</p>
      <div className="tz-scroll"><table className="tz-table" data-testid="monitor-table"><thead><tr><th>Student</th><th>Status</th><th>Time left</th><th>Progress</th><th title="Tab switches">Tabs</th><th title="Window focus lost">Focus</th><th title="Full-screen exits">Full screen</th><th title="Pastes (characters)">Pastes</th><th title="Active / idle / away">Active · idle · away</th><th>Changes</th><th>Last save</th><th /></tr></thead><tbody>
        {sorted.map((a) => {
          const c = { ...zeroCounters(), ...a.counters };
          const online = now - Date.parse(a.lastSeen) < 60000 && a.status === 'in-progress';
          const flags = concern(c);
          const g = progress[a.id];
          return (
            <tr key={a.id} className={flags.length ? 'flag' : ''} data-testid="monitor-row" title={flags.join(', ')}>
              <td><span className={'dot ' + (online ? 'on' : '')} />{a.name}<div className="small muted">{[...Object.values(a.details ?? {}).filter(Boolean), a.email].join(' · ')}</div></td>
              <td>{a.status === 'submitted' ? <span className="tag ok">{a.autoSubmitted ? 'Time up' : 'Handed in'}</span> : <span className="tag">Working</span>}</td>
              <td>{a.status === 'in-progress' ? secs(Math.max(0, (Date.parse(a.deadline) - now) / 1000)) : '-'}</td>
              <td>{g ? <b>{g.score}/{g.max}</b> : <span className="muted small">-</span>}</td>
              <td data-testid="tabs-count" className={c.tabSwitches >= 3 ? 'warn' : ''}>{c.tabSwitches}</td>
              <td>{c.focusLost}</td>
              <td className={c.fullscreenExits >= 2 ? 'warn' : ''}>{c.fullscreenExits}</td>
              <td className={c.pastedChars >= 200 ? 'warn' : ''}>{c.pastes}{c.pastes ? ` (${c.pastedChars})` : ''}</td>
              <td><TimeBar a={c.activeSec} i={c.idleSec} h={c.hiddenSec} /></td>
              <td>{c.actions}</td>
              <td className="small">{a.snapshotAt ? new Date(a.snapshotAt).toLocaleTimeString() : '-'}</td>
              <td className="tz-actions"><button className="btn btn-sm" onClick={() => void attemptDetail(a, test)}><Eye size={12} /> Details</button></td>
            </tr>
          );
        })}
        {!list.length && <tr><td colSpan={12} className="muted">Nobody has started yet. Students go to File &gt; Tests and enter <b className="mono">{test.code}</b>.</td></tr>}
      </tbody></table></div>
    </div>
  );
}

/** Active / idle / away as one thin bar with numbers. */
function TimeBar({ a, i, h }: { a: number; i: number; h: number }) {
  const t = Math.max(1, a + i + h);
  return (
    <div className="tbar" title={`Active ${secs(a)} · idle ${secs(i)} · away ${secs(h)}`}>
      <div className="tbar-track"><span style={{ width: `${(a / t) * 100}%` }} className="a" /><span style={{ width: `${(i / t) * 100}%` }} className="i" /><span style={{ width: `${(h / t) * 100}%` }} className="h" /></div>
      <span className="small">{secs(a)} · {secs(i)} · {secs(h)}</span>
    </div>
  );
}

async function attemptDetail(a: Attempt, test: TestPublic) {
  const school = getBackend()!.school!;
  const events = await school.attemptEvents(a.id).catch(() => [] as AttemptEvent[]);
  const label: Record<string, string> = { started: 'Started', resumed: 'Came back to the test', 'tab-hidden': 'Left the test tab', 'tab-visible': 'Returned to the test tab', 'focus-lost': 'Another window in front', 'fullscreen-exit': 'Left full screen', paste: 'Pasted', copy: 'Copied', 'left-test-database': 'Opened another database', 'page-closed': 'Closed or reloaded the page', submitted: 'Handed in', 'auto-submitted': 'Handed in automatically' };
  await openDialog(`${a.name}: ${test.title}`, (close) => (
    <div style={{ maxWidth: 640 }}>
      <p className="small mb-2">Started {new Date(a.startedAt).toLocaleString()}{a.submittedAt ? ` · handed in ${new Date(a.submittedAt).toLocaleTimeString()}` : ''} · {a.counters.reloads} reload(s)</p>
      <div className="tz-timeline">{events.map((e, i) => <div key={i} className={['tab-hidden', 'fullscreen-exit', 'left-test-database', 'focus-lost'].includes(e.type) ? 'warn' : ''}><span className="mono small">{new Date(e.t).toLocaleTimeString()}</span> {label[e.type] ?? e.type}{e.detail ? <span className="muted"> · {e.detail}</span> : null}</div>)}{!events.length && <div className="muted">No events yet.</div>}</div>
      <div className="dlg-buttons">
        <button className="btn" onClick={async () => { const b = await school.loadAttemptSnapshot(a.id); if (!b) { void messageBox('Nothing saved yet.'); return; } const id = `review-${a.id}`; await saveProject({ id, name: `${a.name} – ${test.title}`, bytes: b, modified: new Date().toISOString(), size: b.length }); useApp.getState().setProject(await WowProject.open(b), id); close(null); }}>Open their database (copy)</button>
        {a.status === 'submitted' && <button className="btn" onClick={async () => { const m = await promptBox('Let this student carry on for how many more minutes?', '10', 'Reopen attempt'); if (m) { await school.reopenAttempt(a.id, Number(m) || 10); close(null); } }}>Reopen</button>}
        <button className="btn btn-primary" onClick={() => close(null)}>Close</button>
      </div>
    </div>
  ), 680);
}

// ---------------------------------------------------------------- results
function Results({ test, classes, go, reload }: { test?: TestPublic; classes: ClassInfo[]; go: (s: Section) => void; reload: () => void }) {
  const school = getBackend()!.school!;
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [grades, setGrades] = useState<Record<string, StoredGrade>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const load = async () => {
    if (!test) return;
    const [as, gs] = await Promise.all([school.listAttempts(test.id), school.listGrades(test.id)]);
    setAttempts(as); setGrades(Object.fromEntries(gs.map((g) => [g.uid, g])));
  };
  useEffect(() => { void load(); }, [test?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!test) return <p className="muted">Test not found.</p>;
  const markAll = async () => {
    setBusy(true); setMsg(null);
    try {
      const key = await school.getKey(test.id); if (!key) throw new Error('The marking key is missing.');
      const tasks = test.tasks.map((x) => ({ ...x, check: key.tasks.find((k) => k.id === x.id)!.check }));
      let n = 0;
      for (const a of attempts) {
        if (grades[a.uid] && grades[a.uid].snapshotAt === a.snapshotAt) continue;
        const b = await school.loadAttemptSnapshot(a.id); if (!b) continue;
        const r = grade(await WowProject.open(b), tasks);
        await school.saveGrade(test.id, { ...r, uid: a.uid, gradedAt: new Date().toISOString(), snapshotAt: a.snapshotAt, teacherAdjust: grades[a.uid]?.teacherAdjust, comment: grades[a.uid]?.comment });
        n++;
      }
      await load(); setMsg(n ? `Marked ${n} attempt(s).` : 'Everything is already marked.');
    } catch (e) { setMsg(cloudMessage(e)); } finally { setBusy(false); }
  };
  const rows = [...attempts].sort((a, b) => a.name.localeCompare(b.name));
  const max = test.tasks.reduce((s, x) => s + x.marks, 0);
  const finalOf = (g?: StoredGrade) => (g ? Math.max(0, Math.min(g.max, g.score + (g.teacherAdjust ?? 0))) : null);
  const marked = rows.filter((a) => grades[a.uid]);
  const avg = marked.length ? marked.reduce((s, a) => s + finalOf(grades[a.uid])!, 0) / marked.length : 0;
  const csv = () => {
    const dk = test.paper?.details ?? [];
    const head = ['Name', 'Email', ...dk, 'Status', 'Score', 'Max', ...test.tasks.map((_, i) => `Task ${i + 1}`), 'Tab switches', 'Full-screen exits', 'Pastes', 'Pasted characters', 'Active minutes', 'Idle minutes', 'Away minutes', 'Teacher adjustment', 'Comment'];
    const lines = rows.map((a) => { const g = grades[a.uid]; const c = { ...zeroCounters(), ...a.counters }; return [a.name, a.email, ...dk.map((k) => a.details?.[k] ?? ''), a.status, finalOf(g) ?? '', max, ...test.tasks.map((t) => g?.tasks.find((x) => x.id === t.id)?.marks ?? ''), c.tabSwitches, c.fullscreenExits, c.pastes, c.pastedChars, Math.round(c.activeSec / 60), Math.round(c.idleSec / 60), Math.round(c.hiddenSec / 60), g?.teacherAdjust ?? '', g?.comment ?? '']; });
    const text = [head, ...lines].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\r\n');
    downloadBytes(new TextEncoder().encode(text), `${test.title} results.csv`, 'text/csv');
  };
  const printable = (list: Attempt[]): PrintStudent[] => list.map((a) => {
    const g = grades[a.uid];
    return {
      name: a.name, email: a.email, details: a.details, status: a.status === 'submitted' ? 'handed in' : 'still working', submittedAt: a.submittedAt, autoSubmitted: a.autoSubmitted,
      counters: { ...zeroCounters(), ...a.counters }, score: g ? g.score : null, max, adjust: g?.teacherAdjust, comment: g?.comment,
      tasks: test.tasks.map((t) => { const r = g?.tasks.find((x) => x.id === t.id); return { text: t.text, marks: r?.marks ?? 0, max: t.marks, ok: r ? r.ok : null, reason: r?.reason ?? '' }; }),
    };
  });
  const print = (list: Attempt[], opts: { sheet: boolean; pages: boolean }, file: string) => {
    const doc = resultsPdf(test, printable(list), { ...opts, className: classes.find((c) => c.id === test.classId)?.name });
    downloadBytes(pdfBytes(doc), `${test.title} ${file}.pdf`, 'application/pdf');
  };
  return (
    <div>
      <div className="tz-head"><h1>{test.title}: results</h1>
        <button className="btn btn-primary" onClick={() => void markAll()} disabled={busy || !attempts.length} data-testid="mark-all">{busy ? 'Marking…' : 'Mark all'}</button>
        <button className="btn" onClick={csv} disabled={!rows.length}><Download size={13} /> CSV</button>
        <button className="btn" onClick={() => print(rows, { sheet: true, pages: false }, 'mark sheet')} disabled={!rows.length} data-testid="print-sheet" title="Class mark sheet: every student's mark for each checkpoint"><Printer size={13} /> Mark sheet</button>
        <button className="btn" onClick={() => print(rows, { sheet: false, pages: true }, 'marked papers')} disabled={!rows.length} data-testid="print-papers" title="One marked paper per student: every checkpoint with the marks awarded and the reason"><Printer size={13} /> Marked papers</button>
        <button className="btn" onClick={() => print(rows, { sheet: true, pages: true }, 'results')} disabled={!rows.length} data-testid="print-all" title="Mark sheet followed by every student's marked paper"><Printer size={13} /> Both</button>
        <button className="btn" onClick={() => void printPaper(test, classes)} data-testid="print-paper-r"><Printer size={13} /> Question paper</button>
        <button className="btn" onClick={() => go({ k: 'monitor', id: test.id })}>Live monitor</button>
        {test.resultsReleased ? <span className="tag ok">Released to students</span> : <button className="btn" disabled={!marked.length} data-testid="release" onClick={async () => { if (await confirmBox(`Release marks for ${marked.length} student(s)? They will see their score and the reason for each task.`)) { await school.releaseResults(test.id); reload(); setMsg('Results released.'); } }}>Release results</button>}
      </div>
      {msg && <div className="banner info mb-2">{msg}</div>}
      <p className="small muted mb-2">{rows.length} attempt(s) · {marked.length} marked · average {marked.length ? `${avg.toFixed(1)} / ${max} (${Math.round((avg / max) * 100)}%)` : '-'}</p>
      <div className="tz-scroll"><table className="tz-table" data-testid="results-table"><thead><tr><th>Student</th><th>Score</th>{test.tasks.map((t, i) => <th key={t.id} title={t.text}>T{i + 1}<div className="small muted">/{t.marks}</div></th>)}<th>Concerns</th><th>Adjust</th><th>Comment</th></tr></thead><tbody>
        {rows.map((a) => { const g = grades[a.uid]; const flags = concern({ ...zeroCounters(), ...a.counters }); return (
          <tr key={a.id} data-testid="result-row">
            <td>{a.name} {a.details && Object.values(a.details).some(Boolean) && <span className="small muted"> ({Object.values(a.details).filter(Boolean).join(', ')})</span>} <button className="icon-btn" title={`Print ${a.name}'s result`} onClick={() => print([a], { sheet: false, pages: true }, a.name)} data-testid="print-one"><Printer size={12} /></button><div className="small muted">{a.status === 'submitted' ? 'Handed in' : 'Still working'}</div></td>
            <td><b data-testid="result-score">{g ? `${finalOf(g)} / ${max}` : '-'}</b></td>
            {test.tasks.map((t) => { const r = g?.tasks.find((x) => x.id === t.id); return <td key={t.id} title={r?.reason}>{r ? (r.ok ? <CheckCircle2 size={15} color="#3c8d40" aria-label="met" /> : <XCircle size={15} color="#a4262c" aria-label="not met" />) : ''}</td>; })}
            <td className="small">{flags.length ? <span className="warn"><AlertTriangle size={12} style={{ display: 'inline' }} /> {flags.join(', ')}</span> : <span className="muted">None</span>}</td>
            <td><input type="number" style={{ width: 54 }} disabled={!g} value={g?.teacherAdjust ?? 0} aria-label="Adjustment" onChange={(e) => g && setGrades({ ...grades, [a.uid]: { ...g, teacherAdjust: Number(e.target.value) || 0 } })} onBlur={() => g && void school.saveGrade(test.id, grades[a.uid])} /></td>
            <td><input style={{ width: 160 }} disabled={!g} value={g?.comment ?? ''} aria-label="Comment" onChange={(e) => g && setGrades({ ...grades, [a.uid]: { ...g, comment: e.target.value } })} onBlur={() => g && void school.saveGrade(test.id, grades[a.uid])} /></td>
          </tr>
        ); })}
        {!rows.length && <tr><td colSpan={5 + test.tasks.length} className="muted">No attempts yet.</td></tr>}
      </tbody></table></div>
      {marked.length > 0 && <>
        <h2>Task analysis</h2>
        <p className="small muted mb-2">How many students met each task. Low scores show what to reteach.</p>
        <table className="tz-table"><tbody>{test.tasks.map((t, i) => { const met = marked.filter((a) => grades[a.uid].tasks.find((x) => x.id === t.id)?.ok).length; const pct = Math.round((met / marked.length) * 100); return (
          <tr key={t.id}><td style={{ width: 40 }}>T{i + 1}</td><td>{t.text}</td><td style={{ width: 220 }}><div className="tbar"><div className="tbar-track"><span className="a" style={{ width: `${pct}%` }} /></div><span className="small">{met}/{marked.length} ({pct}%)</span></div></td></tr>
        ); })}</tbody></table>
      </>}
    </div>
  );
}

// ---------------------------------------------------------------- student analytics
interface StudentRow { m: Member; days: DayStats[]; progress: LearnState | null; tests: { title: string; pct: number; date: string }[] }
const daysAgo = (n: number) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

function StudentsView({ classes, tests }: { classes: ClassInfo[]; tests: TestPublic[] }) {
  const school = getBackend()!.school!;
  const [cid, setCid] = useState<string | null>(classes[0]?.id ?? null);
  const [rows, setRows] = useState<StudentRow[] | null>(null);
  const [open, setOpen] = useState<StudentRow | null>(null);
  const [range, setRange] = useState(14);
  useEffect(() => {
    if (!cid) return; setRows(null); setOpen(null);
    void (async () => {
      const members = await school.classMembers(cid);
      // marks per test, for every student in the class
      const testMarks: Record<string, { title: string; pct: number; date: string }[]> = {};
      for (const t of tests) {
        const [as, gs] = await Promise.all([school.listAttempts(t.id).catch(() => []), school.listGrades(t.id).catch(() => [])]);
        for (const g of gs) { const a = as.find((x) => x.uid === g.uid); (testMarks[g.uid] ??= []).push({ title: t.title, pct: Math.round((Math.max(0, Math.min(g.max, g.score + (g.teacherAdjust ?? 0))) / Math.max(1, g.max)) * 100), date: a?.startedAt ?? g.gradedAt }); }
      }
      const out = await Promise.all(members.map(async (m) => {
        const [days, prog] = await Promise.all([school.studentDays(m.uid, daysAgo(60)).catch(() => []), school.studentProgress(m.uid).catch(() => null)]);
        return { m, days, progress: prog ? JSON.parse(prog) as LearnState : null, tests: (testMarks[m.uid] ?? []).sort((a, b) => a.date.localeCompare(b.date)) };
      }));
      setRows(out);
    })();
  }, [cid, tests.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const since = daysAgo(range - 1);
  const sum = (r: StudentRow, k: keyof DayStats) => r.days.filter((d) => d.date >= since).reduce((s, d) => s + (d[k] as number), 0);
  const trend = (r: StudentRow) => (r.tests.length >= 2 ? r.tests[r.tests.length - 1].pct - r.tests[0].pct : null);
  return (
    <div>
      <div className="tz-head"><h1>Student progress</h1>
        <select value={cid ?? ''} onChange={(e) => setCid(e.target.value)} aria-label="Class">{classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        <select value={range} onChange={(e) => setRange(Number(e.target.value))} aria-label="Period"><option value={7}>Last 7 days</option><option value={14}>Last 14 days</option><option value={30}>Last 30 days</option><option value={60}>Last 60 days</option></select>
      </div>
      {!classes.length && <p className="muted">Create a class first; students join it with its code.</p>}
      <p className="small muted mb-2">Active time counts only minutes with keyboard or mouse use while DBWOW is on screen. Idle is DBWOW on screen with no input; away is DBWOW open in a background tab. Focus = active ÷ (active + idle + away). Progress is measured from verified practical steps, quiz answers and test marks.</p>
      {rows === null && cid && <p className="muted">Loading…</p>}
      {rows && <div className="tz-scroll"><table className="tz-table" data-testid="students-table"><thead><tr><th>Student</th><th>Active</th><th>Focus</th><th>Days used</th><th>Changes</th><th>Steps</th><th>Quiz</th><th>Rank · XP</th><th>Trophies</th><th>Tests</th><th>Trend</th><th /></tr></thead><tbody>
        {rows.map((r) => {
          const a = sum(r, 'activeSec'), i = sum(r, 'idleSec'), h = sum(r, 'hiddenSec');
          const focus = a + i + h ? Math.round((a / (a + i + h)) * 100) : null;
          const qa = sum(r, 'quizAnswered'), qc = sum(r, 'quizCorrect');
          const xp = r.progress ? totalXp(r.progress) : 0;
          const tr = trend(r);
          const lastTest = r.tests[r.tests.length - 1];
          return (
            <tr key={r.m.uid} data-testid="student-row" className={focus !== null && focus < 40 && a + i > 600 ? 'flag' : ''}>
              <td>{r.m.name}<div className="small muted">{r.m.email}</div></td>
              <td>{secs(a)}</td>
              <td>{focus === null ? '-' : `${focus}%`}</td>
              <td>{r.days.filter((d) => d.date >= since && d.activeSec > 0).length}</td>
              <td>{sum(r, 'actions')}</td>
              <td>{sum(r, 'steps')}</td>
              <td>{qa ? `${qc}/${qa}` : '-'}</td>
              <td>{rankFor(xp).name} · {xp}</td>
              <td>{r.progress ? ALL_ACHIEVEMENTS.filter((x) => r.progress!.achievements?.[x.id]).length : 0}</td>
              <td>{lastTest ? `${lastTest.pct}%` : '-'}{r.tests.length > 1 ? <span className="muted small"> ({r.tests.length})</span> : null}</td>
              <td>{tr === null ? '-' : <span className={tr >= 0 ? 'ok-text' : 'bad-text'}>{tr >= 0 ? '▲' : '▼'} {Math.abs(tr)} pts</span>}</td>
              <td><button className="btn btn-sm" onClick={() => setOpen(r)}>Details</button></td>
            </tr>
          );
        })}
        {rows.length === 0 && <tr><td colSpan={12} className="muted">No students in this class yet.</td></tr>}
      </tbody></table></div>}
      {open && <StudentDetail r={open} range={range} close={() => setOpen(null)} />}
    </div>
  );
}

function StudentDetail({ r, range, close }: { r: StudentRow; range: number; close: () => void }) {
  const days = useMemo(() => Array.from({ length: range }, (_, i) => { const d = daysAgo(range - 1 - i); return r.days.find((x) => x.date === d) ?? { date: d, activeSec: 0, idleSec: 0, hiddenSec: 0, xp: 0 } as DayStats; }), [r, range]);
  const xpDays = r.days.filter((d) => d.xp > 0);
  return (
    <div className="tz-detail" data-testid="student-detail">
      <div className="tz-head"><h2 style={{ margin: 0 }}>{r.m.name}</h2><button className="btn btn-sm" onClick={close}>Close</button></div>
      <div className="tz-charts">
        <figure><figcaption>Active minutes per day</figcaption><Bars values={days.map((d) => ({ label: d.date, v: Math.round(d.activeSec / 60), tip: `${d.date}: ${Math.round(d.activeSec / 60)} min active, ${Math.round(d.idleSec / 60)} idle, ${Math.round(d.hiddenSec / 60)} away` }))} unit="min" /></figure>
        <figure><figcaption>Test marks (%)</figcaption>{r.tests.length ? <Line values={r.tests.map((t) => ({ label: t.title, v: t.pct, tip: `${t.title}: ${t.pct}%` }))} max={100} /> : <p className="muted small">No marked tests yet.</p>}</figure>
        <figure><figcaption>XP over time</figcaption>{xpDays.length > 1 ? <Line values={xpDays.map((d) => ({ label: d.date, v: d.xp, tip: `${d.date}: ${d.xp} XP` }))} /> : <p className="muted small">Not enough days yet.</p>}</figure>
      </div>
      {r.progress && <p className="small mt-2">Practical steps verified: {Object.values(r.progress.steps).filter(Boolean).length} · Quiz answers: {Object.keys(r.progress.quizzes).length} · Trophies: {ALL_ACHIEVEMENTS.filter((x) => r.progress!.achievements?.[x.id]).length} of {ALL_ACHIEVEMENTS.length}</p>}
    </div>
  );
}

/** Single-series bar chart (one hue, thin bars rounded at the data end, hover labels). */
function Bars({ values, unit }: { values: { label: string; v: number; tip: string }[]; unit: string }) {
  const W = 320, H = 110, pad = 18;
  const max = Math.max(1, ...values.map((x) => x.v));
  const bw = (W - pad) / values.length;
  return (
    <svg viewBox={`0 0 ${W} ${H + 14}`} className="tz-chart" role="img" aria-label={`Bar chart, ${unit} per day`}>
      <line x1={pad} x2={W} y1={H} y2={H} className="axis" />
      <text x={0} y={10} className="tick">{max}</text><text x={0} y={H} className="tick">0</text>
      {values.map((x, i) => { const h = (x.v / max) * (H - 12); return (
        <g key={i}><rect x={pad + i * bw + bw * 0.2} y={H - h} width={Math.max(2, bw * 0.6)} height={h} rx={Math.min(4, bw * 0.3)} className="bar"><title>{x.tip}</title></rect>
          <rect x={pad + i * bw} y={0} width={bw} height={H} fill="transparent"><title>{x.tip}</title></rect></g>
      ); })}
      <text x={pad} y={H + 12} className="tick">{values[0]?.label.slice(5)}</text><text x={W} y={H + 12} className="tick" textAnchor="end">{values[values.length - 1]?.label.slice(5)}</text>
    </svg>
  );
}
function Line({ values, max: m }: { values: { label: string; v: number; tip: string }[]; max?: number }) {
  const W = 320, H = 110, pad = 22;
  const max = m ?? Math.max(1, ...values.map((x) => x.v));
  const x = (i: number) => pad + (values.length === 1 ? (W - pad) / 2 : (i / (values.length - 1)) * (W - pad - 6));
  const y = (v: number) => H - (v / max) * (H - 10);
  return (
    <svg viewBox={`0 0 ${W} ${H + 14}`} className="tz-chart" role="img" aria-label="Line chart">
      <line x1={pad} x2={W} y1={H} y2={H} className="axis" />
      <text x={0} y={10} className="tick">{max}</text><text x={0} y={H} className="tick">0</text>
      <polyline points={values.map((p, i) => `${x(i)},${y(p.v)}`).join(' ')} className="line" />
      {values.map((p, i) => <circle key={i} cx={x(i)} cy={y(p.v)} r={4} className="pt"><title>{p.tip}</title></circle>)}
      {values.length > 0 && <text x={Math.min(x(values.length - 1) + 7, W - 2)} y={y(values[values.length - 1].v) + 3} className="tick" textAnchor={x(values.length - 1) + 30 > W ? 'end' : 'start'}>{values[values.length - 1].v}</text>}
    </svg>
  );
}

export const TEACHER_TODAY = today;
