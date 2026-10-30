// Forms, reports, import/export, utilities, learning checks, samples, backup/restore.
import './helpers';
import { describe, it, expect } from 'vitest';
import { WowProject, uid } from '@/engine/project';
import { buildSample, SAMPLE_LIST } from '@/engine/samples';
import { autoForm, autoReport, newControl, newFormDef, newGroup, syncGroupSections } from '@/engine/objects';
import { layoutReport, reportToPdf, buildBands } from '@/engine/report';
import { parseCSV, toCSV, analyse, runImport, sqlDump, importSqlScript, writeWorkbook, readWorkbook, parseJSON, exportRows, toJSON } from '@/engine/interchange';
import { integrityCheck, dependencies, statistics, compactAndRepair, documenterHtml, performanceAnalysis } from '@/engine/utilities';
import { runQuery } from '@/engine/queries';
import { PRACTICALS, SAMPLE_EXERCISES, TOPICS } from '@/learning/content';
import { designToSql, emptyDesign, newColumn } from '@/engine/queries';

describe('forms', () => {
  it('designed form (label, text box, combo box, button) persists with positions, sizes, bindings and properties', async () => {
    const p = await buildSample('school');
    const def = newFormDef('frmEntry', 'Students');
    const detail = def.sections.find((s) => s.kind === 'detail')!;
    const lbl = newControl('label', detail.id, 16, 16, def.controls); lbl.props.caption = 'First name:'; def.controls.push(lbl);
    const tb = newControl('textbox', detail.id, 136, 16, def.controls); tb.props.controlSource = 'FirstName'; tb.w = 200; def.controls.push(tb);
    const cb = newControl('combobox', detail.id, 136, 48, def.controls); Object.assign(cb.props, { controlSource: 'ClassID', rowSource: 'Classes', boundField: 'ClassID', displayField: 'ClassName' }); def.controls.push(cb);
    const bt = newControl('button', detail.id, 136, 80, def.controls); bt.props.onClick = 'New Record'; def.controls.push(bt);
    p.saveForm(def);
    const p2 = await WowProject.open(p.db.export());
    const back = p2.getForm('frmEntry')!;
    expect(back.controls.map((c) => [c.type, c.x, c.y, c.w, c.props.controlSource ?? c.props.caption])).toEqual([['label', 16, 16, 104, 'First name:'], ['textbox', 136, 16, 200, 'FirstName'], ['combobox', 136, 48, 168, 'ClassID'], ['button', 136, 80, 112, 'Command']]);
    expect(back.controls[3].props.onClick).toBe('New Record');
  });
  it('auto form binds every field with appropriate controls', async () => {
    const p = await buildSample('school');
    const f = autoForm(p, 'Students', 'x');
    const types = Object.fromEntries(f.controls.filter((c) => c.props.controlSource).map((c) => [c.props.controlSource, c.type]));
    expect(types).toMatchObject({ FirstName: 'textbox', ClassID: 'combobox', Active: 'checkbox', DateOfBirth: 'datepicker' });
  });
});

describe('reports', () => {
  it('groups, sorts, totals, paginates and numbers pages from real records', async () => {
    const p = await buildSample('school');
    let r = autoReport(p, 'Students', 'rpt', { groupBy: 'Town', fields: ['LastName', 'FeePaid'], totals: ['FeePaid'] });
    r = syncGroupSections({ ...r, groups: [...r.groups, newGroup('LastName', true)] });
    const l = layoutReport(p, r);
    expect(l.recordCount).toBe(40);
    expect(l.pages.length).toBeGreaterThan(1);
    const texts = l.pages.flatMap((pg) => pg.items.map((i) => i.text));
    expect(texts).toContain(`Page 1 of ${l.pages.length}`);
    const total = Number(p.db.scalar('SELECT sum(FeePaid) FROM Students'));
    expect(texts).toContain(total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
    expect(texts).toContain('Records: 40');
    // every town group has a subtotal equal to SQL's SUM
    const towns = p.db.all<{ Town: string; s: number }>('SELECT Town, sum(FeePaid) s FROM Students GROUP BY Town');
    for (const t of towns) expect(texts).toContain(t.s.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
    // report header comes before the page header on page 1
    expect(l.pages[0].bands[0].section.kind).toBe('reportHeader');
    expect(l.pages[1].bands[0].section.kind).toBe('pageHeader');
    const pdf = reportToPdf(l, 'rpt');
    const bytes = new Uint8Array(pdf.output('arraybuffer'));
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
    expect(pdf.getNumberOfPages()).toBe(l.pages.length);
  });
  it('bands sort within groups', async () => {
    const p = await buildSample('school');
    const r = syncGroupSections({ ...autoReport(p, 'Students', 'r', { fields: ['LastName'] }), groups: [newGroup('Town'), newGroup('LastName', true)] });
    const bands = buildBands(r, p.db.all('SELECT * FROM Students'));
    const det = bands.filter((b) => b.section.kind === 'detail').map((b) => [b.record!.Town, b.record!.LastName] as [string, string]);
    const sorted = [...det].sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));
    expect(det).toEqual(sorted);
  });
});

