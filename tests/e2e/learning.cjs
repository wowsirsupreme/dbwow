// Live practical checklist and achievements, driven like a student would.
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
  const { browser, page, errors } = await start({ url: process.env.DBWOW_URL });
  const shot = (n) => page.screenshot({ path: path.join(OUT, n + '.png') });
  const ribbon = async (tab, cmd) => { await page.click(`.rtab:text-is("${tab}")`); await page.click(`[data-cmd="${cmd}"]`); };
  const okDialog = async (label = 'OK') => { await page.click(`.dlg .dlg-buttons button:text-is("${label}")`); await page.waitForTimeout(150); };
  const prompt = async (value) => { const inp = page.locator('.dlg input').first(); await inp.fill(value); await okDialog('OK'); };
  const panelStep = (i) => page.locator(`[data-testid="practical-panel"] .pp-step[data-step="${i}"]`);
  const progress = () => page.evaluate(() => JSON.parse(localStorage.getItem('wowdb.learning') || '{}'));

  await step('Practical panel stays beside the work and ticks steps live (pending until saved)', async () => {
    await page.click('[data-testid="new-blank"]');
    await prompt('SchoolDB');
    await page.waitForTimeout(400);
    await ribbon('HELP', 'help.learning');
    await page.click('.lc-side .it:has-text("Create a Student Database")');
    await page.click('[data-testid="work-alongside"]');
    await page.waitForSelector('[data-testid="practical-panel"]');
    await page.waitForTimeout(500);
    assert.match(await panelStep(0).getAttribute('class'), /done/, 'step 1 (SchoolDB) done');
    // close the Learning Centre: the panel must stay
    await page.locator('.doc-tab .x').first().click();
    await ribbon('CREATE', 'create.tableDesign');
    const grid = page.locator('[data-testid="table-design-grid"]');
    await grid.locator('input[aria-label="Field Name"]').nth(0).fill('StudentID');
    await grid.locator('select[aria-label="Data Type"]').nth(0).selectOption('AutoNumber');
    await grid.locator('input[aria-label="Field Name"]').nth(1).fill('FirstName');
    await grid.locator('select[aria-label="Data Type"]').nth(1).selectOption('Short Text');
    await page.waitForTimeout(500);
    assert.ok(await page.locator('[data-testid="practical-panel"]').isVisible(), 'panel visible while designing');
    assert.match(await panelStep(2).getAttribute('class'), /pending/, 'StudentID seen in unsaved design');
    assert.match(await panelStep(3).getAttribute('class'), /pending/, 'AutoNumber seen in unsaved design');
    assert.match(await panelStep(5).getAttribute('class'), /pending/, 'FirstName seen in unsaved design');
    await shot('l1-practical-pending');
    await page.keyboard.press('Control+s');
    await prompt('Students');
    await page.waitForTimeout(200);
    if (await page.locator('.dlg button:text-is("Yes")').count()) await page.click('.dlg button:text-is("Yes")');
    await page.waitForTimeout(700);
    for (const i of [1, 2, 3, 4, 5]) assert.match(await panelStep(i).getAttribute('class'), /done/, `step ${i + 1} done after save`);
    assert.match(await panelStep(6).getAttribute('class'), /current/, 'LastName is the next step');
    const pr = await progress();
    assert.equal(pr.steps['schooldb:2'], true);
    await shot('l2-practical-saved');
  });

  await step('Achievements unlock from real evidence, with a notification, XP and rank', async () => {
    await page.waitForSelector('.lt-toast.achievement');
    const titles = await page.locator('.lt-toast.achievement .lt-toast-title').allTextContents();
    assert.ok(titles.some((t) => t.includes('Table Setter')), 'Table Setter toast: ' + titles.join(', '));
    const pr = await progress();
    for (const id of ['first-table', 'key-holder', 'auto-pilot', 'first-step']) assert.ok(pr.achievements[id], id);
    assert.ok(!pr.achievements['connector'], 'no relationship yet');
    const badge = await page.locator('[data-testid="rank-badge"]').textContent();
    const xp = Number(/(\d+) XP/.exec(badge)[1]);
    assert.equal(xp, 6 * 10 + 15 * 4, 'six verified steps + four bronze trophies');
    await page.click('[data-testid="rank-badge"]');
    await page.waitForSelector('[data-ach="first-table"][data-unlocked="yes"]');
    assert.equal(await page.locator('[data-ach="connector"]').getAttribute('data-unlocked'), 'no');
    await shot('l3-achievements');
  });

  await step('Action trophies: running SQL in SQL View', async () => {
    await ribbon('CREATE', 'create.sql');
    await page.waitForTimeout(300);
    await page.locator('.doc-pane:not(.hidden) textarea[data-testid="sql-editor"]').fill('SELECT * FROM Students');
    await page.click('[data-cmd="q.run"]');
    await page.waitForTimeout(700);
    assert.ok((await progress()).achievements['sql-speaker']);
  });

  await step('Progress, trophies and the open checklist survive a reload', async () => {
    await page.reload();
    await page.waitForTimeout(2000);
    await page.waitForSelector('[data-testid="practical-panel"]');
    assert.match(await panelStep(4).getAttribute('class'), /done/);
    assert.equal(await page.locator('.lt-toast').count(), 0, 'no toast burst on reload');
  });

  const fails = results.filter((r) => r[0] === 'FAIL').length;
  console.log(`\n${results.length - fails}/${results.length} learning steps passed. Browser errors: ${errors.length}`);
  errors.forEach((e) => console.log('  ', e));
  await browser.close();
  process.exit(fails || errors.length ? 1 : 0);
})();
