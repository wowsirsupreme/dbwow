// Achievements, trophies, XP and ranks for the Learning Centre.
//
// Every achievement is earned from evidence: either the state of the real
// database (a saved table with a key, an enforced relationship, a grouped
// report with totals …), the learner's verified practical steps and quiz
// answers, or an action the app records (import, export, PDF, SQL run).
// Nothing is awarded for simply opening a screen.
import type { WowProject } from '@/engine/project';
import type { FormDef, QueryDef, ReportDef, TableDef } from '@/engine/types';
import { PRACTICALS, SAMPLE_EXERCISES, TOPICS, type Practical } from './content';

export type Tier = 'bronze' | 'silver' | 'gold' | 'platinum';
export type Category = 'Tables' | 'Relationships' | 'Queries' | 'Forms' | 'Reports' | 'Data' | 'Learning';

export interface LearnState {
  quizzes: Record<string, number>;          // "topic:index" -> chosen option
  steps: Record<string, boolean>;           // "practical:index" -> verified
  achievements?: Record<string, string>;    // id -> ISO date unlocked
  events?: Record<string, number>;          // action -> count
}

export interface Achievement {
  id: string;
  title: string;
  how: string;                  // what to do to earn it (shown while locked)
  tier: Tier;
  category: Category;
  /** Database evidence. Called with the open database (may be null). */
  db?: (p: WowProject) => boolean;
  /** Learner evidence: verified steps, quiz answers, recorded actions. */
  learner?: (s: LearnState) => boolean;
}

export const XP: Record<Tier, number> = { bronze: 15, silver: 30, gold: 60, platinum: 150 };
export const XP_STEP = 10;
export const XP_QUIZ = 5;

export const RANKS: { name: string; xp: number }[] = [
  { name: 'Novice', xp: 0 },
  { name: 'Data Clerk', xp: 100 },
  { name: 'Table Builder', xp: 250 },
  { name: 'Query Analyst', xp: 500 },
  { name: 'Database Designer', xp: 900 },
  { name: 'Database Architect', xp: 1400 },
  { name: 'Database Master', xp: 2000 },
];

// ---------- helpers on the real database ----------
const userTables = (p: WowProject): TableDef[] => p.tables();
const rows = (p: WowProject, t: string) => { try { return Number(p.db.scalar(`SELECT count(*) FROM "${t.replace(/"/g, '""')}"`)); } catch { return 0; } };
const queries = (p: WowProject): QueryDef[] => p.listObjects('query').map((o) => p.getQuery(o.name)).filter((x): x is QueryDef => !!x);
const forms = (p: WowProject): FormDef[] => p.listObjects('form').map((o) => p.getForm(o.name)).filter((x): x is FormDef => !!x);
const reports = (p: WowProject): ReportDef[] => p.listObjects('report').map((o) => p.getReport(o.name)).filter((x): x is ReportDef => !!x);
const anyQuery = (p: WowProject, re: RegExp, kind?: QueryDef['kind']) => queries(p).some((q) => (!kind || q.kind === kind) && re.test(q.sql));

// ---------- learner helpers ----------
const ev = (s: LearnState, k: string, n = 1) => (s.events?.[k] ?? 0) >= n;
const practicalDone = (s: LearnState, x: Practical) => x.steps.every((_, i) => s.steps[`${x.id}:${i}`]);
const correctAnswers = (s: LearnState) => TOPICS.reduce((n, t) => n + t.quiz.filter((qz, k) => s.quizzes[`${t.id}:${k}`] === qz.answer).length, 0);
const topicsMastered = (s: LearnState) => TOPICS.filter((t) => t.quiz.every((qz, k) => s.quizzes[`${t.id}:${k}`] === qz.answer)).length;
const stepsDone = (s: LearnState) => Object.values(s.steps).filter(Boolean).length;
const exercisesAt = (s: LearnState, level: Practical['level']) => SAMPLE_EXERCISES.filter((x) => x.level === level).every((x) => practicalDone(s, x));

