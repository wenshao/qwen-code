// PR #13621 WebShell probe: a real browser (Playwright Chromium) on the Web
// Shell's Managed panel (Vite dev server, managedProvider=java) against the
// rig's Spring. Between Vite and Spring sits a TCP proxy this script can cut,
// modelling the path to the Managed Agent server going down (gateway restart,
// laptop sleep). The proxy also records the WebShell stream requests and any
// resync frame on the wire.
// Usage: node webshell-probe.mjs <runDirOfHeldStack> <mode> <outDir>
//   mode: explore | blip
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import { createRequire } from 'node:module';

const RIG = '/Users/wenshao/pr13621-rig';
const require = createRequire(`${RIG}/src-head/package.json`);
const { chromium } = require('playwright');
import path from "node:path";
const [stackDir, mode, outDir] = process.argv.slice(2).map((a, i) => (i === 1 ? a : path.resolve(a)));
fs.mkdirSync(outDir, { recursive: true });
const stack = JSON.parse(fs.readFileSync(`${stackDir}/stack.json`, 'utf8'));
const TENANT = process.env.PROBE_TENANT ?? 'webshell-demo';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const T0 = Date.now();
const logf = `${outDir}/probe.log`;
const log = (...a) => {
  const line = `${new Date().toISOString().slice(11, 23)} ${a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')}`;
  console.log(line);
  fs.appendFileSync(logf, line + '\n');
};
const wire = [];
const wireLog = (e) => { wire.push({ t: Date.now() - T0, ...e }); fs.writeFileSync(`${outDir}/wire.json`, JSON.stringify(wire, null, 2)); };

// ---------- cuttable TCP proxy browser -> Vite ----------
// (Cutting behind Vite instead leaves the browser's stream hanging: Vite's
// http-proxy does not end the client response when the upstream dies
// mid-body; Chromium's offline emulation does not fail an open stream.)
let down = false;
const sockets = new Set();
let upstreamPort = null;
const proxy = net.createServer((client) => {
  client.once('data', (first) => {
    const isWs = /^GET [^\r]*\r\n[^]*upgrade: websocket/i.test(first.toString('latin1'));
    if (down && !isWs) { client.destroy(); wireLog({ kind: 'refused' }); return; }
    pipeConn(client, first, isWs);
  });
});
function pipeConn(client, first, isWs) {
  let reqBuf = '';
  const upstream = net.connect({ host: 'localhost', port: upstreamPort });
  if (!isWs) { sockets.add(client); sockets.add(upstream); }
  upstream.write(first);
  scanReq(first);
  const close = () => { client.destroy(); upstream.destroy(); sockets.delete(client); sockets.delete(upstream); };
  client.on('error', close); upstream.on('error', close); client.on('close', close); upstream.on('close', close);
  client.on('data', (d) => { upstream.write(d); scanReq(d); });
  function scanReq(d) {
    reqBuf += d.toString('latin1');
    const m = /POST (\/api\/agent\/web-shell\/v1\/[a-z/]+)[^]*?\r\n\r\n(\{[^]*?\})/.exec(reqBuf);
    if (m) {
      let body = null;
      try { body = JSON.parse(m[2]); } catch {}
      if (m[1].endsWith('/events/stream')) wireLog({ kind: 'stream-request', afterSequence: body?.afterSequence ?? null });
      else if (m[1].endsWith('/transcript/query')) wireLog({ kind: 'transcript-request', cursor: body?.cursor ?? null });
      reqBuf = reqBuf.slice(m.index + m[0].length);
    }
    if (reqBuf.length > 65536) reqBuf = reqBuf.slice(-4096);
  }
  let resBuf = '';
  upstream.on('data', (d) => {
    client.write(d);
    // Strip chunked-transfer framing so frames read whole.
    resBuf += d.toString('utf8');
    resBuf = resBuf.replace(/\r\n[0-9a-f]{1,6}\r\n/g, '');
    let m;
    while ((m = /event:agent\.session\.resync_required\r?\ndata:(\{[^\n]*\})/.exec(resBuf))) {
      wireLog({ kind: 'resync-frame', data: JSON.parse(m[1]) });
      resBuf = resBuf.slice(m.index + m[0].length);
    }
    const ids = [...resBuf.matchAll(/(?:^|\n)id:(\d+)\n/g)].map((x) => +x[1]);
    if (ids.length) wireLog({ kind: 'event-ids', from: ids[0], to: ids.at(-1), n: ids.length });
    const tl = [...resBuf.matchAll(/"coveredSequence":(\d+)[^]*?"lastSequence":(\d+)\}/g)].pop();
    if (tl) { wireLog({ kind: 'transcript-response', coveredSequence: +tl[1], lastSequence: +tl[2] }); resBuf = ''; }
    resBuf = resBuf.slice(-4096);
  });
}
await new Promise((r) => proxy.listen(0, '127.0.0.1', r));
const proxyPort = proxy.address().port;
// The proxy sits between the browser and Vite: a cut resets every open
// HTTP connection (the event stream errors in the browser) and refuses new
// ones until restore. Vite's HMR websocket is exempt so the dev client does
// not reload the page.
let context;
async function cut() { down = true; for (const x of sockets) x.destroy(); sockets.clear(); wireLog({ kind: 'CUT' }); }
async function restore() { down = false; wireLog({ kind: 'RESTORE' }); }

