'use client';
import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Circle, BookOpen, ListChecks, Braces, Keyboard, GraduationCap, Database } from 'lucide-react';
import type { WowProject } from '@/engine/project';
import { TOPICS, PRACTICALS, SAMPLE_EXERCISES, loadProgress, saveProgress, type Practical, type Progress } from '@/learning/content';
import { SAMPLE_LIST } from '@/engine/samples';
import { useApp, type Tab } from './store';
import { highlightSql } from './SqlEditor';
import { confirmBox } from './dialogs';

export function LearningCentre({ tab, project: p, openSample }: { tab: Tab; project: WowProject | null; openSample: (id: string) => void }) {
  const [sel, setSel] = useState<string>(String(tab.payload?.section ?? 'topic:intro'));
  useEffect(() => { if (tab.payload?.section) setSel(String(tab.payload.section)); }, [tab.payload?.section]);
  useEffect(() => {
    const h = (e: Event) => { setSel(String((e as CustomEvent).detail)); document.querySelector('.lc-main')?.scrollTo(0, 0); };
    document.addEventListener('wowdb-learn', h);
    return () => document.removeEventListener('wowdb-learn', h);
  }, []);
  const [progress, setProgress] = useState<Progress>(() => loadProgress());
  const update = (pr: Progress) => { setProgress(pr); saveProgress(pr); };
  const version = useApp((s) => s.version);

  const allPracticals = [...PRACTICALS, ...SAMPLE_EXERCISES];
  const totalSteps = allPracticals.reduce((s, x) => s + x.steps.length, 0);
  const doneSteps = Object.values(progress.steps).filter(Boolean).length;
  const quizDone = Object.keys(progress.quizzes).length;
  const quizTotal = TOPICS.reduce((s, t) => s + t.quiz.length, 0);

  const [kind, id] = sel.split(':');
  return (
    <div className="lc">
      <div className="lc-side">
        <div style={{ padding: '12px 12px 6px' }}>
          <div className="flex items-center gap-2" style={{ color: 'var(--accent-dark)', fontWeight: 600 }}><GraduationCap size={18} /> WOWDB Learning Centre</div>
          <div className="small muted mt-1">Practical steps: {doneSteps}/{totalSteps} · Questions: {quizDone}/{quizTotal}</div>
          <div style={{ height: 6, background: '#e5e5e5', marginTop: 4 }}><div style={{ height: 6, width: `${Math.round(((doneSteps + quizDone) / (totalSteps + quizTotal)) * 100)}%`, background: '#3c8d40' }} /></div>
        </div>
        <div className="grp">Topics</div>
        {TOPICS.map((t, i) => {
          const answered = t.quiz.filter((_, k) => progress.quizzes[`${t.id}:${k}`] !== undefined).length;
          return <div key={t.id} className={'it' + (sel === `topic:${t.id}` ? ' on' : '')} onClick={() => setSel(`topic:${t.id}`)}>{answered === t.quiz.length ? <CheckCircle2 size={13} color="#3c8d40" /> : <BookOpen size={13} color="#888" />}{i + 1}. {t.title}</div>;
        })}
        <div className="grp">Guided practicals</div>
        {PRACTICALS.map((x) => <PracticalLink key={x.id} x={x} sel={sel} setSel={setSel} progress={progress} />)}
        <div className="grp">Sample database exercises</div>
        {SAMPLE_EXERCISES.map((x) => <PracticalLink key={x.id} x={x} sel={sel} setSel={setSel} progress={progress} />)}
        <div className="grp">Reference</div>
        <div className={'it' + (sel === 'ref:sql' ? ' on' : '')} onClick={() => setSel('ref:sql')}><Braces size={13} /> SQL Reference</div>
        <div className={'it' + (sel === 'ref:keys' ? ' on' : '')} onClick={() => setSel('ref:keys')}><Keyboard size={13} /> Keyboard Shortcuts</div>
        <div className={'it' + (sel === 'ref:samples' ? ' on' : '')} onClick={() => setSel('ref:samples')}><Database size={13} /> Sample Databases</div>
        <div style={{ padding: 12 }}><button className="btn btn-sm" onClick={async () => { if (await confirmBox('Reset all quiz answers and practical progress on this device?', { danger: true })) update({ quizzes: {}, steps: {} }); }}>Reset my progress</button></div>
      </div>
      <div className="lc-main">
        {kind === 'topic' && <TopicView id={id} progress={progress} update={update} />}
        {kind === 'prac' && <PracticalView x={allPracticals.find((x) => x.id === id)!} p={p} progress={progress} update={update} version={version} openSample={openSample} />}
        {sel === 'ref:sql' && <SqlReference />}
        {sel === 'ref:keys' && <Shortcuts />}
        {sel === 'ref:samples' && <SamplesRef openSample={openSample} />}
      </div>
    </div>
  );
}

