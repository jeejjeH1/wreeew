// Render selected timestamps to PNG for review: node stills.mjs outdir t1 t2 ...
import { chromium } from 'playwright';
import fs from 'fs';
const [out, ...times] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const errs = [];
page.on('pageerror', e => errs.push(e.message));
page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
await page.goto('http://127.0.0.1:8765/index.html?capture=1');
await page.evaluate(() => window.ready);
for (const t of times) {
  const t0 = Date.now();
  const b64 = await page.evaluate(t => { window.renderFrame(t); return document.getElementById('c').toDataURL('image/jpeg', .85); }, +t);
  fs.writeFileSync(`${out}/f_${(+t).toFixed(2).padStart(6, '0')}.jpg`, Buffer.from(b64.split(',')[1], 'base64'));
  console.log(t, Date.now() - t0, 'ms');
}
if (errs.length) console.log('ERRORS:\n' + errs.join('\n'));
await browser.close();
