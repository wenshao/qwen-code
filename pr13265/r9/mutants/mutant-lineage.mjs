// Mutant M5 (b95765da88): both funnels back on the old rule — any strictly
// higher revision advances, whatever the capture.
import fs from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
const SP = '/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/375ea070-7eb1-408b-8193-ec64d7c2959a/scratchpad';
const WT = `${SP}/wt-pr15`;
const CLI = `${WT}/packages/cli`;
const files = ['src/serve/hosted-child-run-session.ts', 'src/serve/hosted-monitor-session.ts'];
const originals = files.map((f) => fs.readFileSync(`${CLI}/${f}`, 'utf8'));
try {
  files.forEach((f, i) => {
    const a = '!isToolResultManifestChainLink(before, after)';
    if (originals[i].split(a).length !== 2) throw new Error(`${f}: anchor`);
    fs.writeFileSync(`${CLI}/${f}`, originals[i].replace(a, () => 'after.revision <= before.revision'));
  });
  const run = spawnSync('npx', ['vitest', 'run', 'src/serve/hosted-child-run-session.test.ts', 'src/serve/hosted-monitor-session.test.ts'], { cwd: CLI, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const text = `${run.stdout}\n${run.stderr}`;
  fs.writeFileSync(`${SP}/rig9/mutants-final/M5-lineage-by-revision.txt`, text);
  console.log((text.match(/^\s+Tests\s+.*$/m) ?? ['(no tally)'])[0].trim());
  for (const f of new Set([...text.matchAll(/^ FAIL\s+(.*)$/gm)].map((x) => x[1].trim()))) console.log('   FAIL', f);
} finally {
  files.forEach((f, i) => fs.writeFileSync(`${CLI}/${f}`, originals[i]));
}
const diff = execFileSync('git', ['-C', WT, 'diff', '--stat', '--', 'packages/cli/src'], { encoding: 'utf8' });
console.log(diff.trim() ? `NOT RESTORED\n${diff}` : 'restored, git diff clean');
