import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
const W = process.env.MUT_W ?? '/Users/wenshao/git/pr13498-cand';
const MOD = 'packages/core/src/managed-runtime/managed-event-envelope.ts';
const M = [
  ['E1 eventId control characters let through', [[MOD, `    eventId: assertManagedSessionStableId(body.eventId, 'envelope.eventId'),`, `    eventId:\n      typeof body.eventId === 'string' && /[\\u0000-\\u001f\\u007f-\\u009f]/.test(body.eventId)\n        ? body.eventId\n        : assertManagedSessionStableId(body.eventId, 'envelope.eventId'),`]]],
  ['A1+A2 public stream parses and compare ignores stream', [[MOD, `    stream: assertEnum(\n      body.stream,\n      MANAGED_EVENT_ENVELOPE_STREAMS,\n      'envelope.stream',\n    ),`, `    stream: body.stream as never,`], [MOD, `    left.stream === right.stream &&\n`, ``]]],
];
for (const [name, edits] of M) {
  const origs = new Map();
  let ok = true;
  for (const [file, from, to] of edits) {
    const p = `${W}/${file}`; const cur = origs.has(p) ? fs.readFileSync(p, 'utf8') : (origs.set(p, fs.readFileSync(p, 'utf8')), fs.readFileSync(p, 'utf8'));
    const n = cur.split(from).length - 1; if (n !== 1) { console.log(`${name}\tANCHOR_COUNT_${n}`); ok = false; break; }
    fs.writeFileSync(p, cur.replace(from, to));
  }
  try {
    if (ok) {
      const r = spawnSync('npx', ['vitest', 'run', 'src/managed-runtime/managed-event-envelope.test.ts', '--coverage.enabled=false'], { cwd: `${W}/packages/core`, encoding: 'utf8' });
      const out = r.stdout + r.stderr;
      const failed = [...out.matchAll(/ (?:×|FAIL) .*?managed-event-envelope\.test\.ts > (.*)/g)].map((m) => m[1].trim()).slice(0, 2);
      console.log(`${name}\t${r.status === 0 ? 'SURVIVED' : 'killed'}\t${/Tests\s+(.*)/.exec(out)?.[1]?.trim()}\t${failed.join(' | ')}`);
    }
  } finally { for (const [p, o] of origs) fs.writeFileSync(p, o); }
}
