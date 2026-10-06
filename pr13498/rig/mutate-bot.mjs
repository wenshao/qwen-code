import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
const W = process.env.MUT_W;
const MOD = 'packages/core/src/managed-runtime/managed-event-envelope.ts';
const M = [
  ['R1-7 sequence must be >= 2', `  if (sequence < 1) {\n    fail('envelope.sequence must start at 1.');`, `  if (sequence < 2) {\n    fail('envelope.sequence must start at 1.');`],
  ['R1-10 parsed workspaceId hard-coded', `    workspaceId: assertManagedSessionStableId(\n      body.workspaceId,\n      'envelope.workspaceId',\n    ),`, `    workspaceId: (assertManagedSessionStableId(\n      body.workspaceId,\n      'envelope.workspaceId',\n    ), 'workspace-1'),`],
  ['R1-11 key sequence + 1', `    sessionId: envelope.sessionId,\n    sequence: envelope.sequence,`, `    sessionId: envelope.sessionId,\n    sequence: envelope.sequence + 1,`],
];
for (const [name, from, to] of M) {
  const p = `${W}/${MOD}`; const orig = fs.readFileSync(p, 'utf8');
  const n = orig.split(from).length - 1;
  if (n !== 1) { console.log(`${name}\tANCHOR_COUNT_${n}`); continue; }
  fs.writeFileSync(p, orig.replace(from, to));
  try {
    const r = spawnSync('npx', ['vitest', 'run', 'src/managed-runtime/managed-event-envelope.test.ts', '--coverage.enabled=false'], { cwd: `${W}/packages/core`, encoding: 'utf8' });
    console.log(`${name}\t${r.status === 0 ? 'SURVIVED' : 'killed'}\t${/Tests\s+(.*)/.exec(r.stdout + r.stderr)?.[1]?.trim()}`);
  } finally { fs.writeFileSync(p, orig); }
}
