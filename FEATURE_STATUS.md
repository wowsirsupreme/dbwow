# WOWDB Feature Status

Status key:

* **Tested**: implemented and covered by an automated test (Vitest engine tests and/or Playwright browser tests).
* **Implemented**: implemented and checked by hand in the running app, but without its own automated test.
* **Partial**: works, with the limitation stated.
* **Not implemented**: not available in this release.

Last updated: 30 October 2026. Automated results: 45/45 engine tests, 10/10 acceptance steps and 12/12 feature steps passing on both the portable and the Next.js builds.

## Application shell

| Feature | Status | Notes |
|---|---|---|
| Title bar, Quick Access Toolbar (Save, Undo, Redo), save indicator | Tested | |
| Ribbon: File, Home, Create, External Data, Database Tools, Help | Tested | Buttons are disabled when no handler applies to the current object. |
| Context-sensitive ribbon tabs (Table, Query, Relationship, Form, Report, Print Preview) with the contextual tools label in the title bar | Tested | Forms: Design, Arrange, Format. Reports: Design, Arrange, Format, Page Setup. |
| Tell me what you want to do | Tested | Searches the ribbon commands available for the current object. |
| Form/report Themes, Colors, Fonts | Tested | Five built-in WOWDB themes applied to sections and controls. |
| Format tab: font, size, bold/italic/underline, colours, alignment, number format, borders | Tested | |
| Arrange tab: padding, size to tallest/widest etc., align, order, group | Tested | |
| Navigation Pane: categories, search, sort, collapse, drag to canvas | Tested | |
| Navigation Pane: open, design, rename, duplicate, delete, export, create form/report | Tested | Rename and duplicate covered in browser tests; delete asks first. |
| Tabbed workspace, unsaved-change indicator, close with save prompt | Tested | Tabs stay mounted, so switching never loses designer state. |
| Status bar with view switching and record counts | Implemented | |
| Backstage (File): New, Open, Recent, Save, Save As, Download, Export, Print, Close, Info | Implemented | |
| Phone-width layout without horizontal page scroll | Tested | Designers are usable but cramped on phones; desktop is the target. |
| Keyboard shortcuts | Partial | All listed shortcuts work; Chrome does not let pages override Ctrl+N or Ctrl+W, so Ctrl+Alt+N and Ctrl+F4 are provided. |

## Database engine and management

| Feature | Status | Notes |
|---|---|---|
| Real SQLite engine (sql.js 1.12, SQLite 3.45) | Tested | No simulated results anywhere. |
| Create, open, save, close, Save As, download | Tested | |
| Persistence across refresh and restart (IndexedDB autosave) | Tested | |
| Open any SQLite file (adopts its tables and views) | Tested | |
| Database properties (name, description, size, contents) | Implemented | |
| Backup and restore | Tested | Engine test plus Backup dialog; restore makes a safety backup first. |
| Multiple independent databases | Implemented | |

## Table Designer

| Feature | Status | Notes |
|---|---|---|
| Design grid (name, type, description) | Tested | |
| All 11 data types | Tested | Short Text, Long Text, Number, Large Number, Date/Time, Currency, AutoNumber, Yes/No, Hyperlink, Attachment, Calculated. |
| Lookup fields (table/query or value list) and Lookup Wizard | Implemented | Lookups show display values in datasheets and become combo boxes on forms. |
| Field properties: size, format, input mask, caption, default, validation rule/text, required, allow zero length, indexed, decimal places | Tested | Enforced by SQLite constraints or triggers. |
| Primary keys, composite keys | Tested | |
| Drag to reorder, drag field types from the toolbox, multi-select, duplicate, insert/delete rows | Tested | |
| Indexes dialog, Test Validation Rules, Builder (Expression Builder for rules, defaults, calculated fields) | Implemented | |
| Text Align field property | Implemented | Applied in Datasheet View and to new form controls. |
| Schema changes applied to the real table with data kept | Tested | Transactional rebuild with rollback. |
| Undo/redo in Design View | Implemented | |

## Datasheet View

