// Preloaded sample databases. All names and records are fictional.
// Each sample is built through the same public API the designers use, so the
// tables, relationships, queries, forms and reports are ordinary WOWDB objects.
import { WowProject, uid } from './project';
import { designToSql, emptyDesign, newColumn } from './queries';
import { autoForm, autoReport, newControl } from './objects';
import type { DataType, FieldDef, QueryColumn, QueryDesign, QueryKind } from './types';

type FSpec = [string, DataType, Partial<FieldDef>?];

function rng(seed: number) { let s = seed; return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; }; }

class Builder {
  constructor(public p: WowProject) {}
  table(name: string, fields: FSpec[], description = '') {
    this.p.saveTableDesign({ name, description, fields: fields.map(([n, type, o]) => ({ id: uid('f'), name: n, type, fieldSize: type === 'Short Text' ? 50 : undefined, ...o })) });
  }
  rows(table: string, cols: string[], data: unknown[][]) {
    const sql = `INSERT INTO "${table}" (${cols.map((c) => `"${c}"`).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`;
    this.p.db.transaction(() => { for (const r of data) this.p.db.run(sql, r as never, true); });
  }
  rel(primary: string, pf: string, related: string, rf: string, cascadeDelete = false) {
    this.p.saveRelationship({ primaryTable: primary, relatedTable: related, fields: [{ primary: pf, related: rf }], enforce: true, cascadeUpdate: true, cascadeDelete, joinType: 'inner' });
  }
  query(name: string, kind: QueryKind, build: (d: QueryDesign, col: (field: string, table: string, o?: Partial<QueryColumn>) => QueryColumn) => void, description = '') {
    const d = emptyDesign();
    const col = (field: string, table: string, o: Partial<QueryColumn> = {}) => { const c = { ...newColumn(field, table), ...o }; if (!c.criteria.length) c.criteria = ['', '']; d.columns.push(c); return c; };
    build(d, col);
    d.tables.forEach((t, i) => { t.x = 24 + i * 210; t.y = 16 + (i % 2) * 24; });
    // auto-join from relationships
    for (const r of this.p.relationships()) {
      const a = d.tables.find((t) => t.name === r.primaryTable), b = d.tables.find((t) => t.name === r.relatedTable);
      if (a && b && !d.joins.some((j) => (j.leftTable === a.name && j.rightTable === b.name) || (j.leftTable === b.name && j.rightTable === a.name)))
        d.joins.push({ id: uid('j'), leftTable: a.name, leftField: r.fields[0].primary, rightTable: b.name, rightField: r.fields[0].related, type: 'inner' });
    }
    this.p.saveQuery({ name, kind, sql: designToSql(this.p, d, kind), design: d, description });
  }
  t(...names: string[]) { return names.map((n) => ({ id: uid('t'), name: n, x: 0, y: 0 })); }
  layout(positions: Record<string, [number, number]>) {
    this.p.saveLayout('Relationships', { tables: Object.entries(positions).map(([name, [x, y]]) => ({ name, x, y })), zoom: 1 });
  }
}

