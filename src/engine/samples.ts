// Preloaded sample databases. All names and records are fictional.
// Each sample is built through the same public API the designers use, so the
// tables, relationships, queries, forms and reports are ordinary DBWOW objects.
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
  { id: 'sports', name: 'Sports League', description: 'Teams, players, matches and goals.' },
  { id: 'hotel', name: 'Hotel Bookings', description: 'Room types, rooms, guests and bookings.' },
  { id: 'transport', name: 'Bus Transport', description: 'Routes, buses, drivers and trips.' },
  { id: 'cinema', name: 'Cinema', description: 'Films, screens, showings, customers and tickets.' },
  { id: 'restaurant', name: 'Restaurant', description: 'Menu items, waiters, tables, orders and order items.' },
  { id: 'farm', name: 'Farm Co-operative', description: 'Farmers, crops, plots and harvests.' },
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
  if (id === 'sports') sports(b, r);
  if (id === 'hotel') hotel(b, r);
  if (id === 'transport') transport(b, r);
  if (id === 'cinema') cinema(b, r);
  if (id === 'restaurant') restaurant(b, r);
  if (id === 'farm') farm(b, r);
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

const lk = (table: string, bound: string, display: string) => ({ lookup: { rowSourceType: 'Table/Query' as const, rowSource: table, boundField: bound, displayField: display } });

