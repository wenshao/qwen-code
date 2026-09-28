// PR #12923 SDK/daemon matrix through a real nginx (client_max_body_size 1m).
// Topology: DaemonClient -> nginx:18080 (docker) -> fault proxy:18940 -> daemon.
// Every scenario records: the fault-proxy ledger (what reached the daemon), the
// nginx access log (what nginx rejected), the files in the session's attachment
// directory, and the SDK result/error.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { SP, TOKEN, Daemon, prepareHome, sleep } from './lib.mjs';
import { startFaultProxy } from './faultproxy.mjs';
import { sha256 } from './png.mjs';

const NGINX = 'http://127.0.0.1:18080';
const FAKE_PORT = 18951;
const RUN = path.join(SP, 'runs', 'sdk');
fs.rmSync(RUN, { recursive: true, force: true });
fs.mkdirSync(RUN, { recursive: true });
const only = process.argv[2] ? new Set(process.argv[2].split(',')) : undefined;

const LARGE = fs.readFileSync(path.join(SP, 'runs', 'large.png'));
const SMALL = fs.readFileSync(path.join(SP, 'runs', 'small.png'));
const XL = fs.readFileSync(path.join(SP, 'runs', 'xl.png'));

const sdk = {
  head: await import(path.join(SP, 'wt-head/packages/sdk-typescript/dist/daemon/index.js')),
  base: await import(path.join(SP, 'wt-base/packages/sdk-typescript/dist/daemon/index.js')),
};

// ---- infrastructure --------------------------------------------------------
const fakeLedger = path.join(RUN, 'fake-model.jsonl');
const fake = spawn(process.execPath, [path.join(SP, 'rig/fake-model.mjs'), String(FAKE_PORT), fakeLedger], {
  stdio: ['ignore', 'pipe', 'inherit'],
});
await new Promise((r) => fake.stdout.once('data', r));
const proxy = await startFaultProxy({ port: 18940, target: 0 });

async function daemon(arm, port) {
  const root = path.join(RUN, `daemon-${arm}-${port}`);
  const ws = path.join(root, 'ws');
  const { home, qwenHome } = prepareHome({ root, ws, fakePort: FAKE_PORT });
  const d = new Daemon({
    wt: path.join(SP, `wt-${arm}`),
    home,
    qwenHome,
    ws,
    fakePort: FAKE_PORT,
    logFile: path.join(root, 'daemon.log'),
    port0: port,
    extraEnv: { QWEN_RUNTIME_DIR: path.join(root, 'runtime') },
  });
  await d.start();
  d.root = root;
  d.arm = arm;
  return d;
}

function storedFiles(root, sid) {
  const out = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === `session-${encodeURIComponent(sid)}`) {
          for (const f of fs.readdirSync(p)) {
            const b = fs.readFileSync(path.join(p, f));
            out.push({ name: f, bytes: b.length, sha256: sha256(b) });
          }
        } else walk(p);
      }
    }
  };
  walk(root);
  return out;
}

function nginxLogSince(sinceIso) {
  try {
    return execFileSync('docker', ['logs', '--since', sinceIso, 'pr12923-nginx'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
      .split('\n')
      .filter((l) => l.includes('"'))
      .map((l) => l.replace(/^\S+ /, ''));
  } catch (e) {
    return [`docker logs failed: ${e}`];
  }
}

async function raw(base, method, p, { body, headers = {}, clientId } = {}) {
  const h = { Authorization: `Bearer ${TOKEN}`, ...headers };
  if (clientId) h['X-Qwen-Client-Id'] = clientId;
  const res = await fetch(base + p, { method, headers: h, body });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = text.slice(0, 200);
  }
  return { status: res.status, json };
}

function describeError(e) {
  if (!e) return undefined;
  return {
    name: e.name,
    message: String(e.message).slice(0, 300),
    status: e.status,
    httpStatus: e.httpStatus,
    body: e.body && typeof e.body === 'object' ? e.body : typeof e.body === 'string' ? e.body.slice(0, 120) : undefined,
    cause: e.cause ? { name: e.cause.name, message: String(e.cause.message).slice(0, 200), status: e.cause.status } : undefined,
  };
}

const ledgerView = () =>
  proxy.ledger
    .filter((e) => !/\/events$|\/capabilities$/.test(e.path) || e.fault)
    .map((e) => ({
      m: e.method,
      p: e.path.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, (x) => x.slice(0, 8)),
      q: e.query || undefined,
      bytes: e.reqBytes,
      status: e.status,
      fault: e.fault,
    }));

