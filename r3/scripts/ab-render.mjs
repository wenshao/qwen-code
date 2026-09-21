// usage: node ab-render.mjs <r2-root> <r3-root>
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const [r2, r3] = process.argv.slice(2);
const run = (root) =>
  JSON.parse(
    execFileSync('node', [path.join(here, 'ab-fixes.mjs'), root], {
      maxBuffer: 1 << 26,
    }).toString(),
  );
const A = run(r2);
const B = run(r3);

const C = {
  r: '\x1b[1;31m',
  g: '\x1b[1;32m',
  y: '\x1b[1;33m',
  c: '\x1b[1;36m',
  d: '\x1b[2m',
  b: '\x1b[1m',
  x: '\x1b[0m',
};
const paint = (v) =>
  ({ ACCEPT: C.y, REJECT: C.g, CRASH: C.r })[v] + v.padEnd(6) + C.x;

console.log(
  `${C.c}PR #12302 round 3 — every behavioural thread, replayed on both BUILT artifacts${C.x}`,
);
console.log(
  `${C.d}left arm  = 98860b5 (round-2 head)   right arm = bf1a6b1 (current head)   module: packages/core/dist/src/managed-runtime/managed-session-records.js${C.x}\n`,
);
console.log(
  `${C.b}${'thread'.padEnd(8)}${'input'.padEnd(62)}${'98860b5'.padEnd(9)}${'bf1a6b1'.padEnd(9)}what bf1a6b1 says${C.x}`,
);
console.log(C.d + '─'.repeat(168) + C.x);
let changed = 0;
for (let i = 0; i < A.length; i++) {
  const a = A[i];
  const b = B[i];
  if (a.v !== b.v || a.note !== b.note) changed++;
  console.log(
    `${a.id.padEnd(8)}${a.title.padEnd(62)}${paint(a.v)}   ${paint(b.v)}   ${C.d}${b.note}${C.x}`,
  );
}
console.log(C.d + '─'.repeat(168) + C.x);
console.log(
  `${C.d}ACCEPT = value certified   REJECT = ManagedSessionRecordError (or predicate false)   CRASH = any other exception escaping the validator${C.x}`,
);
console.log(`\n${C.b}left-arm detail for the rows that changed:${C.x}`);
for (let i = 0; i < A.length; i++) {
  if (A[i].v === B[i].v) continue;
  if (!A[i].note) continue;
  console.log(`  ${A[i].id.padEnd(8)}${C.d}${A[i].note}${C.x}`);
}
