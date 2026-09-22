// Live execution of the /review round-1 findings that need no mutation, against
// the esbuilt contract at the current head. Every request is written byte-for-byte
// over node:net. Usage: FIXTURES=<fixtures.json> CONTRACT=<contract.mjs> node review-live.mjs
import fs from 'node:fs';
import net from 'node:net';
import zlib from 'node:zlib';
import { createServer } from 'node:http';
import express from 'express';

const { ownedManagedRuntimeRouteGate, registerManagedRuntimeAttestationRoute } =
  await import(process.env.CONTRACT);
const fixtures = JSON.parse(fs.readFileSync(process.env.FIXTURES, 'utf8'));
const success = fixtures.cases.find((c) => c.id === 'success');
const ROUTE = fixtures.route.path;

async function listen({ identityPatch = {}, prelude } = {}) {
  const app = express();
  if (prelude) prelude(app);
  registerManagedRuntimeAttestationRoute(app, { ...fixtures.identity, ...identityPatch });
  const server = createServer(ownedManagedRuntimeRouteGate(app));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return server;
}

function raw(port, { headers, body = '', halfCloseAfter }) {
  return new Promise((resolve) => {
    const sock = net.connect(port, '127.0.0.1');
    const chunks = [];
    sock.on('data', (d) => chunks.push(d));
    sock.on('error', () => {});
    sock.on('close', () => {
      const buf = Buffer.concat(chunks);
      if (!buf.length) return resolve({ status: 'no response', ct: '', body: '' });
      const sep = buf.indexOf('\r\n\r\n');
      const head = buf.subarray(0, sep).toString('latin1').split('\r\n');
      const h = {};
      for (const l of head.slice(1)) h[l.slice(0, l.indexOf(':')).toLowerCase()] = l.slice(l.indexOf(':') + 1).trim();
      resolve({ status: Number(head[0].split(' ')[1]), ct: h['content-type'] ?? '(none)', cache: h['cache-control'] ?? '(none)', body: buf.subarray(sep + 4).toString('latin1') });
    });
    const payload = Buffer.isBuffer(body) ? body : Buffer.from(body);
    const hdrs = Object.entries(headers).filter(([, v]) => v !== undefined);
    const hasLen = hdrs.some(([k]) => k.toLowerCase() === 'content-length');
    const lines = [`POST ${ROUTE} HTTP/1.1`, 'Host: 127.0.0.1', ...hdrs.map(([k, v]) => `${k}: ${v}`)];
    if (!hasLen) lines.push(`Content-Length: ${payload.length}`);
    lines.push('Connection: close', '', '');
    sock.write(lines.join('\r\n'));
    if (halfCloseAfter !== undefined) {
      sock.write(payload.subarray(0, halfCloseAfter));
      sock.end();
    } else {
      // No FIN: a half-close makes node:http abort the request itself (httpAllowHalfOpen
      // is false), which hides what the application would have answered.
      sock.write(payload);
    }
    setTimeout(() => sock.destroy(), 3000);
  });
}

const H = () => ({ ...success.request.headers });
const B = () => ({ ...success.request.body });
const OK = JSON.stringify(B());
const code = (r) => { try { return JSON.parse(r.body).code ?? '(json, no code)'; } catch { return r.body.startsWith('<!DOCTYPE') || r.ct.startsWith('text/html') ? 'HTML page' : r.body.slice(0, 40) || '(empty)'; } };
const rows = [];
const row = (group, label, r, note = '') => {
  rows.push({ group, label, status: r.status, ct: r.ct, code: code(r), note });
  console.log(`${group.padEnd(5)} ${label.padEnd(52)} ${String(r.status).padEnd(12)} ${r.ct.split(';')[0].padEnd(17)} ${code(r)} ${note}`);
};

