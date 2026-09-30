// VERIFICATION RIG ONLY (PR #12894): a minimal Aliyun OSS double so the PR's
// real AliyunToolPublicationObjectStore + aliyun-sdk-oss 3.18.4 talk TLS to it.
// Data plane: https://0.0.0.0:443 (virtual-hosted bucket), objects on disk.
// Control plane: http://127.0.0.1:18994 (faults, versioning, corruption, ledger).
import fs from 'node:fs';
import https from 'node:https';
import http from 'node:http';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

const RIG = path.dirname(new URL(import.meta.url).pathname);
const DATA = process.env.OSS_DATA ?? path.join(RIG, 'oss-data');
fs.mkdirSync(DATA, { recursive: true });
const BUCKET = process.env.OSS_BUCKET ?? 'rig-bucket';
const objects = new Map(); // key -> { file, length, sha256, etag, puts }
for (const f of fs.readdirSync(DATA)) {
  if (!f.endsWith('.meta')) continue;
  const m = JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8'));
  objects.set(m.key, m);
}
const state = {
  versioning: process.env.OSS_VERSIONING ?? 'none',
  acl: 'private',
  faults: [], // { op, mode, count, ms, match }
  ledger: [],
  counters: { put: 0, putCreated: 0, putExists: 0, get: 0, versioning: 0, acl: 0, faults: 0 },
  honorForbidOverwrite: true,
};
const xml = (body) => `<?xml version="1.0" encoding="UTF-8"?>\n${body}`;
const fileFor = (key) => path.join(DATA, createHash('sha256').update(key).digest('hex'));

