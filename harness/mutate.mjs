/**
 * Mutation matrix for PR #11576: each entry edits one shipped line in the PR's
 * source, runs the tests that should notice, and restores the file. A mutant
 * that survives means nothing in the suite pins that line.
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const WT = '/root/git/wt11576';
const MUTANTS = [
  {
    id: 'M1',
    file: 'packages/core/src/goals/goal-runtime.ts',
    from: "      error instanceof InvalidGoalCheckpointError ? 'unusable' : 'unreachable',",
    to: "      error instanceof InvalidGoalCheckpointError ? 'unusable' : 'unusable',",
    note: 'classify every non-checkpoint error as unusable',
    test: ['core', 'src/goals/goal-runtime.test.ts'],
  },
  {
    id: 'M2',
    file: 'packages/core/src/goals/goal-runtime.ts',
    from: "        outcome === 'room' ? 'clear' : failure;",
    to: '        failure;',
    note: 'a check that found room no longer clears the diagnostic',
    test: ['core', 'src/goals/goal-runtime.test.ts'],
  },
  {
    id: 'M3',
    file: 'packages/core/src/goals/goal-runtime.ts',
    from: '          ? previousFailure',
    to: '          ? undefined',
    note: 'a check that proves nothing drops the previous diagnostic',
    test: ['core', 'src/goals/goal-runtime.test.ts'],
  },
  {
    id: 'M4',
    file: 'packages/core/src/goals/goal-runtime.ts',
    from: "      health !== undefined && health !== 'clear' ? health.shape : 'full_claims';",
    to: "      'full_claims';",
    note: 'stop reason ignores the last failure shape (pre-PR behaviour)',
    test: ['core', 'src/goals/goal-runtime.test.ts'],
  },
  {
    id: 'M5',
    file: 'packages/core/src/goals/goal-runtime.ts',
    from: "        ? FULL_CLAIM_LIST_FAILURE\n        : 'clear';",
    to: "        ? FULL_CLAIM_LIST_FAILURE\n        : undefined;",
    note: 'a successful non-stalled checkpoint stops clearing the diagnostic',
    test: ['core', 'src/goals/goal-runtime.test.ts'],
  },
  {
    id: 'M6',
    file: 'packages/core/src/goals/goal-reducer.ts',
    from: "      evidenceCheckpoint: undefined,\n      checkpointStalls: undefined,\n      lastCheckpointFailure: undefined,",
    to: "      evidenceCheckpoint: undefined,\n      checkpointStalls: undefined,",
    note: 'edit no longer clears the diagnostic',
    test: ['core', 'src/goals/goal-reducer.test.ts'],
  },
  {
    id: 'M7',
    file: 'packages/core/src/goals/goal-reducer.ts',
    from: "      'checkpointStalls',\n      'lastCheckpointFailure',",
    to: "      'checkpointStalls',",
    note: 'the record parser rejects any record carrying the new field',
    test: ['core', 'src/goals/goal-reducer.test.ts'],
  },
  {
    id: 'M8',
    file: 'packages/core/src/goals/goal-protocol.ts',
    from: '  const codePoints = [...trimmed];',
    to: "  const codePoints = trimmed.split('');",
    note: 'cap measured in UTF-16 units instead of code points',
    test: ['core', 'src/goals/goal-protocol.test.ts'],
  },
  {
    id: 'M9',
    file: 'packages/core/src/goals/goal-tools.ts',
    from: "      ...(goal.lastCheckpointFailure === undefined\n        ? {}\n        : { lastCheckpointFailure: goal.lastCheckpointFailure }),",
    to: '',
    note: 'get_goal lastGoal summary drops the diagnostic',
    test: ['core', 'src/goals/goal-tools.test.ts'],
  },
  {
    id: 'M10',
    file: 'packages/cli/src/ui/components/GoalPill.tsx',
    from: '    if (stalls > 0) {',
    to: '    if (false && stalls > 0) {',
    note: 'the footer pill never shows the stall streak',
    test: ['cli', 'src/ui/components/GoalPill.test.tsx'],
  },
  {
    id: 'M11',
    file: 'packages/cli/src/ui/components/messages/GoalStatusMessage.tsx',
    from: '        {checkpoint ? (',
    to: '        {false && checkpoint ? (',
    note: 'the ink status card never shows the Checkpoint line',
    test: ['cli', 'src/ui/components/messages/GoalStatusMessage.test.tsx'],
  },
  {
    id: 'M12',
    file: 'packages/cli/src/ui/opentui/live-session-model.ts',
    from: '    ...(checkpoint ? { checkpoint } : {}),',
    to: '',
    note: 'the OpenTUI card never carries the Checkpoint line',
    test: ['cli', 'src/ui/opentui/live-session-model.test.ts'],
  },
  {
    id: 'M13',
    file: 'packages/web-shell/client/daemon/session/mappers.ts',
    from: "      ...(lastCheckpointFailure ? { lastCheckpointFailure } : {}),",
    to: '',
    note: 'the web-shell mapper drops the diagnostic again',
    test: ['web-shell', 'client/daemon/session/mappers.test.ts'],
  },
  {
    id: 'M14',
    file: 'packages/web-shell/client/components/dialogs/GoalsDialog.tsx',
    from: '              {checkpointLine && (',
    to: '              {false && checkpointLine && (',
    note: 'the Goals dialog never renders the Checkpoint line',
    test: ['web-shell', 'client/components/dialogs/GoalsDialog.test.tsx'],
  },
  {
    id: 'M15',
    file: 'packages/web-shell/client/i18n.tsx',
    from: "  'goal.checkpointFailed': 'last check failed',",
    to: "  'goal.checkpointFailed': 'LAST CHECK FAILED',",
    note: 'the English checkpoint-failed string drifts',
    test: ['web-shell', 'client/components/dialogs/GoalsDialog.test.tsx'],
  },
];

const only = process.argv.slice(2);
const rows = [];
for (const m of MUTANTS) {
  if (only.length && !only.includes(m.id)) continue;
  const p = path.join(WT, m.file);
  const original = fs.readFileSync(p, 'utf8');
  if (!original.includes(m.from)) {
    rows.push({ id: m.id, verdict: 'ANCHOR-MISS', note: m.note });
    continue;
  }
  fs.writeFileSync(p, original.replace(m.from, m.to));
  let verdict = 'SURVIVED';
  let detail = '';
  try {
    execSync(`npx vitest run ${m.test[1]} --reporter=basic --coverage.enabled=false`, {
      cwd: path.join(WT, 'packages', m.test[0]),
      stdio: 'pipe',
      timeout: 900_000,
    });
  } catch (error) {
    verdict = 'KILLED';
    const out = `${error.stdout || ''}${error.stderr || ''}`;
    const fail = out.match(/Tests\s+(\d+ failed[^\n]*)/);
    detail = fail ? fail[1] : (out.match(/error TS\d+[^\n]*/)?.[0] ?? 'failed');
  } finally {
    fs.writeFileSync(p, original);
  }
  rows.push({ id: m.id, verdict, note: m.note, detail });
  console.log(
    `${m.id} ${verdict.padEnd(11)} ${m.note}${detail ? ` — ${detail}` : ''}`,
  );
}
fs.writeFileSync(
  '/root/git/h11576/out/mutation-matrix.json',
  JSON.stringify(rows, null, 2),
);
const killed = rows.filter((r) => r.verdict === 'KILLED').length;
console.log(`\n${killed}/${rows.length} killed`);
