// P2b: the REACHABLE trigger for cancelForPrompt.
// A background continuation raises a tool approval; the user ignores the
// dialog and just types the next message. Session.ts aborts the background
// notification turn so user input is not blocked behind it, the child emits
// `_qwencode/end_turn` for that turnId, and the bridge-side approval is
// orphaned (the child has stopped waiting on the RPC).
import * as O from './obs.mjs';

const label = `${O.ARM}-perm2`;
const out = { arm: O.ARM, label, steps: [], perms: [], health: [] };
const step = (m, x) => {
  out.steps.push({ t: O.rel(), m, ...(x || {}) });
  console.log(`[${label} +${O.rel()}s] ${m}`, x ? JSON.stringify(x).slice(0, 240) : '');
};
const deep = async () => {
  const j = await (await fetch(`${O.BASE}/health?deep=1`, { headers: { Authorization: `Bearer ${O.TOKEN}` } })).json();
  return { pendingPermissions: j.pendingPermissions, activePrompts: j.activePrompts, activeWork: j.activeWork };
};

await O.mockRun(label);
const s = await O.createSession({ approvalMode: 'default' });
const sid = s.sessionId;
out.sid = sid;
step('session', { sid });

const ac = new AbortController();
const bgPerms = [];
const resolutions = [];
(async () => {
  const res = await fetch(`${O.BASE}/session/${sid}/events`, {
    headers: { Authorization: `Bearer ${O.TOKEN}`, accept: 'text/event-stream', 'x-qwen-client-id': s.clientId },
    signal: ac.signal,
  });
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const frame = buf.slice(0, i); buf = buf.slice(i + 2);
      const data = frame.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trimStart()).join('\n');
      if (!data) continue;
      let ev; try { ev = JSON.parse(data); } catch { continue; }
      if (ev.type === 'permission_request') {
        const rec = { t: O.rel(), requestId: ev.data?.requestId, promptId: ev.promptId, backgroundTurn: ev.data?.backgroundTurn?.turnId, tool: ev.data?.toolCall?.title };
        out.perms.push(rec);
        if (rec.backgroundTurn) { bgPerms.push(rec); step('background approval raised -> LEFT UNANSWERED', rec); }
        else {
          step('foreground approval -> auto-allow', rec);
          const opts = ev.data?.options ?? [];
          const allow = opts.find((o) => o.kind === 'allow_once') ?? opts.find((o) => /allow/.test(o.kind ?? '')) ?? opts[0];
          await O.api(`/session/${sid}/permission/${rec.requestId}`, { method: 'POST', clientId: s.clientId, body: { outcome: { outcome: 'selected', optionId: allow?.optionId } } });
        }
      } else if (ev.type === 'permission_resolved') {
        resolutions.push({ t: O.rel(), requestId: ev.data?.requestId, outcome: JSON.stringify(ev.data?.outcome ?? {}) });
        step('permission_resolved', resolutions.at(-1));
      }
    }
  }
})().catch(() => {});

await O.prompt(sid, s.clientId, '[[S:perm]] run the permission probe');
const t0 = Date.now();
while (Date.now() - t0 < 60000 && bgPerms.length === 0) await O.sleep(250);
if (!bgPerms.length) step('TIMEOUT: no background approval');
await O.sleep(1500);
out.health.push({ at: 'before-user-prompt', ...(await deep()) });
step('health before the user types', out.health.at(-1));
out.statusBefore = (await O.api(`/session/${sid}/status`)).json;
step('status', { hasActivePrompt: out.statusBefore?.hasActivePrompt, bg: out.statusBefore?.backgroundTurn?.turnId?.slice(-12) });

// The user ignores the dialog and just sends the next message.
const tP = Date.now();
const p = await O.prompt(sid, s.clientId, '[[S:after]] never mind, answer this instead');
out.userPrompt = { status: p.status, ms: Date.now() - tP };
step('user prompt POSTed', out.userPrompt);

let released = null;
const t1 = Date.now();
while (Date.now() - t1 < 40000) {
  const h = await deep();
  if (h.pendingPermissions === 0) { released = Date.now() - t1; break; }
  await O.sleep(250);
}
out.releasedAfterMs = released;
out.health.push({ at: 'after-user-prompt', ...(await deep()) });
step('health after the user typed', { ...out.health.at(-1), releasedAfterMs: released });

await O.sleep(8000);
out.health.push({ at: 'settled', ...(await deep()) });
out.statusAfter = (await O.api(`/session/${sid}/status`)).json;
step('settled', { ...out.health.at(-1), hasActivePrompt: out.statusAfter?.hasActivePrompt });
out.mock = (await O.mockLog()).map((r) => ({ seq: r.seq, kind: r.kind, scenario: r.scenario, step: r.step, notifs: r.notifs, reply: r.reply }));
out.resolutions = resolutions;
ac.abort();
O.save(`/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/badda020-42a9-49a9-a576-6a2155aeabb3/scratchpad/h/out/runs/${label}.json`, out);
console.log('\n=== VERDICT ===');
console.log(JSON.stringify({
  arm: O.ARM,
  backgroundApprovals: bgPerms.length,
  pendingBeforeUserPrompt: out.health[0]?.pendingPermissions,
  pendingAfterUserPrompt: out.health.at(-1)?.pendingPermissions,
  releasedAfterMs: out.releasedAfterMs,
  resolutions: resolutions.length,
}, null, 1));
process.exit(0);
