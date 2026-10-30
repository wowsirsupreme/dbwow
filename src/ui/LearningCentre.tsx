'use client';
import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Circle, BookOpen, ListChecks, Braces, Keyboard, GraduationCap, Database, PanelRightOpen, Trophy, Lock } from 'lucide-react';
import type { WowProject } from '@/engine/project';
import { TOPICS, PRACTICALS, SAMPLE_EXERCISES, type Practical } from '@/learning/content';
import { ALL_ACHIEVEMENTS, RANKS, XP, rankFor, totalXp, trophyCounts, type Category, type LearnState as Progress } from '@/learning/achievements';
import { TIER_LABEL, TrophyIcon, practicalApplies, useLearning, useStepStates } from './learning';
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
  const progress = useLearning((s) => s.progress);
  const update = useLearning((s) => s.setProgress);
  const version = useApp((s) => s.version);
  const xp = totalXp(progress);
  const rank = rankFor(xp);
  const trophies = trophyCounts(progress);

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
          <div className="flex items-center gap-2" style={{ color: 'var(--accent-dark)', fontWeight: 600 }}><GraduationCap size={18} /> DBWOW Learning Centre</div>
          <div className="small muted mt-1">Practical steps: {doneSteps}/{totalSteps} · Questions: {quizDone}/{quizTotal}</div>
          <div style={{ height: 6, background: '#e5e5e5', marginTop: 4 }}><div style={{ height: 6, width: `${Math.round(((doneSteps + quizDone) / (totalSteps + quizTotal)) * 100)}%`, background: '#3c8d40' }} /></div>
          <div className={'lc-rank' + (sel.startsWith('ach:') ? ' on' : '')} onClick={() => setSel('ach:all')} data-testid="lc-achievements">
            <div className="flex items-center gap-2"><Trophy size={15} color="#c99a06" /><b>{rank.name}</b><span className="muted small" style={{ marginLeft: 'auto' }}>{xp} XP</span></div>
            <div className="lc-rank-bar"><div style={{ width: `${rank.pct}%` }} /></div>
            <div className="small muted">{(['bronze', 'silver', 'gold', 'platinum'] as const).map((t) => <span key={t} className="lc-tcount"><TrophyIcon tier={t} size={12} /> {trophies[t].have}/{trophies[t].total}</span>)}</div>
          </div>
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
        <div style={{ padding: 12 }}><button className="btn btn-sm" onClick={async () => { if (await confirmBox('Reset all quiz answers, practical progress, XP and trophies on this device?', { danger: true })) useLearning.getState().reset(); }}>Reset my progress</button></div>
      </div>
      <div className="lc-main">
        {kind === 'ach' && <AchievementsView progress={progress} />}
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

function PracticalView({ x, p, progress, openSample }: { x: Practical; p: WowProject | null; progress: Progress; update: (p: Progress) => void; version: number; openSample: (id: string) => void }) {
  const [hint, setHint] = useState<number | null>(null);
  const [model, setModel] = useState(false);
  const states = useStepStates(x);
  const active = useLearning((s) => s.activePractical);
  const setActive = useLearning((s) => s.setActivePractical);
  const firstOpen = states.findIndex((r) => r.state !== 'done');
  const sampleInfo = x.sample ? SAMPLE_LIST.find((s) => s.id === x.sample) : undefined;
  const onSample = practicalApplies(x, p);
  const everDone = x.steps.filter((_, i) => progress.steps[`${x.id}:${i}`]).length;
  return (
    <div>
      <div className="small muted">{x.level} practical</div>
      <h2>{x.title}</h2>
      <p className="mb-3">{x.intro}</p>
      {sampleInfo && !onSample && <div className="banner warn mb-3" style={{ border: '1px solid #f2cf99' }}>This activity uses the {sampleInfo.name} sample database. <button className="btn btn-sm" onClick={() => openSample(sampleInfo.id)}>Open a fresh copy</button></div>}
      <div className="lc-work mb-3">
        <div style={{ flex: 1 }}>Steps tick themselves off while you work: each one is checked against the real database every time it changes. Steps found in a design you have not saved yet show as <b className="pending-word">save to confirm</b>.</div>
        {active === x.id
          ? <button className="btn" onClick={() => setActive(null)}>Hide the checklist panel</button>
          : <button className="btn btn-primary" data-testid="work-alongside" onClick={() => setActive(x.id)}><PanelRightOpen size={14} style={{ marginRight: 5, verticalAlign: -2 }} />Work on this beside my database</button>}
      </div>
      {x.steps.map((s, i) => {
        const r = states[i];
        const ok = r?.state === 'done';
        return (
          <div key={i} className={'step' + (ok ? ' done' : r?.state === 'pending' ? ' pending' : '')}>
            <div className="num">{ok ? '✓' : i + 1}</div>
            <div style={{ flex: 1 }}>
              <div>{s.text}</div>
              {r && r.state !== 'done' && (i === firstOpen || r.state === 'pending') && <div className="small" style={{ color: r.state === 'pending' ? '#8a5a00' : '#7a4b00', marginTop: 3 }}>{r.note}</div>}
              {hint === i && <div className="small" style={{ color: 'var(--accent-dark)', marginTop: 3 }}>Hint: {s.hint}</div>}
            </div>
            {!ok && <button className="btn btn-sm" onClick={() => setHint(hint === i ? null : i)}>Hint</button>}
          </div>
        );
      })}
      {firstOpen === -1 && <div className="banner ok" style={{ border: '1px solid #b9dfbb' }}>Excellent: every step is complete and verified against your database.</div>}
      {firstOpen !== -1 && everDone > 0 && <p className="small muted mt-2">Steps already earned on this device: {everDone} of {x.steps.length}. Your XP for a step is kept even if you later change the database.</p>}
      {x.modelAnswer && <div className="mt-3"><button className="btn btn-sm" onClick={() => setModel(!model)}>{model ? 'Hide' : 'Show'} model answer</button>{model && <pre className="sqled" style={{ position: 'static', border: '1px solid var(--line)', marginTop: 6, padding: 10, whiteSpace: 'pre-wrap' }}>{highlightSql(x.modelAnswer)}</pre>}</div>}
      {!p && <p className="muted mt-3">Open or create a database to start.</p>}
      <span style={{ display: 'none' }}><Circle /></span>
    </div>
  );
}

