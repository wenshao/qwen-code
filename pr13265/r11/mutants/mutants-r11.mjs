// Round 11, head abf9687ce6: applies each mutant to wt-pr19, runs the named
// test files in the mutant's package, restores the source and checks that
// `git diff` is clean. Every mutant states the exact site it edits.
import fs from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';

const SP = '/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/375ea070-7eb1-408b-8193-ec64d7c2959a/scratchpad';
const WT = `${SP}/wt-pr19`;
const OUT = `${SP}/rig9/mutants-r11`;
fs.mkdirSync(OUT, { recursive: true });
const WAKE_TESTS = ['src/serve/hosted-monitor-wake.test.ts', 'src/serve/hosted-harness-session.test.ts'];
const PUBLISHER_TESTS = ['src/serve/hosted-shell-publisher.background.test.ts', 'src/serve/hosted-shell-publisher.test.ts', 'src/serve/hosted-child-run-session.test.ts', 'src/serve/hosted-monitor-session.test.ts'];

const MUTANTS = [
  {
    id: 'M3a-shared-predicate-by-name',
    file: 'src/serve/hosted-monitor-wake-turn.ts',
    from: '  return (\n    cause instanceof HostedToolRecoveryRequiredError ||\n    cause instanceof HostedMcpRecoveryRequiredError ||\n    cause instanceof HostedHookRecoveryRequiredError\n  );',
    to: "  return (\n    cause instanceof Error &&\n    (cause.name === 'HostedToolRecoveryRequiredError' ||\n      cause.name === 'HostedMcpRecoveryRequiredError' ||\n      cause.name === 'HostedHookRecoveryRequiredError')\n  );",
    tests: WAKE_TESTS,
  },
  {
    id: 'M3b-session-passes-own-name-predicate',
    file: 'src/serve/hosted-harness-session.ts',
    from: '            needsRecovery: monitorWakeNeedsRecovery,',
    to: "            needsRecovery: (cause) =>\n              cause instanceof Error &&\n              ['HostedToolRecoveryRequiredError', 'HostedMcpRecoveryRequiredError', 'HostedHookRecoveryRequiredError'].includes(cause.name),",
    tests: WAKE_TESTS,
  },
  {
    id: 'M7-cancelled-hook-excludes-every-monitor-input',
    file: 'src/serve/hosted-harness-session.ts',
    from: '        const queuedOnly =\n          isMonitorInput(event) &&\n          (typeof turnId !== \'string\' ||\n            !wakeHasPriorAttempt(projected, turnId));',
    to: '        const queuedOnly = isMonitorInput(event);',
    tests: ['src/serve/hosted-harness-session.test.ts'],
  },
  {
    id: 'M8-latch-lastManifest-before-forward',
    file: 'src/serve/hosted-shell-publisher.ts',
    from: "      if (owner.startReceiptRef === null) return;\n      if (background.recordDomain === 'monitor_run') {",
    to: "      if (owner.startReceiptRef === null) return;\n      background.lastManifest = current;\n      if (background.recordDomain === 'monitor_run') {",
    tests: PUBLISHER_TESTS,
  },
  {
    id: 'M8b-write-forward-failure-propagates',
    file: 'src/serve/hosted-shell-publisher.ts',
    from: '      await sink.write(stream, bytes);\n      try {\n        await this.advanceBackgroundManifest(entry, String(id));\n      } catch {',
    to: '      await sink.write(stream, bytes);\n      try {\n        await this.advanceBackgroundManifest(entry, String(id));\n      } catch (error) {\n        throw error;',
    tests: PUBLISHER_TESTS,
  },
];

const dir = `${WT}/packages/cli`;
const summary = [];
for (const m of MUTANTS) {
  const path = `${dir}/${m.file}`;
  const original = fs.readFileSync(path, 'utf8');
  const n = original.split(m.from).length - 1;
  if (n !== 1) throw new Error(`${m.id}: expected 1 site, found ${n}`);
  try {
    fs.writeFileSync(path, original.replace(m.from, () => m.to));
    const run = spawnSync('npx', ['vitest', 'run', ...m.tests], { cwd: dir, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
    const text = `${run.stdout}\n${run.stderr}`;
    fs.writeFileSync(`${OUT}/${m.id}.txt`, `# ${m.id}\n# cli/${m.file}: ${JSON.stringify(m.from)} -> ${JSON.stringify(m.to)}\n# tests: ${m.tests.join(' ')}\n\n${text}`);
    const tally = (text.match(/^\s+Tests\s+.*$/m) ?? ['(no tally)'])[0].trim();
    const failed = [...new Set([...text.matchAll(/^ FAIL\s+(.*)$/gm)].map((x) => x[1].trim()))];
    summary.push({ id: m.id, site: `cli/${m.file}`, tally, failed });
  } finally {
    fs.writeFileSync(path, original);
  }
  const diff = execFileSync('git', ['-C', WT, 'diff', '--stat', '--', 'packages/cli/src'], { encoding: 'utf8' });
  if (diff.trim()) throw new Error(`${m.id}: worktree not restored\n${diff}`);
}
fs.writeFileSync(`${OUT}/summary.json`, JSON.stringify(summary, null, 2));
for (const s of summary) {
  console.log(`${s.id} (${s.site}): ${s.tally}`);
  for (const f of s.failed.slice(0, 5)) console.log(`   FAIL ${f}`);
}
console.log('restored, git diff clean');
