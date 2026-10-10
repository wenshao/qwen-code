// Public-API client + DB evidence dumper for the PR 13550 rig.
// usage: node client.mjs <db> create <prompt>          -> prints session id
//        node client.mjs <db> wait <sessionId> [timeoutSec]
//        node client.mjs <db> send <sessionId> <prompt>
//        node client.mjs <db> cancel <sessionId> <turnId>
//        node client.mjs <db> taskcancel <sessionId> <taskId> | op <sessionId> <opId> | fgtask <sessionId>
//        node client.mjs <db> close <sessionId>
//        node client.mjs <db> get <sessionId> | tasks <sessionId> | events <sessionId>
//        node client.mjs <db> dump <parentSessionId>   (DB evidence: parent + children)
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const RIG = '/Users/wenshao/git/pr13769-rig';
const [, , db, cmd, ...rest] = process.argv;
const st = JSON.parse(readFileSync(`${RIG}/runs/${db}/state.json`, 'utf8'));
const base = `http://127.0.0.1:${st.springPort}/v1/agents/sessions`;
const H = { 'x-qwen-tenant-id': 'rig', 'x-rig-actor': 'rig-actor', 'content-type': 'application/json' };
const sql = (q) => execFileSync(`${RIG}/mysql.sh`, ['sql', '-N', '-B', '-e', q, db], { encoding: 'utf8' }).trim();
async function call(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: { ...H, ...(method === 'POST' || method === 'DELETE' ? { 'idempotency-key': randomUUID() } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, json };
}
const t0 = Date.now();
const ts = () => ((Date.now() - t0) / 1000).toFixed(1) + 's';

if (cmd === 'create') {
  const r = await call('POST', base, {
    agent_id: 'qwen-code',
    workspace: { workspace_id: 'rig-ws' },
    input: [{ type: 'input_text', text: rest.join(' ') }],
  });
  console.log(JSON.stringify(r));
} else if (cmd === 'send') {
  const [sid, ...p] = rest;
  console.log(JSON.stringify(await call('POST', `${base}/${sid}/events`, {
    type: 'agent.session.input.message', input: [{ type: 'input_text', text: p.join(' ') }],
  })));
} else if (cmd === 'cancel') {
  console.log(JSON.stringify(await call('POST', `${base}/${rest[0]}/events`, { type: 'agent.session.cancel', turn_id: rest[1] })));
} else if (cmd === 'taskcancel') {
  console.log(JSON.stringify(await call('POST', `${base}/${rest[0]}/tasks/${rest[1]}/cancel`)));
} else if (cmd === 'op') {
  console.log(JSON.stringify(await call('GET', `${base}/${rest[0]}/operations/${rest[1]}`)));
} else if (cmd === 'fgtask') {
  // the first child_agent task that is still running: prints its id
  const r = await call('GET', `${base}/${rest[0]}/tasks`);
  const t = (r.json.data ?? []).find((x) => JSON.stringify(x).includes('child_agent') && !['completed','failed','cancelled'].includes(x.status));
  console.log(t ? t.id : `NONE ${r.status} ${JSON.stringify(r.json).slice(0, 300)}`);
} else if (cmd === 'close') {
  console.log(JSON.stringify(await call('POST', `${base}/${rest[0]}/close`)));
} else if (cmd === 'delete') {
  console.log(JSON.stringify(await call('DELETE', `${base}/${rest[0]}`)));
} else if (cmd === 'get') {
  console.log(JSON.stringify(await call('GET', `${base}/${rest[0]}`)));
} else if (cmd === 'tasks') {
  console.log(JSON.stringify(await call('GET', `${base}/${rest[0]}/tasks`), null, 1));
} else if (cmd === 'events') {
  const r = await call('GET', `${base}/${rest[0]}/events?after=0&limit=500`);
  for (const e of r.json.data ?? []) console.log(e.sequence, e.type, e.terminal ? 'TERMINAL' : '', JSON.stringify(e.data ?? {}).slice(0, 300));
} else if (cmd === 'wait') {
  const [sid, to = '180'] = rest;
  let after = 0;
  const deadline = Date.now() + Number(to) * 1000;
  for (;;) {
    const r = await call('GET', `${base}/${sid}/events?after=${after}&limit=200`);
    for (const e of r.json.data ?? []) {
      after = Math.max(after, e.sequence);
      console.log(ts(), e.sequence, e.type, e.terminal ? 'TERMINAL' : '', JSON.stringify(e.data ?? {}).slice(0, 200));
      if (e.terminal) process.exit(0);
    }
    if (Date.now() > deadline) { console.log(ts(), 'TIMEOUT'); process.exit(3); }
    await new Promise((r) => setTimeout(r, 500));
  }
} else if (cmd === 'dump') {
  const p = rest[0];
  const q = (label, s) => { console.log(`--- ${label}`); console.log(sql(s)); };
  q('sessions (parent + children)', `SELECT session_id, status, tool_profile, IFNULL(parent_session_id,'-'), IFNULL(root_session_id,'-'), IFNULL(parent_child_run_id,'-'), IFNULL(child_depth,'-') FROM managed_agent_session WHERE session_id='${p}' OR parent_session_id='${p}' ORDER BY created_at`);
  q('turns', `SELECT t.session_id, t.turn_id, t.status, IFNULL(t.error_code,'-'), FROM_UNIXTIME(t.created_at/1000,'%H:%i:%s.%f'), IFNULL(FROM_UNIXTIME(t.completed_at/1000,'%H:%i:%s.%f'),'-') FROM managed_agent_turn t JOIN managed_agent_session s ON s.tenant_id=t.tenant_id AND s.session_id=t.session_id WHERE s.session_id='${p}' OR s.parent_session_id='${p}' ORDER BY t.created_at`);
  q('extension records (latest per key)', `SELECT session_id, domain, record_id, revision, IFNULL(task_kind,'-'), IFNULL(task_state,'-'), IFNULL(runtime_state,'-'), IFNULL(delivery_state,'-'), IFNULL(FROM_UNIXTIME(settled_at/1000,'%H:%i:%s.%f'),'-') FROM qwen_managed_session_extension_record WHERE session_id='${p}' ORDER BY domain, record_id`);
  q('relay ledger', `SELECT child_run_id, state, IFNULL(child_session_id,'-'), attempts, IFNULL(last_error,'-'), FROM_UNIXTIME(updated_at/1000,'%H:%i:%s.%f') FROM qwen_managed_child_result_relay WHERE parent_session_id='${p}'`);
} else {
  console.error('bad cmd');
  process.exit(2);
}
