const { start } = require('./lib.cjs');
(async () => { const { browser, page, errors } = await start(); await page.screenshot({ path: process.argv[2] }); console.log(JSON.stringify(errors)); await browser.close(); })();
