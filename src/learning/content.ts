// Learning Mode content: topics, knowledge checks, guided practicals and
// sample-database exercises. Every practical step is verified against the
// actual database state (tables, fields, keys, records, saved objects, results).
import type { WowProject } from '@/engine/project';
import { runQuery, queryParameters } from '@/engine/queries';
import { q } from '@/engine/sqlite';

export type Check = (p: WowProject | null) => true | string;
export interface Quiz { q: string; options: string[]; answer: number; why: string; }
export interface Topic { id: string; title: string; body: string[]; points: string[]; tryIt?: string; quiz: Quiz[]; }
export interface Step { text: string; hint: string; check: Check; }
export interface Practical { id: string; title: string; level: 'Beginner' | 'Intermediate' | 'Advanced'; intro: string; sample?: string; steps: Step[]; modelAnswer?: string; }

// ---------------- helpers used by checks ----------------
const need = (p: WowProject | null): p is WowProject => !!p;
const NO_DB = 'Open or create a database first (File > New).';
export function table(p: WowProject, name: string) { return p.getTable(name); }
export function field(p: WowProject, t: string, f: string) { return p.getTable(t)?.fields.find((x) => x.name.toLowerCase() === f.toLowerCase()); }
function count(p: WowProject, t: string) { try { return Number(p.db.scalar(`SELECT count(*) FROM ${q(t)}`)); } catch { return 0; } }
function hasTable(name: string): Check { return (p) => !need(p) ? NO_DB : table(p, name) ? true : `There is no table called "${name}" yet. Use Create > Table Design, add fields, then save with the name ${name}.`; }
function hasField(t: string, f: string, type?: string): Check {
  return (p) => {
    if (!need(p)) return NO_DB;
    if (!table(p, t)) return `Create and save the table "${t}" first.`;
    const fd = field(p, t, f);
    if (!fd) return `The table "${t}" has no field called "${f}". Open it in Design View, add the field and save (Ctrl+S).`;
    if (type && fd.type !== type) return `"${f}" is a ${fd.type} field, but it should be ${type}. Change its Data Type in Design View and save.`;
    return true;
  };
}
function isPk(t: string, f: string): Check {
  return (p) => {
    if (!need(p)) return NO_DB;
    const fd = field(p, t, f);
    if (!fd) return `Add the field "${f}" to "${t}" first.`;
    if (!fd.primaryKey) return `"${f}" is not the primary key. Select its row in Design View and click Primary Key on the ribbon, then save.`;
    const others = p.getTable(t)!.fields.filter((x) => x.primaryKey && x.name.toLowerCase() !== fd.name.toLowerCase());
    if (others.length) return `The primary key also includes ${others.map((o) => o.name).join(', ')}. For this table the key should only be ${f}.`;
    return true;
  };
}
function minRecords(t: string, n: number): Check { return (p) => !need(p) ? NO_DB : count(p, t) >= n ? true : `"${t}" has ${count(p, t)} record(s). Open it in Datasheet View and enter at least ${n}.`; }
function hasRel(a: string, b: string, enforce = true): Check {
  return (p) => {
    if (!need(p)) return NO_DB;
    const r = p.relationships().find((x) => x.primaryTable.toLowerCase() === a.toLowerCase() && x.relatedTable.toLowerCase() === b.toLowerCase());
    if (!r) {
      const rev = p.relationships().find((x) => x.primaryTable.toLowerCase() === b.toLowerCase() && x.relatedTable.toLowerCase() === a.toLowerCase());
      if (rev) return `The relationship goes the wrong way. Drag from the primary key in ${a} to the matching field in ${b}.`;
      return `There is no relationship from ${a} to ${b}. Open Database Tools > Relationships, add both tables, and drag ${a}'s key onto the matching field in ${b}.`;
    }
    if (enforce && !r.enforce) return 'The relationship exists, but "Enforce Referential Integrity" is not ticked. Double-click the line to edit it.';
    return true;
  };
}
function queryReturns(name: string, expectedSql: string, params: Record<string, unknown> = {}, opts: { orderMatters?: boolean } = {}): Check {
  return (p) => {
    if (!need(p)) return NO_DB;
    const qd = p.getQuery(name);
    if (!qd) return `Save your query with the name "${name}" (Ctrl+S in the query).`;
    let got: unknown[][];
    try { got = runQuery(p, qd, params).rows; } catch (e) { return `The query "${name}" does not run: ${(e as Error).message}`; }
    let want: unknown[][];
    try { want = p.db.query(expectedSql).rows; } catch (e) { return 'Checker error: ' + (e as Error).message; }
    const norm = (rows: unknown[][]) => rows.map((r) => r.map((v) => (typeof v === 'number' ? Math.round(v * 100) / 100 : String(v ?? '').toLowerCase())).join('|'));
    const g = norm(got), w = norm(want);
    if (g.length !== w.length) return `Your query returns ${g.length} row(s) but ${w.length} were expected. Check your criteria${opts.orderMatters ? ' and sort order' : ''}.`;
    if (opts.orderMatters) { if (g.join('\n') !== w.join('\n')) return 'The rows are right but not in the expected order (or columns differ). Check Sort and the order of fields.'; }
    else if ([...g].sort().join('\n') !== [...w].sort().join('\n')) return 'Your query returns the right number of rows, but different values. Check which fields are shown and the order of the columns.';
    return true;
  };
}
function hasObject(type: string, name: string, extra?: (def: Record<string, unknown>) => true | string): Check {
  return (p) => {
    if (!need(p)) return NO_DB;
    const o = p.getObject<Record<string, unknown>>(type, name);
    if (!o) return `Save a ${type} named "${name}".`;
    return extra ? extra(o.def) : true;
  };
}