function sports(b: Builder, r: () => number) {
  b.table('Teams', [['TeamID', 'AutoNumber', { primaryKey: true }], ['TeamName', 'Short Text', { required: true, indexed: 'Yes (No Duplicates)' }], ['Town', 'Short Text'], ['Coach', 'Short Text'], ['Founded', 'Number', { numberSize: 'Integer', validationRule: 'Between 1900 And 2100' }]]);
  b.table('Players', [['PlayerID', 'AutoNumber', { primaryKey: true }], ['FirstName', 'Short Text', { required: true }], ['LastName', 'Short Text', { required: true }], ['TeamID', 'Number', lk('Teams', 'TeamID', 'TeamName')], ['Position', 'Short Text', { fieldSize: 3, lookup: { rowSourceType: 'Value List', rowSource: 'GK;DEF;MID;FWD' } }], ['DateOfBirth', 'Date/Time'], ['ShirtNumber', 'Number', { numberSize: 'Byte' }], ['Captain', 'Yes/No']]);
  b.table('Matches', [['MatchID', 'AutoNumber', { primaryKey: true }], ['MatchDate', 'Date/Time', { required: true }], ['HomeTeamID', 'Number', lk('Teams', 'TeamID', 'TeamName')], ['AwayTeamID', 'Number', lk('Teams', 'TeamID', 'TeamName')], ['HomeGoals', 'Number', { numberSize: 'Byte' }], ['AwayGoals', 'Number', { numberSize: 'Byte' }], ['Attendance', 'Number']]);
  b.table('Goals', [['GoalID', 'AutoNumber', { primaryKey: true }], ['MatchID', 'Number', { required: true }], ['PlayerID', 'Number', { required: true }], ['Minute', 'Number', { numberSize: 'Byte', validationRule: 'Between 1 And 120' }], ['Penalty', 'Yes/No']]);
  b.rel('Teams', 'TeamID', 'Players', 'TeamID'); b.rel('Teams', 'TeamID', 'Matches', 'HomeTeamID'); b.rel('Matches', 'MatchID', 'Goals', 'MatchID', true); b.rel('Players', 'PlayerID', 'Goals', 'PlayerID');
  b.layout({ Teams: [30, 40], Players: [280, 30], Matches: [280, 260], Goals: [540, 120] });
  const teams = ['Volta Eagles', 'Kumasi Lions', 'Coastal Stars', 'Accra Royals', 'Tamale Hawks', 'Ho Warriors'];
  const towns = ['Ho', 'Kumasi', 'Cape Coast', 'Accra', 'Tamale', 'Ho'];
  b.rows('Teams', ['TeamName', 'Town', 'Coach', 'Founded'], teams.map((t, i) => [t, towns[i], `${FIRST[(i * 7) % FIRST.length]} ${LAST[(i * 3) % LAST.length]}`, 1950 + Math.floor(r() * 70)]));
  const pos = ['GK', 'DEF', 'DEF', 'MID', 'MID', 'FWD', 'FWD'];
  b.rows('Players', ['FirstName', 'LastName', 'TeamID', 'Position', 'DateOfBirth', 'ShirtNumber', 'Captain'], Array.from({ length: 42 }, (_, i) => [FIRST[(i * 7 + 3) % FIRST.length], LAST[(i * 11 + 1) % LAST.length], 1 + (i % 6), pos[Math.floor(i / 6) % 7], date(r, 1995, 2007), 1 + ((i * 7) % 30), Math.floor(i / 6) === 3 ? 1 : 0]));
  const matches: unknown[][] = [];
  for (let k = 0; k < 18; k++) { const h = 1 + (k % 6); let a = 1 + ((k * 5 + 2) % 6); if (a === h) a = (a % 6) + 1; matches.push([date(r, 2026, 2026), h, a, Math.floor(r() * 4), Math.floor(r() * 3), 500 + Math.floor(r() * 90) * 100]); }
  b.rows('Matches', ['MatchDate', 'HomeTeamID', 'AwayTeamID', 'HomeGoals', 'AwayGoals', 'Attendance'], matches);
  const goals: unknown[][] = [];
  matches.forEach((m, k) => { const [, h, a, hg, ag] = m as number[]; for (let g = 0; g < hg; g++) goals.push([k + 1, (h - 1) + 6 * (3 + Math.floor(r() * 4)) + 1, 1 + Math.floor(r() * 90), r() > 0.85 ? 1 : 0]); for (let g = 0; g < ag; g++) goals.push([k + 1, (a - 1) + 6 * (3 + Math.floor(r() * 4)) + 1, 1 + Math.floor(r() * 90), r() > 0.85 ? 1 : 0]); });
  b.rows('Goals', ['MatchID', 'PlayerID', 'Minute', 'Penalty'], goals);
  b.query('qryTopScorers', 'select', (d, c) => { d.tables = b.t('Players', 'Goals'); d.totals = true; c('FirstName', 'Players'); c('LastName', 'Players'); c('GoalID', 'Goals', { total: 'Count', sort: 'Descending', alias: 'GoalsScored' }); });
  b.query('qryTeamSquads', 'select', (d, c) => { d.tables = b.t('Teams', 'Players'); c('TeamName', 'Teams', { sort: 'Ascending' }); c('ShirtNumber', 'Players', { sort: 'Ascending' }); c('FirstName', 'Players'); c('LastName', 'Players'); c('Position', 'Players'); });
  b.p.saveForm(autoForm(b.p, 'Players', 'frmPlayers'));
  b.p.saveReport(autoReport(b.p, 'qryTeamSquads', 'rptSquadsByTeam', { groupBy: 'TeamName', fields: ['ShirtNumber', 'FirstName', 'LastName', 'Position'] }));
}

