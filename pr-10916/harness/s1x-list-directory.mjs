// S1x — the first S1 attempt: identical to s1-git-deadend.mjs except round 3 calls
// list_directory, which is disabled by default and returns an ERROR (different
// signature) — this reset the git streak and moved the halt from request 5 to 8.
const WS = process.env.WS;
const plan = [
  { sh: 'git remote -v' },
  { read: 'README.md' },
  { sh: 'git log --oneline -5' },
  { ls: '.' },
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
  if (p.ls) return { toolCalls: [{ id, name: 'list_directory', args: { path: WS } }] };
}
