// Mutation check of the PR's production change against the PR's own suites.
// usage: node mut.mjs [M1 M2 ...]   (runs in src-head; restores the file after each mutant)
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';

const W = '/Users/wenshao/pr13366-rig/src-head';
const FILE = `${W}/packages/cli/src/serve/hosted-workspace-tool-turn.ts`;
const OUT = '/Users/wenshao/pr13366-rig/out/mutants.tsv';
const NODE22 = '/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin';
const SUITES = [
  'src/serve/hosted-workspace-tool-turn.test.ts',
  'src/serve/hosted-harness-session.issue-13328.test.ts',
];
const original = readFileSync(FILE, 'utf8');

const MUTANTS = {
  M0: ['baseline (unchanged file)', 'const ACQUIRE_BUSY_POLL_MS = 250;', 'const ACQUIRE_BUSY_POLL_MS = 250;'],
  M1: ['call site no longer passes the turn signal (no queueing)', '      await this.acquire(false, signal);', '      await this.acquire();'],
  M2: ['queue workspace_unavailable too', 'if (signal === undefined || !isBusyWorkspaceAcquisition(cause))', 'if (signal === undefined || !isRetryableWorkspaceAcquisition(cause))'],
  M3: ['log the notice on every poll', '          if (!queued) {\n            queued = true;', '          if (true) {\n            queued = true;'],
  M4: ['cancelled queue wait no longer counts as a definite refusal', '(isRetryableWorkspaceAcquisition(cause) || waitAborted)) ||', '(isRetryableWorkspaceAcquisition(cause))) ||'],
  M5: ['any failure after the signal aborted counts as definite (ambiguous too)', '(isRetryableWorkspaceAcquisition(cause) || waitAborted)) ||', '(isRetryableWorkspaceAcquisition(cause) || waitAborted || this.acquired === false)) ||'],
  M6: ['queue wait ignores the turn signal', "            await waitForTurn(\n              new Promise((resolve) =>\n                setTimeout(resolve, ACQUIRE_BUSY_POLL_MS),\n              ),\n              signal,\n            );", "            await new Promise((resolve) =>\n                setTimeout(resolve, ACQUIRE_BUSY_POLL_MS),\n              );"],
  M7: ['recovery acquisitions queue too (signal gate removed)', 'if (signal === undefined || !isBusyWorkspaceAcquisition(cause))', 'if (!isBusyWorkspaceAcquisition(cause))'],
  M8: ['no pause between polls (hot loop)', 'setTimeout(resolve, ACQUIRE_BUSY_POLL_MS)', 'setTimeout(resolve, 0)'],
  M9: ['retry only once, then fail as before', '          if (!queued) {\n            queued = true;', '          if (queued) throw cause;\n          if (!queued) {\n            queued = true;'],
};

function run() {
  const r = spawnSync('npx', ['vitest', 'run', ...SUITES], {
    cwd: `${W}/packages/cli`,
    env: { ...process.env, PATH: `${NODE22}:${process.env.PATH}`, CI: '1' },
    encoding: 'utf8',
    timeout: 600_000,
  });
  const out = (r.stdout + r.stderr).replace(/\x1b\[[0-9;]*m/g, '');
  const tests = /^\s+Tests\s+(.*)$/m.exec(out)?.[1] ?? 'NO SUMMARY';
  const failed = [...out.matchAll(/^\s+(?:×|✗|FAIL)\s+(.+?)(?:\s+\d+ms)?$/gm)].map((m) => m[1].trim());
  return { status: r.status, tests, failed };
}

const pick = process.argv.slice(2);
for (const [id, [desc, from, to]] of Object.entries(MUTANTS)) {
  if (pick.length && !pick.includes(id)) continue;
  const count = original.split(from).length - 1;
  if (count < 1) {
    appendFileSync(OUT, `${id}\tANCHOR-MISSING\t${desc}\n`);
    continue;
  }
  const verdicts = [];
  try {
    writeFileSync(FILE, original.split(from).join(to));
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const res = run();
      verdicts.push(res);
      if (res.status === 0) break; // survived: no need for a second run
    }
  } finally {
    writeFileSync(FILE, original);
  }
  const killed = verdicts.length === 2 && verdicts.every((v) => v.status !== 0);
  const line = `${id}\t${killed ? 'KILLED' : verdicts.at(-1).status === 0 ? 'SURVIVED' : 'FLAKY'}\t${desc}\t${verdicts.map((v) => v.tests).join(' | ')}\t${[...new Set(verdicts.flatMap((v) => v.failed))].slice(0, 4).join(' ; ')}\n`;
  appendFileSync(OUT, line);
  process.stdout.write(line);
}
execFileSync('git', ['-C', W, 'diff', '--quiet', '--', 'packages/cli/src/serve/hosted-workspace-tool-turn.ts']);
console.log('restored clean');