// ---------- daemon + vite ----------
const children = [];
function start(name, cmd, args, opts) {
  const out = fs.openSync(`${outDir}/${name}.log`, 'a');
  const child = spawn(cmd, args, { ...opts, detached: true, stdio: ['ignore', out, out] });
  children.push(child);
  return child;
}
async function freePort() {
  const s = net.createServer();
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const p = s.address().port;
  await new Promise((r) => s.close(r));
  return p;
}
async function waitHttp(url, ms, headers = {}) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { const r = await fetch(url, { headers }); if (r.status < 500) return; } catch {}
    await sleep(300);
  }
  throw new Error(`not ready ${url}`);
}
const daemonPort = await freePort();
const webPort = await freePort();
const daemonToken = randomBytes(24).toString('hex');
const dhome = `${outDir}/daemon-home`;
fs.mkdirSync(`${dhome}/.qwen`, { recursive: true });
fs.writeFileSync(`${dhome}/.qwen/settings.json`, JSON.stringify({ ui: { enableFollowupSuggestions: false } }));
const dws = `${outDir}/daemon-ws`;
fs.mkdirSync(dws, { recursive: true });
const baseEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(https?|all|no)_proxy$/i.test(k) && !/^(qwen|dashscope|openai)_/i.test(k)));
start('daemon', process.execPath, [`${RIG}/src-head/dist/cli.js`, 'serve', '--hostname', '127.0.0.1', '--port', String(daemonPort), '--workspace', dws], {
  cwd: dws, env: { ...baseEnv, HOME: dhome, QWEN_HOME: `${dhome}/.qwen`, QWEN_SERVER_TOKEN: daemonToken, NO_PROXY: '127.0.0.1,localhost' },
});
await waitHttp(`http://127.0.0.1:${daemonPort}/health`, 60000);
log('daemon.ready', daemonPort);
start('vite', 'npm', ['run', 'dev', '--workspace=packages/web-shell', '--', '--port', String(webPort), '--host', 'localhost', '--strictPort'], {
  cwd: `${RIG}/src-head`, env: { ...baseEnv, QWEN_DAEMON_URL: `http://127.0.0.1:${daemonPort}`, QWEN_MANAGED_AGENT_JAVA_URL: `http://127.0.0.1:${stack.springPort}`, NO_PROXY: '127.0.0.1,localhost' },
});
await waitHttp(`http://localhost:${webPort}/`, 120000);
upstreamPort = webPort;
log('vite.ready', webPort, 'proxy', proxyPort);
const pageUrl = `http://localhost:${proxyPort}/?${new URLSearchParams({ managed: '1', managedProvider: 'java', tenant: TENANT, token: daemonToken })}`;

