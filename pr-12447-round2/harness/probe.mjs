// Black-box probe of the PR's attestation contract over raw TCP.
// Every request is written byte-for-byte with node:net so nothing (fetch/undici)
// normalises the method, target, headers or body on the way out.
import fs from 'node:fs';
import net from 'node:net';
import zlib from 'node:zlib';

const port = Number(process.env.PORT);
const fixtures = JSON.parse(fs.readFileSync(process.env.FIXTURES, 'utf8'));
const success = fixtures.cases.find((c) => c.id === 'success');
const ROUTE = fixtures.route.path;
const baseHeaders = () => Object.entries(success.request.headers);
const baseBody = () => ({ ...success.request.body });

function classify(status) {
  if (status === 200) return 'ok';
  if (status === 401 || status === 403) return 'credentials';
  if (status === 400 || status === 413) return 'protocol';
  if (status === 409) return 'identity';
  if (status === 404 || status === 405) return 'incompatible';
  return 'UNCLASSIFIED';
}

function raw({ method = 'POST', target = ROUTE, headers = baseHeaders(), body, chunked = false }) {
  return new Promise((resolve, reject) => {
    const started = process.hrtime.bigint();
    const sock = net.connect(port, '127.0.0.1');
    const chunks = [];
    sock.on('data', (d) => chunks.push(d));
    let sockErr = null;
    sock.on('error', (e) => { sockErr = e.code || String(e); });
    sock.on('close', () => {
      const ms = Number(process.hrtime.bigint() - started) / 1e6;
      const buf = Buffer.concat(chunks);
      if (buf.length === 0) return resolve({ error: sockErr ?? 'closed with no response', ms });
      const sep = buf.indexOf('\r\n\r\n');
      const head = buf.subarray(0, sep).toString('latin1').split('\r\n');
      const status = Number(head[0].split(' ')[1]);
      const hdrs = {};
      for (const line of head.slice(1)) {
        const i = line.indexOf(':');
        hdrs[line.slice(0, i).toLowerCase()] = line.slice(i + 1).trim();
      }
      let payload = buf.subarray(sep + 4);
      if (hdrs['transfer-encoding'] === 'chunked') {
        const out = [];
        let off = 0;
        for (;;) {
          const eol = payload.indexOf('\r\n', off);
          const size = parseInt(payload.subarray(off, eol).toString(), 16);
          if (!size) break;
          out.push(payload.subarray(eol + 2, eol + 2 + size));
          off = eol + 2 + size + 2;
        }
        payload = Buffer.concat(out);
      }
      resolve({ status, headers: hdrs, body: payload.toString('utf8'), ms });
    });
    let lines = [`${method} ${target} HTTP/1.1`, `Host: 127.0.0.1:${port}`, 'Connection: close'];
    for (const [k, v] of headers) lines.push(`${k}: ${v}`);
    const bodyBuf = body === undefined ? null : Buffer.isBuffer(body) ? body : Buffer.from(body);
    if (bodyBuf && chunked) lines.push('Transfer-Encoding: chunked');
    else if (bodyBuf) lines.push(`Content-Length: ${bodyBuf.length}`);
    sock.write(lines.join('\r\n') + '\r\n\r\n');
    if (bodyBuf && chunked) {
      for (let i = 0; i < bodyBuf.length; i += 4096) {
        const part = bodyBuf.subarray(i, i + 4096);
        sock.write(part.length.toString(16) + '\r\n');
        sock.write(part);
        sock.write('\r\n');
      }
      sock.write('0\r\n\r\n');
    } else if (bodyBuf) sock.write(bodyBuf);
  });
}

const H = (name, value) => baseHeaders().map(([k, v]) => [k, k === name ? value : v]);
const without = (name) => baseHeaders().filter(([k]) => k !== name);
const bodyWith = (patch) => JSON.stringify({ ...baseBody(), ...patch });
const OK = JSON.stringify(baseBody());
const otherDigest = 'sha256:' + 'b'.repeat(64);
// INFLATE_OFF=1: the suggested `inflate: false` arm refuses every Content-Encoding with the JSON 400.
const inflateOff = process.env.INFLATE_OFF === '1';

