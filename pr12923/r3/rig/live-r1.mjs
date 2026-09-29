// R3 live checks for R1-4 (415 encoding vs content type) and R1-5 (generic
// chunk 413 proxy hint) against the real head daemon + fault proxy.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { SP, TOKEN, Daemon, prepareHome } from './lib.mjs';
import { startFaultProxy } from './faultproxy.mjs';

const LARGE = fs.readFileSync(path.join(SP, 'runs', 'large.png'));
const RUN = path.join(SP, 'runs', 'live-r1');
fs.rmSync(RUN, { recursive: true, force: true });
fs.mkdirSync(RUN, { recursive: true });
const fake = spawn(process.execPath, [path.join(SP, 'rig/fake-model.mjs'), '18956', path.join(RUN, 'f.jsonl')], { stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((r) => fake.stdout.once('data', r));

const root = path.join(RUN, 'daemon');
const ws = path.join(root, 'ws');
const { home, qwenHome } = prepareHome({ root, ws, fakePort: 18956 });
const d = await new Daemon({ wt: path.join(SP, 'wt-head'), home, qwenHome, ws, fakePort: 18956, logFile: path.join(root, 'daemon.log'), port0: 18938, extraEnv: { QWEN_RUNTIME_DIR: path.join(root, 'rt') } }).start();
const proxy = await startFaultProxy({ port: 18943, target: d.port });
const sdk = await import(path.join(SP, 'wt-head/packages/sdk-typescript/dist/daemon/index.js'));

async function raw(base, method, p, { body, headers = {}, clientId } = {}) {
  const h = { Authorization: `Bearer ${TOKEN}`, ...headers };
  if (clientId) h['X-Qwen-Client-Id'] = clientId;
  const res = await fetch(base + p, { method, headers: h, body });
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : undefined; } catch { json = text.slice(0, 120); }
  return { status: res.status, json };
}

const results = [];
const record = (id, pass, data) => {
  results.push({ id, pass, ...data });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${id} ${JSON.stringify(data)}`);
  fs.writeFileSync(path.join(RUN, 'results.json'), JSON.stringify(results, null, 2));
};

// R1-4a: chunk request with an unsupported Content-Encoding -> 415 encoding code.
{
  const s = await d.createSession();
  const c = await raw(d.base, 'POST', `/session/${s.sessionId}/attachment-uploads`, {
    body: JSON.stringify({ name: 'a.bin', mimeType: 'application/octet-stream', size: 4 }),
    headers: { 'Content-Type': 'application/json' }, clientId: s.clientId,
  });
  const id = c.json?.uploadId;
  const gz = await raw(d.base, 'POST', `/session/${s.sessionId}/attachment-uploads/${id}/chunks?offset=0`, {
    body: Buffer.from([1, 2, 3, 4]),
    headers: { 'Content-Type': 'application/octet-stream', 'Content-Encoding': 'gzip' },
    clientId: s.clientId,
  });
  record('R1-4a-live', gz.status === 415 && gz.json?.code === 'invalid_attachment_upload_encoding', { create: c.status, gz });
  await raw(d.base, 'DELETE', `/session/${s.sessionId}`);
}
// R1-4b: create with an unsupported charset -> 415 content-type code.
{
  const s = await d.createSession();
  const r = await raw(d.base, 'POST', `/session/${s.sessionId}/attachment-uploads`, {
    body: '{"name":"a.txt","mimeType":"text/plain","size":1}',
    headers: { 'Content-Type': 'application/json; charset=iso-8859-1' }, clientId: s.clientId,
  });
  record('R1-4b-live', r.status === 415 && r.json?.code === 'invalid_attachment_upload_content_type', { r });
  await raw(d.base, 'DELETE', `/session/${s.sessionId}`);
}
// R1-5a: gateway 413 (HTML body) on a chunk -> SDK error message gains the proxy hint.
{
  const s = await d.createSession();
  proxy.addFault({ match: (e) => e.path.endsWith('/chunks'), action: 'status', status: 413 });
  const c = new sdk.DaemonClient({ baseUrl: 'http://127.0.0.1:18943', token: TOKEN });
  let err;
  try {
    await c.uploadSessionAttachment(s.sessionId, new Blob([LARGE]), 'image.png', 'image/png', { clientId: s.clientId });
  } catch (e) { err = e; }
  const msg = String(err?.message ?? '');
  const causeMsg = String(err?.cause?.message ?? '');
  record('R1-5a-live', !!err && (msg.includes('reverse proxy') || causeMsg.includes('reverse proxy')), {
    name: err?.name, status: err?.status, httpStatus: err?.httpStatus, message: msg.slice(0, 220), cause: causeMsg.slice(0, 220),
  });
  await raw(d.base, 'DELETE', `/session/${s.sessionId}`);
}
// R1-5b: the daemon's own structured 413 stays intact (no hint path involved).
{
  const s = await d.createSession();
  const r = await raw(d.base, 'POST', `/session/${s.sessionId}/attachment-uploads`, {
    body: JSON.stringify({ name: 'big.bin', mimeType: 'application/octet-stream', size: 8 * 1024 * 1024 + 1 }),
    headers: { 'Content-Type': 'application/json' }, clientId: s.clientId,
  });
  record('R1-5b-live', r.status === 413 && r.json?.code === 'invalid_attachment_upload_metadata' && !JSON.stringify(r.json).includes('reverse proxy'), { r });
  await raw(d.base, 'DELETE', `/session/${s.sessionId}`);
}

await proxy.close();
await d.stop();
fake.kill();
process.exit(results.every((r) => r.pass) ? 0 : 1);
