// usage: node docs-check.mjs <arm-root>   — design docs (EN + zh-CN) vs the BUILT module
import fs from 'node:fs';
import path from 'node:path';
import { loadArm } from './fixtures.mjs';
const root = process.argv[2];
const m = await loadArm(root);
const C = { g: '\x1b[1;32m', r: '\x1b[1;31m', c: '\x1b[1;36m', d: '\x1b[2m', x: '\x1b[0m' };
console.log(`${C.c}Design docs vs. built module — lifecycle table (both languages) and limits table${C.x}`);
for (const f of ['managed-session-record-foundation.md', 'managed-session-record-foundation.zh-CN.md']) {
  const text = fs.readFileSync(path.join(root, 'docs/design', f), 'utf8');
  const rows = [...text.matchAll(/^\| `([a-z_]+)`\s+\| (.+?)\s+\|$/gm)].filter((r) => m.MANAGED_SESSION_LIFECYCLE_STATES.includes(r[1]));
  const table = new Map(rows.map((r) => [r[1], [...r[2].matchAll(/`([a-z_]+)`/g)].map((x) => x[1])]));
  let cells = 0, mismatches = [];
  for (const from of m.MANAGED_SESSION_LIFECYCLE_STATES) for (const to of m.MANAGED_SESSION_LIFECYCLE_STATES) {
    cells++;
    const doc = (table.get(from) ?? []).includes(to);
    const code = m.isManagedSessionLifecycleTransitionAllowed(from, to);
    if (doc !== code) mismatches.push(`${from}→${to} doc=${doc} code=${code}`);
  }
  const initial = m.MANAGED_SESSION_LIFECYCLE_STATES.filter((to) => m.isManagedSessionLifecycleTransitionAllowed(null, to));
  console.log(`  ${f.padEnd(48)} rows ${table.size}/8   ${cells} from×to cells   ${mismatches.length === 0 ? C.g + '0 mismatches' : C.r + mismatches.length + ' mismatches: ' + mismatches.join(', ')}${C.x}   initial state from code: ${initial.join(',')}`);
  const L = m.MANAGED_SESSION_LIMITS;
  const expect = [[/512/, L.maxIdBytes === 512], [/4,096/, L.maxTextBytes === 4096], [/8\.64e15/, L.maxTimeMs === 8.64e15], [/\| *64 \|/, L.maxJsonDepth === 64], [/64 KiB/, L.maxHeaderBytes === 65536 && L.maxCommitMarkerBytes === 65536], [/1 MiB/, L.maxEventBytes === 1048576], [/\| *256 \|/, L.maxTransactionEvents === 256], [/8 MiB/, L.maxTransactionBytes === 8388608]];
  const bad = expect.filter(([re, ok]) => !(re.test(text) && ok));
  console.log(`  ${''.padEnd(48)} limits table: ${bad.length === 0 ? C.g + expect.length + '/' + expect.length + ' documented values equal MANAGED_SESSION_LIMITS' : C.r + 'MISMATCH ' + bad.map((b) => b[0]).join(' ')}${C.x}`);
  console.log(`  ${''.padEnd(48)} mentions updateActiveTail: ${/updateActiveTail/.test(text) ? C.g + 'yes' : C.r + 'no'}${C.x}   mentions actor validator duty: ${/actor/i.test(text) || /actor 校验|actor/.test(text) ? C.g + 'yes' : C.r + 'no'}${C.x}`);
}