const results = [];
async function scenario(id, title, fn) {
  if (only && !only.has(id)) return;
  proxy.clear();
  const since = new Date().toISOString();
  const t0 = Date.now();
  let out;
  try {
    out = await fn();
  } catch (e) {
    out = { pass: false, crashed: describeError(e), stack: String(e.stack).split('\n').slice(0, 4) };
  }
  await sleep(300);
  const r = { id, title, ms: Date.now() - t0, ...out, ledger: ledgerView(), nginx: nginxLogSince(since) };
  results.push(r);
  console.log(`${r.pass ? 'PASS' : 'FAIL'} ${id} ${title} (${r.ms} ms)`);
  fs.writeFileSync(path.join(RUN, 'results.json'), JSON.stringify(results, null, 2));
}

async function newSession(d) {
  const s = await d.createSession();
  return { sid: s.sessionId, clientId: s.clientId };
}

async function upload(sdkArm, d, s, buf, name, mime, extra = {}) {
  const client = new sdk[sdkArm].DaemonClient({ baseUrl: extra.baseUrl ?? NGINX, token: TOKEN });
  try {
    const ref = await client.uploadSessionAttachment(s.sid, new Blob([buf], { type: mime }), name, mime, {
      clientId: s.clientId,
      ...(extra.signal ? { signal: extra.signal } : {}),
    });
    return { ref, client };
  } catch (e) {
    return { error: describeError(e), errorObj: e, client };
  }
}

async function readBack(client, s, ref) {
  const data = await client.readSessionAttachment(s.sid, ref.attachmentId, { clientId: s.clientId });
  const bytes = Buffer.from(data.data, 'base64');
  return { bytes: bytes.length, sha256: sha256(bytes) };
}

// ---- start daemons ---------------------------------------------------------
const H = await daemon('head', 18931);
const B = await daemon('base', 18932);
console.log('daemons', H.base, B.base);
const caps = {
  head: (await raw(H.base, 'GET', '/capabilities')).json?.features?.includes('session_attachment_chunk_upload'),
  base: (await raw(B.base, 'GET', '/capabilities')).json?.features?.includes('session_attachment_chunk_upload'),
};
console.log('chunk capability', caps);

// S1: proxy control — the same PNG as one raw request is rejected by nginx before the daemon.
for (const [arm, d] of [['base', B], ['head', H]]) {
  await scenario(`S1-${arm}`, `nginx control: one-shot raw POST of ${LARGE.length} B PNG (${arm} daemon)`, async () => {
    proxy.setTarget(d.port);
    const s = await newSession(d);
    const r = await raw(NGINX, 'POST', `/session/${s.sid}/attachments?name=image.png`, {
      body: LARGE,
      headers: { 'Content-Type': 'image/png' },
      clientId: s.clientId,
    });
    const reached = proxy.ledger.some((e) => e.path.endsWith('/attachments') && e.method === 'POST');
    const files = storedFiles(d.root, s.sid);
    return { pass: r.status === 413 && !reached && files.length === 0, status: r.status, body: r.json, reachedDaemon: reached, files };
  });
}

