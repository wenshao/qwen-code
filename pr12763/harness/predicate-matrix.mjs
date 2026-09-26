// Read-only: ask each build's own compiled "is there work here?" function
// about the same trees. true = sweep preserves, false = sweep may reap.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const S = process.argv[2];
const dir = path.join(S, 'predicate-fixtures');
fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });
const g = (cwd, ...a) => execFileSync('git', a, { cwd, stdio: 'pipe', encoding: 'utf8' });

const base = await import('<git>/qwen-code-pr12763-base/packages/core/dist/src/services/worktreeCleanup.js');
const pr = await import('<git>/qwen-code-pr12763/packages/core/dist/src/services/gitWorktreeService.js');
const cand = await import('<git>/qwen-code-pr12763-cand/packages/core/dist/src/services/gitWorktreeService.js');
const arms = {
  'main (hasTrackedChanges)': base.__test__.hasTrackedChanges,
  'PR (worktreeHasWork)': pr.worktreeHasWork,
  'candidate': cand.worktreeHasWork,
};

const repo = path.join(dir, 'repo');
fs.mkdirSync(repo);
g(repo, 'init', '-q');
g(repo, 'symbolic-ref', 'HEAD', 'refs/heads/main');
g(repo, 'config', 'user.email', 't@e.com');
g(repo, 'config', 'user.name', 't');
fs.writeFileSync(path.join(repo, '.gitignore'), 'node_modules/\ndist/\n*.tsbuildinfo\n.env\n');
fs.mkdirSync(path.join(repo, 'packages/app/src'), { recursive: true });
fs.writeFileSync(path.join(repo, 'packages/app/src/i.ts'), 'export {};\n');
fs.mkdirSync(path.join(repo, '.husky'));
fs.writeFileSync(path.join(repo, '.husky/pre-commit'), 'npx lint-staged\n');
g(repo, 'add', '-A');
g(repo, 'commit', '-qm', 'init');
fs.mkdirSync(path.join(repo, 'node_modules/x'), { recursive: true });

const cases = [];
let n = 0;
function wt(label, fill) {
  const slug = `agent-${(++n).toString(16).padStart(7, '0')}`;
  const p = path.join(repo, '.qwen/worktrees', slug);
  g(repo, 'worktree', 'add', '-q', '-b', `worktree-${slug}`, p, 'main');
  fill(p);
  cases.push({ label, p });
}
const mk = (p, rel, body = '//\n') => {
  fs.mkdirSync(path.dirname(path.join(p, rel)), { recursive: true });
  fs.writeFileSync(path.join(p, rel), body);
};
wt('ignored .env only', (p) => mk(p, '.env', 'KEY=x\n'));
wt('root node_modules/ only', (p) => mk(p, 'node_modules/x/i.js'));
wt('node_modules symlink (symlinkDirectories), `node_modules/` rule', (p) => fs.symlinkSync(path.join(repo, 'node_modules'), path.join(p, 'node_modules')));
wt('workspace install: packages/app/node_modules/', (p) => mk(p, 'packages/app/node_modules/x/i.js'));
wt('workspace build: packages/app/dist/', (p) => mk(p, 'packages/app/dist/i.js'));
wt('tsc incremental: packages/app/tsconfig.tsbuildinfo', (p) => mk(p, 'packages/app/tsconfig.tsbuildinfo', '{}'));
wt('husky install: .husky/_/ (self-ignoring)', (p) => { mk(p, '.husky/_/.gitignore', '*\n'); mk(p, '.husky/_/h', '#!/bin/sh\n'); });
cases.push({ label: 'REAL: qwen-code worktree after pnpm install + build', p: '<git>/qwen-code-pr12759' });

const rows = [];
for (const c of cases) {
  const r = { case: c.label };
  for (const [name, fn] of Object.entries(arms)) r[name] = (await fn(c.p)) ? 'preserve' : 'reap';
  rows.push(r);
}
const cols = ['case', ...Object.keys(arms)];
const w = cols.map((c) => Math.max(c.length, ...rows.map((r) => r[c].length)));
const line = (r) => cols.map((c, i) => String(r[c]).padEnd(w[i])).join('  ');
const out = [line(Object.fromEntries(cols.map((c) => [c, c]))), ...rows.map(line)].join('\n');
console.log(out);
fs.writeFileSync(path.join(S, 'predicate-matrix.txt'), out + '\n');