// ---------------- topics ----------------
export const TOPICS: Topic[] = [
  { id: 'intro', title: 'Introduction to databases', body: ['A database is an organised collection of related data stored so it can be searched, sorted and updated quickly.', 'A relational database stores data in tables that are linked by keys. DBWOW uses SQLite, the same relational engine used inside phones, browsers and many applications.', 'A database management system (DBMS) is the software that lets you create the structure, enter data, ask questions (queries) and produce output (forms and reports).'], points: ['Data is stored once and reused', 'Tables are linked by key fields', 'Queries ask questions; forms enter data; reports present data'], tryIt: 'Open the School Management sample and look at each object in the Navigation Pane.', quiz: [{ q: 'Which object is mainly used to enter and edit one record at a time?', options: ['Report', 'Form', 'Query', 'Relationship'], answer: 1, why: 'Forms are designed for data entry and editing. Reports present data for printing.' }, { q: 'What does a relational database use to connect tables?', options: ['Colours', 'Key fields', 'File names', 'Fonts'], answer: 1, why: 'Primary keys and foreign keys link related records in different tables.' }] },
  { id: 'terms', title: 'Database terminology', body: ['Table: a collection of data about one type of thing (an entity), such as Students.', 'Record (row): all the data about one item, e.g. one student.', 'Field (column): one attribute of every record, e.g. LastName.', 'Data type: the kind of value a field can hold, such as text, number or date.'], points: ['Entity → table', 'Attribute → field', 'Instance → record'], quiz: [{ q: 'In a Students table, what is "DateOfBirth"?', options: ['A record', 'A field', 'A table', 'A query'], answer: 1, why: 'DateOfBirth is an attribute stored for every student, so it is a field (column).' }, { q: 'One row in a table is called a…', options: ['Field', 'Record', 'Key', 'Index'], answer: 1, why: 'A row holds all the data about one item: a record.' }] },
  { id: 'tables', title: 'Tables, records and fields', body: ['Create tables in Design View (Create > Table Design) to control every field, or in Datasheet View (Create > Table) to start typing straight away.', 'Every field needs a unique name within its table and a data type. Use the Description column to document what the field stores.', 'Records are entered in Datasheet View. The row marked * is the new-record row.'], points: ['Design View = structure', 'Datasheet View = data', 'Save the design with Ctrl+S'], tryIt: 'Create > Table Design, add three fields and switch to Datasheet View.', quiz: [{ q: 'Which view lets you change a field\'s data type?', options: ['Datasheet View', 'Design View', 'Print Preview', 'Form View'], answer: 1, why: 'The structure (field names, types and properties) is edited in Design View.' }] },
  { id: 'types', title: 'Data types', body: ['Short Text: up to 255 characters (names, phone numbers, codes). Phone numbers are text because they can start with 0 and are not calculated.', 'Long Text: notes and comments. Number: values used in calculations, with a Field Size (Byte, Integer, Long Integer, Single, Double).', 'Date/Time, Currency (money), AutoNumber (unique counter), Yes/No (Boolean), Hyperlink, Attachment and Calculated fields are also available.'], points: ['Choose the smallest suitable type', 'Use Currency for money', 'Store phone numbers as Short Text'], quiz: [{ q: 'Which data type is best for a telephone number such as 0244123456?', options: ['Number', 'Short Text', 'Currency', 'AutoNumber'], answer: 1, why: 'Leading zeros would be lost in a Number field, and phone numbers are never used in calculations.' }, { q: 'Which type automatically gives each new record a unique number?', options: ['AutoNumber', 'Number', 'Yes/No', 'Lookup'], answer: 0, why: 'AutoNumber is generated by the database for each new record.' }] },
  { id: 'pk', title: 'Primary keys', body: ['A primary key is a field (or combination of fields) that uniquely identifies each record. It can never be empty and can never repeat.', 'In DBWOW the engine enforces this: try typing a duplicate key value and the record is rejected.', 'A composite key uses two or more fields together, e.g. OrderID + ProductID in OrderDetails.'], points: ['Unique and not null', 'Often an AutoNumber', 'Composite keys combine fields'], tryIt: 'In the Shop sample open OrderDetails in Design View: two fields carry the key icon.', quiz: [{ q: 'Why is StudentName a poor primary key?', options: ['It is too long', 'Two students can have the same name', 'Text cannot be a key', 'It is not a number'], answer: 1, why: 'A primary key must be unique for every record, and names can repeat.' }] },
  { id: 'fk', title: 'Foreign keys', body: ['A foreign key is a field in one table that stores the primary key value of a record in another table.', 'Students.ClassID is a foreign key: it holds the ClassID of the class the student belongs to.', 'The data types must match: an AutoNumber primary key matches a Number (Long Integer) foreign key.'], points: ['Foreign key → points to a primary key', 'Types must match', 'Many records can share one foreign key value'], quiz: [{ q: 'Students.ClassID refers to Classes.ClassID. Which is the foreign key?', options: ['Classes.ClassID', 'Students.ClassID', 'Both', 'Neither'], answer: 1, why: 'The field in the "many" table that refers to another table\'s key is the foreign key.' }] },
  { id: 'rel', title: 'Relationships', body: ['Relationships tell the database how tables are connected. Create them in Database Tools > Relationships by dragging a primary key onto the matching foreign key.', 'DBWOW turns an enforced relationship into a real SQLite FOREIGN KEY constraint.', 'The lines show 1 at the primary-key end and ∞ at the foreign-key end.'], points: ['Drag key → matching field', 'Lines show 1 and ∞', 'Double-click a line to edit it'], tryIt: 'Open the Relationships window of any sample and drag a table to see the lines follow.', quiz: [{ q: 'On a one-to-many line, where does the ∞ appear?', options: ['At the primary key table', 'At the foreign key (many) table', 'In the middle', 'Nowhere'], answer: 1, why: 'The infinity symbol marks the "many" side, the table holding the foreign key.' }] },
  { id: 'one2one', title: 'One-to-one relationships', body: ['Each record in table A matches at most one record in table B, and the other way round.', 'Both sides are joined on a primary key or a unique index. Example: Employees and EmployeeSecurityDetails kept separate for privacy.'], points: ['Both sides unique', 'Often used to split sensitive or optional data'], quiz: [{ q: 'When does DBWOW show a relationship as One-To-One?', options: ['When both joined fields are unique', 'When the tables have one field', 'Always', 'When integrity is off'], answer: 0, why: 'If both sides are primary keys or unique indexes, each record can match only one record.' }] },
  { id: 'one2many', title: 'One-to-many relationships', body: ['The most common relationship: one class has many students, but each student belongs to one class.', 'The "one" side uses its primary key; the "many" side stores it as a foreign key.'], points: ['Primary key on the one side', 'Foreign key on the many side'], quiz: [{ q: 'One customer places many orders. Where does CustomerID go as a foreign key?', options: ['Customers', 'Orders', 'Both as primary keys', 'A new Products table'], answer: 1, why: 'The many side (Orders) stores the key of the one side (Customers).' }] },
  { id: 'many2many', title: 'Many-to-many relationships', body: ['A student takes many subjects and a subject has many students. A relational database represents this with a junction (link) table.', 'The junction table (Enrolments) holds two foreign keys, StudentID and SubjectID, and forms two one-to-many relationships.', 'In the Relationships window use "Junction Table" to create one automatically.'], points: ['Needs a junction table', 'Two one-to-many relationships', 'Junction can store extra data like EnrolDate'], quiz: [{ q: 'How is a many-to-many relationship implemented?', options: ['One huge table', 'A junction table with two foreign keys', 'Two primary keys in each table', 'It cannot be done'], answer: 1, why: 'The junction table breaks it into two one-to-many relationships.' }] },
  { id: 'ri', title: 'Referential integrity', body: ['Referential integrity means every foreign key value must match an existing primary key value.', 'With it enforced, DBWOW rejects a student whose ClassID does not exist, and stops you deleting a class that still has students.', 'Cascade Update changes related foreign keys when a primary key changes. Cascade Delete deletes related records automatically: use it carefully.'], points: ['No orphan records', 'Cascade Update / Cascade Delete', 'Enforced by the SQLite engine'], tryIt: 'In the School sample try typing ClassID 99 for a student: the engine refuses it.', quiz: [{ q: 'With referential integrity enforced (no cascade), what happens when you delete a class that has students?', options: ['Students are deleted too', 'The delete is refused', 'The students\' ClassID becomes 0', 'Nothing'], answer: 1, why: 'The engine blocks deletes that would leave orphan records unless Cascade Delete is ticked.' }] },
  { id: 'queries', title: 'Queries', body: ['A query asks the database a question and returns the matching records. Build them by dragging fields into the design grid, or write SQL directly.', 'Criteria such as >50, Like "A*", Between 1 And 10, Is Null or [Enter class] (a parameter) filter the results. Criteria on the same row are combined with AND; criteria on the "or" rows are combined with OR.', 'Action queries change data: Make Table, Append, Update and Delete. DBWOW tells you how many rows will be affected before running them.'], points: ['Same row = AND', 'Different rows = OR', '[Text in brackets] = parameter'], tryIt: 'Open qryStudentsByClass in Design View, then switch to SQL View to see the SQL it generates.', quiz: [{ q: 'Which criteria finds names starting with K?', options: ['= K', 'Like "K*"', '>K', 'Is K'], answer: 1, why: 'Like with the * wildcard matches any characters after K.' }, { q: 'What does [Enter town] in the Criteria row create?', options: ['A field', 'A parameter prompt', 'A table', 'An error'], answer: 1, why: 'Text in square brackets that is not a field name becomes a parameter the user is asked for.' }] },
  { id: 'sortfilter', title: 'Sorting and filtering', body: ['Sorting puts records in order (ascending A→Z, 0→9 or descending). Filtering hides records that do not match a condition.', 'In Datasheet View use Home > Sort and Filter, or right-click a value and choose "Filter by selection".', 'A filter is temporary; a query saves the question so it can be reused.'], points: ['Ascending / descending', 'Filter by selection', 'Toggle filter on/off'], quiz: [{ q: 'Sorting surnames ascending puts which first?', options: ['Zulu', 'Addo', 'Mensah', 'Random'], answer: 1, why: 'Ascending text order is A to Z.' }] },
  { id: 'forms', title: 'Forms', body: ['Forms provide a user-friendly way to view, enter and edit records. Each control can be bound to a field (Control Source).', 'Design forms by dragging controls from the toolbox or fields from the Field List. Labels describe; text boxes, combo boxes and check boxes hold data; buttons run actions.', 'A subform shows related records, e.g. a class with its students, linked by Link Master/Child Fields.'], points: ['Bound vs unbound controls', 'Combo boxes for lookups', 'Subforms for one-to-many data'], tryIt: 'Open frmClassesWithStudents in the School sample and move between classes.', quiz: [{ q: 'Which property binds a text box to a field?', options: ['Caption', 'Control Source', 'Name', 'Tab Index'], answer: 1, why: 'Control Source names the field (or expression) the control displays.' }] },
  { id: 'reports', title: 'Reports', body: ['Reports present data for printing or PDF. They have Report Header/Footer (once), Page Header/Footer (every page), group headers/footers and the Detail section (once per record).', 'Use Group & Sort to group records (e.g. by class) and add totals with expressions such as =Sum([FeePaid]) or =Count(*).', '[Page] and [Pages] give page numbers: ="Page " & [Page] & " of " & [Pages].'], points: ['Detail repeats per record', 'Group footers for subtotals', 'Print Preview and PDF export'], quiz: [{ q: 'Where should a grand total go?', options: ['Detail', 'Page Header', 'Report Footer', 'Form Header'], answer: 2, why: 'The Report Footer prints once at the end, after all records.' }] },
  { id: 'validation', title: 'Validation rules', body: ['A validation rule limits what can be entered in a field, e.g. Between 0 And 100, >=0, In ("M","F") or <Date(). Validation Text is the message shown when the rule is broken.', 'Required = Yes means the field cannot be left empty. Field Size limits text length.', 'In DBWOW rules become real CHECK constraints or triggers, so data typed in SQL is checked too.'], points: ['Validation Rule + Validation Text', 'Required', 'Field Size'], tryIt: 'In the School sample enter a Score of 120 in Results.', quiz: [{ q: 'Which rule allows only scores from 0 to 100?', options: ['>100', 'Between 0 And 100', 'Like 100', 'In (0,100)'], answer: 1, why: 'Between includes both end values.' }] },
  { id: 'normal', title: 'Normalisation', body: ['Normalisation organises tables to reduce duplicated data and update problems.', '1NF: every field holds one value; no repeating groups. 2NF: every non-key field depends on the whole key. 3NF: no non-key field depends on another non-key field.', 'Example: storing ClassName and ClassTeacher in every Students record repeats data; move them to a Classes table and store ClassID instead.'], points: ['1NF atomic values', '2NF whole key', '3NF nothing but the key'], quiz: [{ q: 'A Students table stores TeacherName for each student\'s class. What should you do?', options: ['Nothing', 'Move class details to a Classes table and link with ClassID', 'Delete the students', 'Make TeacherName the primary key'], answer: 1, why: 'TeacherName depends on the class, not the student: that breaks 3NF.' }] },
  { id: 'sql', title: 'SQL fundamentals', body: ['SQL (Structured Query Language) is the standard language for relational databases. Every DBWOW query has SQL behind it: use SQL View to read or edit it.', 'SELECT fields FROM table WHERE condition ORDER BY field; JOIN combines tables; GROUP BY with SUM/AVG/COUNT summarises; HAVING filters groups.', 'INSERT, UPDATE and DELETE change data. Values are always passed to SQLite as parameters, protecting against SQL injection.'], points: ['SELECT … FROM … WHERE … ORDER BY', 'JOIN … ON', 'GROUP BY / HAVING'], tryIt: 'Create > SQL Query and run: SELECT Town, COUNT(*) FROM Students GROUP BY Town', quiz: [{ q: 'Which clause filters groups after GROUP BY?', options: ['WHERE', 'HAVING', 'ORDER BY', 'FROM'], answer: 1, why: 'WHERE filters rows before grouping; HAVING filters the groups.' }, { q: 'Which statement changes existing records?', options: ['SELECT', 'INSERT', 'UPDATE', 'CREATE'], answer: 2, why: 'UPDATE modifies existing rows.' }] },
  { id: 'security', title: 'Database security', body: ['Protect data with backups (File > Backup), validation, referential integrity and limited permissions.', 'SQL injection happens when user text is pasted into SQL. DBWOW always binds values as parameters and protects its system tables.', 'Personal data must be protected and used fairly: the samples use only fictional people.'], points: ['Back up regularly', 'Parameters, not string concatenation', 'Fictional data for practice'], quiz: [{ q: 'What is the safest way to put a user\'s input into SQL?', options: ['Join strings', 'Use a parameter', 'Upper-case it', 'Remove spaces'], answer: 1, why: 'Parameters keep data separate from SQL code, which prevents injection.' }] },
  { id: 'interchange', title: 'Data import and export', body: ['External Data > Import brings CSV, Excel, JSON or SQL into a new or existing table. The wizard previews data, detects headers, suggests data types, maps fields, finds duplicates and invalid values.', 'Rows that cannot be imported are listed with the reason and can be downloaded; nothing is silently discarded.', 'Export tables or query results to CSV, Excel, JSON or SQL; export reports to PDF.'], points: ['Preview before importing', 'Check the import summary', 'Export for other programs'], quiz: [{ q: 'An imported row has "abc" in a Number column. What does DBWOW do?', options: ['Silently skips it', 'Imports 0', 'Reports the row as failed with the reason', 'Crashes'], answer: 2, why: 'Invalid rows are listed in the import summary so you can fix them.' }] },
];

