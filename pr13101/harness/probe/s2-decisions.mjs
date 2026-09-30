// VERIFICATION RIG ONLY: decisions the PR did not exercise with a real process (deny, mixed batch),
// races between answers, and request validation. Needs the stack in `default` approval mode.
// usage: DB=<db> node s2-decisions.mjs <workspace> <storage>
import { api, one, sql, ensureWorkspace, createSession, listActions, getAction, respond, waitPending, waitOp, waitTurn, opRow, actionRow, sessionRow, readWs, executions, finalText, Report, sleep, j } from './lib.mjs';

const [workspace = 'ws-b', storage = 'b'] = process.argv.slice(2);
const R = new Report('s2-decisions');
const idOf = (a) => a.actionId ?? a.id;
const opId = (o) => o.operationId ?? o.id;
ensureWorkspace(workspace, `st-${storage}`);
const tag = Date.now().toString(36);

// ---------- a. deny
{
  R.say('## a. deny (public API)');
  const f = `deny-${tag}.txt`;
  const c = await createSession('public', workspace, `D6_WRITE name=${f} content=should-not-exist`);
  const S = c.session;
  const p = await waitPending(S);
  const r = await respond('public', S, p.action, 'deny', { key: 'deny-1' });
  const d = await waitOp(S, opId(r.json));
  R.check('deny -> operation completed with outcome decided', r.status === 202 && d.json.status === 'completed' && d.json.action_resolution?.outcome === 'decided', `${d.ms} ms ${j(d.json)}`);
  const t = await waitTurn(S);
  R.check('Turn completes after the refusal', t.status === 'COMPLETED', `${t.status} after ${t.ms} ms`);
  R.check('denied write never ran: file absent, 0 tool executions', readWs(storage, `child/${f}`) === null && executions(S) === 0, `file=${readWs(storage, `child/${f}`)} executions=${executions(S)}`);
  const text = await finalText(S);
  R.check('model received a refusal result and continued', (text ?? '').includes('denied this tool call'), text?.slice(0, 260));
  const g = await getAction('public', S, idOf(p.action));
  R.check('Action reads decided with a receipt; pending list empty', g.json.state === 'decided' && !!g.json.decision_receipt_id && (await listActions('public', S)).json.data.length === 0, `state=${g.json.state}`);
  const flip = await respond('public', S, p.action, 'allow', { key: 'flip-1' });
  R.check('allow after a deny -> 409 action_already_resolved, file still absent', flip.status === 409 && flip.json.error?.code === 'action_already_resolved' && readWs(storage, `child/${f}`) === null, `HTTP ${flip.status} ${j(flip.json.error)}`);
}

// ---------- b. one assistant message with two calls: allow the first, deny the second (WebShell)
{
  R.say('## b. mixed batch, answered through WebShell');
  const [f1, f2] = [`b1-${tag}.txt`, `b2-${tag}.txt`];
  const c = await createSession('web', workspace, `D6_BATCH names=${f1},${f2}`);
  const S = c.session;
  const p1 = await waitPending(S, { surface: 'web' });
  R.check('calls are asked one at a time', p1.page.data.length === 1, `pending=${p1.page.data.length} tool=${p1.action.toolName} call=${p1.action.functionCallId}`);
  const r1 = await respond('web', S, p1.action, 'allow', { key: 'b-allow' });
  const d1 = await waitOp(S, opId(r1.json));
  const p2 = await waitPending(S, { surface: 'web', not: [idOf(p1.action)] });
  R.check('second call asked after the first is decided; nothing dispatched yet', !p2.timeout && p2.page.data.length === 1 && readWs(storage, `child/${f1}`) === null && executions(S) === 0, `call=${p2.action?.functionCallId} file1=${readWs(storage, `child/${f1}`)} executions=${executions(S)}`);
  const r2 = await respond('web', S, p2.action, 'deny', { key: 'b-deny' });
  const d2 = await waitOp(S, opId(r2.json));
  const t = await waitTurn(S);
  R.check('both operations decided, Turn completes', d1.json.status === 'completed' && d2.json.status === 'completed' && t.status === 'COMPLETED', `op1=${d1.json.status} op2=${d2.json.status} turn=${t.status}`);
  R.check('only the allowed call ran', readWs(storage, `child/${f1}`) === `batch-${f1}` && readWs(storage, `child/${f2}`) === null && executions(S) === 1, `f1=${j(readWs(storage, `child/${f1}`))} f2=${readWs(storage, `child/${f2}`)} executions=${executions(S)}`);
  R.note('final model text', (await finalText(S))?.slice(0, 300));
}

