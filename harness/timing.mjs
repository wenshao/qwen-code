// Measures navigation -> data-render-complete for a document, optionally under
// emulated network conditions. Serves everything from one real local origin.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { chromium } from '/root/git/pr11485-head/node_modules/playwright/index.mjs';

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const i = a.indexOf('='); return [a.slice(2, i), a.slice(i + 1)]; }));
const { doc: docPath, js: jsPath, css: cssPath, label = 'x', runs = '5', throttle = '0' } = args;

let html = readFileSync(docPath, 'utf8').replaceAll(
  /https:\/\/unpkg\.com\/@qwen-code\/qwen-code@[^/"]+\/export-transcript-document\.(js|css)/g,
  (_m, ext) => `/export-transcript-document.${ext}`,
);
const js = readFileSync(jsPath);
const css = cssPath ? readFileSync(cssPath) : null;
const server = createServer((req, res) => {
  const u = req.url.split('?')[0];
  if (u === '/' ) { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(html); return; }
  if (u === '/export-transcript-document.js') { res.writeHead(200, { 'content-type': 'text/javascript' }); res.end(js); return; }
  if (u === '/export-transcript-document.css' && css) { res.writeHead(200, { 'content-type': 'text/css' }); res.end(css); return; }
  res.writeHead(404); res.end('nf');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const samples = [];
for (let i = 0; i < Number(runs); i++) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.addInitScript(() => {
    window.__marks = {};
    const tick = () => {
      const b = document.body;
      if (b && b.dataset.renderComplete && !window.__marks.renderComplete) {
        window.__marks.renderComplete = performance.now();
        window.__marks.state = b.dataset.renderComplete;
        return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  if (throttle !== '0') {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Network.enable');
    const [mbps, rtt] = throttle.split(':').map(Number);
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false, latency: rtt,
      downloadThroughput: (mbps * 1024 * 1024) / 8,
      uploadThroughput: (mbps * 1024 * 1024) / 8,
    });
  }
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    const done = await page.evaluate(() => !!window.__marks?.renderComplete);
    if (done) break;
    await new Promise((r) => setTimeout(r, 25));
  }
  const m = await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0];
    const res = performance.getEntriesByType('resource').map((r) => ({
      name: r.name.split('/').pop(), start: Math.round(r.startTime),
      responseEnd: Math.round(r.responseEnd), size: r.transferSize,
    }));
    const paints = Object.fromEntries(performance.getEntriesByType('paint').map((p) => [p.name, Math.round(p.startTime)]));
    return {
      renderComplete: Math.round(window.__marks.renderComplete),
      state: window.__marks.state,
      domContentLoaded: Math.round(nav.domContentLoadedEventEnd),
      loadEvent: Math.round(nav.loadEventEnd),
      paints, res,
    };
  });
  samples.push(m);
  await browser.close();
}
const nums = samples.map((s) => s.renderComplete).sort((a, b) => a - b);
const med = nums[Math.floor(nums.length / 2)];
console.log(JSON.stringify({
  label, throttle, runs: nums.length,
  renderCompleteMs: { min: nums[0], median: med, max: nums[nums.length - 1], all: nums },
  fcp: samples.map((s) => s.paints['first-contentful-paint']),
  fp: samples.map((s) => s.paints['first-paint']),
  loadEvent: samples.map((s) => s.loadEvent),
  resources: samples[0].res,
  state: samples[0].state,
}, null, 2));
server.close();
