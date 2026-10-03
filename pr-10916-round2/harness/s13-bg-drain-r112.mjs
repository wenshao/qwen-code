// S13 — R11-2 end to end (the immediate-drain prompt boundary), on a real
// background agent. The fake server sequences both sides deterministically:
//   bg b0: git log      -> exit 128 "not a git repository"   (streak 1)
//   bg b1: git status   -> same error                         (streak 2)
//   bg b2: text-only reply, HELD until the leader's send_message has queued a
//          follow-up, so the follow-up is drained at the immediate-drain branch
//          (a new prompt for the same reasoning loop)
//   bg b3: (follow-up)  git tag --list -> same error          (streak 3 without the boundary clear)
//   bg b4: final text
// Leader: launch bg agent -> (held until bg reaches b2) send_message -> sleep -> done.
const flat = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.map((p) => p?.text ?? '').join('') : '');
let bgAtB2 = null;      // resolves when bg b2 arrives
let msgQueued = null;   // resolves when leader's send_message result is seen
const deferred = () => { let r; const p = new Promise((res) => (r = res)); p.resolve = r; return p; };
bgAtB2 = deferred(); msgQueued = deferred();
const withTimeout = (p, ms) => Promise.race([p, new Promise((r) => setTimeout(r, ms))]);
export function classify({ body }) {
  const users = JSON.stringify((body.messages ?? []).filter((m) => m.role === 'user'));
  if (users.includes('BG-TASK-MARKER') && !users.includes('LEADER-PROMPT-MARKER')) return 'bg';
  return null;
}
export async function respond({ step, kind, msgs }) {
  const last = msgs[msgs.length - 1];
  const lastText = flat(last?.content ?? '');
  if (kind === 'bg') {
    if (last?.role === 'user' && lastText.includes('BG-FOLLOWUP')) {
      return { toolCalls: [{ id: 'call_b3', name: 'run_shell_command', args: { command: 'git tag --list', description: 'git tags' } }] };
    }
    if (step === 0) return { toolCalls: [{ id: 'call_b0', name: 'run_shell_command', args: { command: 'git log --oneline -3', description: 'git history' } }] };
    if (step === 1) return { toolCalls: [{ id: 'call_b1', name: 'run_shell_command', args: { command: 'git status --short', description: 'git state' } }] };
    if (step === 2) {
      bgAtB2.resolve();
      await withTimeout(msgQueued, 30000);
      await new Promise((r) => setTimeout(r, 300));
      return { content: 'BG-PARTIAL: this directory is not a git repository.' };
    }
    return { content: 'BG-DONE: no repository, no tags.' };
  }
  // leader
  if (step === 0) return { toolCalls: [{ id: 'call_l0', name: 'agent', args: { description: 'bg git check', subagent_type: 'general-purpose', run_in_background: true,
    prompt: 'BG-TASK-MARKER: inspect this project\'s git state and report.' } }] };
  if (step === 1) {
    const launch = JSON.stringify(msgs);
    const m = launch.match(/task_id: ([^\s(\\"]+)/);
    await withTimeout(bgAtB2, 30000);
    return { toolCalls: [{ id: 'call_l1', name: 'send_message', args: { task_id: m ? m[1] : 'unknown', message: 'BG-FOLLOWUP: also list the tags.' } }] };
  }
  if (step === 2) {
    msgQueued.resolve();
    return { toolCalls: [{ id: 'call_l2', name: 'run_shell_command', args: { command: "python3 -c 'import time; time.sleep(8)'", description: 'wait for the background agent' } }] };
  }
  return { content: 'LEADER-DONE.' };
}