| Feature | Status | Notes |
|---|---|---|
| Edit cells, new records, delete records, row selection | Tested | Edits are buffered per record and saved on leaving the row (as in Access). |
| Engine validation feedback | Tested | Plain-language messages for every constraint. |
| Sort, filter (values or condition), filter by selection, toggle filter | Tested | Sorting and filtering are real SQL ORDER BY / WHERE. |
| Find and Replace, search box | Implemented | |
| Copy, cut, paste (multi-cell, multi-row) | Implemented | |
| Column resize, reorder, hide/unhide, best fit; layout saved | Implemented | |
| Record navigation bar and counts | Tested | |
| Virtual scrolling for large tables | Implemented | |
| Undo for record edits | Partial | Esc / Undo Record discards the current record's unsaved changes; saved changes cannot be undone (as in Access). |

## Relationship Designer

| Feature | Status | Notes |
|---|---|---|
| Drag tables in, move, zoom (buttons and Ctrl+wheel), pan, save layout | Tested | |
| Drag primary key onto foreign key → Edit Relationships dialog | Tested | |
| One-to-one and one-to-many detection; 1 / ∞ markers; lines follow moving tables | Tested | |
| Many-to-many through a junction table (Junction Table helper) | Tested | |
| Referential integrity, cascade update, cascade delete as real FOREIGN KEYs | Tested | |
| Invalid relationships rejected with explanations | Tested | Type mismatch, no unique index, orphan records. |
| Edit and delete relationships, join type, Create New…, relationship report | Tested | |

## Query Designer

| Feature | Status | Notes |
|---|---|---|
| Table workspace: add tables/queries, PK markers, joins from relationships, drag to join, join properties, move/remove | Tested | |
| Design grid: Field, Table, Total, Crosstab, Update To, Append To, Sort, Show, Criteria, Or | Tested | |
| Drag fields into the grid, reorder columns, insert/delete columns, aliases and expressions | Tested | |
| Select, parameter, totals, crosstab, make table, append, update, delete queries | Tested | Action queries show the number of affected rows and ask first. |
| Top values (number or percent), unique values | Tested | |
| Insert/Delete criteria rows, Table Names toggle | Tested | |
| Union and Data Definition query types | Tested | Written in SQL View from a template (as in Access, they have no Design View). |
| Pass-Through queries | Not implemented | Not applicable: there is no external server to pass SQL to. |
| Expression Builder | Implemented | |
| SQL View with syntax highlighting, run, execution time, errors | Tested | |
| SQL supported: SELECT, INSERT, UPDATE, DELETE, WHERE, ORDER BY, GROUP BY, HAVING, DISTINCT, JOIN, INNER/LEFT/RIGHT JOIN, aggregates, aliases, subqueries, parameters, CREATE/DROP | Tested | |
| Design View → SQL | Tested | |
| SQL → Design View with meaning check; SQL-only queries kept as SQL | Tested | |
| Saved select queries usable by other queries, forms and reports (SQLite views) | Tested | |
| Editing records in query results | Not implemented | Query datasheets are read-only; edit through the table or a table-bound form. |
| Declared parameter data types | Not implemented | Numeric-looking values are bound as numbers, others as text. |

## Form Designer and Form View

| Feature | Status | Notes |
|---|---|---|
| Toolbox: label, text box, combo box, list box, check box, option button, toggle button, command button, date picker, image, line, rectangle, subform, navigation control | Tested | Placement of all types implemented; label, text box, combo box and button covered by browser tests. |
| Drag from toolbox or Field List; click-and-draw placement | Tested | |
| Move, resize handles, multi-select (Shift/Ctrl, marquee), grid snapping, alignment guides | Tested | |
| Align, distribute, same size, to grid, group/ungroup, bring to front/send to back | Tested | Align covered in browser tests. |
| Copy, paste, duplicate, delete, keyboard nudge, undo/redo | Implemented | |
| Property Sheet with Format, Data, Event, Other, All | Tested | |
| Form Header, Detail, Form Footer, resizable sections and width | Implemented | |
| Tab order dialog | Implemented | |
| Form View: navigate, add, edit, delete, save, validate | Tested | |
| Combo boxes, buttons (safe actions), images, calculated controls | Tested | |
| Single, continuous and datasheet forms | Implemented | |
| Main forms with linked subforms | Tested | |
| Navigation control (tabs of forms/reports) | Implemented | |
| Forms bound to queries | Partial | Read-only, like query datasheets. |
| Option group frames | Not implemented | Option buttons bind directly to a field with an Option Value. |
| Event procedures (VBA) | Not implemented | By design: only fixed safe actions and macros run. |

