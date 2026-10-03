// S11 — R7-1 end to end, on an in-process teammate (AgentInteractive).
// Leader (headless, agent team on): team_create -> spawn teammate "worker" -> wait ->
// send_message to worker -> wait -> answer.
// Worker: two failing git calls, then ONE round with a parallel batch of
// write_file(notes.txt) [succeeds] + a third identical git failure [trips the guard].
// Then the leader's follow-up reaches the worker on the SAME chat.
// Oracle: in the worker's follow-up request, what tool responses are paired with the
// halting round's two calls, versus what really happened on disk.
const WS = process.env.WS;
const flat = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.map((p) => p?.text ?? '').join('') : '');
const firstUser = (msgs) => flat(msgs.find((m) => m.role === 'user')?.content ?? '');
export function classify({ body }) {
  const msgs = body.messages ?? [];
  const users = JSON.stringify(msgs.filter((m) => m.role === 'user'));
  if (users.includes('WORKER-TASK-MARKER') && !users.includes('LEADER-PROMPT-MARKER')) return 'worker';
  return null;
}
const sleepCmd = (s) => `python3 -c 'import time; time.sleep(${s})'`;
const leader = [
  { name: 'team_create', args: { team_name: 'verify', description: 'R7-1 check' } },
  { name: 'agent', args: { description: 'git notes worker', subagent_type: 'general-purpose', name: 'worker',
      prompt: 'WORKER-TASK-MARKER: find this project\'s recent git history and save notes to notes.txt.' } },
  { name: 'run_shell_command', args: { command: sleepCmd(12), description: 'wait for the worker' } },
  { name: 'send_message', args: { to: 'worker', message: 'FOLLOWUP-TO-WORKER: did notes.txt get saved, and what did your last git call return?' } },
  { name: 'run_shell_command', args: { command: sleepCmd(10), description: 'wait for the worker reply' } },
];
export function respond({ step, kind, msgs }) {
  if (kind === 'worker') {
    const last = msgs[msgs.length - 1];
    if (last?.role === 'user' && flat(last.content).includes('FOLLOWUP-TO-WORKER')) {
      return { content: 'WORKER-ACK: answering the follow-up.' };
    }
    const id = (k) => `call_w${step}_${k}`;
    if (step === 0) return { toolCalls: [{ id: id('a'), name: 'run_shell_command', args: { command: 'git log --oneline -3', description: 'git history' } }] };
    if (step === 1) return { toolCalls: [{ id: id('a'), name: 'run_shell_command', args: { command: 'git status --short', description: 'git state' } }] };
    if (step === 2) return { toolCalls: [
      { id: id('write'), name: 'write_file', args: { file_path: `${WS}/notes.txt`, content: 'NOTES-WRITTEN-BY-WORKER: no git history found yet.\n' } },
      { id: id('git'), name: 'run_shell_command', args: { command: 'git branch -a', description: 'git branches' } },
    ] };
    return { content: 'WORKER-DONE: no git repository here; notes saved.' };
  }
  const p = leader[step];
  if (!p) return { content: 'LEADER-DONE.' };
  return { toolCalls: [{ id: `call_l${step}`, name: p.name, args: p.args }] };
}