const CATS: Category[] = ['Tables', 'Relationships', 'Queries', 'Forms', 'Reports', 'Data', 'Learning'];
function AchievementsView({ progress }: { progress: Progress }) {
  const xp = totalXp(progress);
  const r = rankFor(xp);
  const counts = trophyCounts(progress);
  const fmt = (iso: string) => { try { return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }); } catch { return ''; } };
  return (
    <div>
      <h2>Achievements</h2>
      <p className="mb-3">Earn XP for every verified practical step (10 XP) and correct quiz answer (5 XP). Trophies unlock automatically when DBWOW finds the evidence in your database or in what you have done: Bronze {XP.bronze} XP, Silver {XP.silver} XP, Gold {XP.gold} XP, and Platinum ({XP.platinum} XP) for unlocking every other trophy.</p>
      <div className="ach-summary">
        <div className="ach-rank">
          <div className="small muted">Rank</div>
          <div className="ach-rank-name" data-testid="ach-rank">{r.name}</div>
          <div className="lc-rank-bar" style={{ margin: '6px 0' }}><div style={{ width: `${r.pct}%` }} /></div>
          <div className="small muted">{xp} XP{r.next !== null ? ` · ${r.next - xp} XP to ${r.nextName}` : ' · highest rank reached'}</div>
        </div>
        {(['bronze', 'silver', 'gold', 'platinum'] as const).map((t) => <div key={t} className="ach-count"><TrophyIcon tier={t} size={28} locked={counts[t].have === 0} /><div><b>{counts[t].have}</b> / {counts[t].total}</div><div className="small muted">{TIER_LABEL[t]}</div></div>)}
      </div>
      <div className="small muted mb-3">Ranks: {RANKS.map((x) => `${x.name} (${x.xp})`).join(' · ')}</div>
      {CATS.map((c) => {
        const list = ALL_ACHIEVEMENTS.filter((a) => a.category === c);
        return (
          <div key={c} className="mb-3">
            <h3 className="section-title">{c} <span className="muted small">{list.filter((a) => progress.achievements?.[a.id]).length}/{list.length}</span></h3>
            <div className="ach-grid">
              {list.map((a) => {
                const when = progress.achievements?.[a.id];
                return (
                  <div key={a.id} className={'ach-card' + (when ? ' got' : '')} data-ach={a.id} data-unlocked={when ? 'yes' : 'no'}>
                    <div className="ach-icon">{when ? <TrophyIcon tier={a.tier} size={26} /> : <Lock size={20} color="#b0b0b0" />}</div>
                    <div style={{ minWidth: 0 }}>
                      <div className="ach-title">{a.title}</div>
                      <div className="small muted">{a.how}</div>
                      <div className="small" style={{ color: when ? '#2e6b31' : '#888' }}>{TIER_LABEL[a.tier]} · {XP[a.tier]} XP{when ? ` · unlocked ${fmt(when)}` : ''}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
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
  { title: 'Parameter', sql: 'SELECT * FROM Students WHERE Town = [Enter town];', note: 'DBWOW asks for the value when the query runs and binds it safely.' },
  { title: 'Insert', sql: "INSERT INTO Students (FirstName, LastName, ClassID) VALUES ('Esi', 'Owusu', 1);", note: 'The engine checks keys, rules and relationships.' },
  { title: 'Update', sql: "UPDATE Students SET Town = 'Tema' WHERE StudentID = 3;", note: 'Without WHERE every row changes.' },
  { title: 'Delete', sql: 'DELETE FROM Attendance WHERE Present = 0;', note: 'Cannot be undone; DBWOW asks first.' },
  { title: 'Create a table', sql: 'CREATE TABLE Clubs (\n  ClubID INTEGER PRIMARY KEY AUTOINCREMENT,\n  ClubName TEXT NOT NULL UNIQUE\n);', note: 'New tables appear in the Navigation Pane automatically.' },
  { title: 'Make table', sql: 'CREATE TABLE AccraStudents AS\nSELECT * FROM Students WHERE Town = \'Accra\';', note: 'Same as an Access Make Table query.' },
  { title: 'Dates', sql: "SELECT FirstName, date(DateOfBirth, '+18 years') AS Adult,\n  CAST(strftime('%Y', DateOfBirth) AS INTEGER) AS BirthYear\nFROM Students;", note: "Dates are stored as yyyy-mm-dd text. date('now') is today." },
];

function SqlReference() {
  return (
    <div>
      <h2>SQL Reference</h2>
      <p className="mb-3">DBWOW runs real SQLite SQL. Copy any example into Create &gt; SQL Query (or a SQL Module) and press Run. Access-style [Field] names in square brackets are also accepted.</p>
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
      <p className="mb-3 muted">Some browser shortcuts (such as Ctrl+N and Ctrl+W in Chrome) cannot be overridden by a web page, so DBWOW also offers the alternatives shown.</p>
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
