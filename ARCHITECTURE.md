# WOWDB Architecture

## Overview

WOWDB is a single-page React application. The database engine is SQLite 3.45 compiled to WebAssembly (sql.js 1.12), running in the page. There is no server. One codebase produces two builds:

1. Next.js 15 static export (`npm run build` → `out/`). The WebAssembly binary is served as `sql-wasm.wasm`.
2. Portable single-file build with Vite (`npm run build:portable` → `dist-portable/index.html`). JavaScript, CSS and the WebAssembly binary are inlined, so the file runs from disk or from any static host.

Both builds compile the same `src/` tree. Only the entry files differ (`app/page.tsx` and `src/portable-main.tsx`), and they differ only in how the WebAssembly binary is located.

## Layers

The brief asks for nine separated concerns. They map to modules as follows.

| Concern | Module(s) |
|---|---|
| Application interface | `src/ui/**` |
| Database engine | `src/engine/sqlite.ts` |
| Storage and persistence | `src/engine/persistence.ts`, `src/ui/store.ts` (`scheduleSave`) |
| Schema management | `src/engine/project.ts` |
| Query execution | `src/engine/queries.ts`, `src/engine/expr.ts` |
| Object designers | `src/ui/designers/**`, `src/ui/editors/**`, `src/engine/objects.ts`, `src/engine/report.ts` |
| Educational modules | `src/learning/content.ts`, `src/ui/LearningCentre.tsx` |
| Import/export | `src/engine/interchange.ts`, `src/ui/dialogs/Wizards.tsx` |
| Testing | `tests/*.test.ts` (Vitest), `tests/e2e/*.cjs` (Playwright) |

The engine layer has no React or DOM dependencies (except `persistence.ts`, which uses IndexedDB). It is exercised directly by the Vitest suite in Node.

## The database file

A WOWDB database is one SQLite file containing:

* The user's tables, as real `STRICT` SQLite tables.
* Real constraints: `PRIMARY KEY`, `NOT NULL`, `UNIQUE` indexes, `CHECK` constraints for field size, number ranges, dates, Yes/No and validation rules, and `FOREIGN KEY ... ON UPDATE/ON DELETE` for enforced relationships.
* Triggers for validation rules that SQLite does not allow in a CHECK constraint (rules using `Date()` or `Now()`, for example `<Date()`).
* SQLite views for saved select queries without parameters, so queries can be used by other queries, forms and reports.
* Two catalogue tables:
  * `_wow_meta (key, value)`: database name, description, format version.
  * `_wow_objects (type, name, def JSON)`: table metadata (Access data types, captions, formats, input masks, lookups, datasheet layout), relationships, query definitions (SQL plus Design View model), forms, reports, macros, modules and layouts (for example the Relationships window).

Data (records) lives only in the SQLite tables. Visual metadata lives only in `_wow_objects`. The UI state store never holds records.

## Schema changes

SQLite cannot alter column types or constraints in place, so `WowProject.saveTableDesign` uses the documented SQLite "12-step" rebuild inside one transaction with foreign keys temporarily off:

1. Drop views (they are recreated from the catalogue afterwards).
2. Update relationship metadata for renamed tables and fields.
3. Create the new table under a temporary name, copy matching columns (fields keep stable ids, so renames keep data), drop the old table, rename the new one.
4. Rebuild child tables whose FOREIGN KEYs point to this table when the table or its key fields were renamed.
5. Recreate indexes and triggers, run `PRAGMA foreign_key_check`, recreate views.
6. Commit, or roll back everything with a plain-language error if any step fails (for example existing text longer than a new Field Size).

## Data types

| WOWDB type | SQLite column | Enforcement |
|---|---|---|
| Short Text | TEXT COLLATE NOCASE | CHECK length ≤ Field Size |
| Long Text, Hyperlink, Attachment | TEXT COLLATE NOCASE | Attachments are stored as data URLs |
| Number (Byte/Integer/Long Integer) | INTEGER | CHECK range for the field size |
| Number (Single/Double/Decimal), Currency | REAL | STRICT type checking |
| Large Number | INTEGER | STRICT type checking |
| Date/Time | TEXT (ISO `yyyy-mm-dd hh:mm:ss`) | CHECK `datetime(x) IS NOT NULL` |
| AutoNumber | INTEGER PRIMARY KEY AUTOINCREMENT (when it is the only key) | engine-generated |
| Yes/No | INTEGER NOT NULL DEFAULT 0/1 | CHECK IN (0,1) |
| Calculated | GENERATED ALWAYS AS (...) VIRTUAL | expression translated from Access syntax |

Text uses `COLLATE NOCASE` so comparisons and sorting are case-insensitive, as in Access.

## Expressions

`src/engine/expr.ts` implements the Access expression language once and uses it in three ways:

* Translate to SQL: query criteria (`>5`, `Like "A*"`, `Between #1/1/2026# And Date()`, `In ("M","F")`, `Is Null`, `[Parameter]`, unquoted text such as `JHS 1`), validation rules, default values and calculated fields.
* Evaluate in JavaScript: form and report control sources (`=Sum([Fee])`, `="Page " & [Page] & " of " & [Pages]`, `IIf`, `Nz`, `DateDiff`, `Format`).
* Format values for display (Currency, Short Date, Percent, Yes/No and so on).

## Queries

`queries.ts` turns the Query Design model (tables, joins, grid columns) into SQL and back.