function hotel(b: Builder, r: () => number) {
  b.table('RoomTypes', [['RoomTypeID', 'AutoNumber', { primaryKey: true }], ['TypeName', 'Short Text', { required: true }], ['Rate', 'Currency', { validationRule: '>0' }], ['Capacity', 'Number', { numberSize: 'Byte' }]]);
  b.table('Rooms', [['RoomNumber', 'Number', { primaryKey: true, numberSize: 'Integer' }], ['RoomTypeID', 'Number', lk('RoomTypes', 'RoomTypeID', 'TypeName')], ['Floor', 'Number', { numberSize: 'Byte' }], ['SeaView', 'Yes/No']]);
  b.table('Guests', [['GuestID', 'AutoNumber', { primaryKey: true }], ['FirstName', 'Short Text', { required: true }], ['LastName', 'Short Text', { required: true }], ['Country', 'Short Text'], ['Phone', 'Short Text'], ['Email', 'Hyperlink']]);
  b.table('Bookings', [['BookingID', 'AutoNumber', { primaryKey: true }], ['GuestID', 'Number', { required: true }], ['RoomNumber', 'Number', { required: true }], ['CheckIn', 'Date/Time', { required: true }], ['Nights', 'Number', { numberSize: 'Byte', validationRule: '>=1' }], ['Source', 'Short Text', { lookup: { rowSourceType: 'Value List', rowSource: 'Walk-in;Phone;Website;Agent' } }], ['Paid', 'Yes/No']]);
  b.rel('RoomTypes', 'RoomTypeID', 'Rooms', 'RoomTypeID'); b.rel('Rooms', 'RoomNumber', 'Bookings', 'RoomNumber'); b.rel('Guests', 'GuestID', 'Bookings', 'GuestID');
  b.layout({ RoomTypes: [30, 40], Rooms: [270, 40], Bookings: [510, 60], Guests: [760, 40] });
  b.rows('RoomTypes', ['TypeName', 'Rate', 'Capacity'], [['Single', 350, 1], ['Double', 520, 2], ['Family', 780, 4], ['Suite', 1200, 2]]);
  const rooms: unknown[][] = [];
  for (const f of [1, 2, 3]) for (let k = 1; k <= 6; k++) rooms.push([f * 100 + k, 1 + ((k + f) % 4), f, k <= 2 ? 1 : 0]);
  b.rows('Rooms', ['RoomNumber', 'RoomTypeID', 'Floor', 'SeaView'], rooms);
  b.rows('Guests', ['FirstName', 'LastName', 'Country', 'Phone', 'Email'], Array.from({ length: 28 }, (_, i) => [FIRST[(i * 5 + 2) % FIRST.length], LAST[(i * 7 + 3) % LAST.length], pick(r, ['Ghana', 'Ghana', 'Nigeria', 'Togo', 'UK', 'Germany', 'USA']), `024${2000000 + i * 3131}`, `guest${i + 1}@hotel.example`]));
  b.rows('Bookings', ['GuestID', 'RoomNumber', 'CheckIn', 'Nights', 'Source', 'Paid'], Array.from({ length: 55 }, () => [1 + Math.floor(r() * 28), (rooms[Math.floor(r() * rooms.length)] as number[])[0], date(r, 2026, 2026), 1 + Math.floor(r() * 7), pick(r, ['Walk-in', 'Phone', 'Website', 'Agent']), r() > 0.25 ? 1 : 0]));
  b.query('qryGuestBookings', 'select', (d, c) => { d.tables = b.t('Guests', 'Bookings', 'Rooms'); c('LastName', 'Guests', { sort: 'Ascending' }); c('FirstName', 'Guests'); c('RoomNumber', 'Bookings'); c('CheckIn', 'Bookings', { sort: 'Ascending' }); c('Nights', 'Bookings'); });
  b.query('qryBookingsPerRoomType', 'select', (d, c) => { d.tables = b.t('RoomTypes', 'Rooms', 'Bookings'); d.totals = true; c('TypeName', 'RoomTypes'); c('Nights', 'Bookings', { total: 'Sum', sort: 'Descending', alias: 'NightsBooked' }); });
  b.p.saveForm(autoForm(b.p, 'Guests', 'frmGuests'));
  b.p.saveForm(autoForm(b.p, 'Bookings', 'frmBookings'));
  b.p.saveReport(autoReport(b.p, 'qryGuestBookings', 'rptGuestBookings', { fields: ['LastName', 'FirstName', 'RoomNumber', 'CheckIn', 'Nights'] }));
}

