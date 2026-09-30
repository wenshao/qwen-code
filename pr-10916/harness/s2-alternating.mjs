// S2 — two different dead ends alternating round by round (no successes at
// all): varied git commands fail with exit 128, varied `cat` invocations on
// the missing .git/config fail with ENOENT. Every round carries an error and
// each of the two signatures repeats 8 times (16 error rounds), but never on three CONSECUTIVE
// error-bearing rounds.
const git = ['git remote -v', 'git log -1', 'git status', 'git branch', 'git rev-parse HEAD', 'git tag', 'git stash list', 'git describe'];
const cat = ['cat .git/config', 'cat -n .git/config', 'cat -A .git/config', 'cat -s .git/config', 'cat -b .git/config', 'cat -E .git/config', 'cat -T .git/config', 'cat -v .git/config'];
const plan = git.flatMap((g, i) => [g, cat[i]]);
export function respond({ step }) {
  const c = plan[step];
  if (!c) return { content: 'DONE: no git metadata is reachable here.' };
  return { toolCalls: [{ id: `call_s2_${step}`, name: 'run_shell_command', args: { command: c, description: 'inspect git state' } }] };
}