const FIRST = ['Ama', 'Kofi', 'Abena', 'Kwame', 'Akosua', 'Yaw', 'Efua', 'Kojo', 'Adwoa', 'Kwabena', 'Esi', 'Kwaku', 'Afia', 'Yaa', 'Fiifi', 'Nana', 'Selorm', 'Elikem', 'Dzifa', 'Mawuli', 'Naa', 'Nii', 'Aku', 'Edem', 'Sena', 'Kekeli', 'Delali', 'Amma', 'Ekow', 'Araba'];
const LAST = ['Mensah', 'Owusu', 'Asante', 'Boateng', 'Agyeman', 'Osei', 'Appiah', 'Darko', 'Ofori', 'Quaye', 'Tetteh', 'Addo', 'Amoah', 'Badu', 'Nkansah', 'Frimpong', 'Gyamfi', 'Kumi', 'Larbi', 'Sarpong'];
const TOWNS = ['Accra', 'Kumasi', 'Tema', 'Cape Coast', 'Takoradi', 'Ho', 'Koforidua', 'Tamale'];
const date = (r: () => number, y0: number, y1: number) => { const y = y0 + Math.floor(r() * (y1 - y0 + 1)); const m = 1 + Math.floor(r() * 12); const d = 1 + Math.floor(r() * 28); return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`; };
const pick = <T,>(r: () => number, a: T[]) => a[Math.floor(r() * a.length)];

export const SAMPLE_LIST = [
  { id: 'school', name: 'School Management', description: 'Students, teachers, classes, subjects, enrolments, results and attendance.' },
  { id: 'library', name: 'Library Management', description: 'Books, authors, members, loans and categories.' },
  { id: 'hospital', name: 'Hospital Management', description: 'Patients, doctors, departments, appointments and prescriptions.' },
  { id: 'shop', name: 'Shop Inventory', description: 'Products, suppliers, customers, orders and order details.' },
  { id: 'employee', name: 'Employee Management', description: 'Employees, departments, positions and salaries.' },
] as const;
export type SampleId = (typeof SAMPLE_LIST)[number]['id'];

export async function buildSample(id: SampleId): Promise<WowProject> {
  const info = SAMPLE_LIST.find((s) => s.id === id)!;
  const p = await WowProject.create(info.name, info.description + ' (fictional sample data)');
  const b = new Builder(p);
  const r = rng(42 + id.length);
  if (id === 'school') school(b, r);
  if (id === 'library') library(b, r);
  if (id === 'hospital') hospital(b, r);
  if (id === 'shop') shop(b, r);
  if (id === 'employee') employee(b, r);
  p.setMeta('sample', id);
  return p;
}

function school(b: Builder, r: () => number) {
  b.table('Teachers', [['TeacherID', 'AutoNumber', { primaryKey: true }], ['FirstName', 'Short Text', { required: true }], ['LastName', 'Short Text', { required: true }], ['Email', 'Hyperlink'], ['Phone', 'Short Text', { fieldSize: 15, inputMask: '000 000 0000' }], ['HireDate', 'Date/Time', { format: 'Short Date' }]], 'Teaching staff');
  b.table('Classes', [['ClassID', 'AutoNumber', { primaryKey: true }], ['ClassName', 'Short Text', { required: true, indexed: 'Yes (No Duplicates)' }], ['FormTeacherID', 'Number', { lookup: { rowSourceType: 'Table/Query', rowSource: 'Teachers', boundField: 'TeacherID', displayField: 'LastName' } }], ['Room', 'Short Text', { fieldSize: 10 }]]);
  b.table('Subjects', [['SubjectID', 'AutoNumber', { primaryKey: true }], ['SubjectName', 'Short Text', { required: true, indexed: 'Yes (No Duplicates)' }], ['TeacherID', 'Number'], ['Credits', 'Number', { numberSize: 'Byte', defaultValue: '1', validationRule: 'Between 1 And 5', validationText: 'Credits must be between 1 and 5.' }]]);
  b.table('Students', [['StudentID', 'AutoNumber', { primaryKey: true, description: 'Unique student number' }], ['FirstName', 'Short Text', { required: true }], ['LastName', 'Short Text', { required: true }], ['Gender', 'Short Text', { fieldSize: 1, validationRule: 'In ("M","F")', validationText: 'Enter M or F.', lookup: { rowSourceType: 'Value List', rowSource: 'M;F' } }], ['DateOfBirth', 'Date/Time', { format: 'Short Date', validationRule: '<Date()', validationText: 'Date of birth must be in the past.' }], ['ClassID', 'Number', { indexed: 'Yes (Duplicates OK)', lookup: { rowSourceType: 'Table/Query', rowSource: 'Classes', boundField: 'ClassID', displayField: 'ClassName' } }], ['Town', 'Short Text'], ['FeePaid', 'Currency', { defaultValue: '0', validationRule: '>=0', validationText: 'Fee paid cannot be negative.' }], ['Active', 'Yes/No', { defaultValue: 'Yes' }], ['FullName', 'Calculated', { expression: '[FirstName] & " " & [LastName]', resultType: 'Text' }]], 'One record per student');
  b.table('Enrolments', [['EnrolmentID', 'AutoNumber', { primaryKey: true }], ['StudentID', 'Number', { required: true, indexed: 'Yes (Duplicates OK)' }], ['SubjectID', 'Number', { required: true, indexed: 'Yes (Duplicates OK)' }], ['EnrolDate', 'Date/Time', { defaultValue: 'Date()' }]], 'Junction table: students ∞–∞ subjects');
  b.table('Results', [['ResultID', 'AutoNumber', { primaryKey: true }], ['EnrolmentID', 'Number', { required: true }], ['Term', 'Short Text', { fieldSize: 10 }], ['Score', 'Number', { validationRule: 'Between 0 And 100', validationText: 'Score must be from 0 to 100.' }], ['Grade', 'Calculated', { expression: 'IIf([Score]>=80,"A",IIf([Score]>=70,"B",IIf([Score]>=60,"C",IIf([Score]>=50,"D","F"))))', resultType: 'Text' }]]);
  b.table('Attendance', [['AttendanceID', 'AutoNumber', { primaryKey: true }], ['StudentID', 'Number', { required: true }], ['AttendDate', 'Date/Time', { required: true }], ['Present', 'Yes/No']]);
  b.rel('Teachers', 'TeacherID', 'Classes', 'FormTeacherID');
  b.rel('Teachers', 'TeacherID', 'Subjects', 'TeacherID');
  b.rel('Classes', 'ClassID', 'Students', 'ClassID');
  b.rel('Students', 'StudentID', 'Enrolments', 'StudentID', true);
  b.rel('Subjects', 'SubjectID', 'Enrolments', 'SubjectID');
  b.rel('Enrolments', 'EnrolmentID', 'Results', 'EnrolmentID', true);
  b.rel('Students', 'StudentID', 'Attendance', 'StudentID', true);
  b.layout({ Teachers: [30, 40], Classes: [280, 30], Students: [520, 40], Subjects: [280, 260], Enrolments: [760, 220], Results: [1000, 230], Attendance: [760, 30] });
  b.rows('Teachers', ['FirstName', 'LastName', 'Email', 'Phone', 'HireDate'], Array.from({ length: 8 }, (_, i) => [FIRST[(i * 7 + 3) % FIRST.length], LAST[(i * 3 + 1) % LAST.length], `teacher${i + 1}@wowschool.example`, `024${String(1000000 + i * 137531).slice(0, 7)}`, date(r, 2012, 2023)]));
  b.rows('Classes', ['ClassName', 'FormTeacherID', 'Room'], [['JHS 1', 1, 'A1'], ['JHS 2', 2, 'A2'], ['JHS 3', 3, 'A3'], ['IGCSE Year 10', 4, 'B1'], ['IGCSE Year 11', 5, 'B2']]);
  b.rows('Subjects', ['SubjectName', 'TeacherID', 'Credits'], [['Mathematics', 1, 4], ['English Language', 2, 4], ['Integrated Science', 3, 3], ['Computer Science', 4, 3], ['Social Studies', 5, 2], ['French', 6, 2], ['ICT', 7, 2], ['Physical Education', 8, 1]]);
  const students = Array.from({ length: 40 }, (_, i) => [FIRST[i % FIRST.length], LAST[(i * 7) % LAST.length], i % 2 ? 'M' : 'F', date(r, 2008, 2013), 1 + (i % 5), pick(r, TOWNS), Math.round(r() * 30) * 50, r() > 0.1 ? 1 : 0]);
  b.rows('Students', ['FirstName', 'LastName', 'Gender', 'DateOfBirth', 'ClassID', 'Town', 'FeePaid', 'Active'], students);
  const enr: unknown[][] = [];
  for (let s = 1; s <= 40; s++) for (const sub of [1, 2, 3, 4].concat(s % 2 ? [6] : [7])) enr.push([s, sub, '2026-09-08']);
  b.rows('Enrolments', ['StudentID', 'SubjectID', 'EnrolDate'], enr);
  const res: unknown[][] = [];
  enr.forEach((_, i) => { res.push([i + 1, 'Term 1', 35 + Math.floor(r() * 65)]); });
  b.rows('Results', ['EnrolmentID', 'Term', 'Score'], res);
  const att: unknown[][] = [];
  for (let s = 1; s <= 40; s++) for (let d = 1; d <= 5; d++) att.push([s, `2026-10-0${d + 4}`, r() > 0.12 ? 1 : 0]);
  b.rows('Attendance', ['StudentID', 'AttendDate', 'Present'], att);

  b.query('qryStudentsByClass', 'select', (d, c) => { d.tables = b.t('Classes', 'Students'); c('ClassName', 'Classes', { sort: 'Ascending' }); c('LastName', 'Students', { sort: 'Ascending' }); c('FirstName', 'Students'); c('Town', 'Students'); c('Active', 'Students', { criteria: ['Yes', ''], show: false }); }, 'Active students with their class');
  b.query('qryStudentsInClass', 'select', (d, c) => { d.tables = b.t('Classes', 'Students'); c('StudentID', 'Students'); c('FirstName', 'Students'); c('LastName', 'Students'); c('ClassName', 'Classes', { criteria: ['[Enter class name, e.g. JHS 1]', ''] }); }, 'Parameter query');
  b.query('qryAverageScoreBySubject', 'select', (d, c) => { d.tables = b.t('Subjects', 'Enrolments', 'Results'); d.totals = true; c('SubjectName', 'Subjects', { total: 'Group By', sort: 'Ascending' }); c('Score', 'Results', { total: 'Avg' }); c('ResultID', 'Results', { total: 'Count' }); }, 'Totals query');
  b.query('qryFeesOutstanding', 'select', (d, c) => { d.tables = b.t('Students'); c('FullName', 'Students'); c('FeePaid', 'Students', { criteria: ['<1000', ''], sort: 'Ascending' }); c('Outstanding: 1500-[FeePaid]', ''); }, 'Calculated column and criteria');
  b.query('qryScoresCrosstab', 'crosstab', (d, c) => { d.tables = b.t('Students', 'Enrolments', 'Subjects', 'Results'); d.totals = true; c('LastName', 'Students', { crosstab: 'Row Heading' }); c('SubjectName', 'Subjects', { crosstab: 'Column Heading' }); c('Score', 'Results', { total: 'Max', crosstab: 'Value' }); }, 'Crosstab');
  const f = autoForm(b.p, 'Students', 'frmStudents');
  b.p.saveForm(f);
  // master/subform: classes with their students
  const sub = autoForm(b.p, 'Students', 'subStudents', ['StudentID', 'FirstName', 'LastName', 'Town', 'FeePaid'], 'Datasheet');
  b.p.saveForm(sub);
  const cls = autoForm(b.p, 'Classes', 'frmClassesWithStudents');
  const det = cls.sections.find((s) => s.kind === 'detail')!;
  const sf = newControl('subform', det.id, 16, det.height, cls.controls);
  sf.w = 600; sf.h = 200; sf.props.sourceObject = 'subStudents'; sf.props.linkMasterFields = 'ClassID'; sf.props.linkChildFields = 'ClassID'; sf.name = 'StudentsSubform';
  cls.controls.push(sf); det.height += 216;
  b.p.saveForm(cls);
  b.p.saveForm(autoForm(b.p, 'Teachers', 'frmTeachers', undefined, 'Continuous Forms'));
  b.p.saveReport(autoReport(b.p, 'qryStudentsByClass', 'rptStudentsByClass', { groupBy: 'ClassName', fields: ['LastName', 'FirstName', 'Town'] }));
  b.query('qryStudentFees', 'select', (d, c) => { d.tables = b.t('Classes', 'Students'); c('ClassName', 'Classes', { sort: 'Ascending' }); c('LastName', 'Students', { sort: 'Ascending' }); c('FirstName', 'Students'); c('Town', 'Students'); c('FeePaid', 'Students'); }, 'Fees for the fees report');
  b.p.saveReport(autoReport(b.p, 'qryStudentFees', 'rptFeesByClass', { groupBy: 'ClassName', fields: ['LastName', 'FirstName', 'Town', 'FeePaid'], totals: ['FeePaid'] }));
}

function library(b: Builder, r: () => number) {
  b.table('Categories', [['CategoryID', 'AutoNumber', { primaryKey: true }], ['CategoryName', 'Short Text', { required: true, indexed: 'Yes (No Duplicates)' }]]);
  b.table('Authors', [['AuthorID', 'AutoNumber', { primaryKey: true }], ['AuthorName', 'Short Text', { required: true }], ['Country', 'Short Text']]);
  b.table('Books', [['BookID', 'AutoNumber', { primaryKey: true }], ['ISBN', 'Short Text', { fieldSize: 17, indexed: 'Yes (No Duplicates)' }], ['Title', 'Short Text', { fieldSize: 120, required: true }], ['AuthorID', 'Number', { lookup: { rowSourceType: 'Table/Query', rowSource: 'Authors', boundField: 'AuthorID', displayField: 'AuthorName' } }], ['CategoryID', 'Number', { lookup: { rowSourceType: 'Table/Query', rowSource: 'Categories', boundField: 'CategoryID', displayField: 'CategoryName' } }], ['YearPublished', 'Number', { numberSize: 'Integer', validationRule: 'Between 1450 And 2100' }], ['Copies', 'Number', { numberSize: 'Byte', defaultValue: '1' }], ['Price', 'Currency']]);
  b.table('Members', [['MemberID', 'AutoNumber', { primaryKey: true }], ['FirstName', 'Short Text', { required: true }], ['LastName', 'Short Text', { required: true }], ['JoinDate', 'Date/Time'], ['Town', 'Short Text'], ['Email', 'Hyperlink']]);
  b.table('Loans', [['LoanID', 'AutoNumber', { primaryKey: true }], ['BookID', 'Number', { required: true }], ['MemberID', 'Number', { required: true }], ['LoanDate', 'Date/Time', { required: true, defaultValue: 'Date()' }], ['DueDate', 'Date/Time'], ['Returned', 'Yes/No']]);
  b.rel('Categories', 'CategoryID', 'Books', 'CategoryID'); b.rel('Authors', 'AuthorID', 'Books', 'AuthorID'); b.rel('Books', 'BookID', 'Loans', 'BookID'); b.rel('Members', 'MemberID', 'Loans', 'MemberID');
  b.layout({ Categories: [30, 30], Authors: [30, 200], Books: [280, 60], Loans: [530, 80], Members: [780, 40] });
  b.rows('Categories', ['CategoryName'], [['Fiction'], ['Science'], ['History'], ['Technology'], ['Mathematics'], ['Poetry']]);
  b.rows('Authors', ['AuthorName', 'Country'], Array.from({ length: 12 }, (_, i) => [`${FIRST[(i * 5) % FIRST.length]} ${LAST[(i * 3 + 2) % LAST.length]}`, pick(r, ['Ghana', 'Nigeria', 'Kenya', 'UK', 'USA', 'South Africa'])]));
  const titles = ['The River Spirits', 'Coding for Young Minds', 'Stars Over Volta', 'A Short History of Trade', 'Algebra Made Clear', 'Songs of the Harmattan', 'Robots in the Classroom', 'The Market Queen', 'Databases from Scratch', 'Gold Coast Chronicles', 'Physics Everywhere', 'Poems for the Rain', 'The Cocoa Farmer', 'Networks and the Internet', 'Kente Patterns', 'Geometry Adventures', 'Mystery at Elmina', 'Electricity Basics', 'The Talking Drum', 'Python Projects'];
  b.rows('Books', ['ISBN', 'Title', 'AuthorID', 'CategoryID', 'YearPublished', 'Copies', 'Price'], titles.map((t, i) => [`978-9988-${String(1000 + i * 37).padStart(4, '0')}-${i % 10}`, t, 1 + (i % 12), 1 + (i % 6), 1990 + Math.floor(r() * 35), 1 + Math.floor(r() * 4), 40 + Math.floor(r() * 160)]));
  b.rows('Members', ['FirstName', 'LastName', 'JoinDate', 'Town', 'Email'], Array.from({ length: 25 }, (_, i) => [FIRST[(i * 11) % FIRST.length], LAST[(i * 13) % LAST.length], date(r, 2019, 2026), pick(r, TOWNS), `member${i + 1}@library.example`]));
  b.rows('Loans', ['BookID', 'MemberID', 'LoanDate', 'DueDate', 'Returned'], Array.from({ length: 50 }, () => { const d = date(r, 2026, 2026); const due = new Date(d); due.setDate(due.getDate() + 14); return [1 + Math.floor(r() * 20), 1 + Math.floor(r() * 25), d, due.toISOString().slice(0, 10), r() > 0.35 ? 1 : 0]; }));
  b.query('qryBooksOnLoan', 'select', (d, c) => { d.tables = b.t('Books', 'Loans', 'Members'); c('Title', 'Books', { sort: 'Ascending' }); c('FirstName', 'Members'); c('LastName', 'Members'); c('DueDate', 'Loans', { sort: 'Ascending' }); c('Returned', 'Loans', { criteria: ['No', ''], show: false }); });
  b.query('qryLoansPerCategory', 'select', (d, c) => { d.tables = b.t('Categories', 'Books', 'Loans'); d.totals = true; c('CategoryName', 'Categories'); c('LoanID', 'Loans', { total: 'Count', sort: 'Descending' }); });
  b.query('qryBooksByAuthor', 'select', (d, c) => { d.tables = b.t('Authors', 'Books'); c('AuthorName', 'Authors', { criteria: ['[Author name contains]', ''] }); c('Title', 'Books'); c('YearPublished', 'Books'); });
  b.p.saveForm(autoForm(b.p, 'Books', 'frmBooks'));
  b.p.saveForm(autoForm(b.p, 'Members', 'frmMembers'));
  b.p.saveReport(autoReport(b.p, 'qryBooksOnLoan', 'rptBooksOnLoan', { fields: ['Title', 'FirstName', 'LastName', 'DueDate'] }));
}

function hospital(b: Builder, r: () => number) {
  b.table('Departments', [['DepartmentID', 'AutoNumber', { primaryKey: true }], ['DepartmentName', 'Short Text', { required: true, indexed: 'Yes (No Duplicates)' }], ['Floor', 'Number', { numberSize: 'Byte' }]]);
  b.table('Doctors', [['DoctorID', 'AutoNumber', { primaryKey: true }], ['FirstName', 'Short Text', { required: true }], ['LastName', 'Short Text', { required: true }], ['Specialty', 'Short Text'], ['DepartmentID', 'Number', { lookup: { rowSourceType: 'Table/Query', rowSource: 'Departments', boundField: 'DepartmentID', displayField: 'DepartmentName' } }], ['Phone', 'Short Text']]);
  b.table('Patients', [['PatientID', 'AutoNumber', { primaryKey: true }], ['FirstName', 'Short Text', { required: true }], ['LastName', 'Short Text', { required: true }], ['DateOfBirth', 'Date/Time'], ['Gender', 'Short Text', { fieldSize: 1 }], ['Town', 'Short Text'], ['Insured', 'Yes/No']]);
  b.table('Appointments', [['AppointmentID', 'AutoNumber', { primaryKey: true }], ['PatientID', 'Number', { required: true }], ['DoctorID', 'Number', { required: true }], ['AppointmentDate', 'Date/Time', { required: true }], ['Reason', 'Short Text', { fieldSize: 100 }], ['Fee', 'Currency']]);
  b.table('Prescriptions', [['PrescriptionID', 'AutoNumber', { primaryKey: true }], ['AppointmentID', 'Number', { required: true }], ['Medicine', 'Short Text'], ['Dosage', 'Short Text'], ['Days', 'Number', { numberSize: 'Byte' }]]);
  b.rel('Departments', 'DepartmentID', 'Doctors', 'DepartmentID'); b.rel('Patients', 'PatientID', 'Appointments', 'PatientID'); b.rel('Doctors', 'DoctorID', 'Appointments', 'DoctorID'); b.rel('Appointments', 'AppointmentID', 'Prescriptions', 'AppointmentID', true);
  b.layout({ Departments: [30, 40], Doctors: [270, 30], Appointments: [520, 60], Patients: [770, 30], Prescriptions: [770, 260] });
  b.rows('Departments', ['DepartmentName', 'Floor'], [['General Medicine', 1], ['Paediatrics', 2], ['Surgery', 3], ['Maternity', 2], ['Dental', 1]]);
  const specs = ['General Practice', 'Paediatrics', 'Surgery', 'Obstetrics', 'Dentistry'];
  b.rows('Doctors', ['FirstName', 'LastName', 'Specialty', 'DepartmentID', 'Phone'], Array.from({ length: 10 }, (_, i) => [FIRST[(i * 9) % FIRST.length], LAST[(i * 7 + 4) % LAST.length], specs[i % 5], 1 + (i % 5), `020${1000000 + i * 4321}`]));
  b.rows('Patients', ['FirstName', 'LastName', 'DateOfBirth', 'Gender', 'Town', 'Insured'], Array.from({ length: 30 }, (_, i) => [FIRST[(i * 17) % FIRST.length], LAST[(i * 11 + 5) % LAST.length], date(r, 1950, 2022), i % 2 ? 'M' : 'F', pick(r, TOWNS), r() > 0.3 ? 1 : 0]));
  const reasons = ['Check-up', 'Fever', 'Follow-up', 'Vaccination', 'Toothache', 'Injury', 'Antenatal visit'];
  b.rows('Appointments', ['PatientID', 'DoctorID', 'AppointmentDate', 'Reason', 'Fee'], Array.from({ length: 60 }, () => [1 + Math.floor(r() * 30), 1 + Math.floor(r() * 10), date(r, 2026, 2026) + ` ${String(8 + Math.floor(r() * 9)).padStart(2, '0')}:00:00`, pick(r, reasons), 50 + Math.floor(r() * 20) * 10]));
  const meds = ['Paracetamol', 'Amoxicillin', 'Vitamin C', 'Ibuprofen', 'ORS'];
  b.rows('Prescriptions', ['AppointmentID', 'Medicine', 'Dosage', 'Days'], Array.from({ length: 40 }, () => [1 + Math.floor(r() * 60), pick(r, meds), pick(r, ['1 tab 2x daily', '5ml 3x daily', '1 tab daily']), 3 + Math.floor(r() * 7)]));
  b.query('qryAppointmentsByDoctor', 'select', (d, c) => { d.tables = b.t('Doctors', 'Appointments', 'Patients'); c('LastName', 'Doctors', { sort: 'Ascending', alias: 'Doctor' }); c('AppointmentDate', 'Appointments', { sort: 'Ascending' }); c('FirstName', 'Patients'); c('Reason', 'Appointments'); });
  b.query('qryIncomeByDepartment', 'select', (d, c) => { d.tables = b.t('Departments', 'Doctors', 'Appointments'); d.totals = true; c('DepartmentName', 'Departments'); c('Fee', 'Appointments', { total: 'Sum', sort: 'Descending' }); });
  b.p.saveForm(autoForm(b.p, 'Patients', 'frmPatients'));
  b.p.saveForm(autoForm(b.p, 'Appointments', 'frmAppointments'));
  b.p.saveReport(autoReport(b.p, 'qryAppointmentsByDoctor', 'rptAppointmentsByDoctor', { groupBy: 'Doctor', fields: ['AppointmentDate', 'FirstName', 'Reason'] }));
}

function shop(b: Builder, r: () => number) {
  b.table('Suppliers', [['SupplierID', 'AutoNumber', { primaryKey: true }], ['CompanyName', 'Short Text', { required: true }], ['ContactName', 'Short Text'], ['Town', 'Short Text'], ['Phone', 'Short Text']]);
  b.table('Products', [['ProductID', 'AutoNumber', { primaryKey: true }], ['ProductName', 'Short Text', { required: true }], ['SupplierID', 'Number', { lookup: { rowSourceType: 'Table/Query', rowSource: 'Suppliers', boundField: 'SupplierID', displayField: 'CompanyName' } }], ['Category', 'Short Text'], ['UnitPrice', 'Currency', { validationRule: '>0', validationText: 'Price must be greater than zero.' }], ['UnitsInStock', 'Number', { defaultValue: '0', validationRule: '>=0' }], ['ReorderLevel', 'Number', { defaultValue: '10' }], ['Discontinued', 'Yes/No']]);
  b.table('Customers', [['CustomerID', 'AutoNumber', { primaryKey: true }], ['CustomerName', 'Short Text', { required: true }], ['Town', 'Short Text'], ['Phone', 'Short Text'], ['Email', 'Hyperlink']]);
  b.table('Orders', [['OrderID', 'AutoNumber', { primaryKey: true }], ['CustomerID', 'Number', { required: true, lookup: { rowSourceType: 'Table/Query', rowSource: 'Customers', boundField: 'CustomerID', displayField: 'CustomerName' } }], ['OrderDate', 'Date/Time', { defaultValue: 'Date()' }], ['PaymentMethod', 'Short Text', { lookup: { rowSourceType: 'Value List', rowSource: 'Cash;Mobile Money;Card' } }], ['Notes', 'Long Text']]);
  b.table('OrderDetails', [['OrderID', 'Number', { primaryKey: true }], ['ProductID', 'Number', { primaryKey: true }], ['Quantity', 'Number', { required: true, validationRule: '>0' }], ['UnitPrice', 'Currency'], ['Discount', 'Number', { numberSize: 'Double', defaultValue: '0', validationRule: 'Between 0 And 0.5' }], ['LineTotal', 'Calculated', { expression: '[Quantity]*[UnitPrice]*(1-[Discount])', resultType: 'Currency' }]], 'Composite primary key (OrderID + ProductID)');
  b.rel('Suppliers', 'SupplierID', 'Products', 'SupplierID'); b.rel('Customers', 'CustomerID', 'Orders', 'CustomerID'); b.rel('Orders', 'OrderID', 'OrderDetails', 'OrderID', true); b.rel('Products', 'ProductID', 'OrderDetails', 'ProductID');
  b.layout({ Suppliers: [30, 40], Products: [270, 30], OrderDetails: [520, 80], Orders: [770, 40], Customers: [1010, 40] });
  b.rows('Suppliers', ['CompanyName', 'ContactName', 'Town', 'Phone'], [['Volta Foods Ltd', 'Esi Darko', 'Ho', '0362000111'], ['Accra Tech Supplies', 'Kojo Addo', 'Accra', '0302000222'], ['Ashanti Crafts', 'Yaa Osei', 'Kumasi', '0322000333'], ['Coastline Stationers', 'Ekow Quaye', 'Cape Coast', '0332000444']]);
  const prods = [['Rice 5kg', 1, 'Groceries', 85], ['Cooking Oil 1L', 1, 'Groceries', 32], ['Exercise Book', 4, 'Stationery', 6], ['Ballpoint Pen (10)', 4, 'Stationery', 15], ['USB Flash Drive 32GB', 2, 'Electronics', 70], ['Arduino Uno Kit', 2, 'Electronics', 420], ['HDMI Cable', 2, 'Electronics', 45], ['Kente Scarf', 3, 'Crafts', 150], ['Wooden Bowl', 3, 'Crafts', 60], ['Sugar 1kg', 1, 'Groceries', 18], ['Calculator', 4, 'Stationery', 95], ['Breadboard', 2, 'Electronics', 35]];
  b.rows('Products', ['ProductName', 'SupplierID', 'Category', 'UnitPrice', 'UnitsInStock', 'ReorderLevel', 'Discontinued'], prods.map((x) => [...x, Math.floor(r() * 80), 10, 0]));
  b.rows('Customers', ['CustomerName', 'Town', 'Phone', 'Email'], Array.from({ length: 15 }, (_, i) => [`${FIRST[(i * 3 + 1) % FIRST.length]} ${LAST[(i * 5 + 3) % LAST.length]}`, pick(r, TOWNS), `055${1000000 + i * 7777}`, `customer${i + 1}@shop.example`]));
  b.rows('Orders', ['CustomerID', 'OrderDate', 'PaymentMethod'], Array.from({ length: 30 }, () => [1 + Math.floor(r() * 15), date(r, 2026, 2026), pick(r, ['Cash', 'Mobile Money', 'Card'])]));
  const od: unknown[][] = [];
  for (let o = 1; o <= 30; o++) { const used = new Set<number>(); const n = 1 + Math.floor(r() * 4); for (let k = 0; k < n; k++) { const pid = 1 + Math.floor(r() * 12); if (used.has(pid)) continue; used.add(pid); od.push([o, pid, 1 + Math.floor(r() * 6), prods[pid - 1][3], r() > 0.8 ? 0.1 : 0]); } }
  b.rows('OrderDetails', ['OrderID', 'ProductID', 'Quantity', 'UnitPrice', 'Discount'], od);
  b.query('qryLowStock', 'select', (d, c) => { d.tables = b.t('Products', 'Suppliers'); c('ProductName', 'Products'); c('UnitsInStock', 'Products', { sort: 'Ascending', criteria: ['<20', ''] }); c('CompanyName', 'Suppliers'); });
  b.query('qrySalesByProduct', 'select', (d, c) => { d.tables = b.t('Products', 'OrderDetails'); d.totals = true; c('ProductName', 'Products'); c('Quantity', 'OrderDetails', { total: 'Sum' }); c('LineTotal', 'OrderDetails', { total: 'Sum', sort: 'Descending' }); });
  b.query('qryOrderLines', 'select', (d, c) => { d.tables = b.t('Customers', 'Orders', 'OrderDetails', 'Products'); c('OrderID', 'Orders', { sort: 'Ascending' }); c('OrderDate', 'Orders'); c('CustomerName', 'Customers'); c('ProductName', 'Products'); c('Quantity', 'OrderDetails'); c('LineTotal', 'OrderDetails'); });
  b.query('qryRaisePrices', 'update', (d, c) => { d.tables = b.t('Products'); d.targetTable = 'Products'; c('UnitPrice', 'Products', { updateTo: '[UnitPrice]*1.05' }); c('Category', 'Products', { criteria: ['[Category to increase by 5%]', ''] }); }, 'Update query (asks for a category)');
  b.p.saveForm(autoForm(b.p, 'Products', 'frmProducts'));
  const sub = autoForm(b.p, 'OrderDetails', 'subOrderDetails', undefined, 'Datasheet'); b.p.saveForm(sub);
  const ord = autoForm(b.p, 'Orders', 'frmOrders');
  const det = ord.sections.find((s) => s.kind === 'detail')!;
  const sf = newControl('subform', det.id, 16, det.height, ord.controls); sf.w = 600; sf.h = 180; sf.props.sourceObject = 'subOrderDetails'; sf.props.linkMasterFields = 'OrderID'; sf.props.linkChildFields = 'OrderID'; sf.name = 'OrderLines';
  ord.controls.push(sf); det.height += 196; b.p.saveForm(ord);
  b.p.saveReport(autoReport(b.p, 'qryOrderLines', 'rptOrderInvoices', { groupBy: 'OrderID', fields: ['OrderDate', 'CustomerName', 'ProductName', 'Quantity', 'LineTotal'], totals: ['LineTotal'] }));
}

function employee(b: Builder, r: () => number) {
  b.table('Departments', [['DepartmentID', 'AutoNumber', { primaryKey: true }], ['DepartmentName', 'Short Text', { required: true, indexed: 'Yes (No Duplicates)' }], ['Location', 'Short Text']]);
  b.table('Positions', [['PositionID', 'AutoNumber', { primaryKey: true }], ['Title', 'Short Text', { required: true }], ['MinSalary', 'Currency'], ['MaxSalary', 'Currency']]);
  b.table('Employees', [['EmployeeID', 'AutoNumber', { primaryKey: true }], ['FirstName', 'Short Text', { required: true }], ['LastName', 'Short Text', { required: true }], ['DepartmentID', 'Number', { lookup: { rowSourceType: 'Table/Query', rowSource: 'Departments', boundField: 'DepartmentID', displayField: 'DepartmentName' } }], ['PositionID', 'Number', { lookup: { rowSourceType: 'Table/Query', rowSource: 'Positions', boundField: 'PositionID', displayField: 'Title' } }], ['HireDate', 'Date/Time'], ['ManagerID', 'Number'], ['Email', 'Hyperlink'], ['FullTime', 'Yes/No', { defaultValue: 'Yes' }]]);
  b.table('Salaries', [['SalaryID', 'AutoNumber', { primaryKey: true }], ['EmployeeID', 'Number', { required: true }], ['EffectiveDate', 'Date/Time', { required: true }], ['Amount', 'Currency', { validationRule: '>0' }]]);
  b.rel('Departments', 'DepartmentID', 'Employees', 'DepartmentID'); b.rel('Positions', 'PositionID', 'Employees', 'PositionID'); b.rel('Employees', 'EmployeeID', 'Salaries', 'EmployeeID', true);
  b.layout({ Departments: [30, 40], Positions: [30, 220], Employees: [290, 40], Salaries: [550, 60] });
  b.rows('Departments', ['DepartmentName', 'Location'], [['Administration', 'Accra'], ['Finance', 'Accra'], ['ICT', 'Tema'], ['Training', 'Kumasi'], ['Sales', 'Takoradi']]);
  b.rows('Positions', ['Title', 'MinSalary', 'MaxSalary'], [['Officer', 2500, 4000], ['Senior Officer', 4000, 6000], ['Manager', 6000, 9000], ['Director', 9000, 14000], ['Trainee', 1500, 2500]]);
  b.rows('Employees', ['FirstName', 'LastName', 'DepartmentID', 'PositionID', 'HireDate', 'ManagerID', 'Email', 'FullTime'], Array.from({ length: 24 }, (_, i) => [FIRST[(i * 13 + 2) % FIRST.length], LAST[(i * 9 + 7) % LAST.length], 1 + (i % 5), i < 2 ? 4 : i < 6 ? 3 : 1 + Math.floor(r() * 2) + (r() > 0.8 ? 4 : 0) > 5 ? 5 : 1 + Math.floor(r() * 2), date(r, 2010, 2026), i < 2 ? null : 1 + (i % 2), `staff${i + 1}@company.example`, r() > 0.15 ? 1 : 0]));
  const sal: unknown[][] = [];
  for (let e = 1; e <= 24; e++) { const base = 2000 + Math.floor(r() * 60) * 100; sal.push([e, '2025-01-01', base], [e, '2026-01-01', Math.round(base * 1.08)]); }
  b.rows('Salaries', ['EmployeeID', 'EffectiveDate', 'Amount'], sal);
  b.query('qryStaffList', 'select', (d, c) => { d.tables = b.t('Departments', 'Employees', 'Positions'); c('DepartmentName', 'Departments', { sort: 'Ascending' }); c('LastName', 'Employees', { sort: 'Ascending' }); c('FirstName', 'Employees'); c('Title', 'Positions'); });
  b.query('qryPayrollByDepartment', 'select', (d, c) => { d.tables = b.t('Departments', 'Employees', 'Salaries'); d.totals = true; c('DepartmentName', 'Departments'); c('Amount', 'Salaries', { total: 'Sum', sort: 'Descending' }); c('EffectiveDate', 'Salaries', { total: 'Where', criteria: ['>=#2026-01-01#', ''], show: false }); });
  b.p.saveForm(autoForm(b.p, 'Employees', 'frmEmployees'));
  b.p.saveReport(autoReport(b.p, 'qryStaffList', 'rptStaffByDepartment', { groupBy: 'DepartmentName', fields: ['LastName', 'FirstName', 'Title'] }));
}
