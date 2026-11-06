# DBWOW Development Log

## 6 November 2026 — Release 0.7.3: no learning aids during a test

* Learning Mode tips (for example the relationship hint about referential integrity) were still shown during a test if the student had Learning Mode on. Now, unless the teacher allows learning aids, tips are hidden and Learning Mode cannot be switched on during the test.
* The title bar hides the Learning Mode switch, the XP/rank badge and the sign-in button during a test and shows "Test in progress" instead.

## 6 November 2026 — Release 0.7.2: the test database is named after the student and cannot be lost

* The test database is now named with the student's full name and the test title (for example "Ama Mensah - Sports League: Core practical"). The test panel shows the name and tells students to work only in it and not to close or delete it; the question paper says the same.
* During a test, File > New, Open, Save As, Download, Share, Export and Close are switched off, and the test database cannot be deleted from the Recent list. If it is closed or deleted anyway, DBWOW brings it straight back with the work so far (from memory, this browser, or the last cloud save) and records it for the teacher.
* Question papers now tell students to join by the test link with their full name, class details, code and pledge.

## 6 November 2026 — Release 0.7.1: fix "The cloud refused this request" when starting a test

* Starting a test first checks whether the student already has an attempt (to resume it). The security rules only let a student read an attempt whose uid is theirs, and an attempt that does not exist yet has no uid, so Firestore refused the check and the test never started. The rules now allow that check (own(): resource == null or the student's own attempt), and the app also treats a refused check as "no attempt yet", so starting works even before the new rules are published.

## 6 November 2026 — Release 0.7.0: tests without accounts, start window, pledge, red and green test screen

* Students no longer need to register to take a test. They open the student link (?take, or ?take=CODE), enter their full name (first name and surname are required), class and section (or whatever the teacher asks for), the test code, and tick a pledge not to cheat or commit any misconduct and to take responsibility for it. DBWOW signs them in as a guest (Firebase Anonymous Authentication), so the work, monitoring and marks work as before; a reload carries on in the same browser. Students with accounts can still take tests; their name is filled in.
* Start window: the teacher sets when students can start and the last time to start. Before it the test says when it opens; after it the test is no longer available. Anyone already working keeps their full time. Enforced in the Firestore rules (2 minutes' grace for clock differences).
* During a test DBWOW turns red. When the student presses Submit it turns green while they confirm (red again if they keep working), and stays green once the work is handed in, by them or automatically at the end of time. A bar across the top of the window shows the time left.
* The pledge and when it was taken are stored with the attempt and printed on the marked paper. The Tests list shows the student link and each test's start window.
* Guests: no study analytics, cloud saving or progress sync; File > Tests shows the results of tests taken in that browser.
* Firebase: switch on Anonymous sign-in and publish the updated firestore.rules.
* Tests: exams.cjs is now 8 steps (guest join with validation of name and pledge, red/green colours and time bar, an account holder, start window before and after).

## 6 November 2026 — Release 0.6.2: school name and logo, paper total, student details, more report tasks

* School and paper settings in the test editor: school name and logo (any PNG or JPEG, reduced to a small PNG) printed at the top of question papers, mark schemes, mark sheets and marked papers; the paper's total marks, with "Spread the marks" to scale task marks to that total (whole marks, at least 1 each; a test cannot be saved while they disagree); and the details students fill in before starting (default Class and Section; any list, e.g. Index number). The school name, logo and detail list are remembered for the next test.
* Students fill in those details in the start dialog (their name comes from their account). They are stored with the attempt and shown in the live monitor, results, CSV, the mark sheet (a Class / Section column) and every marked paper. Question papers print a line for each.
* Reports: the report check can now also require the fields shown, the sort order and a title in the header, and a Count. New tasks for every sample: a sorted report with a title (now in Core) and a report based on the student's own join query, grouped, with a count in the group footer (Extended and Full paper). Core 9 tasks, Extended 9, Full paper 20.
* Tests: 92 unit tests; exams.cjs fills in class and section, sets the school name and a total of 30 and spreads the marks.

## 6 November 2026 — Release 0.6.1: question papers, mark schemes, marked papers

* Question paper for every test (Tests > Paper, or Results > Question paper), as PDF or an editable Word file (.docx, Times New Roman): title, class, time allowed, total marks, name/class/date lines, instructions to candidates (how to sign in, start, save, submit; what is recorded), the teacher's instructions, the database provided (each table with its fields, data types, keys and number of records; optional), and every task numbered with its marks in brackets. Print it before the test or hand it out on the day.
* Mark scheme (teachers only, PDF or Word): each task, its marks, how DBWOW checks it, and the answer SQL for query tasks.
* Marked papers: Results > Marked papers prints one paper per student: every checkpoint with marks available, marks awarded, met or not met and the reason, checkpoint total, adjustment, final mark, comment, monitoring summary, and lines for the marker's and student's signatures. "Both" prints the class mark sheet followed by the marked papers. The per-student print button and the student's own printout use the same layout.
* Tests: 90 unit tests; exams.cjs downloads marked papers, a Word question paper and a PDF mark scheme.

## 6 November 2026 — Release 0.6.0: ready-made tests for every sample, six new samples, printable results

* Six new sample databases (fictional data, enforced relationships, example queries, forms and reports): Sports League, Hotel Bookings, Bus Transport, Cinema, Restaurant and Farm Co-operative. There are now eleven. Each new sample has beginner, intermediate and advanced exercises in the Learning Centre.
* Ready-made practical tests for all eleven samples (src/exam/library.ts). Teacher > New test > Use a ready-made test: pick a database and a level: Core (8 tasks, 40 min: a new table with its key, a data type, a relationship, records, a validation rule, two queries, a form), Extended (8 tasks, 60 min: wildcard, date range, parameter query, join, totals, calculated field, update query, grouped report with totals) or Full paper (18 tasks, 90 min). Students start in a copy of the sample with its queries, forms and reports removed; that copy is saved with the test.
* Values in the tasks (towns, prices, letters, months, the records an update query changes) are picked from the data each time a test is made, so two tests from the same sample differ. Expected results of update queries are worked out from the starting data.
* The task bank now covers every sample (18 tasks each, grouped) as well as a blank database. Picking from a sample can also set the starting database.
* Build a model answer and try the key: runs every task's model answer on the starting database and marks it. Tasks the teacher wrote are listed so they can be completed by hand in the model answer, which can be opened.
* New marking check: parameter query (asks for a value; given the value, returns the right rows). Sorted answers now accept rows that tie on the sort field in any order.
* Printable results (PDF, Times): Results > Mark sheet (every student's mark for each checkpoint, averages, and the list of checkpoints with how many students met each); Mark sheet + student pages (one page per student: each checkpoint's mark and the reason, adjustment, comment, monitoring summary); a print button for each student. Students can print their own result sheet from File > Tests > My results once results are released; the teacher's adjustment and comment are now released with the marks.
* Tests: tests/library.test.ts (every sample builds; for every sample and three seeds the model answer earns full marks and the starting database none; exercises; PDFs). 89 unit tests. tests/e2e/exams.cjs now 7 steps (ready-made test, model answer, bank, PDF downloads). All browser suites pass on both builds (41 steps).

## 5 November 2026 — Release 0.5.0: practical tests, teacher dashboard, study analytics

* Practical tests. Teachers build a test from tasks (wording + marks + a marking check), choose what students start with (blank database, a sample, or a database the teacher supplies), a time limit, a class, and whether full screen is required or the Learning Centre is allowed. Students need an account: File > Tests > enter the code. A rules screen, then a test panel with the tasks, a timer and flags; work autosaves to the teacher every 45 seconds; Submit, or automatic hand-in when time runs out; a reload carries on with the same deadline.
* Marking checks (src/exam/checks.ts), all run against the student's real database without changing it: table, field (and type), primary key (incl. composite), record count, a record with a value, validation rule (and that it rejects a value), relationship (integrity, cascades), a saved query returning the same rows as the teacher's answer SQL (run on the student's own data; column order ignored; order checked when the answer sorts), a query using a feature (e.g. GROUP BY), form (source, fields shown), report (grouping, totals), custom SQL. A task bank of IGCSE-style tasks; "Try the marking key" on any open database (e.g. a model answer).
* Integrity monitoring during a test: tab or app switches, focus lost to another window, full-screen exits, pastes (and characters), copies, active / idle / away time, database changes, reloads, opening another database. A timeline of events per student. Highlighted rows are prompts to look, not verdicts.
* Teacher dashboard (Teacher button in the title bar): Classes with join codes and member lists; adding teachers; Tests (open, close, edit, delete); Live monitor (updates in real time, online dots, progress marked from the latest saves, details and timeline, open a copy of the student's database, reopen an attempt with extra minutes); Results (mark all, per-task ticks with reasons, adjustment and comment, CSV export, task analysis, release to students).
* Study analytics for every signed-in student: active, idle and away time per day, database changes, practical steps, quiz answers and accuracy, SQL runs, XP. Student progress view per class: focus %, days used, steps, quiz, rank, trophies, latest test mark and trend between first and latest test; per-student charts of active minutes per day, test marks and XP.
* Security: the marking key is stored apart from the test (tests/{id}/key, teachers only); marks live in tests/{id}/grades (teachers only) and are copied into attempts only on release; students can change only their counters, status and snapshot, and only before the deadline (+5 min). Teachers: an email in TEACHER_EMAILS with a verified address, or added by a teacher.
* During a test (unless the teacher allows learning) practical ticks and trophies pause, because they would reveal which tasks are done.
* Tests: tests/exam.test.ts (marking); tests/e2e/exams.cjs (6 steps, teacher + 2 students on separate browsers sharing a stand-in cloud). The stand-in cloud is now a small HTTP key-value server (tests/e2e/fakecloud.cjs). 57 unit tests; 40 browser steps pass on both builds.
* Limits: monitoring sees only this browser tab; it cannot see a phone or a second computer. Marking runs in the teacher's browser (no server needed on the free plan). Counters are reported by the student's browser, so a determined student with developer tools could alter them; marks cannot be altered.

## 30 October 2026 — Release 0.4.0: accounts, cloud saving, sharing, pictures, contextual tabs

* Accounts (Firebase Authentication: email/password, Google, password reset). Signed-in students' databases upload to Cloud Firestore a few seconds after each change; Learning Centre progress and trophies are merged across devices (nothing earned on either device is lost). File > Account lists the databases in the account; opening one on another device downloads it.
* Sharing: File > Share creates a link (?share=…). Anyone who opens it gets their own copy; the shared copy updates whenever the owner's work is saved. Stop sharing deletes it.
* Storage design: database files are split into chunks below Firestore's 1 MiB document limit, written as a new generation before the metadata switches, so a reader never sees half a save. Works on the free Spark plan (no Cloud Storage needed). Limit 15 MB per database. Rules in firestore.rules.
* Without an account (or in the portable file) nothing changes: work stays in the browser.
* Pictures: Attachment fields show thumbnails in Datasheet View; right-click to insert, view or remove; form picture boxes can be changed by double-clicking. Large photos are scaled to at most 1024 px and recompressed (about 350 KB at most) so databases stay shareable. FIELDS tab: new "Image / File" and "Hyperlink" field buttons.
* Contextual tabs now come forward when an object opens, as in Access. Datasheet View has TABLE TOOLS: FIELDS and TABLE.
* Tests: 54 engine tests; new tests/e2e/accounts.cjs (6 steps: register, cross-device sign-in and merge, share link, pictures, contextual tabs, no-account mode) using a stand-in cloud; all suites pass on both builds.

## 30 October 2026 — Release 0.3.2: Learning Centre without a database; app icon

* The Learning Centre opens before any database exists (HELP tab and File > Learning Centre), and stays open when a database is created, opened or closed. Practicals show "Create or open a database" (and "Open the sample database") until one is open.
* The ribbon is visible on the start screen so HELP can be reached.
* DBWOW icon added: browser tab icon and home-screen icon (Next.js app/icon.png, app/apple-icon.png; inlined in the portable build).
* README screenshots retaken with the DB logo; new screenshots of the Learning Centre, the practical panel and achievements.
* Results: 52 engine tests; 6/6 learning, 10/10 acceptance and 12/12 feature steps on both builds.

## 30 October 2026 — Release 0.3.1: DBWOW name everywhere

* Logo mark changed from "W" to "DB".
* Internal names renamed: browser storage keys (dbwow.*), the IndexedDB store (dbwow-store), drag-and-drop data types and the test hook (window.__DBWOW__).
* One-time migration: on first start, settings and learning progress are copied from the old wowdb.* keys, and saved databases and backups from the old wowdb-store, which is then deleted. Covered by a new browser test that recreates an old install.
* Results: 52 engine tests; 5/5 learning, 10/10 acceptance and 12/12 feature steps on both builds.

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
