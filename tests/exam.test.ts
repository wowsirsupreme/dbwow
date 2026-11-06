import './helpers';
import { describe, expect, it } from 'vitest';
import { WowProject } from '@/engine/project';
import { buildSample } from '@/engine/samples';
import { grade, runCheck, type ExamTask } from '@/exam/checks';

describe('practical test marking', () => {
  it('marks a complete school database correctly', async () => {
    const p = await buildSample('school');
    const tasks: ExamTask[] = [
      { id: 't1', text: '', marks: 1, check: { kind: 'table', table: 'students' } },
      { id: 't2', text: '', marks: 1, check: { kind: 'field', table: 'Students', field: 'FeePaid', type: 'Currency' } },
      { id: 't3', text: '', marks: 2, check: { kind: 'primaryKey', table: 'Students', fields: ['StudentID'] } },
      { id: 't4', text: '', marks: 1, check: { kind: 'records', table: 'Classes', min: 5 } },
      { id: 't5', text: '', marks: 2, check: { kind: 'relationship', primary: 'Classes', related: 'Students', enforce: true } },
      { id: 't6', text: '', marks: 2, check: { kind: 'validation', table: 'Results', field: 'Score', rejects: '150' } },
      { id: 't7', text: '', marks: 3, check: { kind: 'report', groupField: 'ClassName', total: true } },
      { id: 't8', text: '', marks: 2, check: { kind: 'form', source: 'Students', fields: ['FirstName', 'LastName'] } },
      { id: 't9', text: '', marks: 2, check: { kind: 'queryUses', contains: 'GROUP BY' } },
      { id: 't10', text: '', marks: 1, check: { kind: 'sql', sql: 'SELECT count(*) > 30 FROM Students', label: 'More than 30 students' } },
    ];
    const r = grade(p, tasks);
    expect(r.tasks.filter((t) => !t.ok).map((t) => `${t.id}: ${t.reason}`)).toEqual([]);
    expect(r.score).toBe(17); expect(r.max).toBe(17);
  });

  it('compares a query with the answer SQL by its rows, whatever the column order', async () => {
    const p = await buildSample('school');
    const key = { kind: 'queryResult' as const, sql: "SELECT FirstName, LastName FROM Students WHERE Town = 'Accra'" };
    const before = runCheck(p, key);
    p.saveQuery({ name: 'qryAccra', kind: 'select', sql: "SELECT LastName, FirstName FROM Students WHERE Town='Accra'" });
    const after = runCheck(p, key);
    expect(after.ok).toBe(true);
    // a wrong filter does not count
    const p2 = await buildSample('school');
    p2.saveQuery({ name: 'qryWrong', kind: 'select', sql: "SELECT FirstName, LastName FROM Students WHERE Town='Kumasi'" });
    expect(runCheck(p2, { ...key, query: 'qryWrong' }).ok).toBe(false);
    expect(typeof before.reason).toBe('string');
  });

  it('gives zero, with reasons, on an empty database, and never changes the database', async () => {
    const p = await WowProject.create('Empty');
    const r = grade(p, [
      { id: 'a', text: '', marks: 2, check: { kind: 'primaryKey', table: 'Students', fields: ['StudentID'] } },
      { id: 'b', text: '', marks: 3, check: { kind: 'queryResult', sql: 'SELECT * FROM Students' } },
    ]);
    expect(r.score).toBe(0);
    expect(r.tasks[0].reason).toMatch(/No table/);
    expect(r.tasks[1].reason).toMatch(/answer key could not run/);
    const s = await buildSample('school');
    const n = s.db.scalar('SELECT count(*) FROM Results');
    runCheck(s, { kind: 'validation', table: 'Results', field: 'Score', rejects: '-5' });
    expect(s.db.scalar('SELECT count(*) FROM Results')).toBe(n);
    expect(s.db.scalar('SELECT min(Score) >= 0 FROM Results')).toBe(1);
  });
});