function transport(b: Builder, r: () => number) {
  b.table('Routes', [['RouteID', 'AutoNumber', { primaryKey: true }], ['Origin', 'Short Text', { required: true }], ['Destination', 'Short Text', { required: true }], ['DistanceKm', 'Number', { numberSize: 'Integer' }], ['Fare', 'Currency', { validationRule: '>0' }]]);
  b.table('Buses', [['BusID', 'AutoNumber', { primaryKey: true }], ['RegNumber', 'Short Text', { fieldSize: 12, indexed: 'Yes (No Duplicates)' }], ['Make', 'Short Text'], ['Seats', 'Number', { numberSize: 'Byte' }], ['YearBought', 'Number', { numberSize: 'Integer' }], ['AirConditioned', 'Yes/No']]);
  b.table('Drivers', [['DriverID', 'AutoNumber', { primaryKey: true }], ['FirstName', 'Short Text', { required: true }], ['LastName', 'Short Text', { required: true }], ['LicenceClass', 'Short Text', { fieldSize: 1 }], ['HireDate', 'Date/Time'], ['Phone', 'Short Text']]);
  b.table('Trips', [['TripID', 'AutoNumber', { primaryKey: true }], ['RouteID', 'Number', { required: true }], ['BusID', 'Number', { required: true }], ['DriverID', 'Number', { required: true }], ['TripDate', 'Date/Time', { required: true }], ['Passengers', 'Number', { numberSize: 'Byte', validationRule: '>=0' }], ['Delayed', 'Yes/No']]);
  b.rel('Routes', 'RouteID', 'Trips', 'RouteID'); b.rel('Buses', 'BusID', 'Trips', 'BusID'); b.rel('Drivers', 'DriverID', 'Trips', 'DriverID');
  b.layout({ Routes: [30, 40], Buses: [30, 230], Trips: [290, 80], Drivers: [550, 40] });
  b.rows('Routes', ['Origin', 'Destination', 'DistanceKm', 'Fare'], [['Accra', 'Kumasi', 250, 120], ['Accra', 'Cape Coast', 145, 80], ['Kumasi', 'Tamale', 380, 160], ['Accra', 'Ho', 165, 85], ['Takoradi', 'Accra', 220, 105], ['Kumasi', 'Sunyani', 130, 65], ['Tema', 'Koforidua', 90, 50]]);
  b.rows('Buses', ['RegNumber', 'Make', 'Seats', 'YearBought', 'AirConditioned'], Array.from({ length: 10 }, (_, i) => [`GT-${2100 + i * 37}-${20 + (i % 6)}`, pick(r, ['Yutong', 'Scania', 'Mercedes', 'King Long']), pick(r, [33, 45, 50, 60]), 2012 + Math.floor(r() * 13), r() > 0.4 ? 1 : 0]));
  b.rows('Drivers', ['FirstName', 'LastName', 'LicenceClass', 'HireDate', 'Phone'], Array.from({ length: 12 }, (_, i) => [FIRST[(i * 9 + 1) % FIRST.length], LAST[(i * 3 + 5) % LAST.length], pick(r, ['D', 'E', 'F']), date(r, 2008, 2025), `027${3000000 + i * 4242}`]));
  b.rows('Trips', ['RouteID', 'BusID', 'DriverID', 'TripDate', 'Passengers', 'Delayed'], Array.from({ length: 60 }, () => [1 + Math.floor(r() * 7), 1 + Math.floor(r() * 10), 1 + Math.floor(r() * 12), date(r, 2026, 2026), 15 + Math.floor(r() * 45), r() > 0.8 ? 1 : 0]));
  b.query('qryTripList', 'select', (d, c) => { d.tables = b.t('Routes', 'Trips', 'Drivers'); c('TripDate', 'Trips', { sort: 'Ascending' }); c('Origin', 'Routes'); c('Destination', 'Routes'); c('LastName', 'Drivers'); c('Passengers', 'Trips'); });
  b.query('qryPassengersByRoute', 'select', (d, c) => { d.tables = b.t('Routes', 'Trips'); d.totals = true; c('Origin', 'Routes'); c('Destination', 'Routes'); c('Passengers', 'Trips', { total: 'Sum', sort: 'Descending', alias: 'TotalPassengers' }); });
  b.p.saveForm(autoForm(b.p, 'Drivers', 'frmDrivers'));
  b.p.saveForm(autoForm(b.p, 'Trips', 'frmTrips'));
  b.p.saveReport(autoReport(b.p, 'qryTripList', 'rptTripsByOrigin', { groupBy: 'Origin', fields: ['TripDate', 'Destination', 'LastName', 'Passengers'], totals: ['Passengers'] }));
}