// S2: the reported bug and the fix — SDK upload of the 2855x1625 PNG through nginx, then a prompt.
for (const arm of ['base', 'head']) {
  const d = arm === 'head' ? H : B;
  await scenario(`S2-${arm}`, `${arm} SDK + ${arm} daemon: upload ${LARGE.length} B PNG through nginx and prompt with it`, async () => {
    proxy.setTarget(d.port);
    const s = await newSession(d);
    const u = await upload(arm, d, s, LARGE, 'image.png', 'image/png');
    const files = storedFiles(d.root, s.sid);
    if (u.error) return { pass: arm === 'base', expectFailure: arm === 'base', error: u.error, files };
    const back = await readBack(u.client, s, u.ref);
    // Prompt through nginx with the reference, exactly as the Web Shell does.
    const before = fs.existsSync(fakeLedger) ? fs.readFileSync(fakeLedger, 'utf8').split('\n').filter(Boolean).length : 0;
    const sub = d.subscribe(s.sid, s.clientId);
    await sub.ready;
    const pr = await raw(NGINX, 'POST', `/session/${s.sid}/prompt`, {
      body: JSON.stringify({ prompt: [{ type: 'text', text: 'PR12923 describe the attached screenshot' }, u.ref] }),
      headers: { 'Content-Type': 'application/json' },
      clientId: s.clientId,
    });
    const done = await sub.waitFor((e) => e.type === 'turn_complete' || e.type === 'turn_error', 60000);
    sub.close();
    const modelCalls = fs
      .readFileSync(fakeLedger, 'utf8')
      .split('\n')
      .filter(Boolean)
      .slice(before)
      .map((l) => JSON.parse(l))
      .filter((c) => c.main);
    const img = modelCalls.flatMap((c) => c.lastUserImages);
    const src = sha256(LARGE);
    return {
      pass:
        back.sha256 === src &&
        files.length === 1 &&
        files[0].sha256 === src &&
        img.length === 1 &&
        img[0].sha256 === src &&
        pr.status < 300,
      ref: u.ref,
      source: { bytes: LARGE.length, sha256: src },
      download: back,
      files,
      prompt: { status: pr.status, turn: done?.type },
      modelImages: img,
      modelReply: modelCalls.at(-1)?.reply,
    };
  });
}

// S3: small attachment keeps the legacy single request.
await scenario('S3-head', `head: ${SMALL.length} B PNG uses the legacy single POST`, async () => {
  proxy.setTarget(H.port);
  const s = await newSession(H);
  const u = await upload('head', H, s, SMALL, 'image.png', 'image/png');
  const back = u.ref ? await readBack(u.client, s, u.ref) : undefined;
  const paths = proxy.ledger.map((e) => `${e.method} ${e.path.split('/').slice(3).join('/')}`);
  return {
    pass: !!u.ref && back.sha256 === sha256(SMALL) && !paths.some((p) => p.includes('attachment-uploads')) && paths.includes('POST attachments'),
    ref: u.ref,
    error: u.error,
    download: back,
  };
});

// S4: threshold and cap boundaries (non-image resources give exact byte counts).
for (const [label, size] of [
  ['512KiB', 512 * 1024],
  ['512KiB+1', 512 * 1024 + 1],
  ['8MiB', 8 * 1024 * 1024],
]) {
  await scenario(`S4-${label}`, `head: ${size} B resource through nginx`, async () => {
    proxy.setTarget(H.port);
    const s = await newSession(H);
    const buf = crypto.randomBytes(size);
    const t = Date.now();
    const u = await upload('head', H, s, buf, 'blob.bin', 'application/octet-stream');
    const took = Date.now() - t;
    const back = u.ref ? await readBack(u.client, s, u.ref) : undefined;
    const chunks = proxy.ledger.filter((e) => e.path.endsWith('/chunks')).map((e) => e.reqBytes);
    const legacy = proxy.ledger.filter((e) => e.method === 'POST' && e.path.endsWith('/attachments')).length;
    const expectChunks = size > 512 * 1024 ? Math.ceil(size / (512 * 1024)) : 0;
    return {
      pass: !!u.ref && back.sha256 === sha256(buf) && chunks.length === expectChunks && (expectChunks ? legacy === 0 : legacy === 1),
      uploadMs: took,
      chunkBytes: chunks,
      legacyPosts: legacy,
      error: u.error,
      download: back,
      files: storedFiles(H.root, s.sid).map((f) => ({ bytes: f.bytes, match: f.sha256 === sha256(buf) })),
    };
  });
}
await scenario('S4-8MiB+1', 'head: 8 MiB + 1 B is refused before any upload request; raw create is 413', async () => {
  proxy.setTarget(H.port);
  const s = await newSession(H);
  const u = await upload('head', H, s, Buffer.alloc(8 * 1024 * 1024 + 1, 7), 'blob.bin', 'application/octet-stream');
  const sdkRequests = proxy.ledger.filter((e) => e.path.includes('attachment')).length;
  const rc = await raw(NGINX, 'POST', `/session/${s.sid}/attachment-uploads`, {
    body: JSON.stringify({ name: 'blob.bin', mimeType: 'application/octet-stream', size: 8 * 1024 * 1024 + 1 }),
    headers: { 'Content-Type': 'application/json' },
    clientId: s.clientId,
  });
  return { pass: !!u.error && sdkRequests === 0 && rc.status === 413, sdkError: u.error, sdkRequests, rawCreate: rc };
});

