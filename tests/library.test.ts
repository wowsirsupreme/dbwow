import './helpers';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { WowProject } from '@/engine/project';
import { SAMPLE_LIST, buildSample } from '@/engine/samples';
import { runQuery } from '@/engine/queries';
import { grade } from '@/exam/checks';
import { LEVELS, readyTest, solveAll, taskLibrary, startDatabase } from '@/exam/library';

describe('sample databases', () => {
  it.each(SAMPLE_LIST.map((s) => s.id))('%s builds, and its saved queries run', async (id) => {
    const p = await buildSample(id);
    expect(p.tables().length).toBeGreaterThanOrEqual(4);
    expect(p.relationships().length).toBeGreaterThanOrEqual(3);
    for (const o of p.listObjects('query')) { if (p.getQuery(o.name)!.kind !== 'select' || /\[/.test(p.getQuery(o.name)!.sql.replace(/\[[^\]]*\]\./g, ''))) continue; const r = runQuery(p, p.getQuery(o.name)!); expect(r.rows.length, o.name).toBeGreaterThan(0); }
    expect(p.listObjects('form').length + p.listObjects('report').length).toBeGreaterThan(0);
  });
});

describe('ready-made tests', () => {
  it.each(SAMPLE_LIST.map((s) => s.id))('%s: the model answer earns full marks and the starting database earns none', async (id) => {
    for (const seed of [1, 7, 12345]) {
      const t = await readyTest(id, 'full', seed);
      expect(t.tasks).toHaveLength(LEVELS.find((l) => l.id === 'full')!.keys.length);
      const blank = grade(t.start, t.tasks);
      expect(blank.tasks.filter((x) => x.ok).map((x) => `${t.tasks.find((k) => k.id === x.id)!.key}: ${x.reason}`)).toEqual([]);
      const model = await WowProject.open(t.start.db.export());
      solveAll(model, t.tasks);
      const r = grade(model, t.tasks);
      expect(r.tasks.filter((x) => !x.ok).map((x) => `${t.tasks.find((k) => k.id === x.id)!.key}: ${x.reason}`)).toEqual([]);
      expect(r.score).toBe(r.max);
    }
  });

  it('picks different values for different tests', async () => {
    const p = await startDatabase('shop');
    const a = taskLibrary('shop', p, 1).map((t) => t.text).join('|');
    const b = taskLibrary('shop', p, 99).map((t) => t.text).join('|');
    expect(a).not.toBe(b);
  });

  it('a wrong answer loses the marks with a reason', async () => {
    const t = await readyTest('library', 'core', 3);
    const p = await WowProject.open(t.start.db.export());
    p.saveQuery({ name: 'qryByValue', kind: 'select', sql: 'SELECT FirstName FROM Members' });
    const r = grade(p, t.tasks);
    const q = r.tasks[t.tasks.findIndex((x) => x.key === 'query.text')];
    expect(q.ok).toBe(false); expect(q.reason).toMatch(/row/);
  });
});

describe('sample exercises', () => {
  it('every sample has three exercises; each model answer returns rows and passes its check', async () => {
    const { SAMPLE_EXERCISES } = await import('@/learning/content');
    const src = readFileSync(path.resolve(__dirname, '../src/learning/content.ts'), 'utf8');
    for (const s of SAMPLE_LIST) {
      const ex = SAMPLE_EXERCISES.filter((x) => x.sample === s.id);
      expect(ex.length, s.id).toBe(3);
      const p = await buildSample(s.id);
      for (const x of ex) {
        const line = src.split('\n').find((l) => l.includes(`id: '${x.id}'`))!;
        const m = /queryReturns\('(\w+)', (['"])(.*?)\2\)/.exec(line)!;
        const sql = m[3].replace(/\\'/g, "'");
        expect(p.db.query(sql).rows.length, x.id).toBeGreaterThan(0);
        expect(x.steps[0].check(p)).not.toBe(true);
        p.saveQuery({ name: m[1], kind: 'select', sql });
        expect(x.steps[0].check(p), x.id).toBe(true);
      }
    }
  });
});

describe('printable results', () => {
  it('makes a mark sheet with every checkpoint and a page per student', async () => {
    const { resultsPdf, studentResultPdf } = await import('@/exam/print');
    const { zeroCounters } = await import('@/cloud/school');
    const t = await readyTest('cinema', 'core', 5);
    const test = { id: 't', title: t.title, instructions: '', classId: null, durationMin: 40, status: 'closed' as const, code: 'X', tasks: t.tasks.map(({ id, text, marks }) => ({ id, text, marks })), start: { kind: 'blank' as const }, settings: { requireFullscreen: true, allowLearning: false }, ownerUid: 'u', ownerName: 'T', created: '', resultsReleased: false };
    const model = await WowProject.open(t.start.db.export()); solveAll(model, t.tasks);
    const g = grade(model, t.tasks); const g0 = grade(t.start, t.tasks);
    const student = (name: string, gr: typeof g) => ({ name, email: `${name}@x`, status: 'handed in', counters: { ...zeroCounters(), tabSwitches: 2 }, score: gr.score, max: gr.max, adjust: 1, comment: 'Good', tasks: t.tasks.map((k, i) => ({ text: k.text, marks: gr.tasks[i].marks, max: k.marks, ok: gr.tasks[i].ok, reason: gr.tasks[i].reason })) });
    const doc = resultsPdf(test, [student('Ama', g), student('Kofi', g0)], { className: 'JHS 2' });
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(3);
    const raw = doc.output();
    expect(raw).toContain('mark sheet'); expect(raw).toContain('Kofi'); expect(raw).toContain('Checkpoints');
    expect(studentResultPdf(t.title, student('Ama', g)).getNumberOfPages()).toBeGreaterThanOrEqual(1);
  });
});
