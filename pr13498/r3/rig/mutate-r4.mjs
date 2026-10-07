// Round-3 schema-pin mutants on top of the earlier sets.
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
const W = process.env.MUT_W ?? '/Users/wenshao/git/pr13498-cand';
const SCH = 'packages/core/src/managed-runtime/contracts/managed-event-envelope-v1.schema.json';
const REC = 'packages/core/src/managed-runtime/managed-session-records.ts';
const M = [
  ['S06 schema stableId maxLength 512 -> 511', SCH, `"maxLength": 512,`, `"maxLength": 511,`],
  ['S06b schema stableId maxLength 512 -> 4096', SCH, `"maxLength": 512,`, `"maxLength": 4096,`],
  ['S07 schema occurredAt maximum +1', SCH, `"maximum": 8640000000000000\n        },\n        "payloadRef"`, `"maximum": 8640000000000001\n        },\n        "payloadRef"`],
  ['S07b schema occurredAt maximum -1', SCH, `"maximum": 8640000000000000\n        },\n        "payloadRef"`, `"maximum": 8639999999999999\n        },\n        "payloadRef"`],
  ['S08 schema sequence maximum +1', SCH, `"maximum": 9007199254740990`, `"maximum": 9007199254740991`],
  ['S08b schema sequence maximum -1', SCH, `"maximum": 9007199254740990`, `"maximum": 9007199254740989`],
  ['R1-9b shared maxTimeMs >=', REC, `  if (value > MANAGED_SESSION_LIMITS.maxTimeMs) {`, `  if (value >= MANAGED_SESSION_LIMITS.maxTimeMs) {`],
];
for (const [name, file, from, to] of M) {
  const p = `${W}/${file}`; const orig = fs.readFileSync(p, 'utf8');
  const n = orig.split(from).length - 1;
  if (n !== 1) { console.log(`${name}\tANCHOR_COUNT_${n}`); continue; }
  fs.writeFileSync(p, orig.replace(from, to));
  try {
    const r = spawnSync('npx', ['vitest', 'run', 'src/managed-runtime/managed-event-envelope.test.ts', '--coverage.enabled=false'], { cwd: `${W}/packages/core`, encoding: 'utf8' });
    const out = r.stdout + r.stderr;
    const failed = [...out.matchAll(/ (?:×|FAIL) .*?managed-event-envelope\.test\.ts > (.*)/g)].map((m) => m[1].trim()).slice(0, 1);
    console.log(`${name}\t${r.status === 0 ? 'SURVIVED' : 'killed'}\t${/Tests\s+(.*)/.exec(out)?.[1]?.trim()}\t${failed.join(' | ')}`);
  } finally { fs.writeFileSync(p, orig); }
}