// ---------- Spring API (no trusted actor: the stack runs auth=auto/open) ----------
async function api(method, p, body, headers = {}) {
  const r = await fetch(`http://127.0.0.1:${stack.springPort}${p}`, { method, headers: { 'x-qwen-tenant-id': TENANT, ...(body ? { 'content-type': 'application/json' } : {}), ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const text = await r.text();
  let json; try { json = JSON.parse(text); } catch {}
  return { status: r.status, json, text };
}
const MYSQL = `${process.env.HOME}/Install/mysql-8.4.7-macos15-arm64/bin/mysql`;
import { spawnSync } from 'node:child_process';
function windowRow(sid) {
  const r = spawnSync(MYSQL, ['--protocol=tcp', '-h127.0.0.1', '-P13621', '-uroot', '--batch', '--skip-column-names', stack.db, '-e',
    `SELECT s.last_sequence, s.replay_floor_sequence, COALESCE(n.covered_sequence,-1) FROM managed_agent_session s LEFT JOIN managed_agent_snapshot n ON n.tenant_id=s.tenant_id AND n.session_id=s.session_id WHERE s.session_id='${sid}'`], { encoding: 'utf8' });
  const [last, floor, snap] = r.stdout.trim().split('\t').map(Number);
  return { last, floor, snapshot: snap };
}
async function waitTurnsDone(sid, ms = 240000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const s = await api('GET', `/v1/agents/sessions/${sid}`);
    const st = s.json?.active_turn?.status;
    if (!st || ['completed', 'failed', 'cancelled'].includes(String(st).toLowerCase())) return s.json;
    await sleep(500);
  }
  throw new Error('turn not done');
}

const browser = await chromium.launch({ headless: true });
context = await browser.newContext({ viewport: { width: 1360, height: 860 }, deviceScaleFactor: 2 });
const page = await context.newPage();
page.on('console', (m) => { if (/managed|resync|stream/i.test(m.text())) log('console', m.type(), m.text().slice(0, 300)); });
const shot = async (name) => { await page.screenshot({ path: `${outDir}/${name}.png` }); log('shot', name); };
const result = { mode, stack, tenant: TENANT, pageUrl: pageUrl.replace(daemonToken, '<token>') };
try {
  await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 300000 });
  await page.waitForLoadState('load', { timeout: 300000 });
  await sleep(8000);
  if (mode === 'explore') {
    await shot('explore-0');
    fs.writeFileSync(`${outDir}/explore-0.txt`, await page.locator('body').innerText());
    fs.writeFileSync(`${outDir}/explore-0.html`, await page.content());
  } else if (mode === 'blip') {
    await blip();
  }
} catch (e) {
  result.error = String(e?.stack ?? e);
  log('ERROR', result.error);
  try { await shot('error'); } catch {}
} finally {
  fs.writeFileSync(`${outDir}/result.json`, JSON.stringify(result, null, 2));
  await browser.close();
  for (const c of children) { try { process.kill(-c.pid, 'SIGTERM'); } catch {} }
  await sleep(1500);
  for (const c of children) { try { process.kill(-c.pid, 'SIGKILL'); } catch {} }
  proxy.close();
  log('done');
  process.exit(0);
}