## Report Designer and Print Preview

| Feature | Status | Notes |
|---|---|---|
| Report Header/Footer, Page Header/Footer, Group Headers/Footers, Detail; vertical and horizontal rulers | Tested | |
| Hide Details | Tested | |
| Toolbox: label, text box, image, line, rectangle, page number, date and time, calculated field, check box | Implemented | |
| Drag fields from the Field List (labels go to the Page Header) | Tested | |
| Group, Sort and Total pane; Totals: Sum, Count, Average | Tested | |
| Expressions: =Sum([x]), =Count(*), [Page], [Pages], IIf, Format and more | Tested | |
| Multiple pages, Force New Page, page size, orientation, margins | Tested | |
| Print Preview, zoom, printing | Implemented | Printing uses the browser print dialog. |
| PDF export | Tested | |
| Can Grow / Can Shrink | Not implemented | Sections have fixed heights; long text is clipped to its control. |
| Keep Together | Partial | Every band is kept whole on one page; there is no "keep group together". |

## Import and export

| Feature | Status | Notes |
|---|---|---|
| Import CSV/TXT, XLSX/XLS/ODS, JSON, SQL scripts | Tested | |
| Import wizard: file, preview, headers, destination, field mapping, type suggestion, type configuration, duplicate detection, invalid values, preview, confirm | Tested | |
| Import summary with every rejected row and its reason; download rejected rows | Tested | |
| Export CSV, XLSX (one table or whole database), JSON, SQL (structure, data, keys, views) | Tested | |
| PDF reports | Tested | |

## Learning Mode

| Feature | Status | Notes |
|---|---|---|
| 20 topics with key points and knowledge checks | Tested | |
| Guided practicals (Student Database, Relationships, Forms and Reports, SQL) | Tested | Every step is verified against the actual database state. |
| 15 sample-database exercises (beginner, intermediate, advanced for each sample) | Tested | Checked by comparing query results with the expected SQL result. |
| Hints, model answers, explanations of mistakes | Implemented | |
| Progress tracking | Partial | Stored in the learner's browser (per device). |
| Contextual tips in every designer (Learning Mode toggle) | Tested | |
| SQL reference, keyboard shortcut reference | Implemented | |

## Sample databases

| Sample | Status |
|---|---|
| School Management (Students, Teachers, Classes, Subjects, Enrolments, Results, Attendance) | Tested |
| Library Management (Books, Authors, Members, Loans, Categories) | Tested |
| Hospital Management (Patients, Doctors, Appointments, Departments, Prescriptions) | Tested |
| Shop Inventory (Products, Suppliers, Customers, Orders, OrderDetails) | Tested |
| Employee Management (Employees, Departments, Salaries, Positions) | Tested |

Each has fictional records, primary keys, enforced relationships, example queries, forms and reports.

## Database tools

| Feature | Status |
|---|---|
| Database Documenter | Tested |
| Object Dependencies | Tested |
| Compact and Repair (VACUUM + integrity check) | Tested |
| Performance Analyzer (keys, indexes, EXPLAIN QUERY PLAN) | Tested |
| Integrity Checker (integrity_check, foreign_key_check, unenforced relationships, broken object references) | Tested |
| Statistics: record counts, index inspection | Tested |

## Macros and modules

| Feature | Status | Notes |
|---|---|---|
| Macros (OpenForm, OpenReport, OpenTable, OpenQuery, RunQuery, MessageBox, CloseActiveObject) | Implemented | |
| Modules | Partial | WOWDB modules are saved SQL scripts that run in one transaction. VBA is not supported, by design. |

## Not in this release

* Tauri desktop wrapper (evaluated; see ARCHITECTURE.md).
* Multi-user editing of the same database file.
* User-level security and permissions.
* Multi-value lookup fields and multiple attachments per field.