// ---- R1-4: which parser-failure classes still leave the JSON envelope with inflate:false?
{
  const s = await listen(); const p = s.address().port;
  row('R1-4', 'gzip + valid gzip body', await raw(p, { headers: { ...H(), 'content-encoding': 'gzip' }, body: zlib.gzipSync(OK) }));
  row('R1-4', 'gzip + uncompressed body', await raw(p, { headers: { ...H(), 'content-encoding': 'gzip' }, body: OK }));
  row('R1-4', 'deflate + uncompressed body', await raw(p, { headers: { ...H(), 'content-encoding': 'deflate' }, body: OK }));
  row('R1-4', 'br + uncompressed body', await raw(p, { headers: { ...H(), 'content-encoding': 'br' }, body: OK }));
  row('R1-4', 'Content-Encoding: identity', await raw(p, { headers: { ...H(), 'content-encoding': 'identity' }, body: OK }));
  row('R1-4', 'Content-Encoding: IDENTITY', await raw(p, { headers: { ...H(), 'content-encoding': 'IDENTITY' }, body: OK }));
  row('R1-4', 'Content-Encoding: identity, gzip', await raw(p, { headers: { ...H(), 'content-encoding': 'identity, gzip' }, body: OK }));
  row('R1-4', 'Content-Length 999999999 (declared > limit)', await raw(p, { headers: { ...H(), 'content-length': '999999999' }, body: OK }));
  row('R1-4', 'Content-Length 400, 100 bytes sent, then FIN (node-level)', await raw(p, { headers: { ...H(), 'content-length': '400' }, body: OK.padEnd(400), halfCloseAfter: 100 }));
  row('R1-4', 'malformed JSON (control)', await raw(p, { headers: H(), body: '{not-json' }));
  s.close();
}

// ---- R1-5: a host-level JSON parser mounted first
{
  // Pad with insignificant JSON whitespace so the body stays the closed eight-key shape.
  const big = OK.replace(/}$/, ' '.repeat(17289 - Buffer.byteLength(OK)) + '}');
  const s0 = await listen(); const p0 = s0.address().port;
  row('R1-5', `no prelude: ${Buffer.byteLength(big)}-byte body`, await raw(p0, { headers: H(), body: big }));
  s0.close();
  const s = await listen({ prelude: (app) => app.use(express.json({ limit: '10mb' })) }); const p = s.address().port;
  row('R1-5', `express.json({limit:'10mb'}) first: ${Buffer.byteLength(big)}-byte body`, await raw(p, { headers: H(), body: big }));
  const noAuth = H(); delete noAuth.authorization;
  row('R1-5', 'parser first: no credentials + malformed JSON', await raw(p, { headers: noAuth, body: '{not-json' }));
  s.close();
}

// ---- R1-6: bearer scheme spelling
{
  const s = await listen(); const p = s.address().port;
  const tok = fixtures.identity.token;
  for (const v of [`Bearer ${tok}`, `bearer ${tok}`, `BEARER ${tok}`, `Bearer  ${tok}`, `Bearer \t${tok}`]) {
    row('R1-6', `Authorization: ${JSON.stringify(v).slice(1, -1)}`, await raw(p, { headers: { ...H(), authorization: v }, body: OK }));
  }
  s.close();
}

// ---- R1-7: identity string bounds
for (const [label, patch] of [
  ['513-char tenantId registered + matching body', { tenantId: 't'.repeat(513) }],
  ['4096-char workspaceCwd registered + matching body', { workspaceCwd: '/' + 'd'.repeat(4095) }],
  ['NUL-bearing tenantId registered + matching body', { tenantId: 'tenant\u0000a' }],
]) {
  let s;
  try { s = await listen({ identityPatch: patch }); } catch (e) { rows.push({ group: 'R1-7', label, status: 'refused at registration', ct: '', code: e.message }); console.log(`R1-7  ${label.padEnd(52)} refused at registration: ${e.message}`); continue; }
  const p = s.address().port;
  row('R1-7', label, await raw(p, { headers: H(), body: JSON.stringify({ ...B(), ...patch }) }));
  s.close();
}

fs.writeFileSync(process.env.OUT ?? 'review-live.json', JSON.stringify(rows, null, 2));
