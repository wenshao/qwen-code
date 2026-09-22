// Real built cleanupReviewWorktreeLeases vs a lease planted inside the
// workspace. The plant names target pr-77 but points worktreePath at ANOTHER
// session's live review tree (.qwen/tmp/review-pr-99) — the #9205 shape.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const [arm, root, qwenHome] = process.argv.slice(2);
process.env['QWEN_HOME'] = qwenHome;
const mod = await import(`${arm}/packages/cli/dist/src/services/review-worktree-lease.js`);

const repo = join(root, 'repo');
const victim = join(repo, '.qwen', 'tmp', 'review-pr-99');
const env = { ...process.env, GIT_CONFIG_GLOBAL: join(root, 'gitconfig'), GIT_CONFIG_SYSTEM: '/dev/null' };
const git = (...a) => execFileSync('git', a, { cwd: repo, encoding: 'utf8', env });
const branchExists = (b) => { try { git('rev-parse', '--verify', b); return true; } catch { return false; } };

// A victim session's live review worktree + branch.
git('worktree', 'add', '-q', '-b', 'qwen-review/pr-99', victim, 'main');
writeFileSync(join(victim, 'ROUND4-EVIDENCE.txt'), 'the other session\'s work\n');

const forged = {
  sessionId: 'sweeper-session', promptId: 'sweeper-prompt', target: 'pr-77',
  repositoryRoot: repo, worktreePath: victim, branch: 'qwen-review/pr-77',
  identity: 1234567890123,
};
for (const dir of ['review-leases', 'tmp']) {
  mkdirSync(join(repo, '.qwen', dir), { recursive: true });
  writeFileSync(join(repo, '.qwen', dir, 'qwen-review-lease-pr-77.json'), JSON.stringify(forged, null, 2));
}
const before = { victimTree: existsSync(join(victim, 'ROUND4-EVIDENCE.txt')), victimBranch: branchExists('qwen-review/pr-99') };
mod.cleanupReviewWorktreeLeases({ sessionId: 'sweeper-session', promptId: 'sweeper-prompt', repositoryRoot: repo });
const after = { victimTree: existsSync(join(victim, 'ROUND4-EVIDENCE.txt')), victimBranch: branchExists('qwen-review/pr-99') };
console.log(JSON.stringify({ arm: arm.split('/').pop(), before, after,
  verdict: before.victimTree && !after.victimTree
    ? 'PLANT HONORED — the other session\'s review worktree was destroyed'
    : 'plant ignored — the other session\'s worktree survived' }));