function cinema(b: Builder, r: () => number) {
  b.table('Films', [['FilmID', 'AutoNumber', { primaryKey: true }], ['Title', 'Short Text', { required: true }], ['Genre', 'Short Text'], ['AgeRating', 'Short Text', { fieldSize: 4, lookup: { rowSourceType: 'Value List', rowSource: 'U;PG;12;15;18' } }], ['DurationMins', 'Number', { numberSize: 'Integer' }], ['ReleaseYear', 'Number', { numberSize: 'Integer' }]]);
  b.table('Screens', [['ScreenID', 'AutoNumber', { primaryKey: true }], ['ScreenName', 'Short Text'], ['Seats', 'Number', { numberSize: 'Integer' }], ['ThreeD', 'Yes/No']]);
  b.table('Showings', [['ShowingID', 'AutoNumber', { primaryKey: true }], ['FilmID', 'Number', { required: true }], ['ScreenID', 'Number', { required: true }], ['ShowDate', 'Date/Time', { required: true }], ['StartTime', 'Short Text', { fieldSize: 5 }], ['TicketPrice', 'Currency', { validationRule: '>0' }]]);
  b.table('Customers', [['CustomerID', 'AutoNumber', { primaryKey: true }], ['FirstName', 'Short Text', { required: true }], ['LastName', 'Short Text', { required: true }], ['Town', 'Short Text'], ['LoyaltyMember', 'Yes/No']]);
  b.table('Tickets', [['TicketID', 'AutoNumber', { primaryKey: true }], ['ShowingID', 'Number', { required: true }], ['CustomerID', 'Number', { required: true }], ['SeatNo', 'Short Text', { fieldSize: 4 }], ['PricePaid', 'Currency']]);
  b.rel('Films', 'FilmID', 'Showings', 'FilmID'); b.rel('Screens', 'ScreenID', 'Showings', 'ScreenID'); b.rel('Showings', 'ShowingID', 'Tickets', 'ShowingID'); b.rel('Customers', 'CustomerID', 'Tickets', 'CustomerID');
  b.layout({ Films: [30, 40], Screens: [30, 240], Showings: [280, 80], Tickets: [530, 80], Customers: [780, 40] });
  b.rows('Films', ['Title', 'Genre', 'AgeRating', 'DurationMins', 'ReleaseYear'], [['The Golden Stool', 'Drama', '12', 128, 2025], ['Robots of Accra', 'Science Fiction', 'PG', 104, 2026], ['Laughing in Lagos', 'Comedy', '12', 96, 2024], ['Night Market', 'Thriller', '15', 112, 2026], ['Kofi and the Comet', 'Animation', 'U', 88, 2025], ['Savannah Run', 'Adventure', 'PG', 119, 2023], ['Coastline', 'Drama', '15', 131, 2026], ['The Last Penalty', 'Sport', 'PG', 101, 2025], ['Ghost of Elmina', 'Horror', '18', 99, 2024], ['Starlight Choir', 'Musical', 'U', 115, 2026]]);
  b.rows('Screens', ['ScreenName', 'Seats', 'ThreeD'], [['Screen 1', 180, 1], ['Screen 2', 120, 0], ['Screen 3', 80, 0], ['VIP', 40, 1]]);
  const times = ['12:00', '15:00', '18:00', '20:30'];
  b.rows('Showings', ['FilmID', 'ScreenID', 'ShowDate', 'StartTime', 'TicketPrice'], Array.from({ length: 30 }, () => [1 + Math.floor(r() * 10), 1 + Math.floor(r() * 4), date(r, 2026, 2026), pick(r, times), pick(r, [45, 55, 60, 80])]));
  b.rows('Customers', ['FirstName', 'LastName', 'Town', 'LoyaltyMember'], Array.from({ length: 22 }, (_, i) => [FIRST[(i * 7 + 5) % FIRST.length], LAST[(i * 9 + 2) % LAST.length], pick(r, TOWNS), r() > 0.55 ? 1 : 0]));
  b.rows('Tickets', ['ShowingID', 'CustomerID', 'SeatNo', 'PricePaid'], Array.from({ length: 80 }, () => { const row = 'ABCDEFG'[Math.floor(r() * 7)]; return [1 + Math.floor(r() * 30), 1 + Math.floor(r() * 22), `${row}${1 + Math.floor(r() * 20)}`, pick(r, [45, 55, 60, 80])]; }));
  b.query('qryShowingTimes', 'select', (d, c) => { d.tables = b.t('Films', 'Showings', 'Screens'); c('ShowDate', 'Showings', { sort: 'Ascending' }); c('StartTime', 'Showings', { sort: 'Ascending' }); c('Title', 'Films'); c('ScreenName', 'Screens'); });
  b.query('qryTicketsPerFilm', 'select', (d, c) => { d.tables = b.t('Films', 'Showings', 'Tickets'); d.totals = true; c('Title', 'Films'); c('TicketID', 'Tickets', { total: 'Count', sort: 'Descending', alias: 'TicketsSold' }); });
  b.p.saveForm(autoForm(b.p, 'Films', 'frmFilms'));
  b.p.saveReport(autoReport(b.p, 'qryShowingTimes', 'rptShowingsByDate', { groupBy: 'ShowDate', fields: ['StartTime', 'Title', 'ScreenName'] }));
}

