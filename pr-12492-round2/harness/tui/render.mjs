import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const xdir = path.dirname(require.resolve('@xterm/xterm/package.json'));
const [,, input, output, colsArg] = process.argv;
const cols = Number(colsArg ?? 150);
const data = fs.readFileSync(input, 'utf8').replace(/\n/g, '\r\n');
const plain = fs.readFileSync(input, 'utf8').replace(/\x1b\[[0-9;]*m/g, '').split('\n');
const rows = plain.reduce((n, l) => n + Math.max(1, Math.ceil([...l.replace(/\t/g, '        ')].length / cols)), 0) + 3;
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1800, height: 1200 }, deviceScaleFactor: 2 });
await page.setContent(`<html><body style="margin:0;background:#0d1117"><div id="wrap" style="padding:14px;background:#0d1117;display:block"><div id="t"></div></div></body></html>`);
await page.addStyleTag({ path: path.join(xdir, 'css/xterm.css') });
await page.addScriptTag({ path: path.join(xdir, 'lib/xterm.js') });
await page.evaluate(({ data, cols, rows }) => new Promise((resolve) => {
  const term = new window.Terminal({ cols, rows, convertEol: false, scrollback: 0, fontSize: 13, fontFamily: 'DejaVu Sans Mono, monospace',
    theme: { background: '#0d1117', foreground: '#d0d7de', cyan: '#39c5cf', green: '#56d364', red: '#f85149', yellow: '#e3b341', brightCyan: '#56d4dd' } });
  term.open(document.getElementById('t'));
  term.write(data + '\x1b[?25l', resolve);
}), { data, cols, rows });
await page.waitForTimeout(300);
const box = await page.locator('#wrap').boundingBox();
await page.setViewportSize({ width: Math.ceil(box.width) + 40, height: Math.ceil(box.height) + 40 });
const box2 = await page.locator('#wrap').boundingBox();
await page.screenshot({ path: output, clip: box2 });
await browser.close();
console.log('rendered', output, rows, 'rows');
