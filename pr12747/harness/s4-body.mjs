// S4: the shared JSON body parser, byte-for-byte response differential over every owned route, base vs PR.
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { startWorker, headers, installation, ROUTES, BOOT_V1, BOOT_V2, PR_REPO, BASE_REPO } from './lib.mjs';
const base = fs.realpathSync(fs.mkdtempSync('/tmp/p12747-s4-'));
fs.mkdirSync(path.join(base, 'services/api'), { recursive: true });
const pad = (n) => JSON.stringify({ protocolVersion: 2, pad: 'x'.repeat(Math.max(0, n - 30)) });
const valid = { protocolVersion: 2, reference: { sessionId: 's1', promptId: 'p', callId: 'c', argsDigest: 'd' } };
const cases = [
  ['valid-shaped JSON', (h) => [h, JSON.stringify(valid)]],
  ['gzip Content-Encoding', (h) => [{ ...h, 'content-encoding': 'gzip' }, gzipSync(JSON.stringify(valid))]],
  ['deflate Content-Encoding', (h) => [{ ...h, 'content-encoding': 'deflate' }, Buffer.from('x')]],
  ['16384 B body', (h) => [h, pad(16384)]],
  ['16385 B body', (h) => [h, pad(16385)]],
  ['70000 B body', (h) => [h, pad(70000)]],
  ['1 MiB + 1 body', (h) => [h, pad(1048577)]],
  ['malformed JSON', (h) => [h, '{"protocolVersion":']],
  ['non-object JSON "x"', (h) => [h, '"x"']],
  ['text/plain', (h) => [{ ...h, 'content-type': 'text/plain' }, JSON.stringify(valid)]],
  ['charset=latin1', (h) => [{ ...h, 'content-type': 'application/json; charset=latin1' }, JSON.stringify(valid)]],
  ['empty body', (h) => [h, '']],
];
const results = {};
for (const [arm, repo] of [['base', BASE_REPO], ['PR', PR_REPO]]) {
  for (const [bootName, boot, routes] of [
    ['v2', { ...BOOT_V2, mountRoot: base }, [ROUTES.ATTEST_V3, ROUTES.CONTEXT, ROUTES.EXECUTE, ROUTES.STATUS, ROUTES.CANCEL]],
    ['v1', { ...BOOT_V1, workspaceCwd: path.join(base, 'services/api') }, [ROUTES.ATTEST_V2, ROUTES.EXECUTE, ROUTES.STATUS, ROUTES.CANCEL]],
  ]) {
    const w = await startWorker(boot, { repo });
    for (const route of routes) for (const [label, make] of cases) {
      const [h, body] = make(headers(boot));
      const res = await fetch(w.url + route, { method: 'POST', headers: h, body });
      const text = await res.text();
      const keyHdr = ['content-type', 'cache-control'].map((k) => `${k}=${res.headers.get(k)}`).join(';');
      (results[`${bootName} ${route} | ${label}`] ??= {})[arm] = `${res.status} ${keyHdr} ${createHash('sha256').update(text).digest('hex').slice(0, 10)} ${text.slice(0, 70).replace(/\s+/g, ' ')}`;
    }
    await w.close();
  }
}
let same = 0, diff = 0;
const lines = [];
for (const [k, v] of Object.entries(results)) {
  if (v.base === v.PR) { same++; lines.push(`same  ${k.padEnd(62)} ${v.PR}`); }
  else { diff++; lines.push(`DIFF  ${k}\n   base: ${v.base}\n   PR:   ${v.PR}`); }
}
lines.push(`== ${same} identical, ${diff} different (status + content-type + cache-control + body sha256)`);
fs.writeFileSync(process.argv[2] ?? 's4.log', lines.join('\n') + '\n');
console.log(lines.slice(-1)[0]);
const byStatus = {};
for (const v of Object.values(results)) { const s = v.PR.split(' ')[0]; byStatus[s] = (byStatus[s] ?? 0) + 1; }
console.log('PR status histogram:', JSON.stringify(byStatus));
