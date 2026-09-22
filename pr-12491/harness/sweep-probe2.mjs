// Non-vacuous variant: the trusted namespace EXISTS and holds a real lease for
// another target, so the sweep really scans it. The plant is still only in the
// workspace. Does it redirect anything?
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
const [arm, root, qwenHome] = process.argv.slice(2);
process.env['QWEN_HOME'] = qwenHome;
const mod = await import(`${arm}/packages/cli/dist/src/services/review-worktree-lease.js`);
const repo = join(root, 'repo');
const env = { ...process.env, GIT_CONFIG_GLOBAL: join(root, 'gitconfig'), GIT_CONFIG_SYSTEM: '/dev/null' };
const git = (...a) => execFileSync('git', a, { cwd: repo, encoding: 'utf8', env });
const has = (b) => { try { git('rev-parse', '--verify', b); return true; } catch { return false; } };

// A REAL lease this session owns, for target pr-55, with its own worktree.
const own = join(repo, '.qwen', 'tmp', 'review-pr-55');
git('worktree', 'add', '-q', '-b', 'qwen-review/pr-55', own, 'main');
mod.createReviewWorktreeLease({ sessionId: 'sweeper-session', promptId: 'sweeper-prompt',
  target: 'pr-55', repositoryRoot: repo, worktreePath: own, branch: 'qwen-review/pr-55' });

// A victim: another session's live review tree.
const victim = join(repo, '.qwen', 'tmp', 'review-pr-99');
git('worktree', 'add', '-q', '-b', 'qwen-review/pr-99', victim, 'main');
writeFileSync(join(victim, 'ROUND4-EVIDENCE.txt'), "the other session's work\n");

const forged = { sessionId: 'sweeper-session', promptId: 'sweeper-prompt', target: 'pr-77',
  repositoryRoot: repo, worktreePath: victim, branch: 'qwen-review/pr-77', identity: 1234567890123 };
for (const dir of ['review-leases', 'tmp']) {
  mkdirSync(join(repo, '.qwen', dir), { recursive: true });
  writeFileSync(join(repo, '.qwen', dir, 'qwen-review-lease-pr-77.json'), JSON.stringify(forged, null, 2));
}
const trusted = mod.reviewLeasePath(repo, 'pr-55');
const nsDir = trusted.slice(0, trusted.lastIndexOf('/'));
const before = { trustedNamespaceEntries: readdirSync(nsDir), ownTree: existsSync(own), victimTree: existsSync(join(victim, 'ROUND4-EVIDENCE.txt')) };
mod.cleanupReviewWorktreeLeases({ sessionId: 'sweeper-session', promptId: 'sweeper-prompt', repositoryRoot: repo });
const after = { trustedNamespaceEntries: existsSync(nsDir) ? readdirSync(nsDir) : [], ownTree: existsSync(own), ownBranch: has('qwen-review/pr-55'), victimTree: existsSync(join(victim, 'ROUND4-EVIDENCE.txt')), victimBranch: has('qwen-review/pr-99') };
console.log(JSON.stringify({ arm: arm.split('/').pop(), before, after,
  sweepDidRun: before.ownTree && !after.ownTree,
  plantRedirected: before.victimTree && !after.victimTree }, null, 2));
