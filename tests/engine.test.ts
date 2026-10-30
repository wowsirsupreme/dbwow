// Automated tests against the real SQLite engine (sql.js) — no mocks.
import './helpers';
import { describe, it, expect, beforeEach } from 'vitest';
import { WowProject, uid } from '@/engine/project';
import type { FieldDef, TableDef } from '@/engine/types';

const f = (name: string, type: FieldDef['type'], o: Partial<FieldDef> = {}): FieldDef => ({ id: uid('f'), name, type, ...o });
let p: WowProject;
beforeEach(async () => { p = await WowProject.create('TestDB'); });

describe('database creation and persistence', () => {
  it('creates a database with metadata and catalogue', () => {
    expect(p.name).toBe('TestDB');
    expect(p.db.scalar("SELECT count(*) FROM sqlite_master WHERE name='_wow_objects'")).toBe(1);
  });
  it('saves and reopens with data, structure and layouts intact', async () => {
    p.saveTableDesign({ name: 'Students', fields: [f('StudentID', 'AutoNumber', { primaryKey: true }), f('FirstName', 'Short Text', { fieldSize: 30, caption: 'First name' })], datasheet: { widths: { FirstName: 180 } } });
    p.insertRecord('Students', { FirstName: 'Ama' });
    p.saveLayout('Relationships', { tables: [{ name: 'Students', x: 120, y: 40 }], zoom: 1.2 });
    const bytes = p.db.export();
    const p2 = await WowProject.open(bytes);
    expect(p2.name).toBe('TestDB');
    expect(p2.getTable('Students')!.fields[1].caption).toBe('First name');
    expect(p2.getTable('Students')!.datasheet?.widths?.FirstName).toBe(180);
    expect(p2.db.scalar('SELECT FirstName FROM Students')).toBe('Ama');
    expect(p2.getLayout<{ zoom: number }>('Relationships')!.zoom).toBe(1.2);
    // foreign keys are re-enabled after reopening
    expect(p2.db.scalar('PRAGMA foreign_keys')).toBe(1);
  });
  it('opens a plain SQLite database that was not made by DBWOW', async () => {
    const raw = await WowProject.create('x');
    raw.db.exec('DROP TABLE _wow_objects; DROP TABLE _wow_meta; CREATE TABLE People (id INTEGER PRIMARY KEY, name TEXT, score REAL); INSERT INTO People VALUES (1,"A",2.5); CREATE VIEW v AS SELECT name FROM People;');
    const p2 = await WowProject.open(raw.db.export());
    expect(p2.tableNames()).toEqual(['People']);
    expect(p2.getTable('People')!.fields.map((x) => x.type)).toEqual(['AutoNumber', 'Short Text', 'Number']);
    expect(p2.getQuery('v')).toBeTruthy();
  });
});