function PracticalLink({ x, sel, setSel, progress }: { x: Practical; sel: string; setSel: (s: string) => void; progress: Progress }) {
  const done = x.steps.every((_, i) => progress.steps[`${x.id}:${i}`]);
  return <div className={'it' + (sel === `prac:${x.id}` ? ' on' : '')} onClick={() => setSel(`prac:${x.id}`)}>{done ? <CheckCircle2 size={13} color="#3c8d40" /> : <ListChecks size={13} color="#888" />}<span>{x.title} <span className="muted small">· {x.level}</span></span></div>;
}

function TopicView({ id, progress, update }: { id: string; progress: Progress; update: (p: Progress) => void }) {
  const t = TOPICS.find((x) => x.id === id) ?? TOPICS[0];
  const idx = TOPICS.indexOf(t);
  return (
    <div>
      <div className="small muted">Topic {idx + 1} of {TOPICS.length}</div>
      <h2>{t.title}</h2>
      {t.body.map((b, i) => <p key={i} style={{ marginBottom: 10 }}>{b}</p>)}
      <div style={{ background: 'var(--accent-soft)', border: '1px solid #c5d9f1', padding: '8px 12px', margin: '12px 0' }}>
        <b>Key points</b>
        <ul style={{ margin: '4px 0 0 18px', listStyle: 'disc' }}>{t.points.map((x) => <li key={x}>{x}</li>)}</ul>
      </div>
      {t.tryIt && <p><b>Try it:</b> {t.tryIt}</p>}
      <h3 className="section-title" style={{ marginTop: 20 }}>Knowledge check</h3>
      {t.quiz.map((qz, k) => {
        const key = `${t.id}:${k}`;
        const ans = progress.quizzes[key];
        return (
          <div key={k} style={{ marginBottom: 16 }}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>{k + 1}. {qz.q}</div>
            {qz.options.map((o, i) => (
              <button key={i} className={'quiz-opt' + (ans !== undefined && i === qz.answer ? ' right' : '') + (ans === i && i !== qz.answer ? ' wrong' : '')} onClick={() => update({ ...progress, quizzes: { ...progress.quizzes, [key]: i } })}>{String.fromCharCode(65 + i)}. {o}</button>
            ))}
            {ans !== undefined && <div className="small" style={{ marginTop: 4, color: ans === qz.answer ? '#1e5b22' : '#8a1c15' }}>{ans === qz.answer ? '✓ Correct. ' : '✗ Not quite. '}{qz.why}</div>}
          </div>
        );
      })}
      <div className="flex gap-2 mt-4">
        {idx > 0 && <button className="btn" onClick={() => document.dispatchEvent(new CustomEvent('wowdb-learn', { detail: `topic:${TOPICS[idx - 1].id}` }))}>← Previous</button>}
        {idx < TOPICS.length - 1 && <button className="btn btn-primary" onClick={() => document.dispatchEvent(new CustomEvent('wowdb-learn', { detail: `topic:${TOPICS[idx + 1].id}` }))}>Next topic →</button>}
      </div>
    </div>
  );
}

