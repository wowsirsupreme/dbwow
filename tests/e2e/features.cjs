// Feature tests: import wizard, filters, find, SQL view, Learning Centre checks,
// navigation pane operations, database tools and small-screen layout.
const { start } = require('./lib.cjs');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const OUT = process.argv[2] || path.resolve(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });
const results = [];
async function step(name, fn) {
  try { await fn(); results.push(['PASS', name]); console.log('PASS', name); }
  catch (e) { results.push(['FAIL', name, e.message]); console.log('FAIL', name, '\n   ', e.message.split('\n').slice(0, 4).join(' | ')); }
}
(async () => {
  const { browser, page, errors } = await start({ url: process.env.WOWDB_URL });
  const vis = (sel) => page.locator('.doc-pane:not(.hidden) ' + sel);
  const sql = (q) => page.evaluate((q) => window.__WOWDB__.store.getState().project.db.all(q), q);
  const scalar = async (q) => Object.values((await sql(q))[0] ?? {})[0];
  const shot = (n) => page.screenshot({ path: path.join(OUT, n + '.png') });
  const ribbon = async (tab, cmd) => { await page.click(`.rtab:text-is("${tab}")`); await page.click(`[data-cmd="${cmd}"]`); };
  const closeAllTabs = async () => { while (await page.locator('.doc-tab .x').count()) { await page.locator('.doc-tab .x').first().click(); await page.waitForTimeout(80); const no = page.locator('.dlg button:text-is("No")'); if (await no.count()) await no.click(); } };

  await page.click('[data-testid="new-sample-school"]');
  await page.waitForTimeout(2500);

  await step('Import wizard: CSV with a bad row, new table, AutoNumber key, summary lists rejected row', async () => {
    const csv = path.join(OUT, 'clubs.csv');
    fs.writeFileSync(csv, 'ClubName,Members,Founded\nRobotics,24,2019-09-01\nChess,abc,2018-01-15\nDrama,31,2020-02-02\n');
    await closeAllTabs();
    const [fc] = await Promise.all([page.waitForEvent('filechooser'), ribbon('EXTERNAL DATA', 'ext.importCsv')]);
    await fc.setFiles(csv);
    await page.waitForSelector('.dlg:has-text("Import Wizard")');
    for (let i = 0; i < 5; i++) await page.click('.dlg button:has-text("Next")');
    // step 6 data types: make Members a Number so "abc" is invalid
    await page.locator('.dlg tr:has(td:text-is("Members")) select').selectOption('Number');
    await page.waitForSelector('.dlg td.bad');
    for (let i = 0; i < 4; i++) await page.click('.dlg button:has-text("Next")');
    await shot('f1-import-confirm');
    await page.click('.dlg button:text-is("Finish")');
    await page.waitForSelector('.dlg:has-text("Import complete")');
    const t = await page.locator('.dlg').innerText();
    assert.match(t, /2<\/b>|2 of 3/);
    assert.match(t, /isn't valid/);
    await shot('f2-import-summary');
    await page.click('.dlg button:text-is("Close")');
    assert.deepEqual(await sql('SELECT ClubName, Members, Founded FROM clubs ORDER BY ID'), [{ ClubName: 'Robotics', Members: 24, Founded: '2019-09-01' }, { ClubName: 'Drama', Members: 31, Founded: '2020-02-02' }]);
  });

  await step('Datasheet: sort, filter by selection, toggle filter, find', async () => {
    await closeAllTabs();
    await page.dblclick('[data-testid="nav-table-Students"]');
    await page.waitForTimeout(300);
    const townCell = vis('[data-testid="datasheet"] tbody tr').nth(0).locator('td').nth(7);
    const town = await townCell.innerText();
    await townCell.click({ button: 'right' });
    await page.click(`.ctx-item:has-text("Equals")`);
    await page.waitForTimeout(300);
    const expected = await scalar(`SELECT count(*) FROM Students WHERE Town = '${town}'`);
    const pos = async () => vis('.dg-nav input.pos').first().inputValue();
    const pv = await pos();
    assert.match(pv, new RegExp(`of ${expected} \\(filtered from 40\\)`));
    assert.equal(await vis('.dg-nav .flt.on').count(), 1);
    await page.click('.rtab:text-is("HOME")');
    await page.click('[data-cmd="home.toggleFilter"]');
    await page.waitForTimeout(200);
    assert.match(await pos(), /of 40$/);
    // sort descending by LastName
    await vis('[data-testid="datasheet"] tbody tr').nth(0).locator('td').nth(3).click();
    await page.click('[data-cmd="home.sortDesc"]');
    await page.waitForTimeout(200);
    const top = await vis('[data-testid="datasheet"] tbody tr').nth(0).locator('td').nth(3).innerText();
    assert.equal(top, await scalar('SELECT LastName FROM Students ORDER BY LastName DESC LIMIT 1'));
    await shot('f3-datasheet-sorted');
  });

  await step('SQL View: GROUP BY with HAVING runs and saves as a view', async () => {
    await ribbon('CREATE', 'create.sql');
    await vis('[data-testid="sql-editor"]').fill('SELECT Town, COUNT(*) AS Students, SUM(FeePaid) AS Fees\nFROM Students\nGROUP BY Town\nHAVING COUNT(*) > 3\nORDER BY Fees DESC;');
    await page.keyboard.press('Control+Enter');
    await page.waitForTimeout(400);
    const n = await scalar('SELECT count(*) FROM (SELECT Town FROM Students GROUP BY Town HAVING COUNT(*) > 3)');
    assert.equal(await vis('[data-testid="datasheet"] tbody tr').count(), n);
    await shot('f4-sql-results');
    await page.keyboard.press('Control+s');
    await page.locator('.dlg input').fill('qryTownFees'); await page.click('.dlg button:text-is("OK")');
    await page.waitForTimeout(300);
    assert.equal(await scalar("SELECT count(*) FROM sqlite_master WHERE type='view' AND name='qryTownFees'"), 1);
  });

  await step('SQL that cannot be drawn stays in SQL View with an explanation', async () => {
    await ribbon('CREATE', 'create.sql');
    await vis('[data-testid="sql-editor"]').fill('SELECT FirstName FROM Students WHERE FeePaid > (SELECT AVG(FeePaid) FROM Students)');
    await page.click('.rm-arrow >> nth=0');
    await page.click('.ctx-item:has-text("Design View")');
    await page.waitForSelector('.doc-pane:not(.hidden) .banner.warn:has-text("cannot be shown exactly")');
    assert.equal(await vis('[data-testid="sql-editor"]').count(), 1);
  });

  await step('Learning Centre: practical steps are verified against the database', async () => {
    await closeAllTabs();
    await ribbon('HELP', 'help.learning');
    await vis('.lc-side .it:has-text("School: students from Accra")').click();
    await page.waitForTimeout(200);
    assert.equal(await vis('.step.done').count(), 0);
    await page.evaluate(() => window.__WOWDB__.store.getState().project.saveQuery({ name: 'qryAccra', kind: 'select', sql: "SELECT FirstName, LastName, Town FROM Students WHERE Town = 'Accra'" }));
    await page.evaluate(() => window.__WOWDB__.store.getState().bump());
    await page.waitForTimeout(300);
    assert.equal(await vis('.step.done').count(), 1);
    await vis('.lc-side .it:has-text("Primary keys")').click();
    await vis('.quiz-opt').nth(1).click();
    assert.equal(await vis('.quiz-opt.right').count(), 1);
    await shot('f5-learning');
  });

  await step('Learning Mode shows contextual tips in designers', async () => {
    await page.click('.titlebar button:has-text("Learning Mode")');
    await page.dblclick('[data-testid="nav-table-Classes"]');
    await page.waitForSelector('.doc-pane:not(.hidden) .learn-bar');
    await page.click('.titlebar button:has-text("Learning Mode")');
  });

  await step('Navigation Pane: rename and duplicate objects; open tabs follow the rename', async () => {
    await closeAllTabs();
    await page.dblclick('[data-testid="nav-form-frmTeachers"]');
    await page.click('[data-testid="nav-form-frmTeachers"]', { button: 'right' });
    await page.click('.ctx-item:text-is("Rename")');
    await page.locator('.dlg input').fill('frmStaff'); await page.click('.dlg button:text-is("OK")');
    await page.waitForTimeout(300);
    assert.equal(await page.locator('[data-testid="nav-form-frmStaff"]').count(), 1);
    assert.equal(await page.locator('.doc-tab:has-text("frmStaff")').count(), 1);
    await page.click('[data-testid="nav-table-Classes"]', { button: 'right' });
    await page.click('.ctx-item:has-text("Copy (duplicate)")');
    await page.locator('.dlg input').fill('ClassesCopy'); await page.click('.dlg button:text-is("OK")');
    await page.click('.dlg button:text-is("Structure and Data")');
    await page.waitForTimeout(300);
    assert.equal(await scalar('SELECT count(*) FROM ClassesCopy'), 5);
  });

  await step('Relationships: junction table for many-to-many', async () => {
    await page.evaluate(() => { const p = window.__WOWDB__.store.getState().project; p.saveTableDesign({ name: 'Societies', fields: [{ id: 'k1', name: 'SocietyID', type: 'AutoNumber', primaryKey: true }, { id: 'k2', name: 'Name', type: 'Short Text' }] }); });
    await ribbon('DATABASE TOOLS', 'tools.relationships');
    await page.click('[data-cmd="rel.junction"]');
    await page.locator('.dlg select').nth(0).selectOption('Students');
    await page.locator('.dlg select').nth(1).selectOption('Societies');
    await page.click('.dlg button:text-is("Create")');
    await page.waitForTimeout(400);
    const fks = await sql("PRAGMA foreign_key_list(StudentsSocieties)");
    assert.equal(fks.length, 2);
    assert.equal(await scalar("SELECT count(*) FROM pragma_table_info('StudentsSocieties') WHERE pk > 0"), 2);
    await shot('f6-junction');
  });

  await step('Database tools: integrity checker, documenter, dependencies, statistics, compact', async () => {
    for (const [cmd, text] of [['tools.integrity', 'Integrity Checker'], ['tools.documenter', 'Database Documenter'], ['tools.dependencies', 'Object Dependencies'], ['tools.statistics', 'Database Statistics'], ['tools.performance', 'Performance Analyzer']]) {
      await ribbon('DATABASE TOOLS', cmd);
      await page.waitForSelector(`.doc-pane:not(.hidden) h1:has-text("${text}")`);
    }
    await shot('f7-integrity');
    await closeAllTabs();
    await ribbon('DATABASE TOOLS', 'tools.compact');
    await page.waitForSelector('.dlg:has-text("Integrity check: ok")');
    await page.click('.dlg button:text-is("OK")');
  });

  await step('Form with subform: moving between classes shows each class\'s students', async () => {
    await page.dblclick('[data-testid="nav-form-frmClassesWithStudents"]');
    await page.waitForTimeout(400);
    const count = async () => Number((await vis('[data-testid="subform-view"] .dg-nav input.pos').inputValue()).split(' of ')[1]);
    const first = await count();
    assert.equal(first, await scalar('SELECT count(*) FROM Students WHERE ClassID = 1'));
    await vis('.fv > .dg-nav button[title="Next record"]').click();
    await page.waitForTimeout(300);
    assert.equal(await count(), await scalar('SELECT count(*) FROM Students WHERE ClassID = 2'));
  });

  await step('Ribbon: Format/Arrange/Themes tabs, Tell Me, query Union/Insert Rows/Table Names, Create New relationship, Hide Details', async () => {
    const proj = (fn, arg) => page.evaluate(([fn, arg]) => { const p = window.__WOWDB__.store.getState().project; return JSON.parse(JSON.stringify(p[fn](arg) ?? null)); }, [fn, arg]);
    await closeAllTabs();
    // form: Format tab bold + font + colour, Theme from the Design tab, Size/Space from Arrange
    await page.click('[data-testid="nav-form-frmStudents"]', { button: 'right' });
    await page.click('.ctx-item:has-text("Design View")');
    await page.waitForTimeout(500);
    const names = (await proj('getForm', 'frmStudents')).controls.filter((c) => c.type === 'textbox').map((c) => c.name);
    await vis(`[data-ctl="${names[0]}"]`).click();
    await vis(`[data-ctl="${names[1]}"]`).click({ modifiers: ['Shift'] });
    await page.click('.rtab:text-is("FORMAT")');
    await page.click('[data-cmd="fmt.bold"]');
    await page.selectOption('select[data-cmd="fmt.fontName"]', 'Georgia');
    await page.locator('input[data-cmd="fmt.foreColor"]').evaluate((el) => { const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(el, '#aa0000'); el.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.click('.rtab:text-is("ARRANGE")');
    await page.click('.rbtn[data-cmd="Size/ Space"]');
    await page.click('.ctx-item:has-text("To Widest")');
    await page.click('.rtab:text-is("DESIGN")');
    await page.click('.rbtn[data-cmd="Themes"]');
    await page.click('.ctx-item:has-text("Forest")');
    await page.keyboard.press('Control+s');
    await page.waitForTimeout(400);
    const f = await proj('getForm', 'frmStudents');
    const [a, b] = names.map((n) => f.controls.find((c) => c.name === n));
    assert.equal(a.props.fontWeight, 'Bold'); assert.equal(b.props.fontWeight, 'Bold');
    assert.equal(a.props.foreColor, '#aa0000');
    assert.equal(a.props.fontName, 'Calibri', 'Forest theme sets its font after the Georgia choice');
    assert.equal(a.w, b.w);
    assert.equal(f.sections.find((x) => x.kind === 'formHeader').backColor, '#d8eadb');
    await shot('f9-form-format');
    // Tell Me: find and run a command by name
    await closeAllTabs();
    await page.click('[data-testid="nav-query-qryStudentsByClass"]', { button: 'right' });
    await page.click('.ctx-item:has-text("Design View")');
    await page.waitForTimeout(400);
    const orRows = () => vis('.qgrid th.rowhead').count();
    const before = await orRows();
    await vis('input[aria-label="Criteria 1"]').click();
    await page.click('[data-cmd="q.insertRows"]');
    assert.equal(await orRows(), before + 1, 'Insert Rows adds a criteria row');
    await page.click('[data-cmd="q.tableNames"]');
    assert.equal(await vis('.qgrid th.rowhead:text-is("Table:")').count(), 0, 'Table Names hides the Table row');
    await page.click('[data-cmd="q.tableNames"]');
    await page.fill('input[aria-label="Tell me what you want to do"]', 'union');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(400);
    const sqlText = await vis('textarea[data-testid="sql-editor"]').inputValue();
    assert.match(sqlText, /\nUNION\n/);
    // Create New in Edit Relationships
    await closeAllTabs();
    await ribbon('DATABASE TOOLS', 'tools.relationships');
    await page.waitForTimeout(500);
    await page.locator('path.hit').first().dblclick({ force: true });
    await page.waitForSelector('.dlg:has-text("Edit Relationships")');
    assert.ok(await page.locator('.dlg select').first().isDisabled());
    await page.click('.dlg button:has-text("Create New")');
    assert.ok(!(await page.locator('.dlg select').first().isDisabled()));
    await page.click('.dlg button:text-is("Cancel")');
    // report: Hide Details + Totals menu
    await closeAllTabs();
    await page.click('[data-testid="nav-report-rptFeesByClass"]', { button: 'right' });
    await page.click('.ctx-item:has-text("Design View")');
    await page.waitForTimeout(500);
    await page.click('[data-cmd="rd.hideDetails"]');
    await page.keyboard.press('Control+s');
    await page.waitForTimeout(300);
    assert.equal((await proj('getReport', 'rptFeesByClass')).sections.find((x) => x.kind === 'detail').visible, false);
    await page.click('[data-cmd="view.toggle"]');
    await page.waitForTimeout(600);
    assert.equal(await vis('[data-testid="report-page"]:has-text("Owusu")').count(), 0, 'detail rows hidden in preview');
    assert.ok(await vis('[data-testid="report-page"]:has-text("Subtotal")').count() > 0, 'group totals still printed');
  });

  await step('Phone-width layout has no horizontal page scroll', async () => {
    await page.setViewportSize({ width: 390, height: 800 });
    await page.waitForTimeout(300);
    const sw = await page.evaluate(() => document.documentElement.scrollWidth);
    assert.ok(sw <= 391, `scrollWidth ${sw}`);
    await shot('f8-phone');
    await page.setViewportSize({ width: 1400, height: 860 });
  });

  const fails = results.filter((r) => r[0] === 'FAIL').length;
  console.log(`\n${results.length - fails}/${results.length} feature steps passed. Browser errors: ${errors.length}`);
  errors.forEach((e) => console.log('  ', e));
  fs.writeFileSync(path.join(OUT, 'feature-results.json'), JSON.stringify({ results, errors }, null, 2));
  await browser.close();
  process.exit(fails || errors.length ? 1 : 0);
})();