function error(res, status, code, message, reqId) {
  const body = xml(`<Error><Code>${code}</Code><Message>${message}</Message><RequestId>${reqId}</RequestId><HostId>${BUCKET}.oss-cn-hangzhou.aliyuncs.com</HostId></Error>`);
  res.writeHead(status, { 'Content-Type': 'application/xml', 'x-oss-request-id': reqId, 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

function takeFault(op, key) {
  const i = state.faults.findIndex((f) => f.op === op && f.count > 0 && (!f.match || key.includes(f.match)));
  if (i < 0) return null;
  const f = state.faults[i];
  if ((f.skip ?? 0) > 0) { f.skip--; return null; }
  f.count--;
  state.counters.faults++;
  return f;
}

const tls = {
  key: fs.readFileSync(path.join(RIG, 'tls', 'srv.key')),
  cert: fs.readFileSync(path.join(RIG, 'tls', 'srv.pem')),
};
const data = https.createServer(tls, async (req, res) => {
  const reqId = randomUUID().replace(/-/g, '').slice(0, 24).toUpperCase();
  const host = String(req.headers.host ?? '').replace(/:\d+$/, '');
  const url = new URL(req.url, `https://${host}`);
  const key = decodeURIComponent(url.pathname.slice(1));
  const entry = { t: Date.now(), method: req.method, host, key, query: url.search, status: null, bytes: 0, forbid: req.headers['x-oss-forbid-overwrite'] ?? null };
  state.ledger.push(entry);
  if (state.ledger.length > 20000) state.ledger.splice(0, 5000);
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = Buffer.concat(chunks);
  entry.bytes = body.length;
  try {
    if (!host.startsWith(`${BUCKET}.`)) return error(res, 404, 'NoSuchBucket', 'bucket', reqId);
    if (req.method === 'GET' && url.searchParams.has('versioning')) {
      state.counters.versioning++;
      entry.status = 200;
      const status = state.versioning === 'none' ? '' : `<Status>${state.versioning}</Status>`;
      const b = xml(`<VersioningConfiguration>${status}</VersioningConfiguration>`);
      res.writeHead(200, { 'Content-Type': 'application/xml', 'x-oss-request-id': reqId, 'Content-Length': Buffer.byteLength(b) });
      return res.end(b);
    }
    if (req.method === 'GET' && url.searchParams.has('acl')) {
      state.counters.acl++;
      entry.status = 200;
      const b = xml(`<AccessControlPolicy><Owner><ID>rig</ID><DisplayName>rig</DisplayName></Owner><AccessControlList><Grant>${state.acl}</Grant></AccessControlList></AccessControlPolicy>`);
      res.writeHead(200, { 'Content-Type': 'application/xml', 'x-oss-request-id': reqId, 'Content-Length': Buffer.byteLength(b) });
      return res.end(b);
    }
    if (req.method === 'PUT' && key) {
      state.counters.put++;
      const fault = takeFault('put', key);
      if (fault?.mode === 'delay') await new Promise((r) => setTimeout(r, fault.ms));
      if (fault?.mode === '500') { entry.status = '500-injected'; return error(res, 500, 'InternalError', 'injected', reqId); }
      if (fault?.mode === '403') { entry.status = '403-injected'; return error(res, 403, 'AccessDenied', 'injected', reqId); }
      if (fault?.mode === 'drop-request') { entry.status = 'dropped-before-store'; return res.destroy(); }
      const existing = objects.get(key);
      const forbid = String(req.headers['x-oss-forbid-overwrite'] ?? '').toLowerCase() === 'true';
      if (existing && forbid && state.honorForbidOverwrite && state.versioning === 'none') {
        state.counters.putExists++;
        entry.status = '409-FileAlreadyExists';
        existing.conflicts = (existing.conflicts ?? 0) + 1;
        existing.lastConflictSha = createHash('sha256').update(body).digest('hex');
        return error(res, 409, 'FileAlreadyExists', 'The object you specified already exists and can not be overwritten.', reqId);
      }
      const file = fileFor(key);
      fs.writeFileSync(file, body);
      const sha256 = createHash('sha256').update(body).digest('hex');
      const etag = createHash('md5').update(body).digest('hex').toUpperCase();
      const meta = { key, file, length: body.length, sha256, etag, puts: (existing?.puts ?? 0) + 1, created: Date.now() };
      objects.set(key, meta);
      fs.writeFileSync(file + '.meta', JSON.stringify(meta));
      state.counters.putCreated++;
      entry.status = existing ? '200-overwrote' : 200;
      if (fault?.mode === 'drop-reply') { entry.status += '-reply-dropped'; return res.destroy(); }
      res.writeHead(200, { ETag: `"${etag}"`, 'x-oss-request-id': reqId, 'Content-Length': 0 });
      return res.end();
    }
    if (req.method === 'GET' && key) {
      state.counters.get++;
      const fault = takeFault('get', key);
      if (fault?.mode === 'delay') await new Promise((r) => setTimeout(r, fault.ms));
      if (fault?.mode === '500') { entry.status = '500-injected'; return error(res, 500, 'InternalError', 'injected', reqId); }
      const meta = objects.get(key);
      if (!meta) { entry.status = 404; return error(res, 404, 'NoSuchKey', 'The specified key does not exist.', reqId); }
      const bytes = fs.readFileSync(meta.file);
      entry.status = 200;
      entry.bytes = bytes.length;
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Length': bytes.length,
        ETag: `"${meta.etag}"`,
        'Last-Modified': new Date(meta.created).toUTCString(),
        'x-oss-request-id': reqId,
      });
      if (fault?.mode === 'truncate') { res.write(bytes.subarray(0, Math.floor(bytes.length / 2))); return res.destroy(); }
      return res.end(bytes);
    }
    entry.status = 400;
    return error(res, 400, 'InvalidRequest', `rig does not implement ${req.method} ${url.search}`, reqId);
  } catch (e) {
    entry.status = `rig-error ${e.message}`;
    return error(res, 500, 'InternalError', e.message, reqId);
  }
});
data.listen(443, '0.0.0.0', () => console.log('fake OSS data plane on :443'));

const admin = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
  const send = (v) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(v)); };
  if (url.pathname === '/state') {
    const prefix = url.searchParams.get('prefix') ?? '';
    const keys = [...objects.values()].filter((o) => o.key.startsWith(prefix));
    return send({
      versioning: state.versioning, acl: state.acl, counters: state.counters, faults: state.faults,
      objects: keys.length, bytes: keys.reduce((a, o) => a + o.length, 0),
      keys: url.searchParams.has('keys') ? keys.map((o) => ({ key: o.key, length: o.length, sha256: o.sha256, puts: o.puts, conflicts: o.conflicts ?? 0 })) : undefined,
    });
  }
  if (url.pathname === '/ledger') {
    const since = Number(url.searchParams.get('since') ?? 0);
    return send(state.ledger.filter((e) => e.t >= since));
  }
  if (url.pathname === '/versioning') { state.versioning = body.status; return send({ versioning: state.versioning }); }
  if (url.pathname === '/acl') { state.acl = body.acl; return send({ acl: state.acl }); }
  if (url.pathname === '/honor-forbid') { state.honorForbidOverwrite = body.honor; return send({ honor: state.honorForbidOverwrite }); }
  if (url.pathname === '/fault') { state.faults.push({ ...body }); return send(state.faults); }
  if (url.pathname === '/clear-faults') { state.faults = []; return send([]); }
  if (url.pathname === '/corrupt') {
    // Flip one byte of the stored object (post-publication corruption).
    const meta = objects.get(body.key) ?? [...objects.values()].find((o) => o.key.includes(body.match ?? '\u0000'));
    if (!meta) return send({ corrupted: null });
    const bytes = fs.readFileSync(meta.file);
    const at = Math.min(bytes.length - 1, body.offset ?? Math.floor(bytes.length / 2));
    bytes[at] ^= 0x01;
    fs.writeFileSync(meta.file, bytes);
    return send({ corrupted: meta.key, at });
  }
  if (url.pathname === '/delete') {
    const meta = objects.get(body.key);
    if (meta) { fs.rmSync(meta.file, { force: true }); fs.rmSync(meta.file + '.meta', { force: true }); objects.delete(body.key); }
    return send({ deleted: !!meta });
  }
  res.writeHead(404); res.end();
});
admin.listen(18994, '127.0.0.1', () => console.log('fake OSS admin on 127.0.0.1:18994'));
