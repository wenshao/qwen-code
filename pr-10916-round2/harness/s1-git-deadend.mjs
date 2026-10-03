// S1 — the issue #10887 shape: a dead-end model that keeps varying its git
// command (every (tool,args) pair unique) while every git call returns the same
// "not a git repository" exit-128 error, with successful reads interleaved.
const WS = process.env.WS;
const plan = [
  { sh: 'git remote -v' },
  { read: 'README.md' },
  { sh: 'git log --oneline -5' },
  { glob: '*.md' },
  { sh: 'git status --short' },
  { sh: 'git branch -a' },
  { read: 'README.md' },
  { sh: 'git rev-parse HEAD' },
  { sh: 'git diff --stat HEAD~1' },
  { sh: 'git config --get remote.origin.url' },
  { sh: 'git show --stat HEAD' },
  { sh: 'git tag --list' },
];
export function respond({ step }) {
  const p = plan[step];
  if (!p) return { content: 'DONE: I could not read the git history of this directory.' };
  const id = `call_s1_${step}`;
  if (p.sh) return { content: `Trying \`${p.sh}\`.`, toolCalls: [{ id, name: 'run_shell_command', args: { command: p.sh, description: 'inspect git state' } }] };
  if (p.read) return { toolCalls: [{ id, name: 'read_file', args: { file_path: `${WS}/${p.read}` } }] };
  if (p.glob) return { toolCalls: [{ id, name: 'glob', args: { pattern: p.glob, path: WS } }] };
}
