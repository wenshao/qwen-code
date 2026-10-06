// Round 13, head c370c5582b: each mutant applied to wt-pr21, named tests run,
// source restored, git diff checked clean.
import fs from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
const SP = '/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/375ea070-7eb1-408b-8193-ec64d7c2959a/scratchpad';
const WT = `${SP}/wt-pr21`;
const OUT = `${SP}/rig9/mutants-r13`;
fs.mkdirSync(OUT, { recursive: true });
const MUTANTS = [
  {
    id: 'M11-selector-without-hasInstalledPublication',
    file: 'src/serve/managed-context-worker.ts',
    from: '    get hasInstalledPublication() {\n      return (\n        remotePublishers.hasInstalledPublication ||\n        remotePublisher.hasInstalledPublication\n      );\n    },\n',
    to: '',
    tests: ['src/serve/managed-runtime-container.test.ts', 'src/serve/managed-context-worker.test.ts'],
  },
  {
    id: 'M12-redrive-single-attempt',
    file: 'src/serve/hosted-shell-publisher.ts',
    from: 'const MAX_REDRIVE_ATTEMPTS = 3;',
    to: 'const MAX_REDRIVE_ATTEMPTS = 1;',
    tests: ['src/serve/hosted-shell-publisher.background.test.ts'],
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
    summary.push({ id: m.id, tally: (text.match(/^\s+Tests\s+.*$/m) ?? ['(no tally)'])[0].trim(), failed: [...new Set([...text.matchAll(/^ FAIL\s+(.*)$/gm)].map((x) => x[1].trim()))] });
  } finally {
    fs.writeFileSync(path, original);
  }
  if (execFileSync('git', ['-C', WT, 'diff', '--stat', '--', 'packages/cli/src'], { encoding: 'utf8' }).trim()) throw new Error(`${m.id}: not restored`);
}
fs.writeFileSync(`${OUT}/summary.json`, JSON.stringify(summary, null, 2));
for (const s of summary) { console.log(`${s.id}: ${s.tally}`); s.failed.slice(0, 4).forEach((f) => console.log(`   FAIL ${f}`)); }
console.log('restored, git diff clean');
