// Small helper for driving DBWOW in headless Chromium (Playwright).
const { chromium } = require('playwright');
const path = require('node:path');
async function start(opts = {}) {
  const url = opts.url ?? 'file://' + path.resolve(__dirname, '../../dist-portable/index.html');
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: opts.w ?? 1400, height: opts.h ?? 860 }, acceptDownloads: true });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto(url);
  await page.waitForTimeout(1200);
  return { browser, context, page, errors };
}
module.exports = { start };