// S5: mixed versions.
await scenario('S5-headSDK-baseDaemon-nginx', 'head SDK -> base daemon through nginx: legacy POST, 413 with proxy hint', async () => {
  proxy.setTarget(B.port);
  const s = await newSession(B);
  const u = await upload('head', B, s, LARGE, 'image.png', 'image/png');
  const legacy = proxy.ledger.filter((e) => e.path.endsWith('/attachments')).length;
  return {
    pass: !!u.error && u.error.status === 413 && /reverse proxy/.test(u.error.message) && legacy === 0,
    error: u.error,
    reachedDaemon: legacy,
  };
});
await scenario('S5-headSDK-baseDaemon-direct', 'head SDK -> base daemon, no proxy: legacy single POST succeeds', async () => {
  const s = await newSession(B);
  const u = await upload('head', B, s, LARGE, 'image.png', 'image/png', { baseUrl: B.base });
  const back = u.ref ? await readBack(u.client, s, u.ref) : undefined;
  return { pass: !!u.ref && back.sha256 === sha256(LARGE), ref: u.ref, error: u.error, download: back };
});
await scenario('S5-baseSDK-headDaemon-direct', 'base SDK -> head daemon, no proxy: legacy route still works', async () => {
  const s = await newSession(H);
  const u = await upload('base', H, s, LARGE, 'image.png', 'image/png', { baseUrl: H.base });
  const back = u.ref ? await readBack(u.client, s, u.ref) : undefined;
  return { pass: !!u.ref && back.sha256 === sha256(LARGE), ref: u.ref, error: u.error, download: back };
});

// S6: lost responses and transient failures on the chunked path.
const chunkAt = (off) => (e) => e.path.endsWith('/chunks') && e.query === `?offset=${off}`;
for (const [id, title, fault] of [
  ['S6-lost-chunk', 'daemon applies chunk 2 but its response is lost', { match: chunkAt(524288), action: 'drop-response' }],
  ['S6-lost-last-chunk', 'daemon applies the final chunk but its response is lost', { match: chunkAt(1572864), action: 'drop-response' }],
  ['S6-lost-complete', 'daemon publishes but the completion response is lost', { match: (e) => e.path.endsWith('/complete'), action: 'drop-response' }],
  ['S6-503-chunk', 'gateway answers 503 for chunk 3 once', { match: chunkAt(1048576), action: 'status', status: 503 }],
  ['S6-502-complete', 'gateway answers 502 for completion once', { match: (e) => e.path.endsWith('/complete'), action: 'status', status: 502 }],
]) {
  await scenario(id, `head: ${title}`, async () => {
    proxy.setTarget(H.port);
    const s = await newSession(H);
    proxy.addFault(fault);
    const u = await upload('head', H, s, LARGE, 'image.png', 'image/png');
    const back = u.ref ? await readBack(u.client, s, u.ref) : undefined;
    const files = storedFiles(H.root, s.sid);
    const list = await raw(H.base, 'GET', `/session/${s.sid}/attachments`, { clientId: s.clientId });
    return {
      pass: !!u.ref && back.sha256 === sha256(LARGE) && files.length === 1 && files[0].sha256 === sha256(LARGE),
      faultFired: proxy.faults[0]?.used,
      ref: u.ref,
      error: u.error,
      download: back,
      files,
      listed: Array.isArray(list.json) ? list.json.length : list.json?.attachments?.length ?? list.json,
    };
  });
}