// ---------------- guided practicals ----------------
export const PRACTICALS: Practical[] = [
  {
    id: 'schooldb', title: 'Create a Student Database', level: 'Beginner',
    intro: 'Build a new database from scratch and check each step against the real database.',
    steps: [
      { text: 'Create a new blank database called SchoolDB.', hint: 'File > New > Blank database, type SchoolDB.', check: (p) => !p ? NO_DB : p.name.trim().toLowerCase() === 'schooldb' ? true : `The open database is called "${p.name}". Create a new blank database named SchoolDB (or rename it in File > Database Properties).` },
      { text: 'Create a table called Students (Create > Table Design) and save it.', hint: 'Add at least one field, press Ctrl+S and type Students.', check: hasTable('Students') },
      { text: 'Add a field StudentID.', hint: 'Type StudentID in the Field Name column.', check: hasField('Students', 'StudentID') },
      { text: 'Set the data type of StudentID to AutoNumber.', hint: 'Choose AutoNumber in the Data Type column and save.', check: hasField('Students', 'StudentID', 'AutoNumber') },
      { text: 'Make StudentID the primary key.', hint: 'Click the row selector of StudentID, then Primary Key on the ribbon. Save.', check: isPk('Students', 'StudentID') },
      { text: 'Add FirstName (Short Text).', hint: 'New row: FirstName, Short Text.', check: hasField('Students', 'FirstName', 'Short Text') },
      { text: 'Add LastName (Short Text).', hint: 'New row: LastName, Short Text.', check: hasField('Students', 'LastName', 'Short Text') },
      { text: 'Add DateOfBirth (Date/Time).', hint: 'New row: DateOfBirth, Date/Time.', check: hasField('Students', 'DateOfBirth', 'Date/Time') },
      { text: 'Add ClassID (Number).', hint: 'New row: ClassID, Number (Long Integer).', check: hasField('Students', 'ClassID', 'Number') },
      { text: 'Save the table design.', hint: 'Press Ctrl+S. The tab loses its * when saved.', check: (p) => { if (!p) return NO_DB; const t = table(p, 'Students'); return t && ['StudentID', 'FirstName', 'LastName', 'DateOfBirth', 'ClassID'].every((f) => field(p, 'Students', f)) ? true : 'Some fields are not saved yet. Press Ctrl+S in the table design.'; } },
      { text: 'Enter five student records.', hint: 'Switch to Datasheet View and type in the * row. Use ClassID values such as 1 and 2.', check: minRecords('Students', 5) },
      { text: 'Create a query named qryStudentsInClass that shows students in a class you type in.', hint: 'Create > Query Design, add Students, drag FirstName, LastName and ClassID to the grid, type [Enter ClassID] in ClassID\'s Criteria, save as qryStudentsInClass.', check: (p) => {
        if (!p) return NO_DB;
        const qd = p.getQuery('qryStudentsInClass');
        if (!qd) return 'Save a query named qryStudentsInClass.';
        const params = queryParameters(p, qd.sql);
        if (!params.length) return 'The query should ask for the class. Put a parameter such as [Enter ClassID] in the Criteria row under ClassID.';
        const classId = p.db.scalar('SELECT ClassID FROM Students WHERE ClassID IS NOT NULL LIMIT 1');
        if (classId === undefined) return 'Give your students ClassID values first.';
        try {
          const r = runQuery(p, qd, { [params[0]]: classId });
          const expected = Number(p.db.scalar('SELECT count(*) FROM Students WHERE ClassID = ?', [classId as number]));
          return r.rows.length === expected ? true : `For ClassID ${classId} your query returned ${r.rows.length} row(s) but there are ${expected} student(s) in that class. Check the criteria is under ClassID.`;
        } catch (e) { return 'The query does not run: ' + (e as Error).message; }
      } },
    ],
    modelAnswer: 'SELECT FirstName, LastName, ClassID FROM Students WHERE ClassID = [Enter ClassID];',
  },
  {
    id: 'relationships', title: 'Link Students to Classes', level: 'Intermediate',
    intro: 'Continue SchoolDB: add a Classes table and enforce referential integrity.',
    steps: [
      { text: 'Create a table Classes with ClassID (AutoNumber, primary key) and ClassName (Short Text).', hint: 'Create > Table Design. Save as Classes.', check: (p) => { const a = isPk('Classes', 'ClassID')(p); if (a !== true) return a; return hasField('Classes', 'ClassName', 'Short Text')(p); } },
      { text: 'Enter classes so that every ClassID used in Students exists in Classes.', hint: 'Open Classes in Datasheet View and add records 1, 2, …', check: (p) => { if (!p) return NO_DB; if (!table(p, 'Classes') || !table(p, 'Students')) return 'Both tables are needed.'; const n = Number(p.db.scalar('SELECT count(*) FROM Students s WHERE s.ClassID IS NOT NULL AND NOT EXISTS (SELECT 1 FROM Classes c WHERE c.ClassID = s.ClassID)')); return n === 0 ? true : `${n} student(s) have a ClassID that is not in Classes. Add those classes first.`; } },
      { text: 'Create a one-to-many relationship Classes.ClassID → Students.ClassID with referential integrity enforced.', hint: 'Database Tools > Relationships. Drag ClassID from Classes onto ClassID in Students, tick Enforce Referential Integrity, Create.', check: hasRel('Classes', 'Students') },
      { text: 'Prove it works: the engine must now refuse a student whose ClassID does not exist.', hint: 'Nothing to do: DBWOW tests this for you.', check: (p) => { if (!p) return NO_DB; const rel = hasRel('Classes', 'Students')(p); if (rel !== true) return 'Finish the relationship step first: ' + rel; try { p.db.raw.run('SAVEPOINT chk'); try { p.db.raw.run('INSERT INTO Students (FirstName, LastName, ClassID) VALUES (\'Test\', \'Test\', 999999)'); return 'A student with ClassID 999999 was accepted. Make sure the relationship enforces referential integrity.'; } catch (e) { return /foreign key/i.test(String((e as Error).message ?? e)) ? true : 'The test record was refused for another reason (' + String((e as Error).message ?? e) + '). Check that Students has FirstName, LastName and ClassID.'; } finally { p.db.raw.run('ROLLBACK TO chk'); p.db.raw.run('RELEASE chk'); } } catch (e) { return String(e); } } },
    ],
  },
  {
    id: 'formreport', title: 'Data-entry form and grouped report', level: 'Intermediate',
    intro: 'Use the School Management sample (File > New > School Management).', sample: 'school',
    steps: [
      { text: 'Create a form named frmStudentEntry bound to Students.', hint: 'Create > Form Design, set Record Source to Students in the Property Sheet, save as frmStudentEntry.', check: hasObject('form', 'frmStudentEntry', (d) => String(d.recordSource).toLowerCase() === 'students' ? true : 'Set the form\'s Record Source to Students.') },
      { text: 'Add a text box bound to FirstName, a text box bound to LastName and a combo box bound to ClassID.', hint: 'Drag the fields from the Field List (Add Existing Fields), or add controls and set Control Source.', check: hasObject('form', 'frmStudentEntry', (d) => { const c = (d.controls as { type: string; props: Record<string, unknown> }[]); const b = (f: string, t?: string) => c.some((x) => String(x.props.controlSource ?? '').toLowerCase() === f.toLowerCase() && (!t || x.type === t)); if (!b('FirstName')) return 'No control is bound to FirstName.'; if (!b('LastName')) return 'No control is bound to LastName.'; if (!b('ClassID', 'combobox')) return 'Add a Combo Box with Control Source ClassID (Row Source: Classes).'; return true; }) },
      { text: 'Add a command button that goes to a new record.', hint: 'Toolbox > Command Button. In the Property Sheet (Event tab) set On Click to New Record.', check: hasObject('form', 'frmStudentEntry', (d) => (d.controls as { type: string; props: Record<string, unknown> }[]).some((x) => x.type === 'button' && x.props.onClick === 'New Record') ? true : 'No button has On Click = New Record.') },
      { text: 'Create a report named rptStudentsPerTown grouped by Town with a count in the group footer.', hint: 'Create > Report Wizard (group by Town) or Report Design: Group & Sort > Add a group on Town with a footer, put =Count(*) in the footer.', check: hasObject('report', 'rptStudentsPerTown', (d) => { const g = (d.groups as { field: string; footer: boolean }[]) ?? []; if (!g.some((x) => x.field.toLowerCase() === 'town')) return 'The report is not grouped on Town.'; const secs = d.sections as { id: string; kind: string }[]; const footers = secs.filter((s) => s.kind === 'groupFooter').map((s) => s.id); const ok = (d.controls as { section: string; props: Record<string, unknown> }[]).some((c) => footers.includes(c.section) && /count\s*\(/i.test(String(c.props.controlSource ?? ''))); return ok ? true : 'Add a text box with =Count(*) in the Town Footer section.'; }) },
    ],
  },
  {
    id: 'sqlbasics', title: 'SQL practice', level: 'Advanced', sample: 'school',
    intro: 'Use the School Management sample. Write each query in SQL View and save it.',
    steps: [
      { text: 'qrySQL1: list FirstName and LastName of students from Kumasi, sorted by LastName.', hint: 'SELECT FirstName, LastName FROM Students WHERE Town = \'Kumasi\' ORDER BY LastName', check: queryReturns('qrySQL1', "SELECT FirstName, LastName FROM Students WHERE Town = 'Kumasi' ORDER BY LastName", {}, { orderMatters: false }) },
      { text: 'qrySQL2: number of students in each class (ClassName, count).', hint: 'Join Classes and Students and GROUP BY ClassName.', check: queryReturns('qrySQL2', 'SELECT c.ClassName, COUNT(*) FROM Classes c JOIN Students s ON s.ClassID = c.ClassID GROUP BY c.ClassName') },
      { text: 'qrySQL3: subjects whose average score is above 65 (SubjectName, average).', hint: 'Use GROUP BY and HAVING AVG(Score) > 65.', check: queryReturns('qrySQL3', 'SELECT sb.SubjectName, AVG(r.Score) FROM Subjects sb JOIN Enrolments e ON e.SubjectID = sb.SubjectID JOIN Results r ON r.EnrolmentID = e.EnrolmentID GROUP BY sb.SubjectName HAVING AVG(r.Score) > 65') },
    ],
    modelAnswer: "SELECT sb.SubjectName, AVG(r.Score) AS AvgScore\nFROM Subjects sb\n  JOIN Enrolments e ON e.SubjectID = sb.SubjectID\n  JOIN Results r ON r.EnrolmentID = e.EnrolmentID\nGROUP BY sb.SubjectName\nHAVING AVG(r.Score) > 65;",
  },
];

// ---------------- sample database exercises ----------------
export const SAMPLE_EXERCISES: Practical[] = [
  { id: 'lib-b', sample: 'library', level: 'Beginner', title: 'Library: books after 2010', intro: 'Library Management sample.', steps: [{ text: 'Create qryRecentBooks listing Title and YearPublished for books published after 2010.', hint: 'Criteria >2010 under YearPublished.', check: queryReturns('qryRecentBooks', 'SELECT Title, YearPublished FROM Books WHERE YearPublished > 2010') }] },
  { id: 'lib-i', sample: 'library', level: 'Intermediate', title: 'Library: loans per member', intro: 'Library Management sample.', steps: [{ text: 'Create qryLoansPerMember showing LastName and the number of loans per member (Totals: Group By LastName, Count of LoanID).', hint: 'Add Members and Loans, click Totals.', check: queryReturns('qryLoansPerMember', 'SELECT m.LastName, COUNT(l.LoanID) FROM Members m JOIN Loans l ON l.MemberID = m.MemberID GROUP BY m.LastName') }] },
  { id: 'lib-a', sample: 'library', level: 'Advanced', title: 'Library: overdue loans', intro: 'Library Management sample.', steps: [{ text: 'Create qryOverdue listing Title and DueDate for loans not returned with DueDate before #2026-07-01#.', hint: 'Returned = No and DueDate < #2026-07-01# on the same criteria row.', check: queryReturns('qryOverdue', "SELECT b.Title, l.DueDate FROM Books b JOIN Loans l ON l.BookID = b.BookID WHERE l.Returned = 0 AND l.DueDate < '2026-07-01'") }] },
  { id: 'hos-b', sample: 'hospital', level: 'Beginner', title: 'Hospital: insured patients', intro: 'Hospital Management sample.', steps: [{ text: 'Create qryInsured listing FirstName, LastName of insured patients.', hint: 'Criteria Yes under Insured; untick Show.', check: queryReturns('qryInsured', 'SELECT FirstName, LastName FROM Patients WHERE Insured = 1') }] },
  { id: 'hos-i', sample: 'hospital', level: 'Intermediate', title: 'Hospital: appointments per doctor', intro: 'Hospital Management sample.', steps: [{ text: 'Create qryDoctorLoad: Doctors.LastName and count of appointments.', hint: 'Totals query with Count.', check: queryReturns('qryDoctorLoad', 'SELECT d.LastName, COUNT(a.AppointmentID) FROM Doctors d JOIN Appointments a ON a.DoctorID = d.DoctorID GROUP BY d.LastName') }] },
  { id: 'hos-a', sample: 'hospital', level: 'Advanced', title: 'Hospital: revenue over 1000', intro: 'Hospital Management sample.', steps: [{ text: 'Create qryBusyDepartments: DepartmentName and total Fee, only departments whose total Fee is over 1000.', hint: 'Criteria >1000 under the Sum of Fee column.', check: queryReturns('qryBusyDepartments', 'SELECT dp.DepartmentName, SUM(a.Fee) FROM Departments dp JOIN Doctors d ON d.DepartmentID = dp.DepartmentID JOIN Appointments a ON a.DoctorID = d.DoctorID GROUP BY dp.DepartmentName HAVING SUM(a.Fee) > 1000') }] },
  { id: 'shop-b', sample: 'shop', level: 'Beginner', title: 'Shop: electronics', intro: 'Shop Inventory sample.', steps: [{ text: 'Create qryElectronics listing ProductName and UnitPrice of products in the Electronics category.', hint: 'Criteria "Electronics" under Category.', check: queryReturns('qryElectronics', "SELECT ProductName, UnitPrice FROM Products WHERE Category = 'Electronics'") }] },
  { id: 'shop-i', sample: 'shop', level: 'Intermediate', title: 'Shop: Mobile Money orders', intro: 'Shop Inventory sample.', steps: [{ text: 'Create qryMomoOrders listing OrderID and CustomerName for orders paid by Mobile Money.', hint: 'Join Customers and Orders.', check: queryReturns('qryMomoOrders', "SELECT o.OrderID, c.CustomerName FROM Customers c JOIN Orders o ON o.CustomerID = c.CustomerID WHERE o.PaymentMethod = 'Mobile Money'") }] },
  { id: 'shop-a', sample: 'shop', level: 'Advanced', title: 'Shop: order totals', intro: 'Shop Inventory sample.', steps: [{ text: 'Create qryOrderTotals: OrderID and the Sum of LineTotal for each order.', hint: 'Totals query on OrderDetails.', check: queryReturns('qryOrderTotals', 'SELECT OrderID, SUM(LineTotal) FROM OrderDetails GROUP BY OrderID') }] },
  { id: 'emp-b', sample: 'employee', level: 'Beginner', title: 'Employees: part-time staff', intro: 'Employee Management sample.', steps: [{ text: 'Create qryPartTime listing FirstName and LastName of employees who are not FullTime.', hint: 'Criteria No under FullTime.', check: queryReturns('qryPartTime', 'SELECT FirstName, LastName FROM Employees WHERE FullTime = 0') }] },
  { id: 'emp-i', sample: 'employee', level: 'Intermediate', title: 'Employees: staff per department', intro: 'Employee Management sample.', steps: [{ text: 'Create qryHeadcount: DepartmentName and number of employees.', hint: 'Totals: Count of EmployeeID.', check: queryReturns('qryHeadcount', 'SELECT d.DepartmentName, COUNT(e.EmployeeID) FROM Departments d JOIN Employees e ON e.DepartmentID = d.DepartmentID GROUP BY d.DepartmentName') }] },
  { id: 'emp-a', sample: 'employee', level: 'Advanced', title: 'Employees: latest salary', intro: 'Employee Management sample.', steps: [{ text: 'Create qryLatestSalary: EmployeeID and the Max of Amount for each employee.', hint: 'Totals query on Salaries with Max.', check: queryReturns('qryLatestSalary', 'SELECT EmployeeID, MAX(Amount) FROM Salaries GROUP BY EmployeeID') }] },
  { id: 'sch-b', sample: 'school', level: 'Beginner', title: 'School: students from Accra', intro: 'School Management sample.', steps: [{ text: 'Create qryAccra listing FirstName, LastName, Town of students whose Town is Accra.', hint: 'Criteria Accra under Town.', check: queryReturns('qryAccra', "SELECT FirstName, LastName, Town FROM Students WHERE Town = 'Accra'") }] },
  { id: 'sch-i', sample: 'school', level: 'Intermediate', title: 'School: girls in JHS classes', intro: 'School Management sample.', steps: [{ text: 'Create qryJhsGirls: FirstName, ClassName for female students in classes whose name starts with JHS.', hint: 'Gender = "F" and ClassName Like "JHS*" on the same row.', check: queryReturns('qryJhsGirls', "SELECT s.FirstName, c.ClassName FROM Students s JOIN Classes c ON c.ClassID = s.ClassID WHERE s.Gender = 'F' AND c.ClassName LIKE 'JHS%'") }] },
  { id: 'sch-a', sample: 'school', level: 'Advanced', title: 'School: top scores', intro: 'School Management sample.', steps: [{ text: 'Create qryTopScores: StudentID and Max Score for students whose highest score is at least 95.', hint: 'Join Enrolments and Results; Group By StudentID; Max of Score with criteria >=95.', check: queryReturns('qryTopScores', 'SELECT e.StudentID, MAX(r.Score) FROM Enrolments e JOIN Results r ON r.EnrolmentID = e.EnrolmentID GROUP BY e.StudentID HAVING MAX(r.Score) >= 95') }] },
];

// ---------------- progress (per learner, per browser) ----------------
export interface Progress { quizzes: Record<string, number>; steps: Record<string, boolean>; }
export function loadProgress(): Progress {
  try { const s = localStorage.getItem('wowdb.learning'); if (s) return JSON.parse(s) as Progress; } catch { /* ignore */ }
  return { quizzes: {}, steps: {} };
}
export function saveProgress(p: Progress) { try { localStorage.setItem('wowdb.learning', JSON.stringify(p)); } catch { /* ignore */ } }

/** Contextual tips shown in Learning Mode for each kind of editor. */
export const CONTEXT_TIPS: Record<string, string> = {
  'table-design': 'Design View: each row is a field. Choose a Data Type, then set properties below. Click a row selector and press Primary Key to make it the key. Ctrl+S saves the structure.',
  'table-datasheet': 'Datasheet View: type in the * row to add a record. Values are checked by the database engine as you leave the row.',
  'query-design': 'Drag fields from the table boxes into the grid. Criteria on the same row are joined with AND, different rows with OR. Click Run to see results, or SQL View to see the SQL.',
  'query-sql': 'SQL View: write SQL and click Run. Saved SELECT queries become database views you can use in other queries, forms and reports.',
  'query-datasheet': 'These are live results from the database. Switch back to Design View to change the question.',
  relationships: 'Drag a primary key (🔑) onto the matching field in another table. Tick Enforce Referential Integrity so the engine prevents orphan records.',
  'form-design': 'Drag controls from the toolbox or fields from the Field List. Select a control to edit it in the Property Sheet. Shift+click selects several.',
  'form-view': 'Form View: changes are saved when you move to another record or press Save Record.',
  'report-design': 'Each band repeats differently: Detail once per record, Page Header on every page, Group Footer after each group. Use =Sum([Field]) for totals.',
  'report-preview': 'Print Preview shows the exact pages. Use Export PDF or Print on the ribbon.',
};
