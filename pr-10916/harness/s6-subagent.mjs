// S6 — the agent-runtime half of the wiring (agent-core.ts): the parent
// delegates to a general-purpose subagent, and the SUBAGENT walks the S1 dead
// end. Requests are told apart by the subagent's system prompt.
const WS = process.env.WS;
export function classify({ sys }) {
  return sys.includes('general-purpose subagent') ? 'sub' : null;
}
const subPlan = [
  { sh: 'git remote -v' }, { read: 'README.md' }, { sh: 'git log --oneline -5' }, { glob: '*.md' },
  { sh: 'git status --short' }, { sh: 'git branch -a' }, { sh: 'git rev-parse HEAD' },
  { sh: 'git diff --stat' }, { sh: 'git show --stat HEAD' }, { sh: 'git tag --list' },
];
export function respond({ step, kind }) {
  if (kind === 'sub') {
    const p = subPlan[step];
    if (!p) return { content: 'SUB DONE: this directory has no git metadata.' };
    const id = `call_sub_${step}`;
    if (p.sh) return { toolCalls: [{ id, name: 'run_shell_command', args: { command: p.sh, description: 'inspect git state' } }] };
    if (p.read) return { toolCalls: [{ id, name: 'read_file', args: { file_path: `${WS}/${p.read}` } }] };
    if (p.glob) return { toolCalls: [{ id, name: 'glob', args: { pattern: p.glob, path: WS } }] };
  }
  if (step === 0) return { toolCalls: [{ id: 'call_parent_0', name: 'agent', args: { subagent_type: 'general-purpose', description: 'Inspect git state', prompt: 'Find the git remote and the last commits of the project in the current directory. Report what you found.' } }] };
  return { content: 'PARENT DONE: the subagent reported back.' };
}
