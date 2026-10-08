// Scenario helper for the PR 13572 rig.
//   node scn.mjs <db> channels | deliveries [channel] | delivery <id> [channel]
//   node scn.mjs <db> db            ingress rows, bindings, claims, ledger, sessions
//   node scn.mjs <db> resend <deliveryId>   (trusted adapter surface, internal port)
//   node scn.mjs <db> records <sessionId>   committed channel_route/channel_delivery revisions
//   node scn.mjs <db> wait-replies <login> <n> [timeoutSec]
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const RIG = '/Users/wenshao/git/pr13572-rig';
const [, , db, cmd, ...rest] = process.argv;
const st = JSON.parse(readFileSync(`${RIG}/runs/${db}/state.json`, 'utf8'));
const pub = `http://127.0.0.1:${st.springPort}`;
const internal = `http://127.0.0.1:${st.internalPort}`;
const H = { 'x-qwen-tenant-id': 'rig', 'x-rig-actor': rest.includes('--as-other') ? 'other-actor' : 'rig-actor' };
const sql = (q) => execFileSync(`${RIG}/mysql.sh`, ['sql', '-t', '-e', q, db], { encoding: 'utf8' });
async function get(url) {
  const res = await fetch(url, { headers: H });
  const text = await res.text();
  try { return { status: res.status, json: JSON.parse(text) }; } catch { return { status: res.status, json: text }; }
}
if (cmd === 'channels') {
  console.log(JSON.stringify(await get(`${pub}/v1/agent-channels?limit=10`), null, 1));
} else if (cmd === 'deliveries') {
  const ch = rest[0] && !rest[0].startsWith('--') ? rest[0] : 'rigmail';
  console.log(JSON.stringify(await get(`${pub}/v1/agent-channels/${ch}/deliveries?limit=50`), null, 1));
} else if (cmd === 'delivery') {
  console.log(JSON.stringify(await get(`${pub}/v1/agent-channels/${rest[1] ?? 'rigmail'}/deliveries/${encodeURIComponent(rest[0])}`), null, 1));
} else if (cmd === 'db') {
  console.log(sql(`
    select platform_event_id ev, account_generation gen, state, left(session_id,8) sess, left(input_id,14) input, json_length(staged_attachment_refs_json) att from qwen_managed_channel_route order by created_at;
    select left(route_id,14) route, left(session_id,8) sess, chat_id, left(thread_id,10) thread from qwen_managed_channel_binding order by created_at;
    select delivery_id, left(session_id,8) sess, from_unixtime(claimed_at/1000) claimed from qwen_managed_channel_claim order by claimed_at;
    select delivery_id, segment_ordinal ord, state, provider_receipt from qwen_managed_channel_delivery order by created_at;
    select left(session_id,8) sess, status, title from managed_agent_session order by created_at;`));
} else if (cmd === 'resend') {
  const res = await fetch(`${internal}/internal/managed-channels/v1/channels/rigmail/deliveries/${encodeURIComponent(rest[0])}:resend`, {
    method: 'POST', headers: { 'x-qwen-tenant-id': 'rig', 'content-type': 'application/json' }, body: '{}',
  });
  console.log(res.status, await res.text());
} else if (cmd === 'close' || cmd === 'delete') {
  // Public lifecycle verbs on a route Session, as its owning actor.
  const id = rest[0];
  const url = cmd === 'close' ? `${pub}/v1/agents/sessions/${id}/close` : `${pub}/v1/agents/sessions/${id}`;
  const res = await fetch(url, {
    method: cmd === 'close' ? 'POST' : 'DELETE',
    headers: { ...H, 'Idempotency-Key': `rig-${cmd}-${id}-${Date.now()}`, 'content-type': 'application/json' },
    ...(cmd === 'close' ? { body: '{}' } : {}),
  });
  console.log(res.status, (await res.text()).slice(0, 600));
} else if (cmd === 'say') {
  // Operator message through the public API, as the Session's creator.
  const [id, ...words] = rest;
  const res = await fetch(`${pub}/v1/agents/sessions/${id}/events`, {
    method: 'POST',
    headers: { ...H, 'Idempotency-Key': `rig-say-${id}-${Date.now()}`, 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'agent.session.input.message', input: [{ type: 'text', text: words.join(' ') }] }),
  });
  console.log(res.status, (await res.text()).slice(0, 600));
} else if (cmd === 'turns') {
  const r = await get(`${pub}/v1/agents/sessions/${rest[0]}/turns?limit=20`);
  console.log(r.status, JSON.stringify((r.json.data ?? r.json)).slice(0, 2000));
} else if (cmd === 'session') {
  console.log(JSON.stringify(await get(`${pub}/v1/agents/sessions/${rest[0]}`), null, 1).slice(0, 1500));
} else if (cmd === 'wait-replies') {
  const [login, n, to = '120'] = rest;
  const deadline = Date.now() + Number(to) * 1000;
  for (;;) {
    const list = JSON.parse(execFileSync('node', [`${RIG}/mail/mua.mjs`, 'list', login], { encoding: 'utf8' }));
    const replies = list.filter((m) => /^Re:/.test(m.subject ?? ''));
    if (replies.length >= Number(n) || Date.now() > deadline) {
      console.log(JSON.stringify({ replies: replies.length, waitedMs: Number(to) * 1000 - (deadline - Date.now()) }));
      break;
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
} else {
  console.error('bad command');
  process.exit(2);
}