function PracticalView({ x, p, progress, update, version, openSample }: { x: Practical; p: WowProject | null; progress: Progress; update: (p: Progress) => void; version: number; openSample: (id: string) => void }) {
  const [hint, setHint] = useState<number | null>(null);
  const [model, setModel] = useState(false);
  const results = useMemo(() => x.steps.map((s) => { try { return s.check(p); } catch (e) { return String((e as Error).message); } }), [x, p, version]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const steps = { ...progress.steps };
    let ch = false;
    results.forEach((r, i) => { const k = `${x.id}:${i}`; if (r === true && !steps[k]) { steps[k] = true; ch = true; } });
    if (ch) update({ ...progress, steps });
  }, [results]); // eslint-disable-line react-hooks/exhaustive-deps
  const firstOpen = results.findIndex((r) => r !== true);
  const sampleInfo = x.sample ? SAMPLE_LIST.find((s) => s.id === x.sample) : undefined;
  const onSample = p?.getMeta('sample') === x.sample;
  return (
    <div>
      <div className="small muted">{x.level} practical</div>
      <h2>{x.title}</h2>
      <p className="mb-3">{x.intro}</p>
      {sampleInfo && !onSample && <div className="banner warn mb-3" style={{ border: '1px solid #f2cf99' }}>This activity uses the {sampleInfo.name} sample database. <button className="btn btn-sm" onClick={() => openSample(sampleInfo.id)}>Open a fresh copy</button></div>}
      <p className="small muted mb-2">Each step is checked automatically against the real database as you work. Keep this tab open beside your work, or come back and the checks update.</p>
      {x.steps.map((s, i) => {
        const r = results[i];
        const ok = r === true;
        return (
          <div key={i} className={'step' + (ok ? ' done' : '')}>
            <div className="num">{ok ? '✓' : i + 1}</div>
            <div style={{ flex: 1 }}>
              <div>{s.text}</div>
              {!ok && i === firstOpen && typeof r === 'string' && <div className="small" style={{ color: '#7a4b00', marginTop: 3 }}>{r}</div>}
              {hint === i && <div className="small" style={{ color: 'var(--accent-dark)', marginTop: 3 }}>Hint: {s.hint}</div>}
            </div>
            {!ok && <button className="btn btn-sm" onClick={() => setHint(hint === i ? null : i)}>Hint</button>}
          </div>
        );
      })}
      {firstOpen === -1 && <div className="banner ok" style={{ border: '1px solid #b9dfbb' }}>Excellent — every step is complete and verified against your database.</div>}
      {x.modelAnswer && <div className="mt-3"><button className="btn btn-sm" onClick={() => setModel(!model)}>{model ? 'Hide' : 'Show'} model answer</button>{model && <pre className="sqled" style={{ position: 'static', border: '1px solid var(--line)', marginTop: 6, padding: 10, whiteSpace: 'pre-wrap' }}>{highlightSql(x.modelAnswer)}</pre>}</div>}
      {!p && <p className="muted mt-3">Open or create a database to start.</p>}
      <span style={{ display: 'none' }}><Circle /></span>
    </div>
  );
}

const SQL_REF: { title: string; sql: string; note: string }[] = [
  { title: 'Select columns', sql: 'SELECT FirstName, LastName FROM Students;', note: 'Use * for every column.' },
  { title: 'Filter rows', sql: "SELECT * FROM Students WHERE Town = 'Accra' AND FeePaid >= 500;", note: 'Text values go in single quotes. Combine conditions with AND / OR / NOT.' },
  { title: 'Patterns, ranges and lists', sql: "SELECT * FROM Students\nWHERE LastName LIKE 'A%'\n  AND DateOfBirth BETWEEN '2010-01-01' AND '2011-12-31'\n  AND Town IN ('Accra', 'Tema');", note: '% matches any characters and _ one character (Access uses * and ?).' },
  { title: 'Sort and limit', sql: 'SELECT * FROM Students ORDER BY LastName ASC, FirstName DESC LIMIT 10;', note: 'LIMIT is the SQLite version of Access TOP.' },
  { title: 'Distinct values', sql: 'SELECT DISTINCT Town FROM Students;', note: 'Removes duplicate rows from the result.' },
  { title: 'Inner join', sql: 'SELECT s.FirstName, c.ClassName\nFROM Students AS s\n  INNER JOIN Classes AS c ON c.ClassID = s.ClassID;', note: 'Only rows with a match in both tables.' },
  { title: 'Left join', sql: 'SELECT c.ClassName, s.FirstName\nFROM Classes AS c\n  LEFT JOIN Students AS s ON s.ClassID = c.ClassID;', note: 'All classes, even those with no students. RIGHT JOIN is also supported.' },
  { title: 'Aggregates and grouping', sql: 'SELECT ClassID, COUNT(*) AS Students, AVG(FeePaid) AS AvgFee\nFROM Students\nGROUP BY ClassID\nHAVING COUNT(*) > 5;', note: 'COUNT, SUM, AVG, MIN, MAX. HAVING filters groups.' },
  { title: 'Subquery', sql: 'SELECT FirstName, FeePaid FROM Students\nWHERE FeePaid > (SELECT AVG(FeePaid) FROM Students);', note: 'Subqueries are kept in SQL View (they cannot be drawn in Design View).' },
  { title: 'Parameter', sql: 'SELECT * FROM Students WHERE Town = [Enter town];', note: 'WOWDB asks for the value when the query runs and binds it safely.' },
  { title: 'Insert', sql: "INSERT INTO Students (FirstName, LastName, ClassID) VALUES ('Esi', 'Owusu', 1);", note: 'The engine checks keys, rules and relationships.' },
  { title: 'Update', sql: "UPDATE Students SET Town = 'Tema' WHERE StudentID = 3;", note: 'Without WHERE every row changes.' },
  { title: 'Delete', sql: 'DELETE FROM Attendance WHERE Present = 0;', note: 'Cannot be undone; WOWDB asks first.' },
  { title: 'Create a table', sql: 'CREATE TABLE Clubs (\n  ClubID INTEGER PRIMARY KEY AUTOINCREMENT,\n  ClubName TEXT NOT NULL UNIQUE\n);', note: 'New tables appear in the Navigation Pane automatically.' },
  { title: 'Make table', sql: 'CREATE TABLE AccraStudents AS\nSELECT * FROM Students WHERE Town = \'Accra\';', note: 'Same as an Access Make Table query.' },
  { title: 'Dates', sql: "SELECT FirstName, date(DateOfBirth, '+18 years') AS Adult,\n  CAST(strftime('%Y', DateOfBirth) AS INTEGER) AS BirthYear\nFROM Students;", note: "Dates are stored as yyyy-mm-dd text. date('now') is today." },
];

