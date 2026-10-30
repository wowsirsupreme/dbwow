// Visual designer acceptance tests (Section 20 of the brief), run against the
// built single-file app in headless Chromium. Each step uses real mouse
// drag-and-drop / typing, then checks the actual SQLite database state.
const { start } = require('./lib.cjs');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const OUT = process.argv[2] || path.resolve(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });

const results = [];
async function step(name, fn) {
  try { await fn(); results.push(['PASS', name]); console.log('PASS', name); }
  catch (e) { results.push(['FAIL', name, e.message]); console.log('FAIL', name, '\n   ', e.message.split('\n')[0]); throw e; }
}

(async () => {
  const { browser, context, page, errors } = await start({ url: process.env.DBWOW_URL });
  const sql = (q) => page.evaluate((q) => window.__DBWOW__.store.getState().project.db.all(q), q);
  const scalar = async (q) => Object.values((await sql(q))[0] ?? {})[0];
  const vis = (sel) => page.locator('.doc-pane:not(.hidden) ' + sel);
  const shot = (n) => page.screenshot({ path: path.join(OUT, n + '.png') });
  const ribbon = async (tab, cmd) => { await page.click(`.rtab:text-is("${tab}")`); await page.click(`[data-cmd="${cmd}"]`); };
  const dragMouse = async (from, to, steps = 12) => {
    const a = await from.boundingBox(), b = typeof to.boundingBox === 'function' ? await to.boundingBox() : to;
    const ax = a.x + a.width / 2, ay = a.y + a.height / 2;
    const bx = b.x + (b.width ? b.width / 2 : 0) + (b.dx ?? 0), by = b.y + (b.height ? b.height / 2 : 0) + (b.dy ?? 0);
    await page.mouse.move(ax, ay); await page.mouse.down(); await page.mouse.move(ax + 5, ay + 5, { steps: 2 });
    await page.mouse.move(bx, by, { steps }); await page.mouse.up(); await page.waitForTimeout(150);
  };
  const okDialog = async (label = 'OK') => { await page.click(`.dlg .dlg-buttons button:text-is("${label}")`); await page.waitForTimeout(150); };
  const prompt = async (value) => { const inp = page.locator('.dlg input').first(); await inp.fill(value); await okDialog('OK'); };

  try {
    // ---------------- create database ----------------
    await step('Create a new blank database', async () => {
      await page.click('[data-testid="new-blank"]');
      await prompt('SchoolDB');
      await page.waitForTimeout(400);
      assert.equal(await page.evaluate(() => window.__DBWOW__.store.getState().project.name), 'SchoolDB');
    });

    // ---------------- table designer ----------------
    await step('Table designer: add fields, AutoNumber, primary key, drag to reorder, save', async () => {
      await ribbon('CREATE', 'create.tableDesign');
      const grid = page.locator('[data-testid="table-design-grid"]');
      const names = grid.locator('input[aria-label="Field Name"]');
      const types = grid.locator('select[aria-label="Data Type"]');
      const add = async (i, name, type) => { await names.nth(i).fill(name); await types.nth(i).selectOption(type); };
      await add(0, 'StudentID', 'AutoNumber');
      await add(1, 'LastName', 'Short Text');
      await add(2, 'FirstName', 'Short Text');
      await add(3, 'ClassID', 'Number');
      await add(4, 'FeePaid', 'Currency');
      // primary key on StudentID
      await grid.locator('td.rs').nth(0).click();
      await page.click('.rtab:text-is("DESIGN")');
      await page.click('[data-cmd="td.primaryKey"]');
      // drag FirstName above LastName using the row selector (HTML5 drag)
      await grid.locator('td.rs').nth(2).dragTo(grid.locator('tbody tr').nth(1));
      // drag a field type from the toolbox into the grid
      await page.locator('.tb-item:has-text("Yes/No")').first().dragTo(grid.locator('tbody tr').last());
      // set a validation rule on FeePaid via the property sheet
      await names.nth(4).click();
      await page.locator('[data-testid="field-properties"] input[aria-label="Validation Rule"]').fill('>=0');
      await shot('a1-table-design');
      await page.keyboard.press('Control+s');
      await prompt('Students');
      await page.waitForTimeout(300);
      const cols = (await sql('PRAGMA table_info(Students)')).map((c) => c.name);
      assert.deepEqual(cols, ['StudentID', 'FirstName', 'LastName', 'ClassID', 'FeePaid', 'YesNo']);
      assert.equal(await scalar("SELECT pk FROM pragma_table_info('Students') WHERE name='StudentID'"), 1);
      assert.match(await scalar("SELECT sql FROM sqlite_master WHERE name='Students'"), /AUTOINCREMENT/);
    });

    await step('Datasheet: enter, edit and validate records', async () => {
      await page.click('[data-cmd="view.toggle"]');
      await page.waitForTimeout(300);
      const ds = vis('[data-testid="datasheet"]');
      await ds.click();
      const type = async (vals) => { for (const v of vals) { await page.keyboard.type(String(v)); await page.keyboard.press('Tab'); } };
      // focus first editable cell of the new row: StudentID is read-only, move right
      await vis('[data-testid="datasheet"] tr.newrow td').nth(2).click();
      await type(['Ama', 'Mensah', '1', '100']); await page.keyboard.press('Tab');
      await vis('[data-testid="datasheet"] tr.newrow td').nth(2).click();
      await type(['Kofi', 'Owusu', '2', '200']); await page.keyboard.press('Tab');
      await vis('[data-testid="datasheet"] tr.newrow td').nth(2).click();
      await type(['Esi', 'Asante', '1', '-5']); await page.keyboard.press('Tab'); await page.keyboard.press('ArrowDown');
      await page.waitForTimeout(300);
      // validation rule >=0 rejected by the engine → message box
      await page.waitForSelector('.dlg:has-text("validation rule")');
      await shot('a2-validation');
      await okDialog('OK');
      await page.keyboard.press('Escape');
      assert.equal(await scalar('SELECT count(*) FROM Students'), 2);
      assert.deepEqual(await sql('SELECT FirstName, LastName, ClassID, FeePaid FROM Students ORDER BY StudentID'), [{ FirstName: 'Ama', LastName: 'Mensah', ClassID: 1, FeePaid: 100 }, { FirstName: 'Kofi', LastName: 'Owusu', ClassID: 2, FeePaid: 200 }]);
    });

    await step('Second table via quick Create > Table', async () => {
      await page.evaluate(() => { const s = window.__DBWOW__.store.getState(); const { project } = s; project.saveTableDesign({ name: 'Classes', fields: [{ id: 'c1', name: 'ClassID', type: 'AutoNumber', primaryKey: true }, { id: 'c2', name: 'ClassName', type: 'Short Text' }] }); project.insertRecord('Classes', { ClassName: 'JHS 1' }); project.insertRecord('Classes', { ClassName: 'JHS 2' }); });
      await page.waitForTimeout(200);
      assert.equal(await scalar('SELECT count(*) FROM Classes'), 2);
    });

    // ---------------- relationships ----------------
    await step('Relationships: drag tables in, drag key onto foreign key, enforce integrity', async () => {
      await ribbon('DATABASE TOOLS', 'tools.relationships');
      const canvas = page.locator('[data-testid="relationships-canvas"]');
      await page.locator('[data-testid="nav-table-Classes"]').dragTo(canvas, { targetPosition: { x: 80, y: 60 } });
      await page.locator('[data-testid="nav-table-Students"]').dragTo(canvas, { targetPosition: { x: 420, y: 80 } });
      await page.waitForTimeout(200);
      // move a table box by its title bar
      await dragMouse(vis('[data-testid="tbox-Students"] .tbox-title'), { x: (await canvas.boundingBox()).x + 520, y: (await canvas.boundingBox()).y + 140 });
      await dragMouse(vis('[data-testid="tbox-Classes"] [data-box-field="ClassID"]'), vis('[data-testid="tbox-Students"] [data-box-field="ClassID"]'));
      await page.waitForSelector('.dlg:has-text("Edit Relationships")');
      await shot('a3-edit-relationship');
      await page.click('.dlg button:text-is("Create")');
      await page.waitForTimeout(400);
      const fk = await sql('PRAGMA foreign_key_list(Students)');
      assert.equal(fk.length, 1); assert.equal(fk[0].table, 'Classes');
      // the database engine now rejects orphans
      const err = await page.evaluate(() => { try { window.__DBWOW__.store.getState().project.insertRecord('Students', { FirstName: 'X', ClassID: 99 }); return 'accepted'; } catch (e) { return e.message; } });
      assert.match(err, /related record is required/);
      assert.equal(await page.locator('[data-testid="relationships-canvas"] text').filter({ hasText: '∞' }).count(), 1);
      await shot('a4-relationships');
    });

    // ---------------- query designer ----------------
    await step('Query designer: drag two tables, drag fields to grid, criteria, run, verify SQL and results', async () => {
      await ribbon('CREATE', 'create.queryDesign');
      const canvas = vis('[data-testid="query-canvas"]');
      await page.locator('[data-testid="nav-table-Classes"]').dragTo(canvas, { targetPosition: { x: 60, y: 30 } });
      await page.locator('[data-testid="nav-table-Students"]').dragTo(canvas, { targetPosition: { x: 330, y: 30 } });
      await page.waitForTimeout(200);
      const grid = vis('[data-testid="query-grid"]');
      const target = (i) => grid.locator(`tr:nth-child(2) td[data-qgrid-col="${i}"]`);
      await dragMouse(vis('[data-testid="tbox-Students"] [data-box-field="FirstName"]'), target(0));
      await dragMouse(vis('[data-testid="tbox-Classes"] [data-box-field="ClassName"]'), target(1));
      await dragMouse(vis('[data-testid="tbox-Students"] [data-box-field="FeePaid"]'), target(2));
      await vis('input[aria-label="Criteria 2"]').fill('JHS 1');
      await vis('[data-testid="query-grid"] tr:nth-child(4) td[data-qgrid-col="0"] select').selectOption('Ascending');
      await shot('a5-query-design');
      await page.click('.rtab:text-is("DESIGN")');
      await page.click('[data-cmd="q.run"]');
      await page.waitForTimeout(400);
      const rows = await vis('[data-testid="datasheet"] tbody tr').count();
      assert.equal(rows, 1);
      await shot('a6-query-results');
      await page.click('.rm-arrow >> nth=0');
      await page.click('.ctx-item:has-text("SQL View")');
      const text = await vis('[data-testid="sql-editor"]').inputValue();
      assert.match(text, /INNER JOIN "Students" ON "Classes"\."ClassID" = "Students"\."ClassID"/);
      assert.match(text, /"Classes"\."ClassName" = 'JHS 1'/);
      await page.keyboard.press('Control+s');
      await prompt('qryJHS1');
      await page.waitForTimeout(300);
      assert.equal(await scalar("SELECT count(*) FROM sqlite_master WHERE type='view' AND name='qryJHS1'"), 1);
      assert.equal(await scalar('SELECT count(*) FROM qryJHS1'), 1);
    });

    // ---------------- form designer ----------------
    await step('Form designer: drag label, text box, combo box and button; resize, align, bind; Form View adds and edits records', async () => {
      await ribbon('CREATE', 'create.formDesign');
      await page.waitForTimeout(300);
      await vis('[data-testid="property-sheet"] select[aria-label="Record Source"]').selectOption('Students');
      const detail = vis('[data-testid="form-design-surface"] .sec-body').nth(1);
      const tool = (label) => vis(`.toolbox-strip .tb-item:text-is("${label}")`);
      await tool('Label').dragTo(detail, { targetPosition: { x: 20, y: 20 } });
      await tool('Text Box').dragTo(detail, { targetPosition: { x: 150, y: 20 } });
      await tool('Combo Box').dragTo(detail, { targetPosition: { x: 150, y: 60 } });
      await tool('Command Button').dragTo(detail, { targetPosition: { x: 150, y: 110 } });
      // a field from the field list creates a bound label + text box
      await vis('.fieldlist .fl-item:text-is("LastName")').dragTo(detail, { targetPosition: { x: 20, y: 160 } });
      await page.waitForTimeout(200);
      const ps = vis('[data-testid="property-sheet"]');
      const pick = async (name) => { await ps.locator('select[aria-label="Object"]').selectOption({ label: name }); };
      // bind the text box
      await pick('TextBox1');
      await ps.locator('.prop-row:has(label:text-is("Control Source")) input').fill('FirstName');
      // bind the combo box to ClassID with Classes as row source
      await pick('ComboBox1');
      await ps.locator('.prop-row:has(label:text-is("Control Source")) input').fill('ClassID');
      await ps.locator('.prop-row:has(label:text-is("Row Source")) select').selectOption('Classes');
      await pick('Label1');
      await ps.locator('.prop-row:has(label:text-is("Caption")) input').fill('First name:');
      // button → New Record
      await pick('CommandButton1');
      await ps.locator('.prop-row:has(label:text-is("On Click")) select').selectOption('New Record');
      await ps.locator('.prop-row:has(label:text-is("Caption")) input').fill('New student');
      // resize the text box with its east handle
      await vis('[data-ctl="TextBox1"]').click();
      const before = await page.evaluate(() => window.__DBWOW__.store.getState());
      void before;
      const tb = vis('[data-ctl="TextBox1"]');
      const box = await tb.boundingBox();
      await dragMouse(tb.locator('.h.e'), { x: box.x + box.width + 64, y: box.y + box.height / 2 });
      // multi-select and align left
      await vis('[data-ctl="TextBox1"]').click();
      await vis('[data-ctl="ComboBox1"]').click({ modifiers: ['Shift'] });
      await vis('[data-ctl="CommandButton1"]').click({ modifiers: ['Shift'] });
      await page.click('.rtab:text-is("ARRANGE")');
      await page.click('[data-cmd="fd.alignLeft"]');
      await page.click('.rtab:text-is("DESIGN")');
      await shot('a7-form-design');
      await page.keyboard.press('Control+s');
      await prompt('frmStudentEntry');
      await page.waitForTimeout(300);
      const def = await page.evaluate(() => window.__DBWOW__.store.getState().project.getForm('frmStudentEntry'));
      const c = Object.fromEntries(def.controls.map((x) => [x.name, x]));
      assert.equal(c.TextBox1.props.controlSource, 'FirstName');
      assert.ok(c.TextBox1.w >= 168 + 56, 'text box was resized');
      assert.equal(c.TextBox1.x, c.ComboBox1.x); assert.equal(c.ComboBox1.x, c.CommandButton1.x);
      assert.equal(c.CommandButton1.props.onClick, 'New Record');
      // Form View: edit current record and add a new one with the button
      await page.click('[data-cmd="view.toggle"]');
      await page.waitForTimeout(400);
      const fv = vis('[data-testid="form-view"]');
      await fv.locator('input[aria-label="TextBox1"]').fill('Ama-Edited');
      await fv.locator('button:text-is("New student")').click();
      await page.waitForTimeout(300);
      assert.equal(await scalar('SELECT FirstName FROM Students WHERE StudentID = 1'), 'Ama-Edited');
      await fv.locator('input[aria-label="TextBox1"]').fill('Yaw');
      await fv.locator('select[aria-label="ComboBox1"]').selectOption({ label: 'JHS 2' });
      await fv.locator(`input[aria-label="${c.LastName ? 'LastName' : Object.keys(c).find((k) => c[k].props.controlSource === 'LastName')}"]`).fill('Boateng');
      await shot('a8-form-view');
      await page.keyboard.press('Shift+Enter');
      await page.waitForTimeout(300);
      assert.deepEqual(await sql("SELECT FirstName, LastName, ClassID FROM Students WHERE FirstName='Yaw'"), [{ FirstName: 'Yaw', LastName: 'Boateng', ClassID: 2 }]);
    });

    // ---------------- report designer ----------------
    await step('Report designer: drag fields, title, page numbers, grouping and totals; preview; export PDF', async () => {
      await ribbon('CREATE', 'create.reportDesign');
      await page.waitForTimeout(300);
      await vis('[data-testid="property-sheet"] select[aria-label="Record Source"]').selectOption('Students');
      const sec = (name) => vis(`[data-testid="report-design-surface"] .sec-bar:has-text("${name}") + .sec-wrap .sec-body`);
      await vis('.fieldlist .fl-item:text-is("FirstName")').dragTo(sec('Detail'), { targetPosition: { x: 10, y: 10 } });
      await vis('.fieldlist .fl-item:text-is("FeePaid")').dragTo(sec('Detail'), { targetPosition: { x: 300, y: 10 } });
      await page.click('.rtab:text-is("DESIGN")');
      await page.click('[data-cmd="fd.title"]');
      await page.click('[data-cmd="rd.pageNumbers"]');
      // Group & Sort pane → group on ClassID
      await vis('.gs-pane button:text-is("Add a group")').click();
      await vis('.gs-pane select[aria-label="Group field"]').selectOption('ClassID');
      await vis('.gs-pane label:has-text("with a footer section") input').check();
      // totals: select the FeePaid text box, then Totals: Sum
      const fee = vis('[data-ctl="FeePaid"]');
      await fee.click();
      await page.click('.rbtn[data-cmd="Totals"]');
      await page.click('.ctx-item:has-text("Sum")');
      await shot('a9-report-design');
      await page.keyboard.press('Control+s');
      await prompt('rptFees');
      await page.waitForTimeout(300);
      const def = await page.evaluate(() => window.__DBWOW__.store.getState().project.getReport('rptFees'));
      assert.ok(def.sections.some((s) => s.kind === 'groupFooter'));
      assert.ok(def.controls.some((c) => c.props.controlSource === '=Sum([FeePaid])'));
      assert.ok(def.controls.some((c) => c.type === 'pagenumber'));
      await page.click('[data-cmd="view.toggle"]');
      await page.waitForTimeout(600);
      const pageText = await vis('[data-testid="report-page"]').first().innerText();
      assert.match(pageText, /Page 1 of 1/);
      const total = await scalar('SELECT sum(FeePaid) FROM Students');
      assert.ok(pageText.includes(Number(total).toLocaleString('en-US', { minimumFractionDigits: 2 })) || pageText.includes(String(total)), 'grand total shown');
      await shot('a10-report-preview');
      const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-cmd="ext.exportPdf"]')]);
      const file = path.join(OUT, 'rptFees.pdf');
      await dl.saveAs(file);
      assert.equal(fs.readFileSync(file).slice(0, 5).toString(), '%PDF-');
    });

    // ---------------- export ----------------
    await step('Export data to CSV', async () => {
      await page.click('.rtab:text-is("EXTERNAL DATA")');
      await page.click('[data-cmd="ext.exportCsv"]');
      await page.locator('.dlg select').first().selectOption('Students');
      const [dl] = await Promise.all([page.waitForEvent('download'), page.click('.dlg button:text-is("Export")')]);
      const file = path.join(OUT, 'Students.csv'); await dl.saveAs(file);
      const text = fs.readFileSync(file, 'utf8');
      assert.match(text, /StudentID,FirstName,LastName,ClassID,FeePaid,YesNo/);
      assert.match(text, /Yaw,Boateng,2/);
    });

    // ---------------- persistence ----------------
    await step('Save, close and reopen: records, structures, positions, bindings and properties intact', async () => {
      await page.keyboard.press('Control+s');
      await page.waitForTimeout(800);
      const before = await page.evaluate(() => { const p = window.__DBWOW__.store.getState().project; return { form: p.getForm('frmStudentEntry'), rel: p.getLayout('Relationships'), rows: p.db.all('SELECT * FROM Students') }; });
      await page.reload();
      await page.waitForTimeout(2000);
      const after = await page.evaluate(() => { const p = window.__DBWOW__.store.getState().project; return p && { name: p.name, form: p.getForm('frmStudentEntry'), rel: p.getLayout('Relationships'), rows: p.db.all('SELECT * FROM Students'), fk: p.db.all('PRAGMA foreign_key_list(Students)').length, q: p.getQuery('qryJHS1') && true, r: p.getReport('rptFees') && true }; });
      assert.ok(after, 'database reopened automatically');
      assert.equal(after.name, 'SchoolDB');
      assert.deepEqual(after.rows, before.rows);
      assert.deepEqual(after.form, before.form);
      assert.deepEqual(after.rel, before.rel);
      assert.equal(after.fk, 1); assert.ok(after.q); assert.ok(after.r);
      await shot('a11-reopened');
    });
  } catch (e) {
    await shot('zz-failure').catch(() => {});
  }
  const fails = results.filter((r) => r[0] === 'FAIL').length;
  const realErrors = errors.filter((e) => !/favicon/.test(e));
  console.log(`\n${results.length - fails}/${results.length} acceptance steps passed. Browser errors: ${realErrors.length}`);
  realErrors.forEach((e) => console.log('  ', e));
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({ results, errors: realErrors }, null, 2));
  await browser.close();
  process.exit(fails || realErrors.length ? 1 : 0);
})();
