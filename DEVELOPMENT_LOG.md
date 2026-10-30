# DBWOW Development Log

## 30 October 2026 — Release 0.3.0: renamed DBWOW; live practicals and achievements

* The product is now DBWOW (formerly WOWDB). Database files use the .dbwow extension; older .wowdb files still open. Browser storage keys are unchanged, so existing databases and progress carry over.
* Practicals tick themselves off while students work. "Work on this beside my database" pins the checklist in a panel that stays visible over every designer. Each step is re-checked whenever the database changes; a step found only in an unsaved table design shows as "save to confirm".
* Achievements: 45 trophies in seven categories (Tables, Relationships, Queries, Forms, Reports, Data, Learning) at Bronze, Silver and Gold, plus Platinum for unlocking all of them. Each is earned from evidence in the real database, verified practical steps, correct quiz answers, or recorded actions (SQL run, import, export, PDF, backup). XP: 10 per verified step, 5 per correct answer, 15/30/60/150 per trophy. Seven ranks from Novice to Database Master, shown in the title bar.
* Fixed: the "Link Students to Classes" step 4 was marked complete in an empty database (any refused insert counted). It now requires the relationship and a foreign-key refusal.
* Tests: 52 engine tests (new achievements suite); new browser suite tests/e2e/learning.cjs (4 steps); 10/10 acceptance and 12/12 feature steps on both builds.

## 30 October 2026 — Release 0.2.1: security updates

* Vercel refused to deploy because Next.js 15.1.6 has published security vulnerabilities. Upgraded to Next.js 15.5.28 (latest patched 15.x release) and jsPDF to 4.2.1.
* SheetJS (`xlsx`) upgraded from 0.18.5 to 0.20.3, which fixes its prototype-pollution and ReDoS advisories. 0.20.3 is published officially only on cdn.sheetjs.com, so it is installed from the npm republish `@e965/xlsx@0.20.3` under the name `xlsx`. Before adopting it, SHA-256 hashes of xlsx.mjs, xlsx.js and dist/xlsx.full.min.js were compared with the official cdn.sheetjs.com files and are identical (xlsx.mjs: 1a0fb062ee9781b13f6687371b202aaefc53b6ce55b530c027e01f9c087b77db).
* Remaining audit note: the PostCSS copy bundled inside Next.js 15 is flagged (moderate/high); it runs only at build time on our own CSS. Next.js 16 removes it; upgrading major versions is a later step.
* Results unchanged: 45/45 engine tests; 10/10 acceptance and 12/12 feature steps on both builds.

## 30 October 2026 — Release 0.2.0: interface matched to the reference screenshots

The interface was compared screen by screen with the five reference screenshots (Table Design, Query Design, Edit Relationships, Form Design, Report Design) and brought into line with them.

### Changes

* Title bar: contextual tool label (TABLE TOOLS, QUERY TOOLS, RELATIONSHIP TOOLS, FORM DESIGN TOOLS, REPORT DESIGN TOOLS, REPORT TOOLS) drawn above the contextual tabs; the title shows the active object, as in the references.
* "Tell me what you want to do" box beside the ribbon tabs. It searches every ribbon command that applies to the current object and runs the one chosen.
* Form Design Tools split into DESIGN, ARRANGE and FORMAT tabs; Report Design Tools into DESIGN, ARRANGE, FORMAT and PAGE SETUP tabs. The old single tab overflowed the window at 1400 px.
  * Design: Views, Themes (Themes, Colors, Fonts), Controls gallery, Insert Image, Header/Footer, Tools; reports add Grouping & Totals (Group & Sort, Totals menu with Sum/Average/Count/Max/Min, Hide Details) and Page Numbers.
  * Arrange: Control Padding, Size/Space (To Tallest/Shortest/Widest/Narrowest, To Grid, Equal Horizontal/Vertical), Align, Bring to Front, Send to Back, Group/Ungroup, Select All.
  * Format: Selection box, font name and size, bold/italic/underline, font colour, alignment, number format, background colour, transparent, shape outline colour and border style.