function SqlReference() {
  return (
    <div>
      <h2>SQL Reference</h2>
      <p className="mb-3">WOWDB runs real SQLite SQL. Copy any example into Create &gt; SQL Query (or a SQL Module) and press Run. Access-style [Field] names in square brackets are also accepted.</p>
      {SQL_REF.map((r) => (
        <div key={r.title} style={{ marginBottom: 14 }}>
          <div style={{ fontWeight: 600 }}>{r.title}</div>
          <pre style={{ background: '#fafafa', border: '1px solid var(--line-soft)', padding: '6px 10px', margin: '4px 0', fontFamily: 'ui-monospace, Consolas, monospace', fontSize: 12.5, whiteSpace: 'pre-wrap' }}>{highlightSql(r.sql)}</pre>
          <div className="small muted">{r.note}</div>
        </div>
      ))}
    </div>
  );
}

export const SHORTCUTS: [string, string][] = [
  ['Ctrl+Alt+N (Ctrl+N in the desktop app)', 'New database'], ['Ctrl+O', 'Open database'], ['Ctrl+S', 'Save the current object'], ['Ctrl+Z / Ctrl+Y', 'Undo / Redo (designers)'],
  ['Ctrl+C / Ctrl+X / Ctrl+V', 'Copy / Cut / Paste (cells, controls)'], ['Ctrl+F', 'Find'], ['Ctrl+H', 'Replace'], ['Delete', 'Delete selected record, field or control (asks first)'],
  ['F5', 'Refresh / run query'], ['F6', 'Switch between Navigation Pane and the workspace'], ['F11', 'Show / hide the Navigation Pane'], ['Ctrl+W', 'Close the current tab (Ctrl+F4 in the desktop app)'],
  ['Ctrl+Enter', 'Run SQL (SQL View)'], ['Shift+Enter', 'Save the current record'], ['Esc', 'Undo changes to the current field / record'], ['F2', 'Edit the current cell'],
  ['Arrow keys', 'Move between cells; nudge selected controls (Ctrl = grid step, Shift = resize)'], ['Ctrl+D', 'Duplicate selected controls'], ['Ctrl+A', 'Select all'], ['PageUp / PageDown', 'Previous / next record in Form View'],
];
function Shortcuts() {
  return (
    <div>
      <h2>Keyboard Shortcuts</h2>
      <p className="mb-3 muted">Some browser shortcuts (such as Ctrl+N and Ctrl+W in Chrome) cannot be overridden by a web page, so WOWDB also offers the alternatives shown.</p>
      <table className="mini-grid"><tbody>{SHORTCUTS.map(([k, d]) => <tr key={k}><td><span className="kbd">{k}</span></td><td>{d}</td></tr>)}</tbody></table>
    </div>
  );
}

function SamplesRef({ openSample }: { openSample: (id: string) => void }) {
  return (
    <div>
      <h2>Sample Databases</h2>
      <p className="mb-3">Each sample contains fictional records, primary and foreign keys, enforced relationships, example queries, forms and reports, and beginner, intermediate and advanced exercises. Opening a sample creates a new copy, so you can experiment freely.</p>
      {SAMPLE_LIST.map((s) => <div key={s.id} className="step"><div className="num"><Database size={13} /></div><div style={{ flex: 1 }}><b>{s.name}</b><div className="small muted">{s.description}</div></div><button className="btn btn-sm" onClick={() => openSample(s.id)}>Open copy</button></div>)}
    </div>
  );
}