describe('table designer → real schema', () => {
  const students = (): TableDef => ({ name: 'Students', fields: [
    f('StudentID', 'AutoNumber', { primaryKey: true }), f('FirstName', 'Short Text', { fieldSize: 10, required: true }),
    f('Age', 'Number', { numberSize: 'Byte', validationRule: 'Between 5 And 20', validationText: 'Age must be 5 to 20' }),
    f('DOB', 'Date/Time', { validationRule: '<Date()', validationText: 'DOB must be in the past' }),
    f('Fee', 'Currency', { defaultValue: '0', validationRule: '>=0' }), f('Active', 'Yes/No', { defaultValue: 'Yes' }),
    f('Email', 'Short Text', { indexed: 'Yes (No Duplicates)' }), f('Label', 'Calculated', { expression: '[FirstName] & " (" & [Age] & ")"' }),
  ] });
  it('creates a STRICT table with constraints and indexes', () => {
    p.saveTableDesign(students());
    const sql = String(p.db.scalar("SELECT sql FROM sqlite_master WHERE name='Students'"));
    expect(sql).toMatch(/STRICT/);
    expect(sql).toMatch(/PRIMARY KEY AUTOINCREMENT/);
    expect(p.db.scalar("SELECT count(*) FROM sqlite_master WHERE type='index' AND name='ix_Students_Email'")).toBe(1);
    expect(p.db.scalar("SELECT count(*) FROM sqlite_master WHERE type='trigger' AND tbl_name='Students'")).toBe(2);
  });
  it('enforces data types, field size, required, ranges, validation rules and unique indexes', () => {
    p.saveTableDesign(students());
    p.insertRecord('Students', { FirstName: 'Ama', Age: '12', DOB: '12/03/2014', Email: 'a@x.org' });
    const row = p.db.get<Record<string, unknown>>('SELECT * FROM Students');
    expect(row).toMatchObject({ FirstName: 'Ama', Age: 12, DOB: '2014-03-12', Fee: 0, Active: 1, Label: 'Ama (12)' });
    expect(() => p.insertRecord('Students', { FirstName: 'Kofi', Age: 30 })).toThrow('Age must be 5 to 20');
    expect(() => p.insertRecord('Students', { FirstName: 'Kofi', Age: 300 })).toThrow(/range|Age must/);
    expect(() => p.insertRecord('Students', { FirstName: 'Kwabena-Long', Age: 10 })).toThrow(/too long/);
    expect(() => p.insertRecord('Students', { Age: 10 })).toThrow(/must enter a value/);
    expect(() => p.insertRecord('Students', { FirstName: 'X', Age: 'abc' })).toThrow(/isn't valid/);
    expect(() => p.insertRecord('Students', { FirstName: 'X', DOB: '2099-01-01' })).toThrow('DOB must be in the past');
    expect(() => p.insertRecord('Students', { FirstName: 'X', Fee: -5 })).toThrow(/validation rule/);
    expect(() => p.insertRecord('Students', { FirstName: 'X', Email: 'a@x.org' })).toThrow(/duplicate values/);
    // raw SQL is also checked by the engine
    expect(() => p.db.run("INSERT INTO Students (FirstName, Age) VALUES ('X', 'abc')")).toThrow();
  });
  it('reorders, renames, retypes and removes fields while keeping data', () => {
    p.saveTableDesign(students());
    p.insertRecord('Students', { FirstName: 'Ama', Age: 12 });
    const d = p.getTable('Students')!;
    const age = d.fields.find((x) => x.name === 'Age')!;
    const next: TableDef = { ...d, fields: [d.fields[0], { ...age, name: 'AgeYears', numberSize: 'Integer' }, ...d.fields.filter((x) => x.name !== 'Age' && x.name !== 'StudentID' && x.name !== 'Label')] };
    p.saveTableDesign(next, 'Students');
    const cols = p.db.all<{ name: string }>('PRAGMA table_info(Students)').map((c) => c.name);
    expect(cols.slice(0, 3)).toEqual(['StudentID', 'AgeYears', 'FirstName']);
    expect(cols).not.toContain('Label');
    expect(p.db.get('SELECT AgeYears, FirstName FROM Students')).toEqual({ AgeYears: 12, FirstName: 'Ama' });
  });
  it('rejects a design change that existing data breaks and rolls back', () => {
    p.saveTableDesign(students());
    p.insertRecord('Students', { FirstName: 'Abcdefghij', Age: 12 });
    const d = p.getTable('Students')!;
    const bad = { ...d, fields: d.fields.map((x) => (x.name === 'FirstName' ? { ...x, fieldSize: 3 } : x)) };
    expect(() => p.saveTableDesign(bad, 'Students')).toThrow(/too long/);
    expect(p.db.scalar('SELECT FirstName FROM Students')).toBe('Abcdefghij');
    expect(p.getTable('Students')!.fields.find((x) => x.name === 'FirstName')!.fieldSize).toBe(10);
  });
  it('supports composite primary keys', () => {
    p.saveTableDesign({ name: 'OD', fields: [f('OrderID', 'Number', { primaryKey: true }), f('ProductID', 'Number', { primaryKey: true }), f('Qty', 'Number')] });
    p.insertRecord('OD', { OrderID: 1, ProductID: 1, Qty: 2 });
    p.insertRecord('OD', { OrderID: 1, ProductID: 2, Qty: 2 });
    expect(() => p.insertRecord('OD', { OrderID: 1, ProductID: 1, Qty: 9 })).toThrow(/duplicate/);
    expect(() => p.insertRecord('OD', { ProductID: 3 })).toThrow(/must enter/);
  });
  it('validates names and duplicate fields', () => {
    expect(() => p.saveTableDesign({ name: 'A', fields: [f('X', 'Short Text'), f('x', 'Number')] })).toThrow(/more than once/);
    expect(() => p.saveTableDesign({ name: '_wow_bad', fields: [f('X', 'Short Text')] })).toThrow(/reserved/);
    expect(() => p.saveTableDesign({ name: 'A', fields: [f('X', 'Short Text', { validationRule: 'Between 1' })] })).toThrow(/Problem in field/);
    p.saveTableDesign({ name: 'A', fields: [f('X', 'Short Text')] });
    expect(() => p.saveTableDesign({ name: 'a', fields: [f('X', 'Short Text')] })).toThrow(/already exists/);
  });
  it('records: insert, update, delete', () => {
    p.saveTableDesign(students());
    const id = p.insertRecord('Students', { FirstName: 'Ama', Age: 10 });
    p.updateRecord('Students', id, { FirstName: 'Abena' });
    expect(p.db.scalar('SELECT FirstName FROM Students')).toBe('Abena');
    expect(() => p.updateRecord('Students', id, { Age: 99 })).toThrow('Age must be 5 to 20');
    expect(p.deleteRecords('Students', [id])).toBe(1);
    expect(p.db.scalar('SELECT count(*) FROM Students')).toBe(0);
  });
});

describe('relationships and referential integrity', () => {
  beforeEach(() => {
    p.saveTableDesign({ name: 'Classes', fields: [f('ClassID', 'AutoNumber', { primaryKey: true }), f('ClassName', 'Short Text')] });
    p.saveTableDesign({ name: 'Students', fields: [f('StudentID', 'AutoNumber', { primaryKey: true }), f('Name', 'Short Text'), f('ClassID', 'Number')] });
    p.insertRecord('Classes', { ClassName: 'JHS 1' }); p.insertRecord('Classes', { ClassName: 'JHS 2' });
    p.insertRecord('Students', { Name: 'Ama', ClassID: 1 });
  });
  const rel = (o: object = {}) => p.saveRelationship({ primaryTable: 'Classes', relatedTable: 'Students', fields: [{ primary: 'ClassID', related: 'ClassID' }], enforce: true, cascadeUpdate: false, cascadeDelete: false, joinType: 'inner', ...o });
  it('creates a real FOREIGN KEY constraint and detects one-to-many', () => {
    rel();
    const fk = p.db.all('PRAGMA foreign_key_list(Students)');
    expect(fk.length).toBe(1);
    expect(p.relationshipType(p.relationships()[0])).toBe('One-To-Many');
    expect(() => p.insertRecord('Students', { Name: 'X', ClassID: 9 })).toThrow(/related record is required in table 'Classes'/);
    expect(() => p.deleteRecords('Classes', [1])).toThrow(/includes related records/);
    p.deleteRecords('Classes', [2]); // no students → allowed
  });
  it('cascade update and cascade delete', () => {
    rel({ cascadeUpdate: true, cascadeDelete: true });
    p.db.run('UPDATE Classes SET ClassID = 10 WHERE ClassID = 1');
    expect(p.db.scalar('SELECT ClassID FROM Students')).toBe(10);
    p.db.run('DELETE FROM Classes WHERE ClassID = 10');
    expect(p.db.scalar('SELECT count(*) FROM Students')).toBe(0);
  });
  it('rejects invalid relationships with explanations', () => {
    p.insertRecord('Students', { Name: 'Orphan', ClassID: 77 });
    expect(() => rel()).toThrow(/have a ClassID value that does not exist/);
    expect(p.relationships().length).toBe(0);
    expect(() => p.saveRelationship({ primaryTable: 'Students', relatedTable: 'Classes', fields: [{ primary: 'Name', related: 'ClassID' }], enforce: true, cascadeUpdate: false, cascadeDelete: false, joinType: 'inner' })).toThrow(/same data types/);
    expect(() => p.saveRelationship({ primaryTable: 'Students', relatedTable: 'Classes', fields: [{ primary: 'ClassID', related: 'ClassID' }], enforce: true, cascadeUpdate: false, cascadeDelete: false, joinType: 'inner' })).toThrow(/No unique index/);
    // without enforcement it is allowed (Access behaviour)
    p.saveRelationship({ primaryTable: 'Classes', relatedTable: 'Students', fields: [{ primary: 'ClassID', related: 'ClassID' }], enforce: false, cascadeUpdate: false, cascadeDelete: false, joinType: 'inner' });
    expect(p.db.all('PRAGMA foreign_key_list(Students)').length).toBe(0);
  });
  it('deleting a relationship removes the constraint; tables with relationships cannot be deleted', () => {
    rel();
    expect(() => p.deleteTable('Classes')).toThrow(/relationships/);
    p.deleteRelationship(p.relationships()[0].name);
    expect(p.db.all('PRAGMA foreign_key_list(Students)').length).toBe(0);
    p.insertRecord('Students', { Name: 'X', ClassID: 9 });
  });
  it('one-to-one when both sides are unique', () => {
    p.saveTableDesign({ name: 'StudentPrivate', fields: [f('StudentID', 'Number', { primaryKey: true }), f('Notes', 'Long Text')] });
    const r = p.saveRelationship({ primaryTable: 'Students', relatedTable: 'StudentPrivate', fields: [{ primary: 'StudentID', related: 'StudentID' }], enforce: true, cascadeUpdate: false, cascadeDelete: true, joinType: 'inner' });
    expect(p.relationshipType(r)).toBe('One-To-One');
  });
  it('renaming tables and fields keeps relationships working', () => {
    rel();
    p.renameObject('table', 'Classes', 'Forms');
    expect(p.relationships()[0].primaryTable).toBe('Forms');
    expect(() => p.insertRecord('Students', { Name: 'X', ClassID: 9 })).toThrow(/related record/);
    const s = p.getTable('Students')!;
    p.saveTableDesign({ ...s, fields: s.fields.map((x) => (x.name === 'ClassID' ? { ...x, name: 'FormID' } : x)) }, 'Students');
    expect(p.relationships()[0].fields[0].related).toBe('FormID');
    expect(p.db.all('PRAGMA foreign_key_list(Students)')[0]).toMatchObject({ from: 'FormID', table: 'Forms' });
  });
});