function restaurant(b: Builder, r: () => number) {
  b.table('MenuItems', [['ItemID', 'AutoNumber', { primaryKey: true }], ['ItemName', 'Short Text', { required: true }], ['Category', 'Short Text', { lookup: { rowSourceType: 'Value List', rowSource: 'Starter;Main;Dessert;Drink' } }], ['Price', 'Currency', { validationRule: '>0' }], ['Vegetarian', 'Yes/No'], ['Spicy', 'Yes/No']]);
  b.table('Waiters', [['WaiterID', 'AutoNumber', { primaryKey: true }], ['FirstName', 'Short Text', { required: true }], ['LastName', 'Short Text', { required: true }], ['HireDate', 'Date/Time']]);
  b.table('DiningTables', [['TableNo', 'Number', { primaryKey: true, numberSize: 'Byte' }], ['Seats', 'Number', { numberSize: 'Byte' }], ['Area', 'Short Text', { lookup: { rowSourceType: 'Value List', rowSource: 'Inside;Terrace;Garden' } }]]);
  b.table('Orders', [['OrderID', 'AutoNumber', { primaryKey: true }], ['TableNo', 'Number', { required: true }], ['WaiterID', 'Number', { required: true }], ['OrderDate', 'Date/Time', { required: true }], ['PaymentMethod', 'Short Text', { lookup: { rowSourceType: 'Value List', rowSource: 'Cash;Mobile Money;Card' } }]]);
  b.table('OrderItems', [['OrderID', 'Number', { primaryKey: true }], ['ItemID', 'Number', { primaryKey: true }], ['Quantity', 'Number', { numberSize: 'Byte', validationRule: '>0' }]], 'Composite primary key (OrderID + ItemID)');
  b.rel('DiningTables', 'TableNo', 'Orders', 'TableNo'); b.rel('Waiters', 'WaiterID', 'Orders', 'WaiterID'); b.rel('Orders', 'OrderID', 'OrderItems', 'OrderID', true); b.rel('MenuItems', 'ItemID', 'OrderItems', 'ItemID');
  b.layout({ MenuItems: [30, 40], OrderItems: [280, 60], Orders: [520, 40], Waiters: [770, 30], DiningTables: [770, 220] });
  b.rows('MenuItems', ['ItemName', 'Category', 'Price', 'Vegetarian', 'Spicy'], [['Kelewele', 'Starter', 25, 1, 1], ['Light Soup', 'Starter', 30, 0, 1], ['Spring Rolls', 'Starter', 28, 1, 0], ['Jollof Rice and Chicken', 'Main', 75, 0, 1], ['Waakye Special', 'Main', 60, 0, 1], ['Banku and Tilapia', 'Main', 95, 0, 1], ['Red Red', 'Main', 50, 1, 0], ['Vegetable Fried Rice', 'Main', 55, 1, 0], ['Fruit Salad', 'Dessert', 30, 1, 0], ['Bofrot (4)', 'Dessert', 15, 1, 0], ['Sobolo', 'Drink', 12, 1, 0], ['Fresh Pineapple Juice', 'Drink', 18, 1, 0], ['Bottled Water', 'Drink', 6, 1, 0]]);
  b.rows('Waiters', ['FirstName', 'LastName', 'HireDate'], Array.from({ length: 6 }, (_, i) => [FIRST[(i * 5 + 4) % FIRST.length], LAST[(i * 7 + 6) % LAST.length], date(r, 2018, 2025)]));
  b.rows('DiningTables', ['TableNo', 'Seats', 'Area'], Array.from({ length: 10 }, (_, i) => [i + 1, pick(r, [2, 4, 4, 6]), i < 5 ? 'Inside' : i < 8 ? 'Terrace' : 'Garden']));
  b.rows('Orders', ['TableNo', 'WaiterID', 'OrderDate', 'PaymentMethod'], Array.from({ length: 40 }, () => [1 + Math.floor(r() * 10), 1 + Math.floor(r() * 6), date(r, 2026, 2026), pick(r, ['Cash', 'Mobile Money', 'Card'])]));
  const oi: unknown[][] = [];
  for (let o = 1; o <= 40; o++) { const used = new Set<number>(); const n = 2 + Math.floor(r() * 3); for (let k = 0; k < n; k++) { const it = 1 + Math.floor(r() * 13); if (used.has(it)) continue; used.add(it); oi.push([o, it, 1 + Math.floor(r() * 3)]); } }
  b.rows('OrderItems', ['OrderID', 'ItemID', 'Quantity'], oi);
  b.query('qryOrderBills', 'select', (d, c) => { d.tables = b.t('Orders', 'OrderItems', 'MenuItems'); c('OrderID', 'Orders', { sort: 'Ascending' }); c('ItemName', 'MenuItems'); c('Quantity', 'OrderItems'); c('Price', 'MenuItems'); });
  b.query('qryBestSellers', 'select', (d, c) => { d.tables = b.t('MenuItems', 'OrderItems'); d.totals = true; c('ItemName', 'MenuItems'); c('Quantity', 'OrderItems', { total: 'Sum', sort: 'Descending', alias: 'PortionsSold' }); });
  b.p.saveForm(autoForm(b.p, 'MenuItems', 'frmMenuItems'));
  b.p.saveReport(autoReport(b.p, 'MenuItems', 'rptMenu', { groupBy: 'Category', fields: ['ItemName', 'Price', 'Vegetarian'] }));
}

