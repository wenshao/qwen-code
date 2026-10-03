// S12 — R7-1 through a reachable entrance: a foreground subagent whose run the
// always-on guard halts, followed by a user SubagentStop hook that blocks once
// ("confirm notes.txt was saved"). runSubagentStopHookLoop does not look at the
// terminate mode, so the SAME chat is sent again.
// Subagent: two failing git calls, then ONE round with a parallel batch of
// write_file(notes.txt) [succeeds] + a third identical git failure [trips the guard].
// Oracle: the tool responses paired with that round's two calls in the
// continuation request, versus notes.txt on disk.
const WS = process.env.WS;
const flat = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.map((p) => p?.text ?? '').join('') : '');
export function classify({ body }) {
  const users = JSON.stringify((body.messages ?? []).filter((m) => m.role === 'user'));
  if (users.includes('SUBAGENT-TASK-MARKER') && !users.includes('LEADER-PROMPT-MARKER')) return 'sub';
  return null;
}
export function respond({ step, kind, msgs }) {
  if (kind === 'sub') {
    const last = msgs[msgs.length - 1];
    if (last?.role === 'user' && flat(last.content).includes('STOPHOOK-CONTINUE')) {
      return { content: 'SUB-CONTINUATION: replying to the stop hook.' };
    }
    const id = (k) => `call_s${step}_${k}`;
    if (step === 0) return { toolCalls: [{ id: id('a'), name: 'run_shell_command', args: { command: 'git log --oneline -3', description: 'git history' } }] };
    if (step === 1) return { toolCalls: [{ id: id('a'), name: 'run_shell_command', args: { command: 'git status --short', description: 'git state' } }] };
    if (step === 2) return { toolCalls: [
      { id: id('write'), name: 'write_file', args: { file_path: `${WS}/notes.txt`, content: 'NOTES-WRITTEN-BY-SUBAGENT: no git history found yet.\n' } },
      { id: id('git'), name: 'run_shell_command', args: { command: 'git branch -a', description: 'git branches' } },
    ] };
    return { content: 'SUBAGENT-DONE: no git repository here; notes saved.' };
  }
  if (step === 0) return { toolCalls: [{ id: 'call_l0', name: 'agent', args: { description: 'git notes', subagent_type: 'general-purpose', run_in_background: false,
    prompt: 'SUBAGENT-TASK-MARKER: find this project\'s recent git history and save notes to notes.txt.' } }] };
  return { content: 'LEADER-DONE.' };
}
