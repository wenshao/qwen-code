// PR #12923 part 2: raw network-error retries (no nginx in front, so the client
// sees a real connection reset instead of nginx's 502), staging capacity and its
// release paths, and a direct latency comparison.
//   node sdk-scenarios2.mjs            (all)   |   node sdk-scenarios2.mjs expiry
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { SP, TOKEN, Daemon, prepareHome, sleep } from './lib.mjs';
import { startFaultProxy } from './faultproxy.mjs';
import { sha256 } from './png.mjs';

const which = process.argv[2] ?? 'main';
const RUN = path.join(SP, 'runs', `sdk2-${which}`);
fs.rmSync(RUN, { recursive: true, force: true });
fs.mkdirSync(RUN, { recursive: true });
const FAKE_PORT = which === 'expiry' ? 18954 : 18953;
const LARGE = fs.readFileSync(path.join(SP, 'runs', 'large.png'));
const sdk = {
  head: await import(path.join(SP, 'wt-head/packages/sdk-typescript/dist/daemon/index.js')),
  base: await import(path.join(SP, 'wt-base/packages/sdk-typescript/dist/daemon/index.js')),
};
const fake = spawn(process.execPath, [path.join(SP, 'rig/fake-model.mjs'), String(FAKE_PORT), path.join(RUN, 'fake.jsonl')], {
  stdio: ['ignore', 'pipe', 'inherit'],
});
await new Promise((r) => fake.stdout.once('data', r));

async function daemon(arm, port) {
  const root = path.join(RUN, `daemon-${arm}-${port}`);
  const ws = path.join(root, 'ws');
  const { home, qwenHome } = prepareHome({ root, ws, fakePort: FAKE_PORT });
  const d = new Daemon({
    wt: path.join(SP, `wt-${arm}`), home, qwenHome, ws, fakePort: FAKE_PORT,
    logFile: path.join(root, 'daemon.log'), port0: port,
    extraEnv: { QWEN_RUNTIME_DIR: path.join(root, 'runtime') },
  });
  await d.start();
  d.root = root;
  return d;
}
function storedFiles(root, sid) {
  const out = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (!e.isDirectory()) continue;
      if (e.name === `session-${encodeURIComponent(sid)}`)
        for (const f of fs.readdirSync(p)) out.push({ name: f, sha256: sha256(fs.readFileSync(path.join(p, f))) });
      else walk(p);
    }
  };
  walk(root);
  return out;
}
async function raw(base, method, p, { body, headers = {}, clientId } = {}) {
  const h = { Authorization: `Bearer ${TOKEN}`, ...headers };
  if (clientId) h['X-Qwen-Client-Id'] = clientId;
  const res = await fetch(base + p, { method, headers: h, body });
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : undefined; } catch { json = text.slice(0, 200); }
  return { status: res.status, json };
}
const create = (d, sid, size, clientId) =>
  raw(d.base, 'POST', `/session/${sid}/attachment-uploads`, {
    body: JSON.stringify({ name: 'blob.bin', mimeType: 'application/octet-stream', size }),
    headers: { 'Content-Type': 'application/json' },
    clientId,
  });
