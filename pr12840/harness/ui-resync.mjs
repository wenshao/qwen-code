// Real Web Shell (vite dev) -> real Spring WebShell adapter (PR jar, MySQL,
// hosted harness, scripted model). The first events/stream request is held
// while a second Turn runs and the replay floor rises past the page's cursor;
// then it is released, so the server answers it with the resync frame.
//   node ui-resync.mjs <viteUrl> <arm> <outdir>
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';

const SP = '/path/to/scratchpad';
const require = createRequire(`${SP}/wt-pr/packages/web-shell/package.json`);
const { chromium } = require('playwright');
const [vite, arm, outdir] = process.argv.slice(2);
const API = 'http://127.0.0.1:33851';
const tenant = `rig-ui-${arm}-${Date.now().toString(36)}`;
fs.mkdirSync(outdir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MYSQL = `${process.env.HOME}/Install/mysql-8.4.7-macos15-arm64/bin/mysql`;
const sql = (q) => execFileSync(MYSQL, ['--no-defaults', '-uroot', '-prig12840', '-h127.0.0.1', '-P33841', '-N', '-B', process.env.DB ?? 'p840_pr', '-e', q], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
const api = async (method, path, body) => {
  const r = await fetch(API + path, { method, headers: { 'X-Qwen-Tenant-Id': tenant, 'content-type': 'application/json', 'Idempotency-Key': randomUUID() }, body: body && JSON.stringify(body) });
  return r.json();
};
const session = (id) => api('GET', `/v1/agents/sessions/${id}`);
async function settled(id) {
  for (let i = 0; i < 400; i++) {
    const s = await session(id);
    if (!s.active_turn && s.snapshot_through_sequence === s.last_event_id) return s;
    await sleep(150);
  }
  throw new Error('not settled');
}

const sid = (await api('POST', '/v1/agents/sessions', { agent_id: 'qwen-code', metadata: { title: `resync ${arm}` }, input: [{ type: 'input_text', text: 'First question before the floor' }] })).id;
const first = await settled(sid);
console.log(`[${arm}] session ${sid} settled at ${first.last_event_id}`);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });
const t0 = Date.now();
const log = [];
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
let release;
const gate = new Promise((r) => (release = r));
let held = false;
await page.route('**/api/agent/web-shell/v1/events/stream', async (route) => {
  const body = JSON.parse(route.request().postData() ?? '{}');
  const entry = { t: Date.now() - t0, route: 'events/stream', afterSequence: body.afterSequence ?? null };
  log.push(entry);
  if (!held) {
    held = true;
    entry.held = true;
    await gate;
    entry.releasedAt = Date.now() - t0;
  }
  await route.continue();
});
page.on('request', (req) => {
  const url = new URL(req.url());
  if (url.pathname.endsWith('/transcript/query')) log.push({ t: Date.now() - t0, route: 'transcript/query' });
});

await page.goto(`${vite}/?managed=1&managedProvider=java&tenant=${tenant}&managedSession=${sid}`);
const conversation = page.getByRole('region', { name: 'Managed conversation' });
await conversation.getByText(/REPLY_\d+: .*First question/).first().waitFor({ timeout: 60000 });
await page.waitForTimeout(800);
await page.screenshot({ path: `${outdir}/${arm}-0-loaded.png` });

// A second Turn while the page's stream request is held.
await api('POST', `/v1/agents/sessions/${sid}/events`, { type: 'agent.session.input.message', input: [{ type: 'text', text: 'Second question after the floor rose' }] });
const second = await settled(sid);
const floor = second.snapshot_through_sequence;
sql(`UPDATE managed_agent_session SET replay_floor_sequence = ${floor} WHERE tenant_id = '${tenant}' AND session_id = '${sid}'`);
console.log(`[${arm}] second Turn settled at ${second.last_event_id}; floor raised to ${floor}; page cursor ${first.last_event_id}`);
const releasedAt = Date.now() - t0;
release();

let shown = null;
try {
  await conversation.getByText(/REPLY_\d+: .*Second question/).first().waitFor({ timeout: 15000 });
  shown = Date.now() - t0 - releasedAt;
} catch {}
await page.waitForTimeout(Math.max(0, releasedAt + 15000 - (Date.now() - t0)));
await page.screenshot({ path: `${outdir}/${arm}-1-after.png` });
const windowEnd = Date.now() - t0;
const after = log.filter((e) => e.t >= releasedAt || e.held);
const streams = after.filter((e) => e.route === 'events/stream');
const summary = {
  arm,
  tenant,
  session: sid,
  pageCursor: first.last_event_id,
  floor,
  lastSequence: second.last_event_id,
  secondReplyShownMs: shown,
  observedMs: windowEnd - releasedAt,
  streamRequests: streams.map((e) => ({ t: e.t - releasedAt, afterSequence: e.afterSequence, held: !!e.held })),
  transcriptReloads: after.filter((e) => e.route === 'transcript/query' && e.t >= releasedAt).length,
  errors,
};
fs.writeFileSync(`${outdir}/${arm}.json`, JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary));
await browser.close();
