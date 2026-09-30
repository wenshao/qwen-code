// S5 — S1's dead end, but the third failing git call is slow (sleep 6) so the
// user can type a mid-turn steer message while it runs. The steer is drained
// into the SAME tool-result submission whose error batch trips the guard.
const WS = process.env.WS;
const plan = [
  { sh: 'git remote -v' },
  { read: 'README.md' },
  { sh: 'git log --oneline -5' },
  { glob: '*.md' },
  { sh: "python3 -c 'import time; time.sleep(7)'; git status --short" },
  { sh: 'git branch -a' },
  { sh: 'git rev-parse HEAD' },
];
const flat = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.map((p) => p?.text ?? '').join('') : '');
export function respond({ step, msgs }) {
  const last = msgs[msgs.length - 1];
  if (last?.role === 'user' && flat(last.content).includes('FOLLOWUP-QUESTION')) {
    return { content: 'ACK-FOLLOWUP: answered.' };
  }
  if (last?.role === 'user' && flat(last.content).includes('STEER-MARKER')) {
    return { content: 'ACK: switching to a README summary as you asked.' };
  }
  const p = plan[step];
  if (!p) return { content: 'DONE: I could not read the git history of this directory.' };
  const id = `call_s5_${step}`;
  if (p.sh) return { content: `Trying \`${p.sh}\`.`, toolCalls: [{ id, name: 'run_shell_command', args: { command: p.sh, description: 'inspect git state' } }] };
  if (p.read) return { toolCalls: [{ id, name: 'read_file', args: { file_path: `${WS}/${p.read}` } }] };
  if (p.glob) return { toolCalls: [{ id, name: 'glob', args: { pattern: p.glob, path: WS } }] };
}