const results = [];
function record(id, title, pass, data) {
  results.push({ id, title, pass, ...data });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${id} ${title}`);
  fs.writeFileSync(path.join(RUN, 'results.json'), JSON.stringify(results, null, 2));
}

if (which === 'main') {
  const H = await daemon('head', 18935);
  const proxy = await startFaultProxy({ port: 18941, target: H.port });
  const PROXY = 'http://127.0.0.1:18941';
  const chunkAt = (off) => (e) => e.path.endsWith('/chunks') && e.query === `?offset=${off}`;

  // S10: connection reset after the daemon applied the request (TypeError on the client).
  for (const [id, fault] of [
    ['S10-reset-chunk', { match: chunkAt(524288), action: 'drop-response' }],
    ['S10-reset-complete', { match: (e) => e.path.endsWith('/complete'), action: 'drop-response' }],
  ]) {
    proxy.clear();
    const s = await H.createSession();
    proxy.addFault(fault);
    const c = new sdk.head.DaemonClient({ baseUrl: PROXY, token: TOKEN });
    let ref, error;
    try {
      ref = await c.uploadSessionAttachment(s.sessionId, new Blob([LARGE]), 'image.png', 'image/png', { clientId: s.clientId });
    } catch (e) { error = String(e); }
    const files = storedFiles(H.root, s.sessionId);
    record(id, `head, no nginx: ${id.endsWith('chunk') ? 'chunk 2' : 'completion'} applied, connection reset before the response`,
      !!ref && files.length === 1 && files[0].sha256 === sha256(LARGE),
      { ref, error, files, ledger: proxy.ledger.filter((e) => e.path.includes('attachment')).map((e) => `${e.method} ${e.path.split('/').pop()}${e.query} ${e.status}${e.fault ? ' [' + e.fault + ']' : ''}`) });
  }

  // S11a: per-session limit of 8 and release by DELETE.
  {
    const s = await H.createSession();
    const codes = [];
    const ids = [];
    for (let i = 0; i < 9; i++) {
      const r = await create(H, s.sessionId, 1024 * 1024, s.clientId);
      codes.push(r.status);
      if (r.json?.uploadId) ids.push(r.json.uploadId);
      if (r.status !== 201) codes.push(r.json?.code);
    }
    const del = await raw(H.base, 'DELETE', `/session/${s.sessionId}/attachment-uploads/${ids[0]}`, { clientId: s.clientId });
    const again = await create(H, s.sessionId, 1024 * 1024, s.clientId);
    record('S11a-session-cap', 'head: 9th concurrent upload in one session is 429; DELETE frees a slot',
      codes.slice(0, 8).every((c) => c === 201) && codes[8] === 429 && del.status === 204 && again.status === 201,
      { codes, deleteStatus: del.status, afterDelete: again.status });
    await raw(H.base, 'DELETE', `/session/${s.sessionId}`);
  }

  // S11b: last-attach detach of one client cancels only that client's uploads.
  {
    const s = await H.createSession();
    const other = (await H.load(s.sessionId)).json?.clientId;
    const own = [];
    for (let i = 0; i < 8; i++) own.push((await create(H, s.sessionId, 1024 * 1024, s.clientId)).json?.uploadId);
    const before = await create(H, s.sessionId, 1024 * 1024, other);
    const det = await H.detach(s.sessionId, s.clientId);
    await sleep(300);
    const after = [];
    for (let i = 0; i < 8; i++) after.push((await create(H, s.sessionId, 1024 * 1024, other)).status);
    const status = await H.status(s.sessionId);
    record('S11b-client-detach', 'head: detaching client A releases its 8 staged uploads; session stays open for client B',
      before.status === 429 && det.status < 300 && after.every((c) => c === 201) && status.status === 200,
      { secondClient: other, otherBeforeDetach: before.status, detach: det.status, otherAfterDetach: after, sessionStatus: status.status });
    await raw(H.base, 'DELETE', `/session/${s.sessionId}`);
  }

  // S11c: global active-upload cap (32) and release on session close. Anonymous
  // uploads (no client id) are not tied to a client, so only the close path can free them.
  {
    const sessions = [];
    for (let i = 0; i < 5; i++) sessions.push(await H.createSession());
    const codes = [];
    for (let i = 0; i < 4; i++)
      for (let j = 0; j < 8; j++) codes.push((await create(H, sessions[i].sessionId, 64 * 1024, undefined)).status);
    const over = await create(H, sessions[4].sessionId, 64 * 1024, undefined);
    const close = await raw(H.base, 'DELETE', `/session/${sessions[0].sessionId}`);
    await sleep(300);
    const afterClose = [];
    for (let j = 0; j < 8; j++) afterClose.push((await create(H, sessions[4].sessionId, 64 * 1024, undefined)).status);
    const over2 = await create(H, sessions[4].sessionId, 64 * 1024, undefined);
    record('S11c-global-cap-close', 'head: 33rd active upload daemon-wide is 429; closing a session frees its 8',
      codes.every((c) => c === 201) && over.status === 429 && close.status === 204 && afterClose.every((c) => c === 201),
      { first32: `${codes.filter((c) => c === 201).length}/32 created`, the33rd: over, closeStatus: close.status, afterClose, sessionCapAfter: over2.status });
    for (const s of sessions.slice(1)) await raw(H.base, 'DELETE', `/session/${s.sessionId}`);
  }

  // S11d: 128 MiB staged-byte cap.
  {
    const sessions = [];
    for (let i = 0; i < 3; i++) sessions.push(await H.createSession());
    const codes = [];
    for (let i = 0; i < 2; i++)
      for (let j = 0; j < 8; j++) codes.push((await create(H, sessions[i].sessionId, 8 * 1024 * 1024, undefined)).status);
    const one = await create(H, sessions[2].sessionId, 1, undefined);
    for (const s of sessions.slice(0, 1)) await raw(H.base, 'DELETE', `/session/${s.sessionId}`);
    await sleep(300);
    const after = await create(H, sessions[2].sessionId, 8 * 1024 * 1024, undefined);
    record('S11d-byte-cap', 'head: 16 x 8 MiB staged = 128 MiB; one more byte is 429 until a session closes',
      codes.every((c) => c === 201) && one.status === 429 && after.status === 201,
      { created: `${codes.filter((c) => c === 201).length}/16`, oneMoreByte: one, afterClose: after.status });
    for (const s of sessions.slice(1)) await raw(H.base, 'DELETE', `/session/${s.sessionId}`);
  }

  // S12: direct latency (no proxies): legacy one-shot vs chunked, same daemon.
  {
    const buf = crypto.randomBytes(8 * 1024 * 1024);
    const s = await H.createSession();
    const timings = { legacyBaseSdk: [], chunkedHeadSdk: [] };
    for (let i = 0; i < 5; i++) {
      for (const [k, arm] of [['legacyBaseSdk', 'base'], ['chunkedHeadSdk', 'head']]) {
        const c = new sdk[arm].DaemonClient({ baseUrl: H.base, token: TOKEN });
        const t = performance.now();
        await c.uploadSessionAttachment(s.sessionId, new Blob([buf]), `b${i}${arm}.bin`, 'application/octet-stream', { clientId: s.clientId });
        timings[k].push(Math.round(performance.now() - t));
      }
    }
    const med = (a) => [...a].sort((x, y) => x - y)[2];
    record('S12-latency', 'head daemon, loopback, 8 MiB: base SDK one-shot vs head SDK 16 chunks (5 runs each)', true,
      { timings, medianMs: { legacy: med(timings.legacyBaseSdk), chunked: med(timings.chunkedHeadSdk) } });
  }
  await proxy.close();
  await H.stop();
} else if (which === 'expiry') {
  // S13: an unfinished upload expires after 5 minutes and its slot is released.
  const H = await daemon('head', 18936);
  const s = await H.createSession();
  const ids = [];
  for (let i = 0; i < 8; i++) ids.push((await create(H, s.sessionId, 1024 * 1024, s.clientId)).json?.uploadId);
  const t0 = Date.now();
  const firstChunk = await raw(H.base, 'POST', `/session/${s.sessionId}/attachment-uploads/${ids[0]}/chunks?offset=0`, {
    body: crypto.randomBytes(512 * 1024), headers: { 'Content-Type': 'application/octet-stream' }, clientId: s.clientId,
  });
  const full = await create(H, s.sessionId, 1024 * 1024, s.clientId);
  await sleep(5 * 60 * 1000 + 35_000); // intentional: wait past the 5-minute lifetime and one 30 s sweep
  const elapsed = Date.now() - t0;
  const resume = await raw(H.base, 'POST', `/session/${s.sessionId}/attachment-uploads/${ids[0]}/chunks?offset=524288`, {
    body: crypto.randomBytes(512 * 1024), headers: { 'Content-Type': 'application/octet-stream' }, clientId: s.clientId,
  });
  const after = [];
  for (let i = 0; i < 8; i++) after.push((await create(H, s.sessionId, 1024 * 1024, s.clientId)).status);
  record('S13-expiry', 'head: unfinished uploads expire after 5 min; the ID is gone and all 8 slots are free again',
    firstChunk.status === 200 && full.status === 429 && resume.status === 404 && after.every((c) => c === 201),
    { firstChunk: firstChunk.status, ninthBeforeExpiry: full.status, elapsedMs: elapsed, resumeAfterExpiry: resume, createsAfterExpiry: after });
  await H.stop();
}
fake.kill();
process.exit(0);
