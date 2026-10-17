// Render a frame range of the motion graphic to an mp4 segment.
// usage: node render.mjs <startFrame> <endFrame> <out.mp4>   |   node render.mjs --cues cues.json
import { chromium } from 'playwright';
import { spawn } from 'child_process';
import fs from 'fs';

const URL = process.env.MG_URL || 'http://127.0.0.1:8765/index.html?capture=1';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
page.on('pageerror', e => console.error('pageerror', e.message));
await page.goto(URL);
await page.evaluate(() => window.ready);

if (process.argv[2] === '--cues') {
  const info = await page.evaluate(() => ({ cues: window.CUES, duration: window.DURATION, fps: window.FPS }));
  fs.writeFileSync(process.argv[3], JSON.stringify(info.cues, null, 1));
  console.log(JSON.stringify({ duration: info.duration, fps: info.fps, cues: info.cues.length }));
  await browser.close();
  process.exit(0);
}

const [start, end, out] = [+process.argv[2], +process.argv[3], process.argv[4]];
const fps = await page.evaluate(() => window.FPS);
const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'png', '-i', '-',
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '15', '-pix_fmt', 'yuv420p', '-profile:v', 'high', out], { stdio: ['pipe', 'inherit', 'inherit'] });
const t0 = Date.now();
for (let f = start; f < end; f++) {
  const b64 = await page.evaluate(t => { window.renderFrame(t); return document.getElementById('c').toDataURL('image/png'); }, f / fps);
  const buf = Buffer.from(b64.slice(b64.indexOf(',') + 1), 'base64');
  if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
  if ((f - start) % 300 === 0) console.log(`[${out}] frame ${f}/${end} ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}
ff.stdin.end();
await new Promise(r => ff.on('close', r));
// browser.close() can hang in headless shell; don't wait on it forever
await Promise.race([browser.close(), new Promise(r => setTimeout(r, 5000))]);
process.exit(0);
