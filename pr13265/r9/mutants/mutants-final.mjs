// Round 9, final head 2a3688d703: applies each mutant to wt-pr14, runs the
// named cli test files, restores the source and checks `git diff` is clean.
import fs from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';

const SP = '/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/375ea070-7eb1-408b-8193-ec64d7c2959a/scratchpad';
const WT = `${SP}/wt-pr14`;
const CLI = `${WT}/packages/cli`;
const OUT = `${SP}/rig9/mutants-final`;
fs.mkdirSync(OUT, { recursive: true });

const MUTANTS = [
  {
    id: 'M1-no-settleAttached',
    file: 'src/serve/hosted-workspace-tool-turn.ts',
    from: 'await this.publisher?.settleAttached(executionCallId);',
    to: '/* MUTANT: no re-drive */',
    count: 2,
    tests: ['src/serve/hosted-workspace-tool-turn.test.ts', 'src/serve/hosted-shell-publisher.background.test.ts', 'src/serve/managed-context-worker.test.ts'],
  },
  {
    id: 'M2-no-publication-lane',
    file: 'src/serve/hosted-workspace-tool-turn.ts',
    from: '        this.publication &&\n        this.backgroundLane &&\n',
    to: '        false &&\n        this.backgroundLane &&\n',
    count: 1,
    tests: ['src/serve/hosted-workspace-tool-turn.test.ts', 'src/serve/hosted-shell-publisher.background.test.ts', 'src/serve/managed-context-worker.test.ts'],
  },
  {
    id: 'M3-wake-wiring-by-name',
    file: 'src/serve/hosted-harness-session.ts',
    from: 'needsRecovery: (cause) =>\n              cause instanceof HostedToolRecoveryRequiredError ||\n              cause instanceof HostedMcpRecoveryRequiredError ||\n              cause instanceof HostedHookRecoveryRequiredError,',
    to: "needsRecovery: (cause) =>\n              cause instanceof Error &&\n              (cause.name === 'HostedToolRecoveryRequiredError' ||\n                cause.name === 'HostedMcpRecoveryRequiredError' ||\n                cause.name === 'HostedHookRecoveryRequiredError'),",
    count: 1,
    tests: ['src/serve/hosted-monitor-wake.test.ts', 'src/serve/hosted-harness-session.test.ts'],
  },
  {
    id: 'M4-h7b-settle-on-root-exit',
    file: 'src/serve/managed-background-shell-registry.ts',
    from: 'evidence = root === null ? null : await process.settleOnEmpty();',
    to: 'evidence = root;',
    count: 1,
    tests: ['src/serve/managed-background-shell.test.ts', 'src/serve/managed-shell-runtime.test.ts', 'src/serve/managed-monitor-runtime.test.ts', 'src/serve/managed-context-worker.test.ts'],
  },
];

const summary = [];
for (const m of MUTANTS) {
  const path = `${CLI}/${m.file}`;
  const original = fs.readFileSync(path, 'utf8');
  const n = original.split(m.from).length - 1;
  if (n !== m.count) throw new Error(`${m.id}: expected ${m.count} sites, found ${n}`);
  try {
    fs.writeFileSync(path, original.split(m.from).join(m.to));
    const run = spawnSync('npx', ['vitest', 'run', ...m.tests], { cwd: CLI, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
    const text = `${run.stdout}\n${run.stderr}`;
    fs.writeFileSync(`${OUT}/${m.id}.txt`, `# ${m.id}\n# ${m.file}: ${JSON.stringify(m.from)} -> ${JSON.stringify(m.to)}\n# tests: ${m.tests.join(' ')}\n\n${text}`);
    const tally = (text.match(/^\s+Tests\s+.*$/m) ?? ['(no tally)'])[0].trim();
    const failed = [...new Set([...text.matchAll(/^ FAIL\s+(.*)$/gm)].map((x) => x[1].trim()))];
    summary.push({ id: m.id, tally, failed });
  } finally {
    fs.writeFileSync(path, original);
  }
  const diff = execFileSync('git', ['-C', WT, 'diff', '--stat', '--', 'packages/cli/src'], { encoding: 'utf8' });
  if (diff.trim()) throw new Error(`${m.id}: worktree not restored\n${diff}`);
}
fs.writeFileSync(`${OUT}/summary.json`, JSON.stringify(summary, null, 2));
for (const s of summary) {
  console.log(`${s.id}: ${s.tally}`);
  for (const f of s.failed.slice(0, 6)) console.log(`   FAIL ${f}`);
}
console.log('restored, git diff clean');