* Vertical rulers beside every form and report section; the selected section bar is dark, as in the reference.
* Query Design ribbon: Union and Data Definition (open SQL View with a template), Insert Rows / Delete Rows for criteria rows, Table Names toggle, Parameters as a large button.
* Table Design ribbon: Builder (Expression Builder for the Validation Rule, Default Value or calculated Expression), Modify Lookups; new Text Align field property applied in Datasheet View and to new form controls.
* Edit Relationships: Create New… button.

### Bugs found and fixed

* Join and relationship lines were drawn one row too high for fields far down a table box: the CSS row height (about 23 px) did not match the 20 px used to place the lines. Rows now have a fixed height. Table boxes also show more fields before scrolling.
* The REPORT DESIGN TOOLS tab set no longer clips Orientation off the right edge.

### Tests

* New browser feature step drives the Format, Arrange and Themes commands, Tell Me, Union, Insert Rows, Table Names, Create New… and Hide Details, and checks the saved definitions in the database.
* Results: 45/45 engine tests; 10/10 acceptance and 12/12 feature steps on both the portable and the Next.js builds; no browser console errors.


## 29 October 2026 — Release 0.1.0

### Environment and decisions

* Started a new project (no existing code). Node 22, Next.js 15.1 (15.5.28 from release 0.2.1), React 18.3, TypeScript 5.6 in strict mode.
* Engine: sql.js 1.12 (SQLite 3.45 compiled to WebAssembly). Tables are created `STRICT` so SQLite itself rejects wrong data types.
* One codebase, two builds: Next.js static export and a Vite single-file portable build. Only the entry points differ (how the WebAssembly binary is found).
* All object definitions are stored inside the SQLite file (`_wow_objects`, `_wow_meta`), so a database is one portable file.
* Interactions are implemented with a small pointer/HTML5 drag layer instead of dnd-kit, React Flow, Konva or Fabric.js. Reasons are in ARCHITECTURE.md.
* Tauri was evaluated and deferred (ARCHITECTURE.md).

### Phase summary

1. Foundation: shell, ribbon with contextual tabs, Navigation Pane, tabbed workspace, command registry, dialogs and context menus, autosave.
2. Engine: catalogue, schema builder for 11 data types, transactional table rebuilds, record operations with plain-language errors, Access expression language.
3. Relationships and queries: FOREIGN KEY relationships, Relationships window, Query Designer, SQL View, all query types, SQL → Design with meaning check.
4. Forms and reports: shared design canvas, Property Sheet, Form View with subforms and safe actions, report engine, Print Preview, PDF.
5. Data interchange: CSV/XLSX/JSON/SQL import wizard and exports.
6. Learning environment: 20 topics, practicals and exercises verified against the database, five sample databases, Learning Mode tips.
7. Quality: 45 engine tests, 10 acceptance and 11 feature browser tests on both builds; documentation.

### Bugs found by testing and fixed

* SQLite refuses `Date()` inside CHECK constraints, so a rule such as `<Date()` failed. Such rules are now enforced with BEFORE INSERT/UPDATE triggers.
* Renaming a parent table or its key field left child FOREIGN KEYs pointing at the old name. Child tables are now rebuilt in the same transaction.
* A Yes/No field's Default Value was ignored.
* Unquoted text criteria with spaces (`JHS 1`) did not parse; plain text is now accepted, as in Access.
* SQL → Design could not read the parenthesised WHERE clauses that Design View generates; the parser now reads nested OR/AND groups.
* Datasheet: tabbing past the last field of the new-record row did not save the record, so the next entry overwrote it. The new row now saves and a fresh new row opens.
* Datasheet: right-click "Equals …" filtered on the previously focused cell instead of the cell clicked.
* A CSS class used for "selected" also styled select boxes, which squashed a selected table box in the Relationships window.
* Report Header printed below the Page Header on page 1.
* Report subtotals did not inherit the currency format of the field.
* The View ribbon button opened a menu instead of switching view.

### Next implementation steps

1. Tauri desktop build that reads and writes `.dbwow` files directly on disk (swap `persistence.ts`).
2. Updatable query datasheets and query-bound forms for single-table queries (write back through the base table's rowid).
3. Can Grow / Can Shrink for report text boxes, and Keep Together for groups.
4. Option group frames on forms.
5. Teacher tools: export a class's Learning Centre progress, and author custom practicals with checks.
6. Declared parameter data types in queries.
