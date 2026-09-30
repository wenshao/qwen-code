// S5b — the S1 dead end where the third git call is written as
// `sleep 6; git status --short`: the shell tool refuses that shape with its
// own "Blocked: sleep N followed by …" advisory — a DIFFERENT error, which
// resets the git streak under the strict-consecutive rule.
const WS = process.env.WS;
const plan = [
  { sh: 'git remote -v' },
  { read: 'README.md' },
  { sh: 'git log --oneline -5' },
  { glob: '*.md' },
  { sh: 'sleep 6; git status --short' },
  { sh: 'git branch -a' },
  { sh: 'git rev-parse HEAD' },
];
export function respond({ step }) {
  const p = plan[step];
  if (!p) return { content: 'DONE: I could not read the git history of this directory.' };
  const id = `call_s5b_${step}`;
  if (p.sh) return { toolCalls: [{ id, name: 'run_shell_command', args: { command: p.sh, description: 'inspect git state' } }] };
  if (p.read) return { toolCalls: [{ id, name: 'read_file', args: { file_path: `${WS}/${p.read}` } }] };
  if (p.glob) return { toolCalls: [{ id, name: 'glob', args: { pattern: p.glob, path: WS } }] };
}
