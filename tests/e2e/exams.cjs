// Practical tests end to end: a teacher and students on separate browsers sharing
// the stand-in cloud. Teacher creates a class and a test; a student joins, takes
// the test (with tab switches and a paste), the teacher watches live, marks and
// releases; the student sees the result. Also: resume after reload, Learning
// Centre locked during the test, study analytics recorded.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const fakecloud = require('./fakecloud.cjs');
const OUT = process.argv[2] || path.resolve(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });
const URL = process.env.DBWOW_URL ?? 'file://' + path.resolve(__dirname, '../../dist-portable/index.html');
const results = [];
async function step(name, fn) {
  try { await fn(); results.push(['PASS', name]); console.log('PASS', name); }
  catch (e) { results.push(['FAIL', name, e.message]); console.log('FAIL', name, '\n   ', e.message.split('\n').slice(0, 5).join(' | ')); }
}
(async () => {
  const cloud = await fakecloud.start();
  const browser = await chromium.launch();
  const errors = [];
  const device = async (label) => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 880 } });
    await ctx.addInitScript((url) => { window.__DBWOW_FAKE_CLOUD__ = url; window.__DBWOW_TEST_TEACHERS__ = ['teacher@school.test']; }, cloud.url);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`${label} pageerror: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`${label} console: ${m.text()}`); });
    await page.goto(URL); await page.waitForTimeout(1500);
    return { ctx, page };
  };
  const register = async (page, name, email) => {
    await page.click('[data-testid="sign-in"]');
    await page.click('.auth-tabs button:text-is("Register")');
    await page.fill('input[aria-label="Your name"]', name);
    await page.fill('input[aria-label="Email"]', email);
    await page.fill('input[aria-label="Password"]', 'secret1');
    await page.fill('input[aria-label="Confirm password"]', 'secret1');
    await page.click('.dlg button[type="submit"]');
    await page.waitForSelector('[data-testid="account-button"]');
  };
  const prompt = async (page, value) => { await page.locator('.dlg input').first().fill(value); await page.click('.dlg .dlg-buttons button:text-is("OK")'); await page.waitForTimeout(250); };
  const hide = (page) => page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  const attempts = () => Object.values(cloud.dump('attempt/'));

  const T = await device('teacher');
  let classCode, testCode;

  await step('Teacher: register, create a class and a test from the task bank, try the key, open it', async () => {
    const { page } = T;
    await register(page, 'Mr Wilfred', 'teacher@school.test');
    await page.waitForSelector('[data-testid="teacher-button"]');
    await page.click('[data-testid="teacher-button"]');
    await page.waitForSelector('[data-testid="teacher"]');
    await page.click('.tz-nav:has-text("Classes")');
    await page.click('[data-testid="new-class"]'); await prompt(page, 'Form 3A');
    classCode = (await page.locator('[data-testid="class-code"]').textContent()).trim();
    assert.match(classCode, /^[A-Z0-9]{6}$/);
    await page.click('.tz-nav:has-text("Tests")');
    await page.click('[data-testid="new-test"]');
    await page.fill('input[aria-label="Test title"]', 'Student table practical');
    await page.fill('input[aria-label="Duration"]', '30');
    await page.fill('textarea[aria-label="Instructions"]', 'Build the Students table described below.');
    await page.click('[data-testid="task-bank"]');
    for (const t of ['Create a table called Students.', 'Add StudentID as an AutoNumber field', 'Enter at least 5 students.']) await page.locator('.dlg label.chk').filter({ hasText: t }).locator('input').check();
    await page.click('.dlg button:has-text("Add 3 tasks")');
    // one more task written by hand: a custom check
    await page.click('[data-testid="add-task"]');
    await page.locator('textarea[aria-label="Task 4 wording"]').fill('Add a LastName field.');
    await page.locator('[data-testid="task-edit"]').nth(3).locator('select[aria-label="Check type"]').selectOption('field');
    await page.locator('[data-testid="task-edit"]').nth(3).locator('input[aria-label="Table"]').fill('Students');
    await page.locator('[data-testid="task-edit"]').nth(3).locator('input[aria-label="Field"]').fill('LastName');
    await page.screenshot({ path: path.join(OUT, 'x1-test-builder.png') });
    // try the key against a model answer: the School sample
    await page.click('[data-testid="save-test"]');
    await page.waitForSelector('[data-testid="test-row"]');
    testCode = (await page.locator('[data-testid="test-code"]').first().textContent()).trim();
    await page.click('[data-testid="open-test"]');
    await page.waitForTimeout(300);
    const t = Object.values(cloud.dump('test/'))[0];
    assert.equal(t.status, 'open'); assert.equal(t.tasks.length, 4);
    assert.ok(!JSON.stringify(t).includes('primaryKey'), 'the public test holds no marking key');
    assert.equal(Object.values(cloud.dump('key/'))[0].tasks.length, 4);
  });

  const S = await device('student');
  await step('Student: must sign in, joins the class, starts the test; learning aids are locked', async () => {
    const { page } = S;
    await page.click('[data-testid="bs-tests"]');
    assert.match(await page.locator('.bs-main, .backstage').first().textContent(), /need to sign in/);
    await register(page, 'Ama Mensah', 'ama@school.test');
    await page.click('.rtab:text-is("FILE")').catch(() => undefined);
    await page.click('[data-testid="bs-tests"]');
    await page.fill('input[aria-label="Class code"]', classCode);
    await page.click('[data-testid="join-class"]');
    await page.waitForSelector('text=You joined Form 3A');
    await page.fill('input[aria-label="Test code"]', testCode);
    await page.click('[data-testid="find-test"]');
    await page.waitForSelector('[data-testid="test-intro"]');
    await page.screenshot({ path: path.join(OUT, 'x2-test-intro.png') });
    await page.click('[data-testid="start-test"]');
    await page.waitForSelector('[data-testid="exam-panel"]');
    if (await page.locator('[data-testid="fullscreen-cover"]').count()) await page.click('[data-testid="return-fullscreen"]');
    assert.match(await page.locator('[data-testid="exam-timer"]').textContent(), /^\s*(29|30):\d\d/);
    assert.equal(await page.locator('.xp-task').count(), 4);
    // learning centre closed
    await page.click('.rtab:text-is("HELP")'); await page.click('[data-cmd="help.learning"]');
    await page.waitForTimeout(300);
    assert.equal(await page.locator('.doc-tab:has-text("Learning Centre")').count(), 0);
  });

  await step('Student works; tab switches, a paste and changes are recorded and visible live to the teacher', async () => {
    const { page } = S;
    await page.evaluate(() => {
      const p = window.__DBWOW__.store.getState().project;
      p.saveTableDesign({ name: 'Students', fields: [{ id: 'a', name: 'StudentID', type: 'AutoNumber', primaryKey: true }, { id: 'b', name: 'FirstName', type: 'Short Text' }, { id: 'c', name: 'LastName', type: 'Short Text' }] });
      for (const n of ['Ama', 'Kofi', 'Esi', 'Yaw', 'Akua']) p.insertRecord('Students', { FirstName: n, LastName: 'Test' });
      p.db.notify();
    });
    for (let i = 0; i < 3; i++) { await hide(page); await page.waitForTimeout(150); }
    await page.evaluate(() => { const dt = new DataTransfer(); dt.setData('text/plain', 'x'.repeat(300)); document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true })); });
    await page.click('.xp-foot button:has-text("Save now")');
    await page.waitForFunction(() => /Saved \d/.test(document.querySelector('.xp-foot')?.textContent ?? ''), null, { timeout: 10000 });
    await page.screenshot({ path: path.join(OUT, 'x3-student-test.png') });
    assert.equal(await page.locator('.lt-toast.achievement').count(), 0, 'no trophies pop up during the test');
    await hide(page);   // flush counters
    await page.waitForTimeout(800);
    const tp = T.page;
    await tp.click('[data-testid="monitor-test"]');
    await tp.waitForSelector('[data-testid="monitor-row"]');
    await tp.waitForFunction(() => Number(document.querySelector('[data-testid="tabs-count"]')?.textContent) >= 3, null, { timeout: 15000 });
    assert.match(await tp.locator('[data-testid="monitor-row"]').getAttribute('class'), /flag/, 'row flagged for review');
    await tp.click('[data-testid="mark-progress"]');
    await tp.waitForFunction(() => /\d+\/\d+/.test(document.querySelector('[data-testid="monitor-row"] td:nth-child(4)')?.textContent ?? ''), null, { timeout: 15000 });
    assert.match(await tp.locator('[data-testid="monitor-row"] td:nth-child(4)').textContent(), /6\/6/);
    await tp.screenshot({ path: path.join(OUT, 'x4-live-monitor.png') });
    const a = attempts()[0];
    assert.ok(a.counters.pastes >= 1 && a.counters.pastedChars >= 300, 'paste recorded');
    assert.ok(a.counters.actions >= 1, 'changes counted');
  });

  await step('Student hands in; the teacher marks, adjusts, releases; the student sees the result', async () => {
    const { page } = S;
    await page.click('[data-testid="submit-test"]');
    await page.click('.dlg button:text-is("Submit")');
    await page.waitForSelector('[data-testid="close-exam"]');
    assert.equal(attempts()[0].status, 'submitted');
    assert.equal(attempts()[0].score, undefined, 'no mark in the attempt before release');
    const tp = T.page;
    await tp.click('.tz-nav:has-text("Tests")');
    await tp.click('[data-testid="results-test"]');
    await tp.click('[data-testid="mark-all"]');
    await tp.waitForFunction(() => /6 \/ 6/.test(document.querySelector('[data-testid="result-score"]')?.textContent ?? ''), null, { timeout: 15000 });
    await tp.locator('input[aria-label="Adjustment"]').fill('-1');
    await tp.locator('input[aria-label="Comment"]').click();
    await tp.locator('input[aria-label="Comment"]').fill('Good work');
    await tp.locator('h1').click();
    await tp.waitForTimeout(400);
    await tp.screenshot({ path: path.join(OUT, 'x5-results.png') });
    const [sheet] = await Promise.all([tp.waitForEvent('download'), tp.click('[data-testid="print-all"]')]);
    assert.match(sheet.suggestedFilename(), /results\.pdf$/);
    assert.equal(fs.readFileSync(await sheet.path()).subarray(0, 5).toString(), '%PDF-');
    await tp.click('[data-testid="release"]');
    await tp.click('.dlg button:text-is("Yes")');
    await tp.waitForSelector('text=Released to students');
    await page.click('[data-testid="close-exam"]');
    await page.click('.rtab:text-is("FILE")');
    await page.click('[data-testid="bs-tests"]');
    await page.waitForSelector('[data-testid="my-score"]');
    assert.equal((await page.locator('[data-testid="my-score"]').textContent()).trim(), '5 / 6');
    await page.locator('[data-testid="my-result"] b').first().click();
    await page.waitForSelector('text=Teacher\'s comment: Good work');
    const [mine] = await Promise.all([page.waitForEvent('download'), page.click('[data-testid="print-my-result"]')]);
    assert.match(mine.suggestedFilename(), /result\.pdf$/);
    assert.equal(fs.readFileSync(await mine.path()).subarray(0, 5).toString(), '%PDF-');
  });

  await step('A second student reloads mid-test and carries on with the same deadline', async () => {
    const S2 = await device('student2');
    const { page } = S2;
    await register(page, 'Kojo Asante', 'kojo@school.test');
    await page.click('.rtab:text-is("FILE")').catch(() => undefined);
    await page.click('[data-testid="bs-tests"]');
    await page.fill('input[aria-label="Test code"]', testCode);
    await page.click('[data-testid="find-test"]');
    await page.click('[data-testid="start-test"]');
    await page.waitForSelector('[data-testid="exam-panel"]');
    const before = attempts().find((a) => a.email === 'kojo@school.test');
    await page.reload(); await page.waitForTimeout(2500);
    await page.waitForSelector('[data-testid="exam-panel"]');
    await page.waitForTimeout(21000);   // one monitoring flush
    const after = attempts().find((a) => a.email === 'kojo@school.test');
    assert.equal(after.deadline, before.deadline, 'deadline unchanged');
    assert.equal(after.counters.reloads, 1, 'reload recorded');
    await S2.ctx.close();
  });

  await step('Study analytics: the teacher sees the student\'s activity and test mark', async () => {
    const days = Object.entries(cloud.dump('day/'));
    assert.ok(days.length >= 1, 'activity recorded');
    const tp = T.page;
    await tp.click('.tz-nav:has-text("Student progress")');
    await tp.waitForSelector('[data-testid="student-row"]');
    const row = tp.locator('[data-testid="student-row"]').filter({ hasText: 'Ama Mensah' });
    assert.match(await row.textContent(), /83%/, 'latest test mark shown');
    await row.locator('button:has-text("Details")').click();
    await tp.waitForSelector('[data-testid="student-detail"] svg');
    await tp.screenshot({ path: path.join(OUT, 'x6-student-progress.png') });
  });

  await step('Teacher: a ready-made test for another sample, model answer earns full marks, more tasks from that database\'s bank', async () => {
    const tp = T.page;
    await tp.click('.tz-nav:has-text("Tests")');
    await tp.click('[data-testid="new-test"]');
    await tp.click('[data-testid="ready-made"]');
    await tp.click('[data-testid="ready-farm"]');
    await tp.locator('.dlg label.chk').filter({ hasText: 'Extended' }).locator('input').check();
    await tp.screenshot({ path: path.join(OUT, 'x7-ready-made.png') });
    await tp.click('[data-testid="ready-use"]');
    await tp.waitForFunction(() => document.querySelectorAll('[data-testid="task-edit"]').length === 8);
    assert.match(await tp.inputValue('input[aria-label="Test title"]'), /Farm Co-operative: Extended/);
    await tp.click('[data-testid="build-model"]');
    await tp.waitForSelector('[data-testid="key-preview"]');
    assert.match(await tp.locator('[data-testid="key-preview"]').textContent(), /^20 \/ 20 on the model answer/);
    await tp.click('[data-testid="task-bank"]');
    await tp.waitForSelector('[data-testid="bank-task"]');
    assert.equal(await tp.inputValue('select[aria-label="Bank database"]'), 'farm');
    await tp.locator('[data-testid="bank-task"]').nth(0).check();
    await tp.locator('[data-testid="bank-task"]').nth(4).check();
    await tp.click('[data-testid="bank-add"]');
    await tp.waitForFunction(() => document.querySelectorAll('[data-testid="task-edit"]').length === 10);
    await tp.click('[data-testid="build-model"]');
    await tp.waitForFunction(() => /^24 \/ 24/.test(document.querySelector('[data-testid="key-preview"]')?.textContent ?? ''));
    await tp.click('[data-testid="save-test"]');
    await tp.waitForFunction(() => document.querySelectorAll('[data-testid="test-row"]').length === 2);
    const t = Object.values(cloud.dump('test/')).find((x) => /Farm/.test(x.title));
    assert.equal(t.start.kind, 'file'); assert.ok(t.start.size > 10000, 'starting database saved with the test');
    assert.equal(t.tasks.length, 10);
  });

  const fails = results.filter((r) => r[0] === 'FAIL').length;
  console.log(`\n${results.length - fails}/${results.length} exam steps passed. Browser errors: ${errors.length}`);
  errors.forEach((e) => console.log('  ', e));
  await browser.close(); await cloud.close();
  process.exit(fails || errors.length ? 1 : 0);
})();
