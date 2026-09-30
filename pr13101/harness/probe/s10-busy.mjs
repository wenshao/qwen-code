// VERIFICATION RIG ONLY: what another Session on the same Workspace sees while a Turn waits for an approval
// (design 5.2/8: the Workspace stays held while a Turn waits). Needs `default` mode.
// usage: DB=<db> node s10-busy.mjs <workspace> <storage>
import { api, one, ensureWorkspace, createSession, respond, waitPending, waitOp, waitTurn, readWs, executions, Report, sleep, j } from './lib.mjs';
const [workspace = 'ws-a', storage = 'a'] = process.argv.slice(2);
const R = new Report('s10-busy');
ensureWorkspace(workspace, `st-${storage}`);
const tag = Date.now().toString(36);
const first = await createSession('public', workspace, `D6_WRITE name=first-${tag}.txt content=first`);
const p = await waitPending(first.session);
R.check('Session 1 waits for its approval', !p.timeout, `action=${p.action?.id}`);
const t0 = Date.now();
const second = await createSession('public', workspace, `D6_WRITE name=second-${tag}.txt content=second`, { actor: 'carol' });
const st = await waitTurn(second.session, { timeoutMs: 30_000 });
R.note('Session 2 (another creator, same Workspace) while Session 1 waits', `create HTTP ${second.status}; Turn ${st.status}${st.error ? '/' + st.error : ''} after ${Date.now() - t0} ms; actions=${one(`SELECT COUNT(*) FROM managed_agent_action WHERE session_id='${second.session}'`)}`);
R.check('Session 2 fails closed (no write) instead of queueing', st.status === 'FAILED' && readWs(storage, `child/second-${tag}.txt`) === null && executions(second.session) === 0, `turn=${st.status}/${st.error}`);
const r = await respond('public', first.session, p.action, 'allow', { key: `busy-${tag}` });
const d = await waitOp(first.session, (r.json.id));
const ft = await waitTurn(first.session);
R.check('Session 1 is unaffected: answer delivered, Turn completes', d.json.status === 'completed' && ft.status === 'COMPLETED' && readWs(storage, `child/first-${tag}.txt`) === 'first', `op=${d.json.status} turn=${ft.status}`);
const third = await createSession('public', workspace, `D6_WRITE name=third-${tag}.txt content=third`, { actor: 'carol' });
const p3 = await waitPending(third.session, { actor: 'carol' });
const r3 = await respond('public', third.session, p3.action, 'allow', { key: `busy3-${tag}`, actor: 'carol' });
const d3 = await waitOp(third.session, r3.json.id);
const t3 = await waitTurn(third.session);
R.check('once Session 1 ends, the Workspace serves a new Session (created and answered by carol)', d3.json.status === 'completed' && t3.status === 'COMPLETED' && readWs(storage, `child/third-${tag}.txt`) === 'third', `op=${d3.json.status} turn=${t3.status}`);
const alice = await respond('public', third.session, p3.action, 'allow', { key: `busy3-alice-${tag}`, actor: 'alice' });
R.check("alice (creator of other Sessions) cannot answer carol's Session", alice.status === 403 && alice.json.error?.code === 'action_forbidden', `HTTP ${alice.status} ${j(alice.json.error)}`);
R.done();