// expected = what the PR's contract/design doc says should happen.
const cases = [
  // ---- A. exact route admission (design doc: "case variants ... fail with 404")
  ['A1', 'route', 'case-variant path', { target: ROUTE.toUpperCase(), body: OK }, 404],
  ['A2', 'route', 'HEAD on route', { method: 'HEAD' }, 404],
  ['A3', 'route', 'OPTIONS on route', { method: 'OPTIONS' }, 404],
  ['A4', 'route', 'absolute-form target', { target: `http://127.0.0.1:${port}${ROUTE}`, body: OK }, 404],
  ['A5', 'route', 'double leading slash', { target: '/' + ROUTE, body: OK }, 404],
  ['A6', 'route', 'percent-encoded segment', { target: ROUTE.replace('attest', '%61ttest'), body: OK }, 404],
  // ---- B. credentials
  ['B1', 'creds', 'wrong token, same length', { headers: H('authorization', 'Bearer fixture-tokeX'), body: OK }, 401],
  ['B2', 'creds', 'wrong token, other length', { headers: H('authorization', 'Bearer x'), body: OK }, 401],
  ['B3', 'creds', 'lowercase "bearer" scheme', { headers: H('authorization', 'bearer fixture-token'), body: OK }, 401],
  ['B4', 'creds', 'Basic scheme', { headers: H('authorization', 'Basic Zml4dHVyZS10b2tlbg=='), body: OK }, 401],
  ['B5', 'creds', 'bare token, no scheme', { headers: H('authorization', 'fixture-token'), body: OK }, 401],
  // ---- C. request headers
  ['C1', 'headers', 'Cache-Control: no-store, no-cache', { headers: H('cache-control', 'no-store, no-cache'), body: OK }, 400],
  ['C2', 'headers', 'missing lease-id header', { headers: without('x-qwen-managed-lease-id'), body: OK }, 409],
  ['C3', 'headers', 'epoch "04"', { headers: H('x-qwen-managed-lease-epoch', '04'), body: OK }, 409],
  // ---- D. content type / encoding (body-parser errors)
  ['D1', 'body', 'Content-Type text/plain', { headers: H('content-type', 'text/plain'), body: OK }, 400],
  ['D2', 'body', 'no Content-Type', { headers: without('content-type'), body: OK }, 400],
  ['D3', 'body', 'application/json; charset=utf-8', { headers: H('content-type', 'application/json; charset=utf-8'), body: OK }, 200],
  ['D4', 'body', 'application/json; charset=latin1', { headers: H('content-type', 'application/json; charset=latin1'), body: OK }, 400],
  ['D5', 'body', 'Content-Encoding: gzip (valid)', { headers: [...baseHeaders(), ['content-encoding', 'gzip']], body: zlib.gzipSync(OK) }, inflateOff ? 400 : 200],
  ['D6', 'body', 'Content-Encoding: gzip (corrupt)', { headers: [...baseHeaders(), ['content-encoding', 'gzip']], body: 'not-gzip' }, 400],
  ['D7', 'body', 'Content-Encoding: zstd', { headers: [...baseHeaders(), ['content-encoding', 'zstd']], body: OK }, 400],
  ['D10', 'body', 'gzip bomb: 1 KiB wire, 1 MiB inflated', { headers: [...baseHeaders(), ['content-encoding', 'gzip']], body: zlib.gzipSync(OK.replace(/}$/, ',"pad":"' + ' '.repeat(1 << 20) + '"}')) }, inflateOff ? 400 : 413],
  ['D11', 'body', 'Content-Encoding: gzip (truncated)', { headers: [...baseHeaders(), ['content-encoding', 'gzip']], body: zlib.gzipSync(OK).subarray(0, 20) }, 400],
  ['D12', 'body', 'Content-Encoding: br (corrupt)', { headers: [...baseHeaders(), ['content-encoding', 'br']], body: 'not-brotli' }, 400],
  ['D8', 'body', 'top-level JSON array', { body: '[]' }, 400],
  ['D9', 'body', 'JSON null', { body: 'null' }, 400],
  // ---- E. body field semantics: malformed -> 400 protocol, well-formed but different -> 409 identity
  ['E1', 'identity', 'different provisionRequestId', { body: bodyWith({ provisionRequestId: 'provision-02' }) }, 409],
  ['E2', 'identity', 'different tenantId', { body: bodyWith({ tenantId: 'tenant-b' }) }, 409],
  ['E3', 'identity', 'different workspaceId', { body: bodyWith({ workspaceId: 'workspace-b' }) }, 409],
  ['E4', 'identity', 'different workspaceCwd', { body: bodyWith({ workspaceCwd: '/other' }) }, 409],
  ['E5', 'identity', 'different (valid) capabilityDigest', { body: bodyWith({ capabilityDigest: otherDigest }) }, 409],
  ['E6', 'identity', 'different isolationClass', { body: bodyWith({ isolationClass: 'workspace' }) }, 409],
  ['E7', 'protocol', 'empty tenantId', { body: bodyWith({ tenantId: '' }) }, 400],
  ['E8', 'protocol', 'workspaceGeneration as number', { body: bodyWith({ workspaceGeneration: 7 }) }, 400],
  ['E9', 'protocol', 'uppercase digest hex', { body: bodyWith({ capabilityDigest: 'sha256:' + 'A'.repeat(64) }) }, 400],
  ['E10', 'protocol', 'protocolVersion "2" (string)', { body: bodyWith({ protocolVersion: '2' }) }, 400],
  ['E11', 'protocol', 'isolationClass "tenant"', { body: bodyWith({ isolationClass: 'tenant' }) }, 400],
  ['E12', 'protocol', 'missing workspaceId', { body: JSON.stringify(Object.fromEntries(Object.entries(baseBody()).filter(([k]) => k !== 'workspaceId'))) }, 400],
  ['E13', 'protocol', 'extra "__proto__" key', { body: OK.replace(/}$/, ',"__proto__":{"x":1}}') }, 400],
  ['E14', 'protocol', 'digest as 1-element array', { body: bodyWith({ capabilityDigest: [baseBody().capabilityDigest] }) }, 400],
  // ---- F. 16 KiB boundary (whitespace-padded valid JSON, so only size varies)
  ['F1', 'size', 'body exactly 16384 bytes', { body: OK + ' '.repeat(16384 - Buffer.byteLength(OK)) }, 200],
  ['F2', 'size', 'body 16385 bytes', { body: OK + ' '.repeat(16385 - Buffer.byteLength(OK)) }, 413],
  ['F3', 'size', 'chunked 20000 bytes, no Content-Length', { body: OK + ' '.repeat(20000 - Buffer.byteLength(OK)), chunked: true }, 413],

  // ---- G. what a default JDK HttpClient (HTTP_2 preference) sends on cleartext
  ['G1', 'wire', 'h2c upgrade headers (JDK default)', { headers: [...baseHeaders(), ['connection', 'Upgrade, HTTP2-Settings'], ['upgrade', 'h2c'], ['http2-settings', 'AAEAAEAAAAIAAAABAAMAAABkAAQBAAAAAAUAAEAA']], body: OK }, 200],
];

