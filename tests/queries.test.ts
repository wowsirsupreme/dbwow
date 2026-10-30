import './helpers';
import { describe, it, expect, beforeEach } from 'vitest';
import { WowProject, uid } from '@/engine/project';
import { designToSql, emptyDesign, newColumn, runSql, runQuery, trySqlToDesign, queryParameters, previewActionCount } from '@/engine/queries';
import type { QueryDesign } from '@/engine/types';
import { parseCriteria, toSql, evaluate, parseExpr } from '@/engine/expr';

let p: WowProject;
const fd = (name: string, type: 'AutoNumber' | 'Short Text' | 'Number' | 'Currency' | 'Date/Time', pk = false) => ({ id: uid('f'), name, type, primaryKey: pk });
beforeEach(async () => {
  p = await WowProject.create('Q');
  p.saveTableDesign({ name: 'Classes', fields: [fd('ClassID', 'AutoNumber', true), fd('ClassName', 'Short Text')] });
  p.saveTableDesign({ name: 'Students', fields: [fd('StudentID', 'AutoNumber', true), fd('FirstName', 'Short Text'), fd('Town', 'Short Text'), fd('ClassID', 'Number'), fd('Fee', 'Currency'), fd('DOB', 'Date/Time')] });
  ['JHS 1', 'JHS 2', 'JHS 3'].forEach((c) => p.insertRecord('Classes', { ClassName: c }));
  const data: [string, string, number, number, string][] = [['Ama', 'Accra', 1, 100, '2012-01-05'], ['Kofi', 'Kumasi', 2, 200, '2011-06-01'], ['Abena', 'Accra', 1, 50, '2012-09-30'], ['Yaw', 'Tema', 2, 300, '2010-02-14'], ['Akosua', 'Kumasi', 1, 0, '2013-11-11']];
  data.forEach(([n, t, c, fee, d]) => p.insertRecord('Students', { FirstName: n, Town: t, ClassID: c, Fee: fee, DOB: d }));
  p.saveRelationship({ primaryTable: 'Classes', relatedTable: 'Students', fields: [{ primary: 'ClassID', related: 'ClassID' }], enforce: true, cascadeUpdate: false, cascadeDelete: false, joinType: 'inner' });
});
function twoTables(): QueryDesign {
  const d = emptyDesign();
  d.tables.push({ id: 'a', name: 'Classes', x: 0, y: 0 }, { id: 'b', name: 'Students', x: 0, y: 0 });
  d.joins.push({ id: 'j', leftTable: 'Classes', leftField: 'ClassID', rightTable: 'Students', rightField: 'ClassID', type: 'inner' });
  return d;
}

describe('Access expressions and criteria', () => {
  const crit = (s: string) => toSql(parseCriteria(s), { self: '"X"', bareAsText: true, params: [] });
  it('translates criteria forms', () => {
    expect(crit('>5')).toBe('("X" > 5)');
    expect(crit('A*')).toBe(`("X" LIKE 'A%')`);
    expect(crit('Not Like "K*"')).toBe(`("X" NOT LIKE 'K%')`);
    expect(crit('Between 1 And 10')).toBe('("X" BETWEEN 1 AND 10)');
    expect(crit('In ("A","B")')).toBe(`("X" IN ('A', 'B'))`);
    expect(crit('Is Null')).toBe('("X" IS NULL)');
    expect(crit('Accra Or Tema')).toBe(`(("X" = 'Accra') OR ("X" = 'Tema'))`);
    expect(crit('>=#2026-01-01#')).toBe(`("X" >= '2026-01-01')`);
    expect(crit('#1/31/2026#')).toBe(`("X" = '2026-01-31')`);
    expect(crit('<Date()')).toMatch(/date\('now','localtime'\)/);
  });
  it('evaluates report/form expressions in JavaScript', () => {
    const recs = [{ Fee: 10, N: 'A' }, { Fee: 20, N: 'B' }];
    expect(evaluate(parseExpr('=Sum([Fee])'), { records: recs })).toBe(30);
    expect(evaluate(parseExpr('="Page " & [Page] & " of " & [Pages]'), { page: 2, pages: 5 })).toBe('Page 2 of 5');
    expect(evaluate(parseExpr('IIf([Fee]>15,"High","Low")'), { record: recs[1] })).toBe('High');
    expect(evaluate(parseExpr('Count(*)'), { records: recs })).toBe(2);
    expect(evaluate(parseExpr('Left(UCase([N]),1) & Len("abc")'), { record: { N: 'kofi' } })).toBe('K3');
    expect(evaluate(parseExpr('DateDiff("yyyy", #2010-05-01#, #2026-05-01#)'), {})).toBe(16);
  });
});

