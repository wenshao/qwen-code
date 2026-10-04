// VERIFICATION RIG ONLY (PR #13163): 288e7feb -> 30f092d0. After a re-registration (generation or storage moves),
// does the WebShell capability assembler (sessions/query page and sessions/get, both through the batch twin) stop
// advertising workspaceTurns for the creator's Sessions, while a Session in an untouched Workspace keeps it?
// usage: DB=<db> node c16-page-caps.mjs <workspace> <storage> <control-workspace> <control-storage> <regen|storage>
import { api, sql, one, register, waitTurn, Report, TENANT, j } from './lib.mjs';
const [WS, ST, CW, CST, MODE] = process.argv.slice(2);
const r = new Report(`c16-page-${MODE}-${WS}`);
for (const [w, s] of [[WS, ST], [CW, CST]]) if (one(`SELECT COUNT(*) FROM managed_workspace_registry WHERE tenant_id='${TENANT}' AND workspace_id='${w}'`) === '0') register(w, `st-${s}`);
const W = `tenant_id='${TENANT}' AND workspace_id='${WS}'`;
sql(`UPDATE managed_workspace_registry SET state='ACTIVE', workspace_generation=1, storage_id='st-${ST}' WHERE ${W}`);
const k = (s) => `${s}-${WS}-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;
const mk = async (actor, ws, label) => {
  const c = await api('POST', '/v1/agents/sessions', { agent_id: 'qwen-code', input: [{ type: 'input_text', text: `G_FILES name=${label}.txt tag=${label}` }], workspace: { workspace_id: ws, cwd_relative: 'child' } }, { actor, key: k(label) });
  await waitTurn(c.json.id, { timeoutMs: 90_000 });
  return c.json.id;
};
const S = { a1: await mk('alice', WS, 'a1'), a2: await mk('alice', WS, 'a2'), c1: await mk('carol', WS, 'c1'), ctl: await mk('alice', CW, 'ctl') };
const read = async (actor) => {
  const page = await api('POST', '/api/agent/web-shell/v1/sessions/query', { limit: 50 }, { actor });
  const rows = Object.fromEntries((page.json.data ?? page.json.items ?? []).map((s) => [s.sessionId, s.capabilities?.workspaceTurns]));
  const out = {};
  for (const [name, id] of Object.entries(S)) {
    const g = await api('POST', '/api/agent/web-shell/v1/sessions/get', { sessionId: id }, { actor });
    out[name] = `list=${rows[id]} get=${g.json.capabilities?.workspaceTurns ?? g.status}`;
  }
  return out;
};
const before = { alice: await read('alice'), carol: await read('carol') };
if (MODE === 'regen') sql(`UPDATE managed_workspace_registry SET workspace_generation=workspace_generation+1 WHERE ${W}`);
else sql(`UPDATE managed_workspace_registry SET storage_id='st-h' WHERE ${W}`);
const after = { alice: await read('alice'), carol: await read('carol') };
const sub = await api('POST', `/v1/agents/sessions/${S.a1}/events`, { type: 'agent.session.input.message', input: [{ type: 'input_text', text: 'G_FILES name=a1.txt tag=a1b' }] }, { actor: 'alice', key: k('sub') });
sql(`UPDATE managed_workspace_registry SET state='ACTIVE', workspace_generation=1, storage_id='st-${ST}' WHERE ${W}`);
const restored = { alice: await read('alice') };
r.note('before (alice)', j(before.alice));
r.note('before (carol)', j(before.carol));
r.note(`after ${MODE} (alice)`, j(after.alice));
r.note(`after ${MODE} (carol)`, j(after.carol));
r.note(`after ${MODE}: alice submit on a1`, `${sub.status} ${sub.json.error?.code ?? sub.json.turn_id}`);
r.note('after restore (alice)', j(restored.alice));
const f = (v) => v.split(' ').map((x) => x.split('=')[1]);
r.check('before: creator sees workspaceTurns=true on her own Sessions (list and get)', ['a1', 'a2', 'ctl'].every((n) => f(before.alice[n]).every((x) => x === 'true')), j(before.alice));
r.check(`after ${MODE}: creator's Sessions in the moved Workspace show workspaceTurns=false (list and get)`, ['a1', 'a2'].every((n) => f(after.alice[n]).every((x) => x === 'false')), j(after.alice));
r.check(`after ${MODE}: control Workspace Session keeps workspaceTurns=true`, f(after.alice.ctl).every((x) => x === 'true'), after.alice.ctl);
r.check(`after ${MODE}: submit refused 409 workspace_unavailable`, sub.status === 409 && sub.json.error?.code === 'workspace_unavailable', `${sub.status} ${sub.json.error?.code}`);
r.check('after restore: capability back to true', ['a1', 'a2', 'ctl'].every((n) => f(restored.alice[n]).every((x) => x === 'true')), j(restored.alice));
r.done({ S, before, after, restored, submit: [sub.status, sub.json.error?.code] });
process.exit(0);
