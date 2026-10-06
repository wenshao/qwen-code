import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
const W = '/Users/wenshao/git/pr13498-cand';
const MOD = 'packages/core/src/managed-runtime/managed-event-envelope.ts';
const M = [
  ['A1 dedupe ignores stream (equivalent while v1 has one stream)', `    left.stream === right.stream &&\n`, ``],
  ['A2 any stream accepted', `    stream: assertEnum(\n      body.stream,\n      MANAGED_EVENT_ENVELOPE_STREAMS,\n      'envelope.stream',\n    ),`, `    stream: body.stream as never,`],
  ['A3 derivation omits stream', `    stream: 'authoritative_journal',\n    sequence: event.sequence,`, `    sequence: event.sequence,`],
  ['C1 slash allowed', `id.includes('/') || `, ``],
  ['C2 backslash allowed', ` || id.includes('\\\\')`, ``],
  ['C3 dot-only allowed', ` || /^\\.+$/.test(id)`, ``],
  ['C4 tenant limit off by one (>=)', `Buffer.byteLength(id, 'utf8') > MAX_TENANT_ID_BYTES`, `Buffer.byteLength(id, 'utf8') >= MAX_TENANT_ID_BYTES`],
  ['C5 tenant limit dropped', `Buffer.byteLength(id, 'utf8') > MAX_TENANT_ID_BYTES`, `false`],
];
for (const [name, from, to] of M) {
  const p = `${W}/${MOD}`; const orig = fs.readFileSync(p, 'utf8');
  const n = orig.split(from).length - 1;
  if (n !== 1) { console.log(`${name}\tANCHOR_COUNT_${n}`); continue; }
  fs.writeFileSync(p, orig.replace(from, to));
  try {
    const r = spawnSync('npx', ['vitest', 'run', 'src/managed-runtime/managed-event-envelope.test.ts', '--coverage.enabled=false'], { cwd: `${W}/packages/core`, encoding: 'utf8' });
    const out = r.stdout + r.stderr;
    const failed = [...out.matchAll(/ (?:×|FAIL) .*?managed-event-envelope\.test\.ts > (.*)/g)].map((m) => m[1].trim()).slice(0, 2);
    console.log(`${name}\t${r.status === 0 ? 'SURVIVED' : 'killed'}\t${/Tests\s+(.*)/.exec(out)?.[1]?.trim()}\t${failed.join(' | ')}`);
  } finally { fs.writeFileSync(p, orig); }
}