describe('import and export', () => {
  it('CSV import wizard: headers, types, invalid rows reported, nothing silently discarded', async () => {
    const p = await WowProject.create('I');
    const csv = 'Name,Age,Joined,Paid\n"Mensah, Ama",12,2024-01-05,yes\nKofi,abc,2024-02-01,no\nAbena,14,2024-03-01,yes\n';
    const rows = parseCSV(csv);
    expect(rows[1][0]).toBe('Mensah, Ama');
    const cols = analyse(rows, true);
    expect(cols.map((c) => c.type)).toEqual(['Short Text', 'Short Text', 'Date/Time', 'Yes/No']);
    cols[1].type = 'Number'; cols[1].numberSize = 'Long Integer';
    const s = runImport(p, { rows, hasHeader: true, columns: cols, mode: 'new', table: 'People', primaryKey: 'add', duplicateKeys: [], skipDuplicates: false });
    expect(s.inserted).toBe(2);
    expect(s.failed).toEqual([expect.objectContaining({ row: 2, reason: expect.stringMatching(/isn't valid/) })]);
    expect(p.db.all('SELECT Name, Age, Joined, Paid FROM People')).toEqual([{ Name: 'Mensah, Ama', Age: 12, Joined: '2024-01-05', Paid: 1 }, { Name: 'Abena', Age: 14, Joined: '2024-03-01', Paid: 1 }]);
    // append with duplicate detection
    const more = parseCSV('Name,Age\nAbena,15\nEsi,11\n');
    const c2 = analyse(more, true).map((c) => ({ ...c, target: c.source, type: c.source === 'Age' ? 'Number' as const : 'Short Text' as const }));
    const s2 = runImport(p, { rows: more, hasHeader: true, columns: c2, mode: 'append', table: 'People', primaryKey: 'none', duplicateKeys: ['Name'], skipDuplicates: true });
    expect([s2.inserted, s2.duplicates]).toEqual([1, 1]);
  });
  it('round-trips CSV, JSON, XLSX and SQL', async () => {
    const p = await buildSample('shop');
    const r = exportRows(p, 'Products');
    expect(parseCSV(toCSV(r.columns, r.rows)).length).toBe(r.rows.length + 1);
    expect(parseJSON(toJSON(r.columns, r.rows))[0].rows.length).toBe(r.rows.length + 1);
    const wb = readWorkbook(writeWorkbook([{ name: 'Products', ...r }]).buffer as ArrayBuffer);
    expect(wb[0].rows.length).toBe(r.rows.length + 1);
    const dump = sqlDump(p);
    const p2 = await WowProject.create('copy');
    importSqlScript(p2, dump);
    expect(p2.tableNames().sort()).toEqual(p.tableNames().sort());
    expect(p2.db.scalar('SELECT sum(Quantity) FROM OrderDetails')).toBe(p.db.scalar('SELECT sum(Quantity) FROM OrderDetails'));
    expect(p2.getTable('Products')!.fields.find((f) => f.name === 'UnitPrice')!.type).toBe('Currency');
    expect(p2.db.all('PRAGMA foreign_key_list(OrderDetails)').length).toBe(2);
    expect(() => p2.insertRecord('OrderDetails', { OrderID: 999, ProductID: 1, Quantity: 1 })).toThrow(/related record/);
  });
});

describe('utilities', () => {
  it('integrity, dependencies, statistics, documenter, performance and compact', async () => {
    const p = await buildSample('library');
    expect(integrityCheck(p).filter((i) => i.severity === 'error')).toEqual([]);
    const deps = dependencies(p);
    expect(deps.find((d) => d.name === 'Books')!.usedBy.map((u) => u.name)).toEqual(expect.arrayContaining(['qryBooksOnLoan', 'frmBooks']));
    expect(statistics(p).tables.find((t) => t.name === 'Loans')!.records).toBe(50);
    expect(documenterHtml(p)).toContain('Table: Books');
    expect(performanceAnalysis(p).length).toBeGreaterThan(0);
    const c = compactAndRepair(p);
    expect(c.integrity).toBe('ok');
    expect(p.db.scalar('PRAGMA foreign_keys')).toBe(1);
  });
  it('backup/restore is a byte-exact copy of the database', async () => {
    const p = await buildSample('employee');
    const backup = p.db.export();
    p.db.run('DELETE FROM Salaries');
    const restored = await WowProject.open(backup);
    expect(restored.db.scalar('SELECT count(*) FROM Salaries')).toBe(48);
    expect(restored.listObjects('form').length).toBe(p.listObjects('form').length);
  });
});

describe('samples', () => {
  for (const s of SAMPLE_LIST) it(`${s.name} builds with keys, relationships, queries, forms and reports that run`, async () => {
    const p = await buildSample(s.id);
    expect(p.relationships().every((r) => r.enforce)).toBe(true);
    expect(p.tables().every((t) => t.fields.some((f) => f.primaryKey))).toBe(true);
    expect(p.listObjects('form').length).toBeGreaterThan(0);
    expect(p.listObjects('report').length).toBeGreaterThan(0);
    for (const q of p.queries()) if (q.kind === 'select' || q.kind === 'crosstab') expect(() => runQuery(p, q, { 'Enter class name, e.g. JHS 1': 'JHS 1', 'Author name contains': '' })).not.toThrow();
    for (const o of p.listObjects('report')) expect(layoutReport(p, p.getReport(o.name)!).pages.length).toBeGreaterThan(0);
    expect(integrityCheck(p).filter((i) => i.severity !== 'info')).toEqual([]);
  });
});

describe('learning mode verifies the real database state', () => {
  it('the Student Database practical advances step by step', async () => {
    const steps = PRACTICALS.find((x) => x.id === 'schooldb')!.steps;
    const p = await WowProject.create('SchoolDB');
    const status = () => steps.map((s) => s.check(p) === true);
    expect(status()[0]).toBe(true);
    expect(status()[1]).toBe(false);
    expect(steps[1].check(p)).toMatch(/no table called "Students"/);
    p.saveTableDesign({ name: 'Students', fields: [{ id: uid('f'), name: 'StudentID', type: 'Number' }] });
    expect(steps[3].check(p)).toMatch(/should be AutoNumber/);
    p.saveTableDesign({ name: 'Students', fields: [{ id: 'a', name: 'StudentID', type: 'AutoNumber', primaryKey: true }, { id: 'b', name: 'FirstName', type: 'Short Text' }, { id: 'c', name: 'LastName', type: 'Short Text' }, { id: 'd', name: 'DateOfBirth', type: 'Date/Time' }, { id: 'e', name: 'ClassID', type: 'Number' }] }, 'Students');
    for (let i = 0; i < 5; i++) p.insertRecord('Students', { FirstName: 'S' + i, LastName: 'L', ClassID: i % 2 + 1 });
    expect(status().slice(0, 11).every(Boolean)).toBe(true);
    expect(steps[11].check(p)).toMatch(/Save a query/);
    const d = emptyDesign(); d.tables.push({ id: 't', name: 'Students', x: 0, y: 0 });
    const c = newColumn('ClassID', 'Students'); c.criteria = ['[Enter ClassID]', ''];
    d.columns.push(newColumn('FirstName', 'Students'), c);
    p.saveQuery({ name: 'qryStudentsInClass', kind: 'select', sql: designToSql(p, d, 'select'), design: d });
    expect(steps[11].check(p)).toBe(true);
  });
  it('sample exercises have model answers that pass', async () => {
    expect(TOPICS.length).toBe(20);
    const ex = SAMPLE_EXERCISES.find((x) => x.id === 'sch-b')!;
    const p = await buildSample('school');
    expect(ex.steps[0].check(p)).toMatch(/Save your query/);
    p.saveQuery({ name: 'qryAccra', kind: 'select', sql: "SELECT FirstName, LastName, Town FROM Students WHERE Town = 'Accra'" });
    expect(ex.steps[0].check(p)).toBe(true);
    p.saveQuery({ name: 'qryAccra', kind: 'select', sql: "SELECT FirstName, LastName, Town FROM Students WHERE Town = 'Tema'" }, 'qryAccra');
    expect(ex.steps[0].check(p)).not.toBe(true);
  });
});
