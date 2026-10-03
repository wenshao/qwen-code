// Applies one mutant at a time to wt-mut's managed-session-records.ts, runs the
// records suite with the JSON reporter, restores with git checkout, and
// asserts a clean tree before the next mutant. Fail-closed on anchors.
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const SP = process.env.SP;
const WT = path.join(SP, 'wt-mut');
const CORE = path.join(WT, 'packages/core');
const FILE = 'src/managed-runtime/managed-session-records.ts';
const ABS = path.join(CORE, FILE);
const OUT = path.join(SP, 'mut');
const only = process.argv.slice(2);

const M = [
  ['C1-no-expansion-cap', 'drop the expansion bound', [['if (shared && bytes > MANAGED_SESSION_LIMITS.maxTransactionBytes) {', 'if (false) {']]],
  ['C2-primitive-height-1', 'primitive leaf counts as a level again', [['height = Math.max(height, (shape?.height ?? 0) + 1);', 'height = Math.max(height, (shape?.height ?? 1) + 1);']]],
  ['C3-memo-skips-depth', 'memo hit skips the depth check', [['if (depth + seen.height - 1 > MANAGED_SESSION_LIMITS.maxJsonDepth) {', 'if (false) {']]],
  ['C4-no-memo', 'drop the memo lookup', [['const seen = shapes.get(value);', 'const seen: JsonShape | undefined = undefined;']]],
  ['C5-shared-flag-ignores-hits', 'a direct memo hit does not mark sharing', [['shared = shared || reached || shape?.shared === true;', 'shared = shared || shape?.shared === true;']]],
];
const _old = [
  ['M1-no-height-memo', 'drop the memo lookup (path-scoped walk again)',
    [['const seen = heights.get(value);', 'const seen: number | undefined = undefined;']]],
  ['M2-memo-skips-depth', 'memo hit returns without the depth check',
    [['if (depth + seen - 1 > MANAGED_SESSION_LIMITS.maxJsonDepth) {', 'if (false) {']]],
  ['M3-no-activation-identity', 'delete the activation payload-identity check',
    [["subject['type'] === 'activation' &&\n        (subject['activationId']", "false &&\n        (subject['activationId']"]]],
  ['M4-no-envelope-match', 'delete the envelope/payload subject match',
    [["subject !== undefined &&\n    'subject' in schema.fields &&", "false &&\n    'subject' in schema.fields &&"]]],
  ['M5-no-self-parent', 'delete message.committed self-parent guard',
    [["payload['parentMessageId'] !== null &&\n        payload['parentMessageId'] === payload['messageId']", "false"]]],
  ['M6-no-self-checkpoint', 'delete checkpoint self-predecessor guard',
    [["payload['previousCheckpointId'] !== null &&\n        payload['previousCheckpointId'] === payload['checkpointId']", "false"]]],
  ['M7-config-ge-to-gt', 'config.bound allows previousRevision == revision',
    [["(payload['previousRevision'] as number) >=\n          (payload['revision'] as number)", "(payload['previousRevision'] as number) >\n          (payload['revision'] as number)"]]],
  ['M8-reader-grammar-relaxed', 'reader grammar (0|[1-9][0-9]*) -> (\\d+)',
    [['/^managed-session\\/(0|[1-9][0-9]*)$/', '/^managed-session\\/(\\d+)$/']]],
  ['M9-recovery-blocked-narrow', 'only active may enter recovery_blocked',
    [["return from !== 'deleted' && from !== 'recovery_blocked';", "return from === 'active';"]]],
  ['M10-recovery-row-narrow', 'recovery_blocked may only return to active',
    [["  recovery_blocked: [\n    'idle',\n    'active',\n    'closing',\n    'closed',\n    'archived',\n    'deleting',\n  ],", "  recovery_blocked: ['active'],"]]],
  ['M11-exact-height', 'primitive leaf height 0 (exact object-depth semantics)',
    [["? (heights.get(child) ?? 1)\n          : 1;", "? (heights.get(child) ?? 1)\n          : 0;"]]],
  ['M12-regex-control-rule', 'R3-5 reverted to the inlined regex (equivalent mutant)',
    [['if (stripAnsiAndControl(value) !== value) {', '// eslint-disable-next-line no-control-regex\n  if (/[\\u0000-\\u001f\\u007f-\\u009f]/.test(value)) {']]],
];

function sh(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: 'utf8', ...opts });
}
function clean() {
  return sh('git', ['-C', WT, 'status', '--porcelain']).trim() === '';
}
if (!clean()) throw new Error('wt-mut is dirty before start');

for (const [id, desc, edits] of M) {
  if (only.length && !only.includes(id)) continue;
  const original = fs.readFileSync(ABS, 'utf8');
  let text = original;
  for (const [find, repl] of edits) {
    const n = text.split(find).length - 1;
    if (n !== 1) {
      console.log(`RESULT\t${id}\tANCHOR-COUNT-${n}\t${desc}`);
      text = null;
      break;
    }
    text = text.replace(find, repl);
  }
  if (text === null) continue;
  fs.writeFileSync(ABS, text);
  const json = path.join(OUT, `${id}.json`);
  const t0 = Date.now();
  const r = spawnSync(
    'npx',
    ['vitest', 'run', FILE.replace(/\.ts$/, '.test.ts'), '--reporter=json', `--outputFile=${json}`, '--coverage.enabled=false'],
    { cwd: CORE, encoding: 'utf8', timeout: 600_000 },
  );
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  sh('git', ['-C', WT, 'checkout', '--', `packages/core/${FILE}`]);
  if (!clean()) throw new Error(`restore failed after ${id}`);
  let summary = `exit=${r.status}`;
  let failed = [];
  let total = 0;
  if (fs.existsSync(json)) {
    const rep = JSON.parse(fs.readFileSync(json, 'utf8'));
    total = rep.numTotalTests;
    summary = `passed=${rep.numPassedTests} failed=${rep.numFailedTests} total=${rep.numTotalTests}`;
    for (const f of rep.testResults)
      for (const a of f.assertionResults)
        if (a.status === 'failed')
          failed.push(`${a.title} [${a.duration ? Math.round(a.duration) + 'ms' : ''}] ${String(a.failureMessages?.[0] ?? '').split('\n')[0].slice(0, 110)}`);
    fs.unlinkSync(json);
  }
  // Fail closed: a run that did not execute the whole suite proves nothing.
  const verdict =
    total !== 85 ? `INVALID(total=${total})` : failed.length ? 'KILLED' : 'SURVIVED';
  console.log(`RESULT\t${id}\t${verdict}\t${summary}\t${secs}s\t${desc}`);
  for (const f of failed) console.log(`  FAILED\t${id}\t${f}`);
}
console.log(`CLEAN\t${clean()}`);