describe('query designer', () => {
  it('drag-two-tables query: criteria, sort, generated SQL and real results', () => {
    const d = twoTables();
    const a = newColumn('FirstName', 'Students'); a.sort = 'Ascending';
    const b = newColumn('ClassName', 'Classes'); b.criteria = ['JHS 1', ''];
    const c = newColumn('Fee', 'Students'); c.criteria = ['>=50', ''];
    d.columns.push(a, b, c);
    const sql = designToSql(p, d, 'select');
    expect(sql).toContain('INNER JOIN "Students" ON "Classes"."ClassID" = "Students"."ClassID"');
    expect(sql).toContain(`("Classes"."ClassName" = 'JHS 1') AND ("Students"."Fee" >= 50)`);
    const r = runSql(p, sql);
    expect(r.rows).toEqual([['Abena', 'JHS 1', 50], ['Ama', 'JHS 1', 100]]);
  });
  it('OR rows, hidden criteria columns, aliases and expressions', () => {
    const d = emptyDesign(); d.tables.push({ id: 'b', name: 'Students', x: 0, y: 0 });
    const n = newColumn('FirstName', 'Students'); n.criteria = ['A*', 'Kofi'];
    const t = newColumn('Town', 'Students'); t.show = false; t.criteria = ['Accra', ''];
    const e = newColumn('Double: [Fee]*2', '');
    d.columns.push(n, t, e);
    const r = runSql(p, designToSql(p, d, 'select'));
    expect(r.columns).toEqual(['FirstName', 'Double']);
    expect(r.rows.map((x) => x[0]).sort()).toEqual(['Abena', 'Ama', 'Kofi']);
  });
  it('totals with Group By, Sum, Count, Where and HAVING', () => {
    const d = twoTables(); d.totals = true;
    const g = newColumn('ClassName', 'Classes'); g.sort = 'Ascending';
    const s = newColumn('Fee', 'Students'); s.total = 'Sum'; s.criteria = ['>100', ''];
    const cnt = newColumn('StudentID', 'Students'); cnt.total = 'Count';
    const w = newColumn('Town', 'Students'); w.total = 'Where'; w.criteria = ['<>"Tema"', ''];
    d.columns.push(g, s, cnt, w);
    const r = runSql(p, designToSql(p, d, 'select'));
    expect(r.columns).toEqual(['ClassName', 'SumOfFee', 'CountOfStudentID']);
    expect(r.rows).toEqual([['JHS 1', 150, 3], ['JHS 2', 200, 1]]);
  });
  it('parameter queries ask for values and bind them safely', () => {
    const d = emptyDesign(); d.tables.push({ id: 'b', name: 'Students', x: 0, y: 0 });
    const t = newColumn('Town', 'Students'); t.criteria = ['[Enter town]', ''];
    d.columns.push(newColumn('FirstName', 'Students'), t);
    const sql = designToSql(p, d, 'select');
    expect(queryParameters(p, sql)).toEqual(['Enter town']);
    expect(runSql(p, sql, { 'Enter town': 'Kumasi' }).rows.length).toBe(2);
    expect(runSql(p, sql, { 'Enter town': "x' OR '1'='1" }).rows.length).toBe(0); // injection attempt is just a value
  });
  it('left join and top values', () => {
    const d = twoTables(); d.joins[0].type = 'left';
    const cn = newColumn('ClassName', 'Classes'); const id = newColumn('StudentID', 'Students'); id.criteria = ['Is Null', ''];
    d.columns.push(cn, id);
    expect(runSql(p, designToSql(p, d, 'select')).rows).toEqual([['JHS 3', null]]);
    const t = emptyDesign(); t.tables.push({ id: 'b', name: 'Students', x: 0, y: 0 }); const fee = newColumn('Fee', 'Students'); fee.sort = 'Descending'; t.columns.push(fee); t.top = '2';
    expect(runSql(p, designToSql(p, t, 'select')).rows).toEqual([[300], [200]]);
    t.top = '40%';
    expect(runSql(p, designToSql(p, t, 'select')).rows.length).toBe(2);
  });
  it('crosstab', () => {
    const d = twoTables(); d.totals = true;
    const r = newColumn('Town', 'Students'); r.crosstab = 'Row Heading';
    const c = newColumn('ClassName', 'Classes'); c.crosstab = 'Column Heading';
    const v = newColumn('Fee', 'Students'); v.total = 'Sum'; v.crosstab = 'Value';
    d.columns.push(r, c, v);
    const res = runSql(p, designToSql(p, d, 'crosstab'));
    expect(res.columns).toEqual(['Town', 'JHS 1', 'JHS 2']);
    expect(res.rows).toContainEqual(['Accra', 150, null]);
  });
  it('make table, append, update and delete queries', () => {
    const mk = emptyDesign(); mk.tables.push({ id: 'b', name: 'Students', x: 0, y: 0 }); mk.targetTable = 'AccraStudents';
    const t = newColumn('Town', 'Students'); t.criteria = ['Accra', '']; mk.columns.push(newColumn('FirstName', 'Students'), newColumn('Fee', 'Students'), t);
    const mkSql = designToSql(p, mk, 'maketable');
    expect(runQuery(p, { name: 'm', kind: 'maketable', sql: mkSql, design: mk }).changes).toBe(2);
    expect(p.getTable('AccraStudents')!.fields.map((x) => x.name)).toEqual(['FirstName', 'Fee', 'Town']);
    const ap = emptyDesign(); ap.tables.push({ id: 'b', name: 'Students', x: 0, y: 0 }); ap.targetTable = 'AccraStudents';
    const n = newColumn('FirstName', 'Students'); n.appendTo = 'FirstName'; const tw = newColumn('Town', 'Students'); tw.appendTo = 'Town'; tw.criteria = ['Tema', ''];
    ap.columns.push(n, tw);
    expect(runSql(p, designToSql(p, ap, 'append')).changes).toBe(1);
    const up = emptyDesign(); up.tables.push({ id: 'b', name: 'Students', x: 0, y: 0 }); up.targetTable = 'Students';
    const fee = newColumn('Fee', 'Students'); fee.updateTo = '[Fee]+10'; const town = newColumn('Town', 'Students'); town.criteria = ['Kumasi', ''];
    up.columns.push(fee, town);
    const upDef = { name: 'u', kind: 'update' as const, sql: designToSql(p, up, 'update'), design: up };
    expect(previewActionCount(p, upDef)).toBe(2);
    runQuery(p, upDef);
    expect(p.db.scalar("SELECT sum(Fee) FROM Students WHERE Town='Kumasi'")).toBe(220);
    const del = emptyDesign(); del.tables.push({ id: 'b', name: 'AccraStudents', x: 0, y: 0 }); del.targetTable = 'AccraStudents';
    const dt = newColumn('Town', 'AccraStudents'); dt.criteria = ['Tema', '']; del.columns.push(dt);
    expect(runSql(p, designToSql(p, del, 'delete')).changes).toBe(1);
  });
  it('saved select queries become views usable by other queries', () => {
    p.saveQuery({ name: 'qAccra', kind: 'select', sql: "SELECT [FirstName], [Fee] FROM [Students] WHERE [Town] = 'Accra'" });
    expect(p.db.scalar("SELECT count(*) FROM sqlite_master WHERE type='view' AND name='qAccra'")).toBe(1);
    expect(runSql(p, 'SELECT sum(Fee) FROM qAccra').rows[0][0]).toBe(150);
    // renaming a table keeps saved design queries in step
    const d = emptyDesign(); d.tables.push({ id: 'b', name: 'Students', x: 0, y: 0 }); d.columns.push(newColumn('FirstName', 'Students'));
    p.saveQuery({ name: 'qNames', kind: 'select', sql: designToSql(p, d, 'select'), design: d });
    p.deleteRelationship(p.relationships()[0].name);
    p.renameObject('table', 'Students', 'Pupils');
    expect(p.getQuery('qNames')!.design!.tables[0].name).toBe('Pupils');
  });
});