const rows = [];
for (const [id, group, label, req, expected] of cases) {
  const r = await raw(req);
  const ct = r.headers?.['content-type'] ?? '';
  let json = null;
  try { json = r.body ? JSON.parse(r.body) : null; } catch {}
  const noStore = r.headers?.['cache-control'] === 'no-store';
  const jsonOrEmpty = r.status === 404 ? r.body === '' : !!json;
  const pass = r.status === expected && noStore && jsonOrEmpty && classify(r.status) !== 'UNCLASSIFIED';
  rows.push({
    id, group, label, expected, status: r.status ?? r.error, class: r.status ? classify(r.status) : '-',
    noStore, body: r.status === 404 && r.body === '' ? '(empty)' : json ? `json code=${json.code ?? '(success)'}` : `${ct.split(';')[0] || 'none'} ${JSON.stringify(r.body?.slice(0, 60))}`,
    stackLeak: /node_modules|at [A-Za-z.]+ \(/.test(r.body ?? ''),
    ms: Math.round(r.ms), pass, sockErr: r.error,
    rawBody: pass ? undefined : r.body?.slice(0, 600),
  });
}
fs.writeFileSync(process.env.OUT ?? 'probe-results.json', JSON.stringify(rows, null, 2));
for (const row of rows) {
  const mark = row.pass ? 'PASS' : 'FAIL';
  console.log(`${mark} ${row.id.padEnd(4)} ${row.label.padEnd(38)} exp=${row.expected} got=${String(row.status).padEnd(3)} ${row.class.padEnd(12)} no-store=${row.noStore ? 'y' : 'N'} ${row.body}${row.stackLeak ? ' [STACK TRACE IN BODY]' : ''}`);
}
console.log(`\n${rows.filter((r) => r.pass).length}/${rows.length} conform`);
