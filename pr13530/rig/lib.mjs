// Public-API client + DB/model-log helpers for the PR 13530 rig.
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, appendFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

export const RIG = '/Users/wenshao/git/pr13530-rig';
export const state = (db) => JSON.parse(readFileSync(`${RIG}/runs/${db}/state.json`, 'utf8'));
export const sql = (db, q) =>
  execFileSync(`${RIG}/mysql.sh`, ['sql', '-N', '-B', '-e', q, db], { encoding: 'utf8' }).trim();
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function client(db, actor = 'rig-actor') {
  const st = state(db);
  const base = `http://127.0.0.1:${st.springPort}`;
  async function api(method, path, body, key) {
    const headers = { 'x-qwen-tenant-id': 'rig', 'x-rig-actor': actor, 'content-type': 'application/json' };
    if (method !== 'GET') headers['idempotency-key'] = key ?? randomUUID();
    const res = await fetch(base + path, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch { json = text; }
    return { status: res.status, json };
  }
  return {
    st, api,
    createAgent: (def, key) => api('POST', '/v1/agents', def, key),
    updateAgent: (id, def, key) => api('POST', `/v1/agents/${id}`, def, key),
    getAgent: (id) => api('GET', `/v1/agents/${id}`),
    createSession: ({ agentId, revision, prompt, bound = true, key }) =>
      api('POST', '/v1/agents/sessions', {
        agent_id: agentId,
        ...(revision !== undefined ? { agent_revision: revision } : {}),
        ...(bound ? { workspace: { workspace_id: 'rig-ws' } } : {}),
        ...(prompt ? { input: [{ type: 'input_text', text: prompt }] } : {}),
      }, key),
    send: (sid, prompt) => api('POST', `/v1/agents/sessions/${sid}/events`, {
      type: 'agent.session.input.message', input: [{ type: 'input_text', text: prompt }],
    }),
    get: (sid) => api('GET', `/v1/agents/sessions/${sid}`),
    events: (sid, after = 0) => api('GET', `/v1/agents/sessions/${sid}/events?after=${after}&limit=500`),
    actions: (sid) => api('GET', `/v1/agents/sessions/${sid}/actions`),
    respond: (sid, a, option = 'allow') => api('POST', `/v1/agents/sessions/${sid}/actions/${a.id}/responses`, {
      kind: 'permission', option_id: option, input_revision: a.input_revision, policy_revision: a.policy_revision,
    }),
    // Wait until the newest Turn of the Session is terminal, or a pending Action appears.
    async waitTurn(sid, { timeout = 120, stopOnAction = false } = {}) {
      const deadline = Date.now() + timeout * 1000;
      for (;;) {
        const t = sql(db, `SELECT CONCAT(turn_id,' ',status,' ',IFNULL(error_code,'-')) FROM managed_agent_turn WHERE tenant_id='rig' AND session_id='${sid}' ORDER BY created_at DESC LIMIT 1`);
        if (/ (COMPLETED|FAILED|CANCELLED) /.test(t + ' ')) return t;
        if (stopOnAction) {
          const a = await api('GET', `/v1/agents/sessions/${sid}/actions`);
          const pending = (a.json?.data ?? []).filter((x) => x.state === 'requested');
          if (pending.length) return `ACTION ${pending[0].id} ${pending[0].state} ${pending[0].tool_name}`;
        }
        if (Date.now() > deadline) return `TIMEOUT ${t}`;
        await sleep(700);
      }
    },
  };
}

export function modelLog(filter = () => true) {
  const f = `${RIG}/runs/model-requests.jsonl`;
  if (!existsSync(f)) return [];
  return readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter(filter);
}
export function hproxyLog(db, filter = () => true) {
  const f = `${RIG}/runs/${db}/hproxy.jsonl`;
  if (!existsSync(f)) return [];
  return readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter(filter);
}
// RESULT lines go to stdout and runs/results.tsv so the report reads from disk.
export function result(scenario, check, pass, detail = '') {
  const line = `${pass ? 'PASS' : 'FAIL'}\t${scenario}\t${check}\t${String(detail).replace(/\s+/g, ' ').slice(0, 400)}`;
  console.log('RESULT ' + line);
  appendFileSync(`${RIG}/runs/results.tsv`, `${new Date().toISOString()}\t${line}\n`);
}
export const short = (o) => JSON.stringify(o).slice(0, 300);