describe('SQL view', () => {
  it('runs SELECT/INSERT/UPDATE/DELETE, joins, subqueries, group/having, distinct and reports errors', () => {
    expect(runSql(p, 'SELECT DISTINCT Town FROM Students ORDER BY Town').rows.map((r) => r[0])).toEqual(['Accra', 'Kumasi', 'Tema']);
    expect(runSql(p, 'SELECT FirstName FROM Students WHERE Fee > (SELECT AVG(Fee) FROM Students)').rows.length).toBe(2);
    expect(runSql(p, 'SELECT c.ClassName, COUNT(*) n FROM Classes c LEFT JOIN Students s ON s.ClassID = c.ClassID GROUP BY c.ClassName HAVING COUNT(*) > 1').rows.length).toBe(2);
    expect(runSql(p, 'SELECT s.FirstName FROM Classes c RIGHT JOIN Students s ON s.ClassID = c.ClassID').rows.length).toBe(5);
    expect(runSql(p, "INSERT INTO Students (FirstName, ClassID) VALUES ('Esi', 3)").changes).toBe(1);
    expect(runSql(p, "UPDATE Students SET Town = 'Ho' WHERE FirstName = 'Esi'").changes).toBe(1);
    expect(runSql(p, "DELETE FROM Students WHERE FirstName = 'Esi'").changes).toBe(1);
    expect(() => runSql(p, 'SELEC * FROM Students')).toThrow(/syntax error/);
    expect(() => runSql(p, "INSERT INTO Students (FirstName, ClassID) VALUES ('X', 99)")).toThrow(/related record/);
    expect(() => runSql(p, 'DELETE FROM _wow_objects')).toThrow(/protected/);
    expect(() => runSql(p, "ATTACH 'x' AS y")).toThrow(/not available/);
  });
  it('multi-statement scripts are atomic', () => {
    expect(() => runSql(p, "INSERT INTO Classes (ClassName) VALUES ('New'); INSERT INTO Students (FirstName, ClassID) VALUES ('Bad', 999);")).toThrow();
    expect(p.db.scalar("SELECT count(*) FROM Classes WHERE ClassName='New'")).toBe(0);
  });
  it('DDL typed in SQL View is reflected in the catalogue', () => {
    runSql(p, 'CREATE TABLE Clubs (ClubID INTEGER PRIMARY KEY, ClubName TEXT NOT NULL)');
    expect(p.getTable('Clubs')!.fields.map((x) => [x.name, x.type, !!x.required])).toEqual([['ClubID', 'AutoNumber', false], ['ClubName', 'Short Text', true]]);
    runSql(p, 'DROP TABLE Clubs');
    expect(p.getTable('Clubs')).toBeUndefined();
  });
  it('SQL → Design View for representable SQL; refuses what it cannot show exactly', () => {
    const d = trySqlToDesign(p, `SELECT DISTINCT s.FirstName, c.ClassName AS Cls FROM Students AS s INNER JOIN Classes AS c ON c.ClassID = s.ClassID WHERE s.Fee >= 100 AND s.Town LIKE 'K%' OR s.Town = 'Tema' ORDER BY s.FirstName DESC LIMIT 5`);
    expect(d).not.toBeNull();
    expect(d!.distinct).toBe(true);
    expect(d!.top).toBe('5');
    expect(d!.columns.find((c) => c.field === 'Town')!.criteria.slice(0, 2)).toEqual(['Like "K*"', '"Tema"']);
    // the regenerated SQL returns exactly the same rows as the original
    const orig = runSql(p, `SELECT DISTINCT s.FirstName, c.ClassName AS Cls FROM Students AS s INNER JOIN Classes AS c ON c.ClassID = s.ClassID WHERE s.Fee >= 100 AND s.Town LIKE 'K%' OR s.Town = 'Tema' ORDER BY s.FirstName DESC LIMIT 5`).rows;
    expect(runSql(p, designToSql(p, d!, 'select')).rows).toEqual(orig);
    expect(trySqlToDesign(p, 'SELECT FirstName FROM Students WHERE Fee > (SELECT AVG(Fee) FROM Students)')).toBeNull();
    expect(trySqlToDesign(p, 'SELECT FirstName FROM Students UNION SELECT ClassName FROM Classes')).toBeNull();
    expect(trySqlToDesign(p, 'SELECT upper(FirstName) FROM Students')).toBeNull();
  });
});
