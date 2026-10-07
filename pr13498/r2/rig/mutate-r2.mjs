// Round-2 extras: stream mutants, the bot's R1 mutants, and shared-helper mutants the new rows claim to pin.
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
const W = process.env.MUT_W ?? '/Users/wenshao/git/pr13498-cand';
const MOD = 'packages/core/src/managed-runtime/managed-event-envelope.ts';
const SCH = 'packages/core/src/managed-runtime/contracts/managed-event-envelope-v1.schema.json';
const REC = 'packages/core/src/managed-runtime/managed-session-records.ts';
const M = [
  ['A1 dedupe ignores stream', MOD, `    left.stream === right.stream &&\n`, ``],
  ['A2 any stream accepted', MOD, `    stream: assertEnum(\n      body.stream,\n      MANAGED_EVENT_ENVELOPE_STREAMS,\n      'envelope.stream',\n    ),`, `    stream: body.stream as never,`],
  ['A3 derivation omits stream', MOD, `    stream: 'authoritative_journal',\n    sequence: event.sequence,`, `    sequence: event.sequence,`],
  ['A4 key omits stream', MOD, `    sessionId: envelope.sessionId,\n    stream: envelope.stream,\n    sequence: envelope.sequence,`, `    sessionId: envelope.sessionId,\n    stream: 'authoritative_journal' as const,\n    sequence: envelope.sequence,`],
  ['A5 schema stream enum widened', SCH, `"stream": {\n          "enum": ["authoritative_journal"]\n        },`, `"stream": {\n          "enum": ["authoritative_journal", "public_event"]\n        },`],
  ['R1-7 sequence must be >= 2', MOD, `  if (sequence < 1) {\n    fail('envelope.sequence must start at 1.');`, `  if (sequence < 2) {\n    fail('envelope.sequence must start at 1.');`],
  ['R1-7b schema sequence minimum 2', SCH, `          "minimum": 1,\n          "maximum": 9007199254740990`, `          "minimum": 2,\n          "maximum": 9007199254740990`],
  ['R1-8 schema digest {64,}', SCH, `      "pattern": "^[0-9a-f]{64}$"`, `      "pattern": "^[0-9a-f]{64,}$"`],
  ['R1-9 shared byte limit >=', REC, `  if (Buffer.byteLength(value, 'utf8') > maxBytes) {`, `  if (Buffer.byteLength(value, 'utf8') >= maxBytes) {`],
  ['R1-10 parsed workspaceId constant', MOD, `    workspaceId: assertManagedSessionStableId(\n      body.workspaceId,\n      'envelope.workspaceId',\n    ),`, `    workspaceId: (assertManagedSessionStableId(\n      body.workspaceId,\n      'envelope.workspaceId',\n    ), 'workspace-1'),`],
  ['R1-10b parsed digest constant', MOD, `      digest: assertManagedSessionDigest(\n        ref.digest,\n        'envelope.payloadRef.digest',\n      ),`, `      digest: (assertManagedSessionDigest(\n        ref.digest,\n        'envelope.payloadRef.digest',\n      ), '631f42ee57f8e39d9491a76ba9477d32a11f8c2b8a3a4ff3c21b30760c600000'),`],
  ['R1-11 key sequence + 1', MOD, `    stream: envelope.stream,\n    sequence: envelope.sequence,`, `    stream: envelope.stream,\n    sequence: envelope.sequence + 1,`],
  ['R1-13 shared UTF-16 check removed', REC, `  if (Buffer.from(id, 'utf8').toString('utf8') !== id) {`, `  if (false) {`],
  ['R1-13b shared NFC check removed', REC, `  if (id.normalize('NFC') !== id) {`, `  if (false) {`],
];
const only = process.argv[2];
for (const [name, file, from, to] of M) {
  if (only && !name.startsWith(only)) continue;
  const p = `${W}/${file}`; const orig = fs.readFileSync(p, 'utf8');
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