async function listSessions() {
  const r = await api('GET', '/v1/agents/sessions?limit=50');
  return r.json?.data ?? [];
}
async function waitFor(name, fn, ms, every = 500) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(every); }
  throw new Error(`timeout: ${name}`);
}
async function assistantTexts(sid) {
  const r = await api('GET', `/v1/agents/sessions/${sid}/items?limit=100`);
  const items = r.json?.data ?? [];
  return items.filter((i) => i.role === 'assistant' || i.type === 'message' && i.role === 'assistant').map((i) => (i.content ?? []).map((c) => c.text ?? '').join(''));
}
async function blip() {
  const prompt1 = 'In one short sentence, what is a replay cursor in an event stream?';
  const prompt2 = 'Now give one short sentence on why a server might expire such a cursor.';
  const composer = page.getByPlaceholder('Message the managed agent');
  await composer.fill(prompt1);
  await page.getByRole('button', { name: 'Send' }).click();
  const sess = await waitFor('session created', async () => (await listSessions())[0], 120000);
  const sid = sess.id;
  result.sessionId = sid;
  log('session', sid);
  await waitFor('turn1 done', async () => { const s = await api('GET', `/v1/agents/sessions/${sid}`); const st = s.json?.active_turn?.status; return s.json?.last_event_id > 0 && (!st || ['completed', 'failed', 'cancelled'].includes(String(st).toLowerCase())) ? s.json : null; }, 240000);
  const t1 = await waitFor('turn1 text', async () => { const a = await assistantTexts(sid); return a.length >= 1 && a[0] ? a : null; }, 60000);
  result.turn1Reply = t1[0];
  const w1 = await waitFor('floor at snapshot after turn1', async () => { const w = windowRow(sid); return w.snapshot === w.last && (stack.floor ? w.floor === w.last : true) ? w : null; }, 60000);
  result.windowAfterTurn1 = w1;
  await waitFor('turn1 reply rendered', async () => (await page.locator('body').innerText()).includes(t1[0].slice(0, 40)), 60000);
  await sleep(2000);
  await shot('01-turn1-live');
  const clientCursor = w1.last;
  result.clientCursorAtCut = clientCursor;
  await cut();
  log('OFFLINE at seq', clientCursor);
  await sleep(4000);
  await shot('02-cut');
  const sub = await api('POST', `/v1/agents/sessions/${sid}/events`, { type: 'agent.session.input.message', input: [{ type: 'text', text: prompt2 }] }, { 'idempotency-key': randomUUID() });
  result.turn2Submit = sub.status;
  log('turn2 submitted via API while the page is cut off', sub.status);
  await waitFor('turn2 done', async () => { const s = await api('GET', `/v1/agents/sessions/${sid}`); const st = s.json?.active_turn?.status; return s.json?.last_event_id > clientCursor && (!st || ['completed', 'failed', 'cancelled'].includes(String(st).toLowerCase())) ? s.json : null; }, 240000);
  const w2 = await waitFor('floor passes the page cursor', async () => { const w = windowRow(sid); return w.snapshot === w.last && (stack.floor ? w.floor === w.last : true) ? w : null; }, 60000);
  result.windowBeforeRestore = w2;
  const t2 = await waitFor('turn2 text', async () => { const a = await assistantTexts(sid); return a.length >= 2 && a[1] ? a : null; }, 60000);
  result.turn2Reply = t2[1];
  const pageHadTurn2 = (await page.locator('body').innerText()).includes(t2[1].slice(0, 40));
  result.pageHadTurn2BeforeRestore = pageHadTurn2;
  log('window before restore', JSON.stringify(w2), 'page cursor', clientCursor, 'page shows turn2 already?', pageHadTurn2);
  await restore();
  const tRestore = Date.now();
  await waitFor('turn2 reply rendered after restore', async () => (await page.locator('body').innerText()).includes(t2[1].slice(0, 40)), 120000, 250);
  result.turn2RenderedMsAfterRestore = Date.now() - tRestore;
  await sleep(2500);
  await shot('03-after-restore');
  const body = await page.locator('body').innerText();
  result.pageShowsBothReplies = body.includes(t1[0].slice(0, 40)) && body.includes(t2[1].slice(0, 40));
  result.pageErrorBanner = /not advancing|error|failed/i.test(body) ? body.match(/.{0,60}(not advancing|error|failed).{0,60}/i)?.[0] : null;
  await sleep(3000);
  result.wireAfterRestore = wire.filter((e) => e.t >= tRestore - T0);
  result.finalWindow = windowRow(sid);
  const s = await api('GET', `/v1/agents/sessions/${sid}/events?after=0&limit=1`);
  result.publicAfter0 = { status: s.status, code: s.json?.error?.code ?? null };
}