// ---------- c. allow and deny race under different keys
for (let round = 0; round < 3; round++) {
  R.say(`## c${round}. allow vs deny race (different keys)`);
  const f = `race-${tag}-${round}.txt`;
  const c = await createSession('public', workspace, `D6_WRITE name=${f} content=race`);
  const S = c.session;
  const p = await waitPending(S);
  const w = (await getAction('web', S, idOf(p.action))).json;
  const [ra, rd] = await Promise.all([respond('public', S, p.action, 'allow', { key: `race-allow-${round}` }), respond('web', S, w, 'deny', { key: `race-deny-${round}` })]);
  const outs = [];
  for (const [name, r] of [['allow', ra], ['deny', rd]]) {
    if (r.status === 202) {
      const d = await waitOp(S, opId(r.json));
      outs.push({ name, http: 202, status: d.json.status, outcome: d.json.action_resolution?.outcome, failure: d.json.failure_code });
    } else outs.push({ name, http: r.status, code: r.json.error?.code });
  }
  const t = await waitTurn(S);
  const winners = outs.filter((o) => o.status === 'completed' && o.outcome === 'decided');
  const losers = outs.filter((o) => o.failure === 'action_already_resolved' || o.code === 'action_already_resolved');
  R.check('exactly one decision wins; the other reports action_already_resolved', winners.length === 1 && losers.length === 1, j(outs));
  const ran = readWs(storage, `child/${f}`) !== null;
  R.check('the effect matches the winner', t.status === 'COMPLETED' && ran === (winners[0]?.name === 'allow') && executions(S) === (ran ? 1 : 0), `winner=${winners[0]?.name} fileExists=${ran} executions=${executions(S)}`);
}

// ---------- d. same decision, two keys, at once; e. 20 identical requests
{
  R.say('## d/e. same decision under two keys at once; 20 identical requests');
  const f = `same-${tag}.txt`;
  const c = await createSession('public', workspace, `D6_WRITE name=${f} content=same`);
  const S = c.session;
  const p = await waitPending(S);
  const burst = await Promise.all(Array.from({ length: 20 }, () => respond('public', S, p.action, 'allow', { key: 'burst' })));
  const ids = new Set(burst.map((r) => opId(r.json)));
  R.check('20 concurrent identical requests -> one operation', burst.every((r) => r.status === 202) && ids.size === 1 && burst.filter((r) => r.json.replayed === false).length === 1, `statuses=${j([...new Set(burst.map((r) => r.status))])} operations=${ids.size} firsts=${burst.filter((r) => r.json.replayed === false).length}`);
  const second = await respond('public', S, p.action, 'allow', { key: 'other-key' });
  const outs = [];
  for (const r of [burst[0], second]) {
    if (r.status === 202) {
      const d = await waitOp(S, opId(r.json));
      outs.push({ http: 202, status: d.json.status, receipt: d.json.action_resolution?.decision_receipt_id, failure: d.json.failure_code });
    } else outs.push({ http: r.status, code: r.json.error?.code });
  }
  R.check('same decision under a second key: 202+decided with the same decision receipt, or 409 once it has ended', outs[0].status === 'completed' && (outs[1].receipt === outs[0].receipt || outs[1].code === 'action_already_resolved'), j(outs));
  const t = await waitTurn(S);
  R.check('write ran exactly once', t.status === 'COMPLETED' && readWs(storage, `child/${f}`) === 'same' && executions(S) === 1, `turn=${t.status} executions=${executions(S)}`);
}

