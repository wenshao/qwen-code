// Public-API client + DB evidence dumper for the PR 13598 rig.
// usage: node client.mjs <db> session <prompt>             -> create a Workspace Session (first Turn)
//        node client.mjs <db> wait <sid> [timeoutSec]
//        node client.mjs <db> send <sid> <prompt>
//        node client.mjs <db> events <sid> | messages <sid> | turns <sid>
//        node client.mjs <db> acreate <json> [key] [actor]   -> POST /v1/agent-automations
//        node client.mjs <db> aupdate <id> <json> [key] [actor]
//        node client.mjs <db> aretire <id> [key] [actor]
//        node client.mjs <db> arun <id> [key] [actor]
//        node client.mjs <db> aget <id> [actor] | alist [actor] | aruns <id> [actor]
//        node client.mjs <db> raw <METHOD> <path> [json] [key] [actor]
//        node client.mjs <db> dump <sid>
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const RIG = '/rig';
const [, , db, cmd, ...rest] = process.argv;
const st = JSON.parse(readFileSync(`${RIG}/runs/${db}/state.json`, 'utf8'));
const root = `http://127.0.0.1:${st.springPort}`;
const base = `${root}/v1/agents/sessions`;
const sql = (q) => execFileSync('mysql', ['-h127.0.0.1', '-P3306', '-uroot', '-N', '-B', '-e', q, db], { encoding: 'utf8' }).trim();
async function call(method, url, body, key, actor = 'rig-actor') {
  const t0 = Date.now();
  const res = await fetch(url, {
    method,
    headers: {
      'x-qwen-tenant-id': 'rig',
      'x-rig-actor': actor,
      'content-type': 'application/json',
      ...(method === 'POST' || method === 'DELETE' ? { 'idempotency-key': key ?? randomUUID() } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  const replay = res.headers.get('x-qwen-idempotent-replay');
  return { status: res.status, ms: Date.now() - t0, ...(replay !== null ? { replay } : {}), json };
}
const out = (r) => console.log(JSON.stringify(r, null, 1));
const t0 = Date.now();
const ts = () => ((Date.now() - t0) / 1000).toFixed(1) + 's';
const AUTO = `${root}/v1/agent-automations`;
const opt = (v) => (v === undefined || v === '-' ? undefined : v);

switch (cmd) {
  case 'session':
    out(await call('POST', base, { agent_id: 'qwen-code', workspace: { workspace_id: 'rig-ws' }, input: [{ type: 'input_text', text: rest.join(' ') }] }));
    break;
  case 'send': {
    const [sid, ...p] = rest;
    out(await call('POST', `${base}/${sid}/events`, { type: 'agent.session.input.message', input: [{ type: 'input_text', text: p.join(' ') }] }));
    break;
  }
  case 'events': {
    const r = await call('GET', `${base}/${rest[0]}/events?after=0&limit=500`);
    for (const e of r.json.data ?? []) console.log(e.sequence, e.type, e.turn_id ?? '', e.terminal ? 'TERMINAL' : '', JSON.stringify(e.data ?? {}).slice(0, 240));
    break;
  }
  case 'messages':
    out(await call('GET', `${base}/${rest[0]}/messages?limit=100`));
    break;
  case 'turns':
    out(await call('GET', `${base}/${rest[0]}/turns?limit=100`));
    break;
  case 'wait': {
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
  }
  case 'acreate':
    out(await call('POST', AUTO, JSON.parse(rest[0]), opt(rest[1]), opt(rest[2])));
    break;
  case 'aupdate':
    out(await call('POST', `${AUTO}/${rest[0]}`, JSON.parse(rest[1]), opt(rest[2]), opt(rest[3])));
    break;
  case 'aretire':
    out(await call('DELETE', `${AUTO}/${rest[0]}`, undefined, opt(rest[1]), opt(rest[2])));
    break;
  case 'arun':
    out(await call('POST', `${AUTO}/${rest[0]}/runs`, undefined, opt(rest[1]), opt(rest[2])));
    break;
  case 'aget':
    out(await call('GET', `${AUTO}/${rest[0]}`, undefined, undefined, opt(rest[1])));
    break;
  case 'alist':
    out(await call('GET', `${AUTO}?limit=100`, undefined, undefined, opt(rest[0])));
    break;
  case 'aruns':
    out(await call('GET', `${AUTO}/${rest[0]}/runs?limit=100`, undefined, undefined, opt(rest[1])));
    break;
  case 'raw':
    out(await call(rest[0], `${root}${rest[1]}`, rest[2] && rest[2] !== '-' ? JSON.parse(rest[2]) : undefined, opt(rest[3]), opt(rest[4])));
    break;
  case 'dump': {
    const p = rest[0];
    const q = (label, s) => { console.log(`--- ${label}`); console.log(sql(s)); };
    q('turns', `SELECT turn_id, status, IFNULL(error_code,'-'), FROM_UNIXTIME(created_at/1000,'%H:%i:%s'), IFNULL(FROM_UNIXTIME(completed_at/1000,'%H:%i:%s'),'-') FROM managed_agent_turn WHERE session_id='${p}' ORDER BY created_at`);
    q('extension records', `SELECT domain, record_id, revision, IFNULL(task_kind,'-'), IFNULL(task_state,'-'), IFNULL(runtime_state,'-'), IFNULL(FROM_UNIXTIME(settled_at/1000,'%H:%i:%s'),'-') FROM qwen_managed_session_extension_record WHERE session_id='${p}' ORDER BY domain, record_id`);
    q('automation schedule ledger', `SELECT schedule_id, record_revision, definition_revision, cron, overlap, catch_up, IFNULL(catch_up_limit,'-'), enabled, state, IFNULL(blocked_reason,'-'), FROM_UNIXTIME(armed_at/1000,'%H:%i:%s'), IFNULL(FROM_UNIXTIME(watermark_slot/1000,'%H:%i:%s'),'-'), IFNULL(lease_owner,'-'), fence FROM qwen_managed_automation_schedule WHERE session_id='${p}'`);
    q('automation occurrences', `SELECT schedule_id, occurrence_key, run_id, trigger_kind, outcome, IFNULL(reason,'-'), definition_revision, attempts, IFNULL(last_error,'-'), FROM_UNIXTIME(created_at/1000,'%H:%i:%s'), FROM_UNIXTIME(updated_at/1000,'%H:%i:%s') FROM qwen_managed_automation_occurrence WHERE session_id='${p}' ORDER BY created_at, occurrence_key`);
    break;
  }
  default:
    console.error('bad cmd');
    process.exit(2);
}