* Select queries: joins are built from the join list, criteria rows become `WHERE` (AND across a row, OR between rows), totals become `GROUP BY` and `HAVING`, `Return` becomes `LIMIT` (percentages use a subquery).
* Parameters are written as `[Prompt]` in the saved SQL and bound as named SQLite parameters at run time. Bracketed names that match a table, query or field are treated as identifiers, so Access-style `[FirstName]` works in SQL View.
* Crosstab queries store a template; column headings are found at run time and expanded with conditional aggregates.
* Make-table queries create a proper WOWDB table (with inferred field types) through the catalogue. `CREATE TABLE ... AS SELECT` typed in SQL View takes the same path.
* SQL typed in SQL View that changes the schema (CREATE, DROP, ALTER) is followed by a catalogue sync.
* SQL → Design View: a restricted recursive-descent parser accepts SELECT with joins, OR-of-AND criteria, GROUP BY, ORDER BY and LIMIT. It then regenerates SQL from the design and re-parses it; if the two designs differ, or the ORDER BY sequence changes, the translation is rejected and the query stays in SQL View with an explanation. This is how "never silently change query meaning" is enforced.
* Safety: values are always bound as parameters; writes to the catalogue tables, `ATTACH`, and dangerous PRAGMAs are refused; multi-statement scripts run inside one savepoint.

## Forms and reports

Forms and reports share one model (`SectionDef`, `ControlDef`) and one designer component (`DesignCanvas.tsx`). Form View (`FormRunner.tsx`) buffers edits per record and writes them with INSERT/UPDATE when the user moves away or presses Save Record, so SQLite constraints validate every write. Command buttons and macros run a fixed list of safe actions (`actions.ts`); no user-entered code is ever executed.

The report engine (`report.ts`) sorts records by the group levels, expands them into bands (report header, page header, group headers, detail, group footers, page footer, report footer), paginates with Force New Page support, then evaluates every control with its record, its group's records (for aggregates), and the page number and page count. The same page model renders Print Preview, browser printing (a print-only DOM) and PDF (jsPDF drawing text, lines, rectangles and images at exact positions).

## UI state and commands

* `src/ui/store.ts` (Zustand) holds UI state: open project handle, tabs, ribbon tab, panels, and a `version` counter bumped whenever SQLite changes, so views re-read from the database.
* Autosave: every database change schedules an export of the SQLite file to IndexedDB (debounced 400 ms).
* `src/ui/commands.ts` is a command registry. Ribbon buttons and keyboard shortcuts dispatch named commands. The active editor and the components inside it register handlers; app-level handlers cover Create, External Data, Database Tools, Help and File. A ribbon button whose command has no handler is disabled, so no visible button is inert.
* Open tabs stay mounted (hidden when inactive), so switching tabs never loses unsaved designer state.
* Designers keep multi-level undo/redo histories (`useHistory.ts`).

## Library decisions

The brief lists a preferred stack and asks to avoid unnecessary dependencies. Final runtime dependencies: React, Next.js, Zustand, sql.js, SheetJS (`xlsx`), jsPDF and lucide-react. Tailwind is used at build time.

* **dnd-kit, React Flow, Konva, Fabric.js: evaluated, not used.** The designers need three different interaction models (HTML5 drag from the Navigation Pane/toolbox/field list; pointer-based move/resize with snapping and alignment guides; field-to-field dragging that ends either on another table box or on the query grid). A single small pointer layer gives exact control over all three, keeps the canvas as plain DOM (so controls render with the same CSS in design and run modes, and print exactly), and avoids four libraries. Relationship and join lines are plain SVG paths recomputed from box positions on every move.
* **Shadcn/UI: not used.** The interface deliberately follows a dense desktop look (ribbon, property sheets, datasheets). Native elements styled with one stylesheet were simpler and smaller than adapting a card-style component kit.
* **PDF: jsPDF**, drawing from the report page model rather than rasterising HTML, so text stays selectable and positions are exact.

## Tauri evaluation

A Tauri desktop wrapper was evaluated and is not built in this release:

* Benefit: native window, file associations for `.wowdb`, saving straight to disk, and the ability to use native SQLite with file locking for very large databases.
* Cost: a Rust toolchain on every build machine, per-platform installers and code signing, and two storage paths to maintain.
* For the classroom use case the browser build already meets the requirements: real SQLite, persistence across restarts, and `.wowdb` files that can be downloaded and reopened. The portable single-file build covers "run without installing".
* The architecture keeps the option open: all storage goes through `persistence.ts` and the engine only needs bytes in and bytes out, so a Tauri build can swap IndexedDB for the filesystem without touching the designers. This is listed as a next step in DEVELOPMENT_LOG.md.

## Risks and how they are handled

| Risk | Handling |
|---|---|
| Schema changes losing data | Transactional rebuild with stable field ids; confirmation before deleting fields; rollback with a clear message when existing data does not fit. |
| Constraint changes breaking existing data | Orphan check before enforcing a relationship; `PRAGMA foreign_key_check` after every rebuild; Test Validation Rules command. |
| SQL injection | Parameters everywhere; parameter prompts are bound, never concatenated. |
| Damaging the catalogue from SQL View | Writes to `_wow_*` tables, ATTACH and dangerous PRAGMAs are refused. |
| Design View changing query meaning | Round-trip verification before accepting SQL → Design translation. |
| Browser storage loss | Autosave plus Backup (in browser) and Download (.wowdb file). |
| Browser shortcuts that pages cannot override (Ctrl+N, Ctrl+W in Chrome) | Alternatives documented: Ctrl+Alt+N, Ctrl+F4. |
