// Accounts, cloud saving across devices, sharing, pictures and contextual tabs.
// Uses the stand-in cloud (window.__DBWOW_FAKE_CLOUD__); each "device" is a
// separate browser context, and the stand-in server is copied between them.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const OUT = process.argv[2] || path.resolve(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });
const URL = process.env.DBWOW_URL ?? 'file://' + path.resolve(__dirname, '../../dist-portable/index.html');
// the stand-in cloud only runs on http(s) pages, like the real one; for file:// runs we allow it explicitly
const results = [];
async function step(name, fn) {
  try { await fn(); results.push(['PASS', name]); console.log('PASS', name); }
  catch (e) { results.push(['FAIL', name, e.message]); console.log('FAIL', name, '\n   ', e.message.split('\n').slice(0, 4).join(' | ')); }
}
(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const device = async (server) => {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 860 }, acceptDownloads: true });
    await ctx.addInitScript((srv) => { window.__DBWOW_FAKE_CLOUD__ = true; if (srv && !localStorage.getItem('dbwow.__testcloud')) localStorage.setItem('dbwow.__testcloud', srv); }, server ?? null);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
    return { ctx, page };
  };
  const serverOf = (page) => page.evaluate(() => { const s = JSON.parse(localStorage.getItem('dbwow.__testcloud')); delete s.session; return JSON.stringify(s); });
  const project = (page) => page.evaluate(() => { const p = window.__DBWOW__.store.getState().project; return p && { name: p.name, tables: p.tableNames() }; });
  const prompt = async (page, value) => { await page.locator('.dlg input').first().fill(value); await page.click('.dlg .dlg-buttons button:text-is("OK")'); await page.waitForTimeout(200); };
  const waitSaved = (page) => page.waitForFunction(() => /Saved to your account/.test(document.querySelector('[data-testid="account-button"]')?.getAttribute('title') ?? ''), null, { timeout: 15000 });

  const A = await device();
  await A.page.goto(URL); await A.page.waitForTimeout(1500);
  let server, shareUrl;

  await step('Register an account; the open database and progress save to it automatically', async () => {
    const { page } = A;
    await page.click('[data-testid="sign-in"]');
    await page.click('.auth-tabs button:text-is("Register")');
    await page.fill('input[aria-label="Your name"]', 'Ama Mensah');
    await page.fill('input[aria-label="Email"]', 'ama@example.com');
    await page.fill('input[aria-label="Password"]', 'secret1');
    await page.fill('input[aria-label="Confirm password"]', 'secret2');
    await page.click('.dlg button:text-is("Create account")');
    assert.match(await page.locator('.dlg [role="alert"]').textContent(), /different/);
    await page.fill('input[aria-label="Confirm password"]', 'secret1');
    await page.click('.dlg button:text-is("Create account")');
    await page.waitForSelector('[data-testid="account-button"]');
    assert.match(await page.locator('[data-testid="account-button"]').textContent(), /Ama Mensah/);
    // answer a quiz (progress) and build a database
    await page.click('.rtab:text-is("HELP")'); await page.click('[data-cmd="help.learning"]');
    await page.click('.lc-side .it:has-text("Primary keys")');
    await page.locator('.quiz-opt').first().click();
    await page.click('.rtab:text-is("FILE")'); await page.click('[data-testid="new-blank"]'); await prompt(page, 'MyDB');
    await page.evaluate(() => window.__DBWOW__.store.getState().project.saveTableDesign({ name: 'Pets', fields: [{ id: 'a', name: 'PetID', type: 'AutoNumber', primaryKey: true }, { id: 'b', name: 'PetName', type: 'Short Text' }, { id: 'c', name: 'Photo', type: 'Attachment' }] }));
    await waitSaved(page);
    server = await serverOf(page);
    const s = JSON.parse(server);
    const u = Object.values(s.users)[0];
    assert.equal(Object.values(u.dbs)[0].name, 'MyDB');
    assert.ok(JSON.parse(u.progress).quizzes, 'progress saved to the account');
  });

  await step('Contextual tabs come forward when an object opens (TABLE TOOLS: FIELDS / TABLE)', async () => {
    const { page } = A;
    await page.click('[data-testid="nav-table-Pets"]', { button: 'right' });
    await page.click('.ctx-item:has-text("Design View")');
    await page.waitForTimeout(300);
    assert.equal(await page.locator('.rtab.active').textContent(), 'DESIGN');
    assert.match(await page.locator('.ctx-band').textContent(), /TABLE TOOLS/);
    await page.dblclick('[data-testid="nav-table-Pets"]');
    await page.waitForTimeout(300);
    const ctx = await page.locator('.ctx-set .rtab').allTextContents();
    assert.deepEqual(ctx, ['FIELDS', 'TABLE']);
    assert.equal(await page.locator('.rtab.active').textContent(), 'FIELDS');
  });

  await step('Pictures: insert into an Attachment field, shrunk automatically, shown as a thumbnail and saved', async () => {
    const { page } = A;
    const big = path.resolve(__dirname, '../../docs/screenshots/07-form-design.png');
    await page.evaluate(() => window.__DBWOW__.store.getState().project.db.run("INSERT INTO Pets (PetName) VALUES ('Rex')"));
    await page.waitForTimeout(400);
    await page.locator('.doc-pane:not(.hidden) td').filter({ hasText: '(0)' }).first().click({ button: 'right' });
    const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.click('.ctx-item:has-text("Insert Picture")')]);
    await fc.setFiles(big);
    await page.waitForSelector('.doc-pane:not(.hidden) img.ds-thumb');
    await page.click('.rtab:text-is("HOME")');
    await page.click('[data-cmd="home.saveRecord"]');
    await page.waitForTimeout(500);
    const v = await page.evaluate(() => window.__DBWOW__.store.getState().project.db.scalar('SELECT Photo FROM Pets LIMIT 1'));
    assert.match(v, /^data:image\/(jpeg|png)/);
    const kb = (v.length * 0.75) / 1024;
    assert.ok(kb < 360, `stored picture is ${kb.toFixed(0)} KB (original ${(fs.statSync(big).size / 1024).toFixed(0)} KB)`);
    await page.screenshot({ path: path.join(OUT, 'c1-picture.png') });
    await waitSaved(page);
    server = await serverOf(page);
  });

  const B = await device(server);
  await step('On another device: sign in, progress and trophies merge, open the database from the account', async () => {
    const { page } = B;
    await page.goto(URL); await page.waitForTimeout(1500);
    await page.click('[data-testid="sign-in"]');
    await page.fill('input[aria-label="Email"]', 'ama@example.com');
    await page.fill('input[aria-label="Password"]', 'wrong-pass');
    await page.click('.dlg button[type="submit"]');
    assert.match(await page.locator('.dlg [role="alert"]').textContent(), /not correct/);
    await page.fill('input[aria-label="Password"]', 'secret1');
    await page.click('.dlg button[type="submit"]');
    await page.waitForSelector('[data-testid="account-button"]');
    await page.waitForTimeout(500);
    const prog = await page.evaluate(() => JSON.parse(localStorage.getItem('dbwow.learning') || '{}'));
    assert.ok(Object.keys(prog.quizzes ?? {}).length >= 1, 'quiz answer from device A');
    await page.click('[data-testid="bs-account"]');
    await page.waitForSelector('[data-testid="cloud-row"]');
    await page.screenshot({ path: path.join(OUT, 'c2-account.png') });
    await page.click('[data-testid="cloud-row"]');
    await page.waitForTimeout(800);
    const pj = await project(page);
    assert.equal(pj.name, 'MyDB'); assert.ok(pj.tables.includes('Pets'));
    assert.match(await page.evaluate(() => window.__DBWOW__.store.getState().project.db.scalar('SELECT Photo FROM Pets LIMIT 1')), /^data:image/);
  });

  await step('Share a database with a link; someone else opens their own copy', async () => {
    const { page } = B;
    await page.click('.rtab:text-is("FILE")');
    await page.click('[data-testid="bs-share"]');
    await page.click('[data-testid="create-share"]');
    await page.waitForSelector('[data-testid="share-link"]');
    shareUrl = await page.locator('[data-testid="share-link"]').inputValue();
    assert.match(shareUrl, /\?share=/);
    await page.screenshot({ path: path.join(OUT, 'c3-share.png') });
    server = await serverOf(page);
    const C = await device(server);
    const target = URL.split('?')[0] + '?' + shareUrl.split('?')[1];
    await C.page.goto(target); await C.page.waitForTimeout(1800);
    assert.match(await C.page.locator('.dlg').textContent(), /shared by Ama Mensah/);
    await C.page.click('.dlg button:text-is("Open a copy")');
    await C.page.waitForTimeout(800);
    const pj = await project(C.page);
    assert.equal(pj.name, 'MyDB'); assert.ok(pj.tables.includes('Pets'));
    assert.ok(!(await C.page.evaluate(() => location.search.includes('share'))), 'link cleaned from the address bar');
    await C.ctx.close();
  });

  await step('Without an account nothing changes: work stays in the browser', async () => {
    const D = await device();
    await D.page.goto(URL); await D.page.waitForTimeout(1200);
    await D.page.click('[data-testid="new-blank"]'); await prompt(D.page, 'Local');
    await D.page.waitForTimeout(600);
    assert.equal(await D.page.evaluate(() => localStorage.getItem('dbwow.__testcloud')), null);
    await D.ctx.close();
  });

  const fails = results.filter((r) => r[0] === 'FAIL').length;
  console.log(`\n${results.length - fails}/${results.length} account steps passed. Browser errors: ${errors.length}`);
  errors.forEach((e) => console.log('  ', e));
  await browser.close();
  process.exit(fails || errors.length ? 1 : 0);
})();
