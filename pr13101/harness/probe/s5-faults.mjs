// VERIFICATION RIG ONLY: delivery faults between the Java server and the Hosted Harness (tap rules).
// Needs `default` mode and a long approval timeout. usage: DB=<db> node s5-faults.mjs <workspace> <storage>
import { api, one, sql, ensureWorkspace, createSession, listActions, getAction, respond, waitPending, waitOp, waitTurn, opRow, actionRow, sessionRow, readWs, executions, finalText, setTapRules, tapEntries, Report, sleep, j } from './lib.mjs';

const [workspace = 'ws-d', storage = 'd'] = process.argv.slice(2);
const R = new Report('s5-faults');
const idOf = (a) => a.actionId ?? a.id;
const opId = (o) => o.operationId ?? o.id;
ensureWorkspace(workspace, `st-${storage}`);
const tag = Date.now().toString(36);
const resolvesFor = (A) => tapEntries().filter((e) => e.method === 'POST' && e.path.includes(`/actions/${A}/resolve`));
const RESOLVE = 'POST .*/actions/.*/resolve';

async function pending(marker) {
  const c = await createSession('public', workspace, marker);
  const p = await waitPending(c.session);
  return { S: c.session, action: p.action, A: idOf(p.action) };
}

// ---------- a. lost reply
{
  R.say('## a. the Harness records the decision, its answer is lost (drop-after x1)');
  const f = `lost-${tag}.txt`;
  const { S, action, A } = await pending(`D6_WRITE name=${f} content=lost-reply`);
  const before = sessionRow(S);
  setTapRules([{ match: RESOLVE, action: 'drop-after', times: 1 }]);
  const r = await respond('public', S, action, 'allow', { key: 'lost-1' });
  const d = await waitOp(S, opId(r.json), { timeoutMs: 40_000 });
  const calls = resolvesFor(A);
  R.check('operation completes decided from the committed journal decision', d.json.status === 'completed' && d.json.action_resolution?.outcome === 'decided' && d.json.action_resolution?.decision_receipt_id === actionRow(A)[1], `${d.ms} ms ${j(d.json)}`);
  R.check('the Harness was asked once and answered 200; no second delivery was needed', calls.length === 1 && calls[0].fault === 'drop-after' && calls[0].status === 200, j(calls.map((c) => ({ fault: c.fault, status: c.status, body: c.upstreamBody }))));
  R.check('no retry was scheduled (attempt_count 0)', opRow(opId(r.json))[3] === '0', `row=${j(opRow(opId(r.json)))}`);
  const t = await waitTurn(S);
  R.check('Turn completes, write ran once', t.status === 'COMPLETED' && readWs(storage, `child/${f}`) === 'lost-reply' && executions(S) === 1, `turn=${t.status} executions=${executions(S)}`);
  R.check('Session lifecycle status unchanged', sessionRow(S)[0] === before[0], `${before[0]} -> ${sessionRow(S)[0]}`);
}

