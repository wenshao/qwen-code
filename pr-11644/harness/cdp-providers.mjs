// Record the JS initiator stack of every GET /workspace/providers at startup.
import fs from 'node:fs';
import { launch, UI_URL, sleep } from './ui.mjs';
const arm = process.argv[2];
const { browser, context, page } = await launch();
const cdp = await context.newCDPSession(page);
await cdp.send('Network.enable');
await cdp.send('Debugger.enable');
await cdp.send('Debugger.setAsyncCallStackDepth', { maxDepth: 32 });
const hits = [];
cdp.on('Network.requestWillBeSent', (e) => {
  if (!/\/providers(\?|$)/.test(e.request.url)) return;
  const frames = [];
  for (let st = e.initiator.stack; st; st = st.parent) {
    for (const f of st.callFrames) frames.push({ fn: f.functionName, url: f.url.split('/').pop(), line: f.lineNumber, col: f.columnNumber, async: st.description || '' });
  }
  hits.push({ t: e.timestamp, url: e.request.url.replace(/^.*?\/workspace/, '/workspace'), frames });
});
await page.goto(UI_URL);
await sleep(15_000);
const bundles = {};
for (const h of hits) for (const f of h.frames) {
  if (!f.url.endsWith('.js')) continue;
  if (!bundles[f.url]) bundles[f.url] = fs.readFileSync(`/root/git/pr11644/dist/web-shell/assets/${f.url}`, 'utf8').split('\n');
  const lineText = bundles[f.url][f.line] ?? '';
  f.ctx = lineText.slice(Math.max(0, f.col - 160), f.col + 60).replace(/\s+/g, ' ');
}
for (const [i, h] of hits.entries()) { console.log(`#${i + 1} ${h.url}`); for (const f of h.frames.slice(2, 7)) console.log(`   ${f.async ? "[" + f.async + "] " : ""}${f.fn || "(anon)"} :: ${f.ctx.slice(60, 220)}`); }
await browser.close();
