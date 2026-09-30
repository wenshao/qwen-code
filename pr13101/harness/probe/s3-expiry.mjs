// VERIFICATION RIG ONLY: expiry with a real process. Needs `default` mode and QWEN_MANAGED_AGENT_APPROVAL_TIMEOUT=8s.
// usage: DB=<db> node s3-expiry.mjs <workspace> <storage>
import { api, one, ensureWorkspace, createSession, listActions, getAction, respond, waitPending, waitOp, waitTurn, opRow, actionRow, sessionRow, readWs, executions, finalText, setTapRules, tapEntries, Report, sleep, j } from './lib.mjs';

const [workspace = 'ws-c', storage = 'c'] = process.argv.slice(2);
const R = new Report('s3-expiry');
const idOf = (a) => a.actionId ?? a.id;
const opId = (o) => o.operationId ?? o.id;
ensureWorkspace(workspace, `st-${storage}`);
const tag = Date.now().toString(36);
setTapRules([]);

// ---------- a. nobody answers
{
  R.say('## a. nobody answers');
  const f = `exp-${tag}.txt`;
  const t0 = Date.now();
  const c = await createSession('public', workspace, `D6_WRITE name=${f} content=never`);
  const S = c.session;
  const p = await waitPending(S);
  const A = idOf(p.action);
  const window = p.action.expires_at - p.action.created_at;
  R.check('Action carries the deployment timeout (8 s)', window === 8000, `expires_at - created_at = ${window} ms`);
  const t = await waitTurn(S, { timeoutMs: 60_000 });
  const waited = Date.now() - t0;
  R.check('Turn ends by itself about one timeout later', t.status === 'COMPLETED' && waited > 7000 && waited < 25000, `${t.status} ${waited} ms after creation`);
  const g = await getAction('public', S, A);
  const gw = await getAction('web', S, A);
  R.check('Action reads expired on both surfaces, without a decision receipt', g.json.state === 'expired' && g.json.decision_receipt_id === undefined && gw.json.state === 'expired', `public=${j(g.json).slice(0, 200)}`);
  R.check('expired Action left the pending list; call never ran', (await listActions('public', S)).json.data.length === 0 && readWs(storage, `child/${f}`) === null && executions(S) === 0, `executions=${executions(S)}`);
  const late = await respond('public', S, p.action, 'allow', { key: 'late' });
  const latew = await respond('web', S, gw.json, 'allow', { key: 'late-w' });
  R.check('answer after expiry -> 409 action_expired (both surfaces)', late.status === 409 && late.json.error?.code === 'action_expired' && latew.status === 409 && latew.json.error?.code === 'action_expired', `public HTTP ${late.status} ${j(late.json.error)} / web HTTP ${latew.status} ${j(latew.json.error)}`);
  R.note('final model text', (await finalText(S))?.slice(0, 260));
  const ev = await api('GET', `/v1/agents/sessions/${S}/events?limit=100`);
  R.check('events: action.updated requested then expired', j((ev.json.data ?? []).filter((e) => e.type === 'action.updated').map((e) => (e.data ?? e.payload)?.state)) === '["requested","expired"]', j((ev.json.data ?? []).filter((e) => e.type === 'action.updated')));
}

// ---------- b. after one expiry the Turn asks no more
{
  R.say('## b. three sequential writes, nobody answers');
  const f = `seq-${tag}`;
  const t0 = Date.now();
  const c = await createSession('public', workspace, `D6_SEQ n=3 name=${f}`);
  const S = c.session;
  const t = await waitTurn(S, { timeoutMs: 90_000 });
  const n = one(`SELECT COUNT(*) FROM managed_agent_action WHERE session_id='${S}'`);
  R.check('only the first call is asked about; the Turn ends after one timeout, not three', t.status === 'COMPLETED' && n === '1' && Date.now() - t0 < 25000, `${t.status} after ${Date.now() - t0} ms, actions=${n}, executions=${executions(S)}`);
  R.note('final model text', (await finalText(S))?.slice(0, 400));
}

// ---------- c. answer admitted in time, delivered after the expiry
{
  R.say('## c. admitted before expiry, delivery delayed past it (tap delays the resolve call 10 s)');
  const f = `slow-${tag}.txt`;
  const c = await createSession('public', workspace, `D6_WRITE name=${f} content=slow`);
  const S = c.session;
  const p = await waitPending(S);
  setTapRules([{ match: 'POST .*/actions/.*/resolve', action: 'delay', delayMs: 10000, times: 1 }]);
  const r = await respond('public', S, p.action, 'allow', { key: 'slow-1' });
  R.check('admitted while the Action was still open', r.status === 202 && r.json.status !== 'failed', `HTTP ${r.status} ${j(r.json)}`);
  const d = await waitOp(S, opId(r.json), { timeoutMs: 60_000 });
  R.check('operation ends failed with failure_code action_expired (not decided)', d.json.status === 'failed' && d.json.failure_code === 'action_expired' && d.json.action_resolution == null, `${d.ms} ms ${j(d.json)}`);
  const dw = await api('POST', '/api/agent/web-shell/v1/operations/query', { sessionId: S, operationId: opId(r.json) });
  R.check('WebShell operation shows failureCode action_expired', dw.json.status === 'failed' && dw.json.failureCode === 'action_expired', j(dw.json));
  const t = await waitTurn(S, { timeoutMs: 60_000 });
  R.check('the call did not run although the owner said allow', t.status === 'COMPLETED' && readWs(storage, `child/${f}`) === null && executions(S) === 0 && actionRow(idOf(p.action))[0] === 'expired', `turn=${t.status} file=${readWs(storage, `child/${f}`)} action=${actionRow(idOf(p.action))[0]}`);
  const resolves = tapEntries().filter((e) => e.path.includes(idOf(p.action)));
  R.note('Harness answers to the delayed resolve', j(resolves.map((e) => ({ status: e.status, body: e.upstreamBody }))));
  const again = await respond('public', S, p.action, 'allow', { key: 'slow-1' });
  R.check('replaying the key returns the failed operation', again.status === 202 && opId(again.json) === opId(r.json) && again.json.status === 'failed' && again.json.failure_code === 'action_expired', `HTTP ${again.status} ${j(again.json)}`);
  setTapRules([]);
}
R.done();