// ---------- f. request validation against a live pending Action
{
  R.say('## f. request validation (Action stays requested throughout)');
  const f = `valid-${tag}.txt`;
  const c = await createSession('public', workspace, `D6_WRITE name=${f} content=valid`);
  const S = c.session;
  const p = await waitPending(S);
  const A = idOf(p.action);
  const w = (await getAction('web', S, A)).json;
  const base = `/v1/agents/sessions/${S}/actions/${A}/responses`;
  const good = { kind: 'permission', option_id: 'allow', input_revision: 1, policy_revision: 'hosted-tool-approval/1' };
  const cases = [
    ['stale input_revision 2', { ...good, input_revision: 2 }, 400, 'invalid_action_response'],
    ['input_revision as string "1"', { ...good, input_revision: '1' }, 400, 'invalid_action_response'],
    ['input_revision 1.5', { ...good, input_revision: 1.5 }, 400, 'invalid_action_response'],
    ['other policy_revision', { ...good, policy_revision: 'hosted-tool-approval/2' }, 400, 'invalid_action_response'],
    ['unknown option', { ...good, option_id: 'always' }, 400, 'invalid_action_response'],
    ['question kind', { ...good, kind: 'question' }, 400, 'invalid_action_response'],
    ['unknown extra field', { ...good, note: 'x' }, 400, null],
    ['missing option_id', { kind: 'permission', input_revision: 1, policy_revision: 'hosted-tool-approval/1' }, 400, null],
    ['camelCase on the public route', { kind: 'permission', optionId: 'allow', inputRevision: 1, policyRevision: 'hosted-tool-approval/1' }, 400, null],
  ];
  let n = 0;
  for (const [label, body, status, code] of cases) {
    const r = await api('POST', base, body, { key: `v-${n++}` });
    R.check(`public: ${label} -> ${status}${code ? ' ' + code : ''}`, r.status === status && (!code || r.json.error?.code === code), `HTTP ${r.status} ${j(r.json.error ?? r.json)}`);
  }
  const noKey = await api('POST', base, good);
  R.check('public: missing Idempotency-Key -> 400', noKey.status === 400, `HTTP ${noKey.status} ${j(noKey.json.error ?? noKey.json)}`);
  const longKey = await api('POST', base, good, { key: 'k'.repeat(300) });
  R.check('public: oversized Idempotency-Key -> 400', longKey.status === 400, `HTTP ${longKey.status} ${j(longKey.json.error ?? longKey.json)}`);
  const unknown = await api('POST', `/v1/agents/sessions/${S}/actions/tool_approval_${'0'.repeat(32)}/responses`, good, { key: 'v-unknown' });
  R.check('public: unknown Action id -> 404 action_not_found', unknown.status === 404 && unknown.json.error?.code === 'action_not_found', `HTTP ${unknown.status} ${j(unknown.json.error)}`);
  const malformed = await api('GET', `/v1/agents/sessions/${S}/actions/not-an-action`);
  R.check('public: malformed Action id -> 404 action_not_found', malformed.status === 404 && malformed.json.error?.code === 'action_not_found', `HTTP ${malformed.status} ${j(malformed.json.error)}`);
  const wbase = '/api/agent/web-shell/v1/actions/respond';
  const wgood = { sessionId: S, actionId: A, idempotencyKey: 'w-0', requestId: 'rig', response: { kind: 'permission', optionId: 'allow', inputRevision: 1, policyRevision: 'hosted-tool-approval/1' } };
  const wcases = [
    ['stale inputRevision', { ...wgood, idempotencyKey: 'w-1', response: { ...wgood.response, inputRevision: 7 } }, 400, 'invalid_action_response'],
    ['snake_case response fields', { ...wgood, idempotencyKey: 'w-2', response: { kind: 'permission', option_id: 'allow', input_revision: 1, policy_revision: 'hosted-tool-approval/1' } }, 400, null],
    ['unknown top-level field', { ...wgood, idempotencyKey: 'w-3', extra: true }, 400, null],
    ['missing idempotencyKey', { sessionId: S, actionId: A, response: wgood.response }, 400, null],
    ['missing response', { sessionId: S, actionId: A, idempotencyKey: 'w-5' }, 400, null],
  ];
  for (const [label, body, status, code] of wcases) {
    const r = await api('POST', wbase, body);
    R.check(`WebShell: ${label} -> ${status}${code ? ' ' + code : ''}`, r.status === status && (!code || r.json.error?.code === code), `HTTP ${r.status} ${j(r.json.error ?? r.json)}`);
  }
  for (const [label, q, status] of [['limit=0', '?limit=0', 400], ['limit=101', '?limit=101', 400], ['garbage cursor', '?cursor=%21%21', 400], ['well-formed foreign cursor', `?cursor=${Buffer.from('1:tool_approval_' + 'f'.repeat(32)).toString('base64url')}`, 200]]) {
    const r = await api('GET', `/v1/agents/sessions/${S}/actions${q}`);
    R.check(`public list: ${label} -> ${status}`, r.status === status, `HTTP ${r.status} ${j(r.json.error ?? r.json).slice(0, 160)}`);
  }
  R.check('after every rejected request: no operation, Action still requested, nothing ran', one(`SELECT COUNT(*) FROM managed_agent_operation WHERE session_id='${S}'`) === '0' && actionRow(A)[0] === 'requested' && executions(S) === 0, `operations=${one(`SELECT COUNT(*) FROM managed_agent_operation WHERE session_id='${S}'`)} state=${actionRow(A)[0]}`);
  const ok = await api('POST', wbase, wgood);
  const d = await waitOp(S, opId(ok.json));
  const t = await waitTurn(S);
  R.check('a valid answer afterwards still completes the Turn', ok.status === 202 && d.json.status === 'completed' && t.status === 'COMPLETED' && readWs(storage, `child/${f}`) === 'valid', `HTTP ${ok.status} op=${d.json.status} turn=${t.status}`);
  R.check('WebShell respond echoes the client requestId', ok.headers['x-request-id'] === 'rig' || ok.headers['x-qwen-request-id'] === 'rig', j(Object.fromEntries(Object.entries(ok.headers).filter(([k]) => /request/i.test(k)))));
}
R.done();
