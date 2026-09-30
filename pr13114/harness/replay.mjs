// PR #13114: direct replays of a captured, exhausted segment operation (after F4).
// usage: node replay.mjs <captured.json> [port]
import fs from 'node:fs';
const [file, port = '18894'] = process.argv.slice(2);
const c = JSON.parse(fs.readFileSync(file, 'utf8'));
const e = c[c.length - 1];
const body = Buffer.from(e.body, 'base64');
const url = new URL(e.url, `http://127.0.0.1:${port}`);
const base = url.pathname.replace(/\/segments\/.*$/, '');
const H = (op) => ({ 'X-Qwen-Tenant-Id': e.headers['x-qwen-tenant-id'], 'X-Qwen-Tool-Publication-Token': e.headers['x-qwen-tool-publication-token'], 'X-Qwen-Tool-Publication-Operation': op, 'Cache-Control': 'no-store' });
const op0 = e.headers['x-qwen-tool-publication-operation'];
async function call(label, path, op, b) {
  const u = new URL(path + url.search, url);
  const t = Date.now();
  const r = await fetch(u, { method: b ? 'POST' : 'GET', headers: H(op), body: b });
  const text = await r.text();
  let j; try { j = JSON.parse(text); } catch { j = text; }
  const code = j?.error?.code ?? j?.state ?? '';
  console.log(`[replay] ${label}: ${r.status} ${code}${j?.error?.message ? ' — ' + j.error.message : ''} (${Date.now() - t} ms)`);
  return j;
}
const changed = Buffer.from(body); changed[0] ^= 1;
await call('status', `${base}/operations/${op0}`, op0);
await call('identical bytes, same operation', url.pathname, op0, body);
await call('one byte changed, same operation', url.pathname, op0, changed);
await call('identical bytes, new operation id', url.pathname, op0 + 'x', body);
await call('explicit 4th /recover (worker stopped at 3)', `${base}/operations/${op0}/recover`, op0, Buffer.from('{}'));
await call('status after recover', `${base}/operations/${op0}`, op0);
await call('one byte changed after recover', url.pathname, op0, changed);
await call('identical bytes after recover', url.pathname, op0, body);
await call('status', `${base}/operations/${op0}`, op0);
