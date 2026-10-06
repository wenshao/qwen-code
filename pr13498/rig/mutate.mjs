// Fail-closed anchor mutants for the envelope module, schema and gate.
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
const W = process.env.MUT_W ?? '/Users/wenshao/git/pr13498-mut';
const MOD = 'packages/core/src/managed-runtime/managed-event-envelope.ts';
const SCH = 'packages/core/src/managed-runtime/contracts/managed-event-envelope-v1.schema.json';
const M = [
  ['M01 drop forbidden-name check', MOD, `      fail(\`\${label} must not carry the forbidden field "\${key}".\`);`, `      void key;`],
  ['M02 allow extra keys', MOD, `    Object.keys(value).length !== keys.length ||\n`, ``],
  ['M03 allow missing keys', MOD, `    Object.keys(value).some((key) => !keys.includes(key as Key))`, `    false`],
  ['M04 accept non-plain objects', MOD, `    (Object.getPrototypeOf(value) !== Object.prototype &&\n      Object.getPrototypeOf(value) !== null)`, `    false`],
  ['M05 drop v check', MOD, `  if (body.v !== MANAGED_EVENT_ENVELOPE_FORMAT_VERSION) {`, `  if (false) {`],
  ['M06 sequence may be 0', MOD, `  if (sequence < 1) {\n    fail('envelope.sequence must start at 1.');`, `  if (sequence < 0) {\n    fail('envelope.sequence must start at 1.');`],
  ['M07 tenantId unchecked', MOD, `    tenantId: assertManagedSessionStableId(body.tenantId, 'envelope.tenantId'),`, `    tenantId: body.tenantId as string,`],
  ['M08 workspaceId unchecked', MOD, `    workspaceId: assertManagedSessionStableId(\n      body.workspaceId,\n      'envelope.workspaceId',\n    ),`, `    workspaceId: body.workspaceId as string,`],
  ['M09 eventId unchecked', MOD, `    eventId: assertManagedSessionStableId(body.eventId, 'envelope.eventId'),`, `    eventId: body.eventId as string,`],
  ['M10 kind unchecked', MOD, `    kind: assertEnum(body.kind, MANAGED_SESSION_EVENT_KINDS, 'envelope.kind'),`, `    kind: body.kind as never,`],
  ['M11 occurredAt unchecked', MOD, `    occurredAt: assertManagedSessionTime(\n      body.occurredAt,\n      'envelope.occurredAt',\n    ),`, `    occurredAt: body.occurredAt as number,`],
  ['M12 digest unchecked', MOD, `      digest: assertManagedSessionDigest(\n        ref.digest,\n        'envelope.payloadRef.digest',\n      ),`, `      digest: ref.digest as string,`],
  ['M13 payloadRef not frozen', MOD, `    payloadRef: Object.freeze({\n      digest: assertManagedSessionDigest(`, `    payloadRef: ({\n      digest: assertManagedSessionDigest(`],
  ['M14 tenant/workspace swapped on parse', MOD, `    tenantId: assertManagedSessionStableId(body.tenantId, 'envelope.tenantId'),`, `    tenantId: assertManagedSessionStableId(body.workspaceId, 'envelope.tenantId'),`],
  ['M15 dedupe ignores tenant', MOD, `    left.tenantId === right.tenantId &&\n`, ``],
  ['M16 dedupe ignores session', MOD, `    left.sessionId === right.sessionId &&\n`, ``],
  ['M17 dedupe ignores sequence', MOD, `    left.sequence === right.sequence\n`, `    true\n`],
  ['M18 dedupe also requires equal digest', MOD, `    left.sequence === right.sequence\n`, `    left.sequence === right.sequence &&\n    JSON.stringify(delivered) === JSON.stringify(seen)\n`],
  ['M19 both-unparseable compares true', MOD, `    left !== null &&\n    right !== null &&\n`, `    (left === null || right === null ? left === right : true) &&\n    left !== null && right !== null &&\n`.replace('left !== null && right !== null &&\n', '')],
  ['M20 keyOf swallows every error', MOD, `      if (error instanceof ManagedSessionRecordError) return null;\n      throw error;`, `      return null;`],
  ['M21 derived digest over payload only', MOD, `      digest: managedSessionEventsDigest([event]),`, `      digest: managedSessionEventsDigest([{ ...event, payload: {} }]),`],
  ['M22 derived occurredAt = now', MOD, `    occurredAt: event.occurredAt,\n    payloadRef`, `    occurredAt: Date.now(),\n    payloadRef`],
  ['M23 derived envelope not frozen', MOD, `  return Object.freeze({\n    v: MANAGED_EVENT_ENVELOPE_FORMAT_VERSION,\n    sessionId: event.sessionKey.sessionId,`, `  return ({\n    v: MANAGED_EVENT_ENVELOPE_FORMAT_VERSION,\n    sessionId: event.sessionKey.sessionId,`],
  ['M24 key omits tenant', MOD, `  return Object.freeze({\n    tenantId: envelope.tenantId,\n    sessionId: envelope.sessionId,`, `  return Object.freeze({\n    tenantId: '',\n    sessionId: envelope.sessionId,`],
  ['S01 schema envelope open', SCH, `    "envelope": {\n      "type": "object",\n      "additionalProperties": false,`, `    "envelope": {\n      "type": "object",`],
  ['S02 schema digest case-insensitive', SCH, `      "pattern": "^[0-9a-f]{64}$"`, `      "pattern": "^[0-9a-fA-F]{64}$"`],
  ['S03 schema extra kind in envelope enum', SCH, `            "message.delta",\n            "message.retracted"\n          ]\n        },\n        "occurredAt"`, `            "message.delta",\n            "message.retracted",\n            "message.removed"\n          ]\n        },\n        "occurredAt"`],
  ['S04 schema sequence may be 0', SCH, `          "minimum": 1,\n          "maximum": 9007199254740990`, `          "minimum": 0,\n          "maximum": 9007199254740990`],
  ['S05 schema stableId allows C1', SCH, `"^[^\\\\u0000-\\\\u001f\\\\u007f-\\\\u009f]+$"`, `"^[^\\\\u0000-\\\\u001f\\\\u007f]+$"`],
];
const only = process.argv[2];
const rows = [];
for (const [name, file, from, to] of M) {
  if (only && !name.startsWith(only)) continue;
  const p = `${W}/${file}`; const orig = fs.readFileSync(p, 'utf8');
  const n = orig.split(from).length - 1;
  if (n !== 1) { rows.push(`${name}\tANCHOR_COUNT_${n}`); continue; }
  fs.writeFileSync(p, orig.replace(from, to));
  try {
    const r = spawnSync('npx', ['vitest', 'run', 'src/managed-runtime/managed-event-envelope.test.ts', '--coverage.enabled=false'], { cwd: `${W}/packages/core`, encoding: 'utf8' });
    const out = r.stdout + r.stderr;
    const t = /Tests\s+(.*)/.exec(out)?.[1]?.trim() ?? 'no-summary';
    const failed = [...out.matchAll(/ (?:×|FAIL) .*?managed-event-envelope\.test\.ts > (.*)/g)].map((m) => m[1].trim()).slice(0, 2);
    rows.push(`${name}\t${r.status === 0 ? 'SURVIVED' : 'killed'}\t${t}\t${failed.join(' | ')}`);
  } finally { fs.writeFileSync(p, orig); }
}
console.log(rows.join('\n'));
