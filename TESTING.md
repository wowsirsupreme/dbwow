# DBWOW Testing

DBWOW is tested at two levels. Neither level mocks the database: every test runs real SQLite.

## 1. Engine tests (Vitest)

```bash
npm test
```

Run in Node with the same sql.js WebAssembly engine the browser uses. Files:

| File | Covers |
|---|---|
| `tests/engine.test.ts` | Database creation, save/reopen, opening plain SQLite files; table creation, all field properties, constraint enforcement (types, size, required, ranges, validation rules including `<Date()`, unique indexes), field reorder/rename/retype/delete with data kept, rollback on bad changes, composite keys, name validation, record insert/update/delete; relationships as real FOREIGN KEYs, one-to-one/one-to-many detection, cascade update/delete, rejection of invalid relationships, renaming tables and key fields with relationships. |
| `tests/queries.test.ts` | Access criteria translation and expression evaluation; two-table query with criteria and sort (generated SQL and results); OR rows, hidden criteria columns, aliases, expressions; totals with Group By/Sum/Count/Where/HAVING; parameter queries (including an injection attempt); left join, Top N and Top %; crosstab; make-table, append, update and delete queries with affected-row preview; saved queries as views; SQL View statements and errors; atomic scripts; DDL catalogue sync; SQL → Design translation with result equivalence, and refusal of SQL it cannot draw. |
| `tests/objects.test.ts` | Form definitions persist positions, sizes, bindings and properties; auto forms; report grouping, sorting, totals, pagination, page numbering and PDF output checked against SQL sums; CSV import with invalid rows reported; append with duplicate detection; CSV/JSON/XLSX/SQL round trips (including foreign keys after SQL import); integrity checker, dependencies, statistics, documenter, performance analyser, compact and repair; backup/restore; all five samples build and every query and report runs; Learning Mode checks follow the real database state step by step. |

Result at the time of writing: 45 tests, all passing.

## 2. Browser tests (Playwright)

```bash
npm run test:e2e
```

This builds the portable single-file app and drives it in headless Chromium with real mouse drags, typing and clicks, then reads the SQLite database through a read-only inspection hook to verify the result. Screenshots of each step are written to `tests/e2e/out/`.

To run against the Next.js build instead:

```bash
npm run build
npx serve out -l 4321      # or any static server
DBWOW_URL=http://localhost:4321/ node tests/e2e/acceptance.cjs
```

### Acceptance suite (`tests/e2e/acceptance.cjs`)

The complete workflow from the brief, in one run:

Create Database → Create Tables → Configure Fields → Set Primary Keys → Insert Records → Create Relationships → Build Queries → Design Forms → Design Reports → Export Data → Save → Close → Reopen.

| Step | What is checked in the database |
|---|---|
| Create a blank database | Project name is SchoolDB. |
| Table designer | Fields typed into the grid, AutoNumber, primary key set from the ribbon, FirstName dragged above LastName, a Yes/No field dragged in from the toolbox, a validation rule set; the real column order, PK and AUTOINCREMENT are verified. |
| Datasheet | Records entered by keyboard; a value breaking the rule is rejected with a message; exact stored rows verified. |
| Relationships | Tables dragged from the Navigation Pane, a box moved, ClassID dragged onto ClassID, Create; `PRAGMA foreign_key_list` shows the FK; the engine refuses an orphan record; the ∞ marker is drawn. |
| Query designer | Two tables dragged in, three fields dragged into specific grid columns, criteria typed, sort chosen, Run; result row count; SQL View contains the INNER JOIN and criteria; saved query exists as a view and returns the same rows. |
| Form designer | Label, text box, combo box and button dragged from the toolbox; a field dragged from the Field List; properties set in the Property Sheet; the text box resized with its handle; three controls multi-selected and aligned; saved definition verified; in Form View an existing record is edited, the button creates a new record, values are typed and the combo box used; the database rows are verified. |
| Report designer | Fields dragged from the Field List, Title and Page Numbers added, a group added in the Group, Sort and Total pane with a footer, Sum totals added; preview shows "Page 1 of 1" and the grand total; the PDF download starts with `%PDF-`. |
| Export | CSV download contains the header and the new record. |
| Persistence | Page reloaded; the same database reopens automatically with identical records, form definition (positions, sizes, bindings, properties), relationship layout, foreign key, query and report. |

Result: 10/10 steps pass on the portable build and on the Next.js build, with no browser console errors.

### Feature suite (`tests/e2e/features.cjs`)

| Step | Checks |
|---|---|
| Import wizard | A CSV with an invalid value goes through all ten wizard steps; the summary lists the rejected row with its reason; the imported rows and types are verified. |
| Datasheet sort/filter | Filter by selection from the right-click menu (count matches SQL), toggle filter, sort descending (top value matches SQL). |
| SQL View | GROUP BY / HAVING query runs, row count matches SQL, saved as a view. |
| SQL-only queries | A subquery cannot be shown in Design View; DBWOW explains and keeps the SQL. |
| Learning Centre | A sample exercise step turns complete only after the right query exists; knowledge-check feedback. |
| Learning Mode | Contextual tips appear in designers. |
| Navigation Pane | Rename (open tab follows) and duplicate with data. |
| Junction table | Many-to-many helper creates a composite key and two foreign keys. |
| Database tools | Integrity checker, documenter, dependencies, statistics, performance analyser, compact and repair. |
| Subform | Moving between classes in the main form changes the linked subform records to match SQL counts. |
| Ribbon tools | Format tab (bold, font, colour) on two controls, Arrange Size/Space, Design Themes; Tell Me runs Union; query Insert Rows and Table Names; Create New… in Edit Relationships; report Hide Details removes detail rows in Print Preview while subtotals remain. Saved definitions are read back from the database. |
| Phone width | No horizontal page scroll at 390 px. |

Result: 12/12 steps pass.

## Screenshots

`node tests/e2e/screens.cjs docs/screenshots` (after `npm run build:portable`) regenerates the README screenshots from the running app, so documentation images always match the build.

## Manual checks

Before a release, also check by hand: printing a report through the browser dialog, opening a downloaded `.dbwow` file with File > Open, importing an Excel workbook with several sheets, and the Lookup Wizard.
