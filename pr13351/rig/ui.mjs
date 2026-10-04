// VERIFICATION RIG ONLY (PR #13351): watch a midstream-cut Turn live in the real Web Shell Managed panel.
// usage: ARM=head|base node ui.mjs <tag> [lang=en|zh]
// Creates a Workspace Session through the public API with the `slow` scenario, opens the rig host page on it
// while the model is still streaming, releases the cut once the partial is visible on the public feed, and
// captures: (1) mid-stream before the cut, (2) the settled live view, (3) a fresh page load afterwards.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import { ARM, RIG, PORTS, createSession, api, release, eventText, ensureWorkspace, sleep, j } from './lib.mjs';

const require = createRequire(`/Users/wenshao/git/pr13351-${ARM}/packages/web-shell/package.json`);
const { chromium } = require('playwright');
const tag = process.argv[2] ?? 'ui';
const args = Object.fromEntries(process.argv.slice(3).map((a) => a.split('=')));
const lang = args.lang ?? 'en';
const FIG = `${RIG}/fig/raw`;
fs.mkdirSync(FIG, { recursive: true });
ensureWorkspace('ws-b', 'st-b');

const id = `${ARM}-ui-${tag}-${Date.now().toString(36)}`;
const c = await createSession(`MSR id=${id} sc=slow cuts=1 hold=wait delay=700. Reply with the scripted answer.`, { workspace: 'ws-b' });
if (c.status !== 202) throw new Error(`create ${c.status} ${j(c.json)}`);
const session = c.session;

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1180, height: 760 }, deviceScaleFactor: 2 });
const page = await context.newPage();
const net = [];
page.on('request', (req) => {
  const url = new URL(req.url());
  if (url.pathname.startsWith('/api/agent/web-shell/v1/')) net.push({ t: Date.now(), path: url.pathname.replace('/api/agent/web-shell/v1', '') });
});
const errors = [];
page.on('pageerror', (e) => errors.push(String(e).slice(0, 300)));
const url = `http://localhost:${PORTS.vite}/e2e/fixtures/rig-13351.html?${new URLSearchParams({ actor: 'alice', lang, session })}`;
await page.goto(url, { waitUntil: 'load' });

const bodyText = () => page.locator('body').innerText();
const shots = {};
// 1. Wait until the 6th partial chunk is on screen, capture, then release the cut.
let before = '';
for (let i = 0; i < 300; i++) {
  before = await bodyText();
  if (before.includes('partial-1.6')) break;
  await sleep(100);
}
shots.before = `${FIG}/${ARM}-${tag}-1-before-cut.png`;
await page.screenshot({ path: shots.before });
// Confirm it is durable on the public feed before cutting (the post-publication case).
let durable = false;
for (let i = 0; i < 100 && !durable; i++) {
  const r = await api('GET', `/v1/agents/sessions/${session}/events?after=0&limit=100`);
  durable = (r.json.data ?? []).some((e) => e.type === 'item.output_text.delta' && eventText(e).includes('partial-1.6'));
  if (!durable) await sleep(100);
}
let rel = { released: false };
const releaseStarted = Date.now();
for (let i = 0; i < 100 && !rel.released; i++) {
  rel = await release(id);
  if (!rel.released) await sleep(50);
}
const releasedAt = Date.now();

// 2. Wait for the Turn to settle on the feed, give the panel time to apply it, capture the live view.
let terminal;
for (let i = 0; i < 600 && !terminal; i++) {
  const r = await api('GET', `/v1/agents/sessions/${session}/events?after=0&limit=100`);
  terminal = (r.json.data ?? []).find((e) => e.terminal);
  if (!terminal) await sleep(200);
}
const terminalSeenAt = Date.now();
const running = () => page.getByText('This turn is running').count();
let panelSettledMs = null;
const statusSamples = [];
for (let i = 0; i < 600; i++) {
  const r = await running();
  const t = await bodyText();
  statusSamples.push({ ms: Date.now() - terminalSeenAt, running: r, final4: t.includes('final.4'), partial: t.includes('MIDSTREAM_PARTIAL') });
  if (r === 0 && t.includes('final.4')) { panelSettledMs = Date.now() - terminalSeenAt; break; }
  await sleep(100);
}
await sleep(500);
const liveAfter = await bodyText();
shots.live = `${FIG}/${ARM}-${tag}-2-live-after.png`;
await page.screenshot({ path: shots.live });

// 3. A fresh viewer: reload the page on the same Session.
await page.reload({ waitUntil: 'load' });
for (let i = 0; i < 100; i++) {
  if ((await bodyText()).includes('final.4')) break;
  await sleep(100);
}
await sleep(1500);
const reloaded = await bodyText();
shots.reload = `${FIG}/${ARM}-${tag}-3-reloaded.png`;
await page.screenshot({ path: shots.reload });
await browser.close();

const count = (s, needle) => s.split(needle).length - 1;
const res = {
  arm: ARM,
  tag,
  id,
  session,
  durableBeforeCut: durable,
  releaseWaitMs: releasedAt - releaseStarted,
  panelSettledMsAfterFeedTerminal: panelSettledMs,
  firstSample: statusSamples[0],
  released: rel.released,
  terminal: terminal?.type,
  live: { hasPartial: liveAfter.includes('MIDSTREAM_PARTIAL'), partialChunks: count(liveAfter, 'partial-1.'), finalChunks: count(liveAfter, 'final.') },
  reload: { hasPartial: reloaded.includes('MIDSTREAM_PARTIAL'), partialChunks: count(reloaded, 'partial-1.'), finalChunks: count(reloaded, 'final.') },
  transcriptQueries: net.filter((e) => e.path === '/transcript/query').length,
  streamOpens: net.filter((e) => e.path === '/events/stream').length,
  errors,
  shots,
};
fs.writeFileSync(`${RIG}/results/${id}.json`, JSON.stringify({ ...res, liveAfter, reloaded, statusSamples, net }, null, 2));
console.log(`UIRESULT ${j(res)}`);
