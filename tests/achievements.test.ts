import './helpers';
import { describe, expect, it } from 'vitest';
import { WowProject } from '@/engine/project';
import { buildSample } from '@/engine/samples';
import { ACHIEVEMENTS, ALL_ACHIEVEMENTS, PLATINUM, RANKS, newlyEarned, rankFor, totalXp, type LearnState } from '@/learning/achievements';
import { PRACTICALS, TOPICS } from '@/learning/content';

const empty = (): LearnState => ({ quizzes: {}, steps: {}, achievements: {}, events: {} });

describe('achievements', () => {
  it('have unique ids and every tier', () => {
    const ids = ALL_ACHIEVEMENTS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(ALL_ACHIEVEMENTS.map((a) => a.tier))).toEqual(new Set(['bronze', 'silver', 'gold', 'platinum']));
  });

  it('a blank database earns nothing', async () => {
    const p = await WowProject.create('Blank');
    expect(newlyEarned(p, empty())).toEqual([]);
  });

  it('database trophies come from real evidence in the sample databases', async () => {
    const school = await buildSample('school');
    const got = new Set(newlyEarned(school, empty()).map((a) => a.id));
    for (const id of ['first-table', 'key-holder', 'auto-pilot', 'connector', 'integrity', 'first-query', 'filter', 'joiner', 'totals', 'crosstab', 'first-form', 'first-report', 'grouper', 'grand-total', 'data-entry', 'subform']) expect(got, id).toContain(id);
    // nothing learner-based without learner evidence
    expect(got.has('sql-speaker')).toBe(false);
    expect(got.has('first-step')).toBe(false);
  });

  it('many-to-many needs a junction table; composite keys are detected', async () => {
    const p = await WowProject.create('Clubs');
    p.saveTableDesign({ name: 'Students', fields: [{ id: 'a', name: 'StudentID', type: 'AutoNumber', primaryKey: true }, { id: 'b', name: 'Name', type: 'Short Text' }] });
    p.saveTableDesign({ name: 'Clubs', fields: [{ id: 'c', name: 'ClubID', type: 'AutoNumber', primaryKey: true }] });
    p.saveTableDesign({ name: 'Members', fields: [{ id: 'd', name: 'StudentID', type: 'Number', primaryKey: true }, { id: 'e', name: 'ClubID', type: 'Number', primaryKey: true }] });
    let ids = newlyEarned(p, empty()).map((a) => a.id);
    expect(ids).toContain('composite');
    expect(ids).not.toContain('many-to-many');
    p.saveRelationship({ primaryTable: 'Students', relatedTable: 'Members', fields: [{ primary: 'StudentID', related: 'StudentID' }], enforce: true, cascadeUpdate: false, cascadeDelete: true, joinType: 'inner' });
    p.saveRelationship({ primaryTable: 'Clubs', relatedTable: 'Members', fields: [{ primary: 'ClubID', related: 'ClubID' }], enforce: true, cascadeUpdate: false, cascadeDelete: false, joinType: 'inner' });
    ids = newlyEarned(p, empty()).map((a) => a.id);
    expect(ids).toEqual(expect.arrayContaining(['many-to-many', 'cascade', 'integrity']));
  });

  it('learner trophies use verified steps, quiz answers and recorded actions', () => {
    const s = empty();
    s.steps[`${PRACTICALS[0].id}:0`] = true;
    s.events = { 'sql-run': 1, import: 1, 'sample:school': 1, 'sample:shop': 1, 'sample:library': 1 };
    let k = 0;
    for (const t of TOPICS) t.quiz.forEach((qz, i) => { if (k++ < 5) s.quizzes[`${t.id}:${i}`] = qz.answer; });
    const ids = newlyEarned(null, s).map((a) => a.id);
    expect(ids).toEqual(expect.arrayContaining(['first-step', 'sql-speaker', 'importer', 'explorer', 'quiz-starter']));
    expect(ids).not.toContain('quiz-pro');
    // wrong answers do not count
    const wrong = empty(); for (const t of TOPICS) t.quiz.forEach((qz, i) => { wrong.quizzes[`${t.id}:${i}`] = (qz.answer + 1) % qz.options.length; });
    expect(newlyEarned(null, wrong).map((a) => a.id)).not.toContain('quiz-starter');
  });

  it('platinum needs every other trophy; XP and ranks add up', () => {
    const s = empty();
    s.achievements = Object.fromEntries(ACHIEVEMENTS.slice(1).map((a) => [a.id, 'x']));
    expect(newlyEarned(null, s).map((a) => a.id)).not.toContain(PLATINUM.id);
    s.achievements[ACHIEVEMENTS[0].id] = 'x';
    expect(newlyEarned(null, s).map((a) => a.id)).toContain(PLATINUM.id);
    expect(totalXp(empty())).toBe(0);
    expect(rankFor(0).name).toBe(RANKS[0].name);
    expect(rankFor(RANKS[2].xp).name).toBe(RANKS[2].name);
    expect(rankFor(999999).next).toBeNull();
    const one = empty(); one.steps['x:0'] = true; one.achievements = { 'first-table': 'x' };
    expect(totalXp(one)).toBe(10 + 15);
  });
});

describe('practical checks', () => {
  it('"Link Students to Classes" is not satisfied by an empty database, and passes once the relationship is enforced', async () => {
    const x = PRACTICALS.find((p) => p.id === 'relationships')!;
    const p = await WowProject.create('SchoolDB');
    expect(x.steps.map((s) => s.check(p) === true)).toEqual([false, false, false, false]);
    p.saveTableDesign({ name: 'Classes', fields: [{ id: 'a', name: 'ClassID', type: 'AutoNumber', primaryKey: true }, { id: 'b', name: 'ClassName', type: 'Short Text' }] });
    p.saveTableDesign({ name: 'Students', fields: [{ id: 'c', name: 'StudentID', type: 'AutoNumber', primaryKey: true }, { id: 'd', name: 'FirstName', type: 'Short Text' }, { id: 'e', name: 'LastName', type: 'Short Text' }, { id: 'f', name: 'ClassID', type: 'Number' }] });
    expect(x.steps[3].check(p)).not.toBe(true);
    p.saveRelationship({ primaryTable: 'Classes', relatedTable: 'Students', fields: [{ primary: 'ClassID', related: 'ClassID' }], enforce: true, cascadeUpdate: false, cascadeDelete: false, joinType: 'inner' });
    expect(x.steps.map((s) => s.check(p))).toEqual([true, true, true, true]);
  });
});