function farm(b: Builder, r: () => number) {
  b.table('Farmers', [['FarmerID', 'AutoNumber', { primaryKey: true }], ['FirstName', 'Short Text', { required: true }], ['LastName', 'Short Text', { required: true }], ['Village', 'Short Text'], ['Region', 'Short Text'], ['Phone', 'Short Text'], ['JoinedYear', 'Number', { numberSize: 'Integer' }]]);
  b.table('Crops', [['CropID', 'AutoNumber', { primaryKey: true }], ['CropName', 'Short Text', { required: true, indexed: 'Yes (No Duplicates)' }], ['Season', 'Short Text', { lookup: { rowSourceType: 'Value List', rowSource: 'Major;Minor;All year' } }], ['PricePerKg', 'Currency', { validationRule: '>0' }]]);
  b.table('Plots', [['PlotID', 'AutoNumber', { primaryKey: true }], ['FarmerID', 'Number', { required: true }], ['Hectares', 'Number', { numberSize: 'Double' }], ['SoilType', 'Short Text', { lookup: { rowSourceType: 'Value List', rowSource: 'Loam;Clay;Sandy' } }], ['Irrigated', 'Yes/No']]);
  b.table('Harvests', [['HarvestID', 'AutoNumber', { primaryKey: true }], ['PlotID', 'Number', { required: true }], ['CropID', 'Number', { required: true }], ['HarvestDate', 'Date/Time', { required: true }], ['KgHarvested', 'Number', { validationRule: '>0' }], ['Organic', 'Yes/No']]);
  b.rel('Farmers', 'FarmerID', 'Plots', 'FarmerID'); b.rel('Plots', 'PlotID', 'Harvests', 'PlotID', true); b.rel('Crops', 'CropID', 'Harvests', 'CropID');
  b.layout({ Farmers: [30, 40], Plots: [280, 60], Harvests: [520, 60], Crops: [770, 40] });
  const regions: [string, string][] = [['Techiman', 'Bono East'], ['Ejura', 'Ashanti'], ['Hohoe', 'Volta'], ['Nkawkaw', 'Eastern'], ['Bolgatanga', 'Upper East'], ['Wenchi', 'Bono']];
  b.rows('Farmers', ['FirstName', 'LastName', 'Village', 'Region', 'Phone', 'JoinedYear'], Array.from({ length: 20 }, (_, i) => { const [v, g] = regions[i % regions.length]; return [FIRST[(i * 11 + 6) % FIRST.length], LAST[(i * 5 + 9) % LAST.length], v, g, `050${4000000 + i * 5151}`, 2008 + Math.floor(r() * 18)]; }));
  b.rows('Crops', ['CropName', 'Season', 'PricePerKg'], [['Maize', 'Major', 4.5], ['Cassava', 'All year', 2.2], ['Yam', 'Major', 6.8], ['Cocoa', 'Major', 48], ['Groundnut', 'Minor', 9.5], ['Rice', 'Major', 7.2], ['Tomato', 'Minor', 8.6], ['Plantain', 'All year', 5.4]]);
  b.rows('Plots', ['FarmerID', 'Hectares', 'SoilType', 'Irrigated'], Array.from({ length: 32 }, (_, i) => [1 + (i % 20), Math.round((0.5 + r() * 4.5) * 10) / 10, pick(r, ['Loam', 'Clay', 'Sandy']), r() > 0.7 ? 1 : 0]));
  b.rows('Harvests', ['PlotID', 'CropID', 'HarvestDate', 'KgHarvested', 'Organic'], Array.from({ length: 70 }, () => [1 + Math.floor(r() * 32), 1 + Math.floor(r() * 8), date(r, 2025, 2026), 100 + Math.floor(r() * 60) * 50, r() > 0.75 ? 1 : 0]));
  b.query('qryHarvestByCrop', 'select', (d, c) => { d.tables = b.t('Crops', 'Harvests'); d.totals = true; c('CropName', 'Crops'); c('KgHarvested', 'Harvests', { total: 'Sum', sort: 'Descending', alias: 'TotalKg' }); });
  b.query('qryFarmerPlots', 'select', (d, c) => { d.tables = b.t('Farmers', 'Plots'); c('LastName', 'Farmers', { sort: 'Ascending' }); c('FirstName', 'Farmers'); c('Village', 'Farmers'); c('Hectares', 'Plots'); c('SoilType', 'Plots'); });
  b.p.saveForm(autoForm(b.p, 'Farmers', 'frmFarmers'));
  b.p.saveReport(autoReport(b.p, 'qryFarmerPlots', 'rptPlotsByVillage', { groupBy: 'Village', fields: ['LastName', 'FirstName', 'Hectares', 'SoilType'], totals: ['Hectares'] }));
}
