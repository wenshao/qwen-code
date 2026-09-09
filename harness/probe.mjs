// Opens an exported transcript document over a REAL local HTTP origin (no CDP
// route interception) and reports what the browser actually did.
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname } from 'node:path';
import { chromium } from '/root/git/pr11485-head/node_modules/playwright/index.mjs';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const i = a.indexOf('=');
    return [a.slice(2, i), a.slice(i + 1)];
  }),
);
const { doc: docPath, js: jsPath, css: cssPath, mode = 'ok', shot, label = 'probe' } = args;

let html = readFileSync(docPath, 'utf8');
html = html.replaceAll(
  /https:\/\/unpkg\.com\/@qwen-code\/qwen-code@[^/"]+\/export-transcript-document\.(js|css)/g,
  (_m, ext) => `/export-transcript-document.${ext}`,
);
const js = readFileSync(jsPath);
const css = cssPath ? readFileSync(cssPath) : null;

const server = createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (url === '/' || url === '/index.html') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(html);
    return;
  }
  if (url === '/export-transcript-document.js') {
    if (mode === 'js-404') { res.writeHead(404); res.end('nope'); return; }
    res.writeHead(200, { 'content-type': 'text/javascript' });
    res.end(js);
    return;
  }
  if (url === '/export-transcript-document.css') {
    if (mode === 'css-404') { res.writeHead(404); res.end('nope'); return; }
    if (mode === 'css-reset') { req.socket.destroy(); return; }
    if (mode === 'css-tamper') {
      res.writeHead(200, { 'content-type': 'text/css' });
      res.end(Buffer.concat([css, Buffer.from('/*x*/')]));
      return;
    }
    if (mode === 'css-slow') {
      setTimeout(() => {
        res.writeHead(200, { 'content-type': 'text/css' });
        res.end(css);
      }, 2500);
      return;
    }
    res.writeHead(200, { 'content-type': 'text/css' });
    res.end(css);
    return;
  }
  res.writeHead(404);
  res.end('nf');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const requests = [];
const consoleErrors = [];
page.on('request', (r) => requests.push(`${r.resourceType()} ${r.url()}`));
page.on('console', (m) => {
  const t = m.text();
  if (/content security policy|refused to|failed to find|integrity/i.test(t)) consoleErrors.push(t);
});

const navStart = Date.now();
await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });
// give the renderer a beat to mount / the error path to settle
const deadline = Date.now() + 15000;
while (Date.now() < deadline) {
  const state = await page.evaluate(() => document.body.dataset.renderComplete || '');
  if (state) break;
  await new Promise((r) => setTimeout(r, 100));
}

const result = await page.evaluate(() => {
  const link = document.getElementById('transcript-stylesheet');
  const injected = document.querySelector('style[data-qwen-web-shell="component"]');
  const katex = document.querySelector('.katex');
  const alertEl = document.querySelector('[role="alert"]');
  const paints = performance.getEntriesByType('paint').map((p) => `${p.name}=${Math.round(p.startTime)}ms`);
  const h1 = document.querySelector('h2, h1');
  return {
    renderComplete: document.body.dataset.renderComplete || '(unset)',
    hasStylesheetLink: !!link,
    sheetLoaded: !!link && link.sheet !== null,
    sheetRuleCount: (() => {
      try { return link && link.sheet ? link.sheet.cssRules.length : -1; } catch { return -2; }
    })(),
    injectedStyleTag: !!injected,
    injectedStyleLength: injected ? injected.textContent.length : 0,
    injectedStyleText: injected ? injected.textContent : null,
    katexFontFamily: katex ? getComputedStyle(katex).fontFamily : '(no .katex)',
    headingFontWeight: h1 ? getComputedStyle(h1).fontWeight : '(none)',
    headingFontSize: h1 ? getComputedStyle(h1).fontSize : '(none)',
    bodyBg: getComputedStyle(document.body).backgroundColor,
    alertText: alertEl ? alertEl.textContent.slice(0, 120) : null,
    appChildren: document.getElementById('app')?.children.length ?? -1,
    bodyTextLength: document.body.innerText.length,
    paints,
    styleFailedLatch: !!window.__transcriptStyleFailed,
  };
});
result.label = label;
result.mode = mode;
result.wallMs = Date.now() - navStart;
result.requests = requests;
result.consoleErrors = consoleErrors;
if (result.injectedStyleText) {
  result.injectedStyleSha256 = createHash('sha256').update(result.injectedStyleText, 'utf8').digest('hex');
  result.injectedStyleBytes = Buffer.byteLength(result.injectedStyleText, 'utf8');
}
delete result.injectedStyleText;

console.log(JSON.stringify(result, null, 2));
if (shot) {
  mkdirSync(dirname(shot), { recursive: true });
  try {
    await page.screenshot({ path: shot, fullPage: args.viewportShot !== '1' });
  } catch (e) {
    try { await page.screenshot({ path: shot }); } catch (e2) { console.error('screenshot failed:', e2.message); }
  }
}
await browser.close();
server.close();
