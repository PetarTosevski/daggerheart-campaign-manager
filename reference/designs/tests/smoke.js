// Loads every board in a headless browser and reports script errors and blank pages.
// Usage (from this folder):  npm i playwright && npx playwright install chromium
//                            (cd project && python3 -m http.server 8765) &   then:  node tests/smoke.js
const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path');
(async () => {
  const boards = Object.keys(JSON.parse(fs.readFileSync(path.join(__dirname, '../project/canvas.json'), 'utf8')).boards);
  const b = await chromium.launch(); let bad = 0;
  for (const f of boards) {
    const p = await b.newPage({ viewport: { width: 1440, height: 1000 } }); const errs = [];
    p.on('pageerror', (e) => errs.push(e.message));
    await p.goto('http://127.0.0.1:8765/' + f); await p.waitForTimeout(1200);
    const txt = (await p.evaluate(() => document.body.innerText)).length;
    const nodes = await p.evaluate(() => document.querySelectorAll('*').length);
    const ok = !errs.length && txt > 50; if (!ok) bad++;
    console.log((ok ? 'ok   ' : 'FAIL ') + f.padEnd(28) + ' text=' + txt + ' nodes=' + nodes + (errs.length ? ' errors: ' + errs.join(' | ') : ''));
    await p.close();
  }
  await b.close(); process.exit(bad ? 1 : 0);
})();