// S7: cancellation mid-upload (abort while chunk 3 is held by the gateway).
await scenario('S7-cancel', 'head: abort during chunk 3 -> DELETE sent, nothing stored, ID gone', async () => {
  proxy.setTarget(H.port);
  const s = await newSession(H);
  proxy.addFault({ match: chunkAt(1048576), action: 'delay', ms: 1500 });
  const ac = new AbortController();
  const p = upload('head', H, s, LARGE, 'image.png', 'image/png', { signal: ac.signal });
  for (let i = 0; i < 200 && !proxy.ledger.some(chunkAt(1048576)); i++) await sleep(20);
  ac.abort(new Error('user cancelled'));
  const u = await p;
  await sleep(2500);
  const id = proxy.ledger.find((e) => e.path.endsWith('/chunks'))?.path.split('/')[4];
  const files = storedFiles(H.root, s.sid);
  const probe = await raw(H.base, 'POST', `/session/${s.sid}/attachment-uploads/${id}/complete`, { clientId: s.clientId });
  const del = proxy.ledger.filter((e) => e.method === 'DELETE');
  return {
    pass: !!u.error && files.length === 0 && del.length === 1 && del[0].status === 204 && probe.status === 404,
    error: u.error,
    files,
    deleteStatus: del.map((e) => e.status),
    completeAfterCancel: probe,
  };
});

// S8: ownership — another attached client and an anonymous caller cannot touch the upload.
await scenario('S8-ownership', 'head: foreign client / anonymous cannot append, complete or cancel', async () => {
  const s = await newSession(H);
  const other = await H.load(s.sid);
  const otherId = other.json?.clientId;
  const c = await raw(H.base, 'POST', `/session/${s.sid}/attachment-uploads`, {
    body: JSON.stringify({ name: 'blob.bin', mimeType: 'application/octet-stream', size: 10 }),
    headers: { 'Content-Type': 'application/json' },
    clientId: s.clientId,
  });
  const id = c.json?.uploadId;
  const chunk = (cid) =>
    raw(H.base, 'POST', `/session/${s.sid}/attachment-uploads/${id}/chunks?offset=0`, {
      body: Buffer.alloc(10, 1),
      headers: { 'Content-Type': 'application/octet-stream' },
      clientId: cid,
    });
  const foreignAppend = await chunk(otherId);
  const anonAppend = await chunk(undefined);
  const foreignComplete = await raw(H.base, 'POST', `/session/${s.sid}/attachment-uploads/${id}/complete`, { clientId: otherId });
  const foreignDelete = await raw(H.base, 'DELETE', `/session/${s.sid}/attachment-uploads/${id}`, { clientId: otherId });
  const ownerAppend = await chunk(s.clientId);
  const ownerComplete = await raw(H.base, 'POST', `/session/${s.sid}/attachment-uploads/${id}/complete`, { clientId: s.clientId });
  return {
    pass:
      otherId && otherId !== s.clientId &&
      foreignAppend.status === 404 && anonAppend.status === 404 && foreignComplete.status === 404 &&
      ownerAppend.status === 200 && ownerComplete.status === 200,
    otherClient: otherId,
    foreignAppend,
    anonAppend,
    foreignComplete,
    foreignDelete,
    ownerAppend,
    ownerComplete,
  };
});

// S9: a malformed /capabilities answer (bot Stage 1 question) — head hard-fails where base uploaded.
for (const arm of ['base', 'head']) {
  await scenario(`S9-${arm}`, `${arm}: /capabilities answered 200 text/html by the gateway (no body cap involved)`, async () => {
    const d = arm === 'head' ? H : B;
    proxy.setTarget(d.port);
    const s = await newSession(d);
    proxy.addFault({ match: (e) => e.path === '/capabilities', action: 'html200' });
    // Bypass nginx so the body cap is not the variable: go straight to the fault proxy.
    const u = await upload(arm, d, s, LARGE, 'image.png', 'image/png', { baseUrl: 'http://127.0.0.1:18940' });
    return { pass: true, informational: true, ok: !!u.ref, error: u.error, capabilitiesFault: proxy.faults[0]?.used };
  });
}

console.log(JSON.stringify(results.map((r) => [r.id, r.pass]), null, 0));
await H.stop();
await B.stop();
await proxy.close();
fake.kill();
process.exit(0);