// ---------- b. Harness unreachable for the first attempts
{
  R.say('## b. delivery fails 4 times before reaching the Harness (drop-before x4)');
  const f = `outage-${tag}.txt`;
  const { S, action, A } = await pending(`D6_WRITE name=${f} content=after-outage`);
  const before = sessionRow(S);
  setTapRules([{ match: RESOLVE, action: 'drop-before', times: 4 }]);
  const t0 = Date.now();
  const r = await respond('public', S, action, 'allow', { key: 'outage-1' });
  const samples = [];
  for (let i = 0; i < 8; i++) {
    await sleep(1000);
    const o = await api('GET', `/v1/agents/sessions/${S}/operations/${opId(r.json)}`);
    samples.push(`${Math.round((Date.now() - t0) / 1000)}s:${o.json.status}/${o.json.delivery_state}`);
    if (o.json.status === 'completed') break;
  }
  R.note('operation while the Harness is unreachable', samples.join('  '));
  const mid = { session: sessionRow(S), action: actionRow(A)[0], turn: one(`SELECT status FROM managed_agent_turn WHERE session_id='${S}'`) };
  const d = await waitOp(S, opId(r.json), { timeoutMs: 90_000 });
  const calls = resolvesFor(A);
  R.check('operation stays pending/running through the failures, then completes decided', d.json.status === 'completed' && d.json.action_resolution?.outcome === 'decided', `${Date.now() - t0} ms ${j(d.json)}`);
  R.check('4 dropped attempts + 1 delivered', calls.filter((c) => c.fault === 'drop-before').length === 4 && calls.filter((c) => c.status === 200).length === 1, j(calls.map((c) => c.fault ?? c.status)));
  const gaps = calls.map((c, i) => (i ? Math.round((Date.parse(c.t) - Date.parse(calls[i - 1].t)) / 100) / 10 : 0)).slice(1);
  R.note('gaps between attempts (s): dispatch backoff 1,2,4,8 + 1 s scan', j(gaps));
  R.check('retries did not touch the Session lifecycle status or the Turn', sessionRow(S)[0] === before[0] && mid.session[0] === before[0] && mid.turn === 'RUNNING', `before=${before[0]} during=${mid.session[0]}/${mid.turn}/${mid.action} after=${sessionRow(S)[0]}`);
  R.check('attempt_count records the 4 failures', opRow(opId(r.json))[3] === '4', `row=${j(opRow(opId(r.json)))}`);
  const t = await waitTurn(S);
  R.check('Turn completes, write ran once', t.status === 'COMPLETED' && readWs(storage, `child/${f}`) === 'after-outage' && executions(S) === 1, `turn=${t.status} executions=${executions(S)}`);
}

// ---------- c. Harness answers 503 action_resolution_failed twice
{
  R.say('## c. the Harness answers 503 twice (respond 503 x2)');
  const f = `e503-${tag}.txt`;
  const { S, action, A } = await pending(`D6_WRITE name=${f} content=after-503`);
  setTapRules([{ match: RESOLVE, action: 'respond', status: 503, body: { error: 'action_resolution_failed' }, times: 2 }]);
  const r = await respond('web', S, (await getAction('web', S, A)).json, 'allow', { key: 'e503-1' });
  const d = await waitOp(S, opId(r.json), { timeoutMs: 60_000 });
  R.check('503 is retried; operation completes decided', d.json.status === 'completed' && opRow(opId(r.json))[3] === '2', `${d.ms} ms attempts=${opRow(opId(r.json))[3]} ${j(d.json)}`);
  const t = await waitTurn(S);
  R.check('Turn completes', t.status === 'COMPLETED' && readWs(storage, `child/${f}`) === 'after-503', `turn=${t.status}`);
}

// ---------- d. Harness answers 400 -> the operation fails, the Action can still be answered
{
  R.say('## d. the Harness answers 400 invalid_action_response (respond 400 x1)');
  const f = `e400-${tag}.txt`;
  const { S, action, A } = await pending(`D6_WRITE name=${f} content=after-400`);
  setTapRules([{ match: RESOLVE, action: 'respond', status: 400, body: { error: 'invalid_action_response' }, times: 1 }]);
  const r = await respond('public', S, action, 'allow', { key: 'e400-1' });
  const d = await waitOp(S, opId(r.json), { timeoutMs: 30_000 });
  R.check('400 ends the operation failed with invalid_action_response, no retry', d.json.status === 'failed' && d.json.failure_code === 'invalid_action_response' && resolvesFor(A).length === 1, `${d.ms} ms ${j(d.json)}`);
  R.check('the Action is still requested and listed', actionRow(A)[0] === 'requested' && (await listActions('public', S)).json.data.length === 1, `state=${actionRow(A)[0]}`);
  const r2 = await respond('public', S, action, 'allow', { key: 'e400-2' });
  const d2 = await waitOp(S, opId(r2.json), { timeoutMs: 30_000 });
  const t = await waitTurn(S);
  R.check('a new key answers it and the Turn completes', d2.json.status === 'completed' && t.status === 'COMPLETED' && readWs(storage, `child/${f}`) === 'after-400', `op=${d2.json.status} turn=${t.status}`);
}
setTapRules([]);
R.done();