export const ACHIEVEMENTS: Achievement[] = [
  // ---- Tables ----
  { id: 'first-table', title: 'Table Setter', how: 'Save your first table.', tier: 'bronze', category: 'Tables', db: (p) => userTables(p).length > 0 },
  { id: 'key-holder', title: 'Key Holder', how: 'Give a table a primary key.', tier: 'bronze', category: 'Tables', db: (p) => userTables(p).some((t) => t.fields.some((f) => f.primaryKey)) },
  { id: 'auto-pilot', title: 'Auto Pilot', how: 'Use an AutoNumber field.', tier: 'bronze', category: 'Tables', db: (p) => userTables(p).some((t) => t.fields.some((f) => f.type === 'AutoNumber')) },
  { id: 'type-collector', title: 'Type Collector', how: 'Use five different data types in one table.', tier: 'silver', category: 'Tables', db: (p) => userTables(p).some((t) => new Set(t.fields.map((f) => f.type)).size >= 5) },
  { id: 'gatekeeper', title: 'Gatekeeper', how: 'Set a Validation Rule on a field.', tier: 'silver', category: 'Tables', db: (p) => userTables(p).some((t) => t.fields.some((f) => !!f.validationRule?.trim())) },
  { id: 'lookup-pro', title: 'Lookup Pro', how: 'Create a lookup field (combo box) in a table.', tier: 'silver', category: 'Tables', db: (p) => userTables(p).some((t) => t.fields.some((f) => !!f.lookup)) },
  { id: 'calculator', title: 'Calculator', how: 'Add a Calculated field.', tier: 'silver', category: 'Tables', db: (p) => userTables(p).some((t) => t.fields.some((f) => f.type === 'Calculated')) },
  { id: 'data-entry', title: 'Data Entry', how: 'Have 10 records in one table.', tier: 'bronze', category: 'Tables', db: (p) => userTables(p).some((t) => rows(p, t.name) >= 10) },
  { id: 'composite', title: 'Two Keys Are Better', how: 'Make a composite primary key (two fields).', tier: 'gold', category: 'Tables', db: (p) => userTables(p).some((t) => t.fields.filter((f) => f.primaryKey).length >= 2) },

  // ---- Relationships ----
  { id: 'connector', title: 'Connector', how: 'Create a relationship between two tables.', tier: 'bronze', category: 'Relationships', db: (p) => p.relationships().length > 0 },
  { id: 'integrity', title: 'Integrity Guard', how: 'Enforce referential integrity on a relationship.', tier: 'silver', category: 'Relationships', db: (p) => p.relationships().some((r) => r.enforce) },
  { id: 'cascade', title: 'Cascade', how: 'Turn on Cascade Update or Cascade Delete.', tier: 'silver', category: 'Relationships', db: (p) => p.relationships().some((r) => r.enforce && (r.cascadeUpdate || r.cascadeDelete)) },
  { id: 'many-to-many', title: 'Many-to-Many', how: 'Link two tables through a junction table (one table on the "many" side of two enforced relationships).', tier: 'gold', category: 'Relationships', db: (p) => { const c: Record<string, number> = {}; for (const r of p.relationships()) if (r.enforce) c[r.relatedTable] = (c[r.relatedTable] ?? 0) + 1; return Object.values(c).some((n) => n >= 2); } },

  // ---- Queries ----
  { id: 'first-query', title: 'Question Asker', how: 'Save your first query.', tier: 'bronze', category: 'Queries', db: (p) => queries(p).length > 0 },
  { id: 'filter', title: 'Filter Master', how: 'Save a query with criteria (a WHERE clause).', tier: 'bronze', category: 'Queries', db: (p) => anyQuery(p, /\bwhere\b/i) },
  { id: 'sorter', title: 'In Order', how: 'Save a query that sorts its results.', tier: 'bronze', category: 'Queries', db: (p) => anyQuery(p, /\border\s+by\b/i) },
  { id: 'joiner', title: 'Joiner', how: 'Save a query that joins two tables.', tier: 'silver', category: 'Queries', db: (p) => anyQuery(p, /\bjoin\b/i) },
  { id: 'totals', title: 'Number Cruncher', how: 'Save a totals query (Group By with Sum, Count or Avg).', tier: 'silver', category: 'Queries', db: (p) => anyQuery(p, /\bgroup\s+by\b/i) },
  { id: 'parameter', title: 'Ask Me Anything', how: 'Save a parameter query, e.g. criteria [Enter class].', tier: 'silver', category: 'Queries', db: (p) => queries(p).some((q) => /\[[^\]]+\]/.test(q.sql) && /\bwhere\b/i.test(q.sql) && /\[(enter|type|which|what|choose|select)[^\]]*\]/i.test(q.sql)) },
  { id: 'crosstab', title: 'Crosstab Crafter', how: 'Save a crosstab query.', tier: 'gold', category: 'Queries', db: (p) => queries(p).some((q) => q.kind === 'crosstab') },
  { id: 'subquery', title: 'Query Inception', how: 'Save a query that contains a subquery.', tier: 'gold', category: 'Queries', db: (p) => anyQuery(p, /\(\s*select\b/i) },
  { id: 'sql-speaker', title: 'SQL Speaker', how: 'Run a statement you wrote in SQL View.', tier: 'bronze', category: 'Queries', learner: (s) => ev(s, 'sql-run') },
  { id: 'action-hero', title: 'Action Hero', how: 'Run an update, append, delete or make-table query.', tier: 'silver', category: 'Queries', learner: (s) => ev(s, 'action-query') },

  // ---- Forms ----
  { id: 'first-form', title: 'Form Maker', how: 'Save a form bound to a table or query.', tier: 'bronze', category: 'Forms', db: (p) => forms(p).some((f) => !!f.recordSource) },
  { id: 'button-pusher', title: 'Button Pusher', how: 'Add a command button with an On Click action.', tier: 'silver', category: 'Forms', db: (p) => forms(p).some((f) => f.controls.some((c) => c.type === 'button' && c.props.onClick && c.props.onClick !== 'None')) },
  { id: 'combo', title: 'Pick From a List', how: 'Bind a combo box on a form to a field.', tier: 'silver', category: 'Forms', db: (p) => forms(p).some((f) => f.controls.some((c) => c.type === 'combobox' && !!c.props.controlSource)) },
  { id: 'subform', title: 'Form Within a Form', how: 'Add a linked subform to a form.', tier: 'gold', category: 'Forms', db: (p) => forms(p).some((f) => f.controls.some((c) => c.type === 'subform' && !!c.props.sourceObject && !!c.props.linkChildFields)) },

  // ---- Reports ----
  { id: 'first-report', title: 'Reporter', how: 'Save a report.', tier: 'bronze', category: 'Reports', db: (p) => reports(p).length > 0 },
  { id: 'grouper', title: 'Grouped', how: 'Group a report on a field.', tier: 'silver', category: 'Reports', db: (p) => reports(p).some((r) => r.groups.some((g) => !g.isSort)) },
  { id: 'grand-total', title: 'Grand Total', how: 'Put a total such as =Sum([Fee]) or =Count(*) in a group or report footer.', tier: 'silver', category: 'Reports', db: (p) => reports(p).some((r) => { const foot = r.sections.filter((s) => s.kind === 'groupFooter' || s.kind === 'reportFooter').map((s) => s.id); return r.controls.some((c) => foot.includes(c.section) && /=\s*(sum|count|avg|min|max)\s*\(/i.test(String(c.props.controlSource ?? ''))); }) },
  { id: 'publisher', title: 'Publisher', how: 'Export a report to PDF.', tier: 'silver', category: 'Reports', learner: (s) => ev(s, 'pdf') },

  // ---- Data ----
  { id: 'importer', title: 'Importer', how: 'Import data with the Import Wizard.', tier: 'silver', category: 'Data', learner: (s) => ev(s, 'import') },
  { id: 'exporter', title: 'Exporter', how: 'Export a table or query (CSV, Excel, JSON or SQL).', tier: 'bronze', category: 'Data', learner: (s) => ev(s, 'export') },
  { id: 'safe-keeper', title: 'Safe Keeper', how: 'Back up your database or download it as a .dbwow file.', tier: 'bronze', category: 'Data', learner: (s) => ev(s, 'backup') },
  { id: 'explorer', title: 'Explorer', how: 'Open three different sample databases.', tier: 'bronze', category: 'Data', learner: (s) => ['sample:school', 'sample:library', 'sample:hospital', 'sample:shop', 'sample:employee'].filter((k) => ev(s, k)).length >= 3 },

  // ---- Learning ----
  { id: 'first-step', title: 'First Step', how: 'Complete any practical step.', tier: 'bronze', category: 'Learning', learner: (s) => stepsDone(s) >= 1 },
  { id: 'quiz-starter', title: 'Quick Thinker', how: 'Answer 5 knowledge-check questions correctly.', tier: 'bronze', category: 'Learning', learner: (s) => correctAnswers(s) >= 5 },
  { id: 'quiz-pro', title: 'Scholar', how: 'Answer 15 knowledge-check questions correctly.', tier: 'silver', category: 'Learning', learner: (s) => correctAnswers(s) >= 15 },
  { id: 'all-topics', title: 'Theory Champion', how: 'Answer every question in all 20 topics correctly.', tier: 'gold', category: 'Learning', learner: (s) => topicsMastered(s) === TOPICS.length },
  ...PRACTICALS.map((x): Achievement => ({ id: `prac-${x.id}`, title: x.title, how: `Complete every step of the "${x.title}" practical.`, tier: x.level === 'Beginner' ? 'bronze' : x.level === 'Intermediate' ? 'silver' : 'gold', category: 'Learning', learner: (s) => practicalDone(s, x) })),
  { id: 'ex-beginner', title: 'Beginner Exercises', how: 'Complete all five beginner sample-database exercises.', tier: 'silver', category: 'Learning', learner: (s) => exercisesAt(s, 'Beginner') },
  { id: 'ex-intermediate', title: 'Intermediate Exercises', how: 'Complete all five intermediate sample-database exercises.', tier: 'gold', category: 'Learning', learner: (s) => exercisesAt(s, 'Intermediate') },
  { id: 'ex-advanced', title: 'Advanced Exercises', how: 'Complete all five advanced sample-database exercises.', tier: 'gold', category: 'Learning', learner: (s) => exercisesAt(s, 'Advanced') },
];

/** Platinum: every other achievement unlocked. */
export const PLATINUM: Achievement = { id: 'platinum', title: 'DBWOW Platinum', how: 'Unlock every other achievement.', tier: 'platinum', category: 'Learning', learner: (s) => ACHIEVEMENTS.every((a) => !!s.achievements?.[a.id]) };
export const ALL_ACHIEVEMENTS: Achievement[] = [...ACHIEVEMENTS, PLATINUM];

/**
 * Work out which achievements are newly earned. Database achievements are
 * judged against the open database; once earned they stay earned (like a
 * trophy), even if the learner later deletes the object.
 */
export function newlyEarned(p: WowProject | null, s: LearnState): Achievement[] {
  const have = s.achievements ?? {};
  const out: Achievement[] = [];
  for (const a of ACHIEVEMENTS) {
    if (have[a.id]) continue;
    try { if ((a.db && p && a.db(p)) || (a.learner && a.learner(s))) out.push(a); } catch { /* a broken check never awards */ }
  }
  if (!have[PLATINUM.id]) {
    const after = { ...s, achievements: { ...have, ...Object.fromEntries(out.map((a) => [a.id, 'x'])) } };
    if (PLATINUM.learner!(after)) out.push(PLATINUM);
  }
  return out;
}

export function totalXp(s: LearnState): number {
  const steps = stepsDone(s) * XP_STEP;
  const quiz = correctAnswers(s) * XP_QUIZ;
  const ach = ALL_ACHIEVEMENTS.filter((a) => s.achievements?.[a.id]).reduce((n, a) => n + XP[a.tier], 0);
  return steps + quiz + ach;
}

export function rankFor(xp: number) {
  let i = 0;
  while (i + 1 < RANKS.length && xp >= RANKS[i + 1].xp) i++;
  const cur = RANKS[i], next = RANKS[i + 1];
  return { index: i, name: cur.name, xp, floor: cur.xp, next: next?.xp ?? null, nextName: next?.name ?? null, pct: next ? Math.min(100, Math.round(((xp - cur.xp) / (next.xp - cur.xp)) * 100)) : 100 };
}

export function trophyCounts(s: LearnState) {
  const c: Record<Tier, { have: number; total: number }> = { bronze: { have: 0, total: 0 }, silver: { have: 0, total: 0 }, gold: { have: 0, total: 0 }, platinum: { have: 0, total: 0 } };
  for (const a of ALL_ACHIEVEMENTS) { c[a.tier].total++; if (s.achievements?.[a.id]) c[a.tier].have++; }
  return c;
}
