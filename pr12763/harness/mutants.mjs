// Mutation matrix for PR #12763. Each mutant rewrites one exact string (asserted
// to occur exactly once), runs the affected suites, then restores the file
// byte-for-byte. Predicate mutants are applied to core src (core suites import
// src) AND core dist (the cli suite imports the built @qwen-code/qwen-code-core).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const WT = process.env.WT ?? '<git>/qwen-code-pr12763';
const OUT = process.env.OUT;
const CORE = path.join(WT, 'packages/core');
const CLI = path.join(WT, 'packages/cli');
const SRC = 'src/services/gitWorktreeService.ts';
const DIST = 'dist/src/services/gitWorktreeService.js';

// [src text, dist text] pairs for predicate mutants.
const P = (id, desc, srcFrom, srcTo, distFrom = srcFrom, distTo = srcTo) => ({
  id,
  desc,
  edits: [
    { file: path.join(CORE, SRC), from: srcFrom, to: srcTo },
    { file: path.join(CORE, DIST), from: distFrom, to: distTo },
  ],
  suites: ['core', 'cli'],
});

const mutants = [
  P('M1', 'drop --ignored=matching', "      '--ignored=matching',\n", '', "            '--ignored=matching',\n", ''),
  P('M2', '--untracked-files=normal -> no', "'--untracked-files=normal'", "'--untracked-files=no'"),
  P(
    'M3',
    'untracked (??) entries do not count as work',
    "        if (line.startsWith('!!')) {",
    "        if (line.startsWith('??')) return false;\n        if (line.startsWith('!!')) {",
    "            if (line.startsWith('!!')) {",
    "            if (line.startsWith('??')) return false;\n            if (line.startsWith('!!')) {",
  ),
  P(
    'M4',
    'no disposable-roots exemption (every ignored entry is work)',
    "return !DISPOSABLE_IGNORED_ROOTS.has(entry.split('/')[0] ?? '');",
    'return true;',
  ),
  P(
    'M5',
    'every ignored entry exempt',
    "return !DISPOSABLE_IGNORED_ROOTS.has(entry.split('/')[0] ?? '');",
    'return false;',
  ),
  P(
    'M6',
    'no .qwen-session name exemption',
    '        if (entry === WORKTREE_SESSION_FILE) return false;\n',
    '',
    '            if (entry === WORKTREE_SESSION_FILE)\n                return false;\n',
    '',
  ),
  P(
    'M7',
    'fail open on read error',
    '  } catch {\n    return true;\n  }\n}\n\n/**\n * Diff flags',
    '  } catch {\n    return false;\n  }\n}\n\n/**\n * Diff flags',
    '    catch {\n        return true;\n    }\n}\n/**\n * Diff flags',
    '    catch {\n        return false;\n    }\n}\n/**\n * Diff flags',
  ),
  P(
    'M8',
    'drop NO_EXEC_CONFIG from the probe',
    "    const stdout = await runGit(worktreePath, [\n      ...NO_EXEC_CONFIG,\n",
    "    const stdout = await runGit(worktreePath, [\n",
    "        const stdout = await runGit(worktreePath, [\n            ...NO_EXEC_CONFIG,\n",
    "        const stdout = await runGit(worktreePath, [\n",
  ),
  P(
    'M9',
    'drop --no-optional-locks',
    "      ...NO_EXEC_CONFIG,\n      '--no-optional-locks',\n      'status',\n      '--porcelain',\n      '--untracked-files=normal'",
    "      ...NO_EXEC_CONFIG,\n      'status',\n      '--porcelain',\n      '--untracked-files=normal'",
    "            ...NO_EXEC_CONFIG,\n            '--no-optional-locks',\n            'status',\n            '--porcelain',\n            '--untracked-files=normal'",
    "            ...NO_EXEC_CONFIG,\n            'status',\n            '--porcelain',\n            '--untracked-files=normal'",
  ),
  P('M10', '.some -> .every', '      .some((line) => {\n        const entry', '      .every((line) => {\n        const entry', '            .some((line) => {\n            const entry', '            .every((line) => {\n            const entry'),
  P(
    'M13',
    'drop the own-.git access guard (b3cf405)',
    "    await fs.access(path.join(worktreePath, '.git'));\n",
    '',
    "        await fs.access(path.join(worktreePath, '.git'));\n",
    '',
  ),
  {
    id: 'M11',
    desc: 'sweep stops consulting the predicate (always clean)',
    edits: [
      {
        file: path.join(CORE, 'src/services/worktreeCleanup.ts'),
        from: '      worktreeHasWork(worktreePath),',
        to: '      Promise.resolve(false),',
      },
    ],
    suites: ['core'],
  },
  {
    id: 'M12',
    desc: 'daemon stops consulting the predicate (always clean)',
    edits: [
      {
        file: path.join(CLI, 'src/serve/server/worktree-orphan-cleanup.ts'),
        from: '  if (await worktreeHasWork(plan.lockKey)) {',
        to: '  if (false as boolean) {',
      },
    ],
    suites: ['cli'],
  },
];

function runSuite(name) {
  const cwd = name === 'core' ? CORE : CLI;
  const files =
    name === 'core'
      ? ['src/services/worktreeCleanup.test.ts', 'src/utils/git-config-exec.canary.test.ts']
      : ['src/serve/server/worktree-orphan-cleanup.test.ts'];
  let out;
  let ok = true;
  try {
    out = execFileSync('npx', ['vitest', 'run', '--coverage.enabled=false', ...files], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 300_000,
    });
  } catch (e) {
    ok = false;
    out = `${e.stdout ?? ''}${e.stderr ?? ''}`;
  }
  const plain = out.replace(/\x1b\[[0-9;]*m/g, '');
  const failed = [...plain.matchAll(/^\s*× (.+?)\s+\d+ms$/gm)].map((m) => m[1]);
  const summary = (plain.match(/^\s*Tests\s+(.+)$/m) ?? [])[1]?.trim() ?? '?';
  return { ok, summary, failed };
}

const only = process.argv.slice(2);
const results = [];
const baseline = { id: 'M0', desc: 'no mutation (baseline)', core: runSuite('core'), cli: runSuite('cli') };
results.push(baseline);
console.log(JSON.stringify(baseline));
for (const m of mutants) {
  if (only.length && !only.includes(m.id)) continue;
  const backups = m.edits.map((e) => ({ file: e.file, bytes: fs.readFileSync(e.file) }));
  try {
    for (const e of m.edits) {
      const text = fs.readFileSync(e.file, 'utf8');
      const count = text.split(e.from).length - 1;
      if (count !== 1) throw new Error(`${m.id}: expected 1 match in ${e.file}, got ${count}`);
      fs.writeFileSync(e.file, text.replace(e.from, e.to));
    }
    const r = { id: m.id, desc: m.desc };
    for (const s of m.suites) r[s] = runSuite(s);
    r.killed = m.suites.some((s) => !r[s].ok);
    results.push(r);
    console.log(JSON.stringify(r));
  } finally {
    for (const b of backups) fs.writeFileSync(b.file, b.bytes);
  }
}
if (OUT) fs.writeFileSync(OUT, results.map((r) => JSON.stringify(r)).join('\n') + '\n');
