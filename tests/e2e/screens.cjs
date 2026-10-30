// Captures the reference screens used in the README (docs/screenshots).
// Each screen mirrors one of the Access reference layouts: table design with
// Field Properties, query design grid, Edit Relationships, form design
// (Design/Arrange/Format), report design with banded sections, print preview.
const { start } = require('./lib.cjs');
const fs = require('node:fs');
const out = process.argv[2] || 'docs/screenshots';
fs.mkdirSync(out, { recursive: true });
(async () => {
  const { browser, page, errors } = await start(process.env.WOWDB_URL ? { url: process.env.WOWDB_URL } : {});
  const shot = async (n) => { await page.waitForTimeout(450); await page.screenshot({ path: `${out}/${n}.png` }); console.log('shot', n); };
  const closeAll = async () => { for (;;) { const x = await page.$('.doc-tab .x'); if (!x) break; await x.click(); await page.waitForTimeout(150); const no = await page.$('.dlg button:has-text("No")'); if (no) await no.click(); } };
  const ribbonTab = (label) => page.click(`.rtab:text-is("${label}")`);

  await page.click('[data-testid="new-sample-school"]');
  await page.waitForTimeout(2500);
  await closeAll();

  // 1. Table design: Students, a Short Text field selected
  await page.click('[data-testid="nav-table-Students"]', { button: 'right' });
  await page.click('.ctx-item:has-text("Design View")');
  await page.waitForTimeout(500);
  const rows = await page.$$('.td-grid input[aria-label="Field Name"]');
  if (rows[3]) await rows[3].click();
  await shot('01-table-design');

  // 2. Datasheet
  await closeAll();
  await page.dblclick('[data-testid="nav-table-Students"]');
  await shot('02-datasheet');

  // 3. Query design
  await closeAll();
  await page.click('[data-testid="nav-query-qryStudentsByClass"]', { button: 'right' });
  await page.click('.ctx-item:has-text("Design View")');
  await shot('03-query-design');
  await page.click('[data-cmd="view.sql"]').catch(async () => { await page.click('[data-cmd="view.toggle"] .rm-arrow'); await page.click('.ctx-item:has-text("SQL View")'); });
  await shot('04-query-sql');

  // 4. Relationships + Edit Relationships dialog
  await closeAll();
  await ribbonTab('DATABASE TOOLS');
  await page.click('[data-cmd="tools.relationships"]');
  await page.waitForTimeout(700);
  await shot('05-relationships');
  const line = await page.$('path.hit');
  if (line) { await line.dblclick({ force: true }).catch(() => {}); await page.waitForTimeout(500); await shot('06-edit-relationships'); await page.keyboard.press('Escape'); }

  // 5. Form design
  await closeAll();
  await page.click('[data-testid="nav-form-frmStudents"]', { button: 'right' });
  await page.click('.ctx-item:has-text("Design View")');
  await page.waitForTimeout(600);
  await shot('07-form-design');
  await page.click('[data-ctl]');
  await ribbonTab('FORMAT');
  await shot('08-form-format');
  await ribbonTab('ARRANGE');
  await shot('09-form-arrange');
  await ribbonTab('DESIGN');
  await page.click('[data-cmd="view.toggle"]').catch(() => {});
  await ribbonTab('HOME').catch(() => {});
  await page.waitForTimeout(500);
  await shot('10-form-view');

  // 6. Report design + preview
  await closeAll();
  await page.click('[data-testid="nav-report-rptFeesByClass"]', { button: 'right' });
  await page.click('.ctx-item:has-text("Design View")');
  await page.waitForTimeout(600);
  await shot('11-report-design');
  await ribbonTab('PAGE SETUP');
  await shot('12-report-page-setup');
  await ribbonTab('DESIGN');
  await page.click('[data-cmd="view.toggle"]');
  await page.waitForTimeout(900);
  await shot('13-report-preview');

  console.log(JSON.stringify(errors, null, 1));
  await browser.close();
})();
