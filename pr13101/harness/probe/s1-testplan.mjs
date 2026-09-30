// VERIFICATION RIG ONLY: the PR's Reviewer Test Plan, once per creating surface.
// usage: DB=<db> node s1-testplan.mjs <public|web> <workspace> <storage>
// Needs the stack in `default` approval mode.
import { api, sql, one, ensureWorkspace, createSession, listActions, getAction, respond, getOp, waitPending, waitOp, waitTurn, opRow, actionRow, sessionRow, readWs, executions, finalText, modelCalls, Report, sleep, j, TENANT } from './lib.mjs';

const [surface = 'public', workspace = 'ws-a', storage = 'a'] = process.argv.slice(2);
const other = surface === 'public' ? 'web' : 'public';
const R = new Report(`s1-testplan-${surface}`);
const idOf = (a) => a.actionId ?? a.id;
const opId = (o) => o.operationId ?? o.id;

ensureWorkspace(workspace, `st-${storage}`);
const file = `proof-${surface}-${Date.now().toString(36)}.txt`;
const before = modelCalls();
const created = await createSession(surface, workspace, `D6_FILES name=${file}`);
R.check(`create Workspace Session through ${surface}`, created.status === 202, `HTTP ${created.status} session=${created.session}`);
const S = created.session;

// --- first approval: write_file
const p1 = await waitPending(S, { surface });
R.check('a pending Action appears', !p1.timeout, `after ${p1.ms} ms: ${j(p1.action)}`);
const a1 = p1.action;
const A1 = idOf(a1);
const pub = await api('GET', `/v1/agents/sessions/${S}`);
const web = await api('POST', '/api/agent/web-shell/v1/sessions/get', { sessionId: S });
R.check('Session reports Actions support (public capabilities.actions)', pub.json.capabilities?.actions === true, j(pub.json.capabilities));
R.check('Session reports Actions support (WebShell capabilities.actions)', web.json.capabilities?.actions === true, j(web.json.capabilities));
R.check('approval mode pinned on the Session row', sessionRow(S)[1] === 'default', `approval_mode=${sessionRow(S)[1]}`);

const lp = await listActions('public', S);
const lw = await listActions('web', S);
R.check('pending Action listed on both surfaces with the same id', lp.json.data?.length === 1 && lw.json.data?.length === 1 && lp.json.data[0].id === lw.json.data[0].actionId, `public=${lp.json.data?.[0]?.id} web=${lw.json.data?.[0]?.actionId}`);
const gp = await getAction('public', S, A1);
const gw = await getAction('web', S, A1);
R.check('public detail: requested permission for write_file, allow/deny', gp.status === 200 && gp.json.state === 'requested' && gp.json.kind === 'permission' && gp.json.tool_name === 'write_file' && gp.json.source?.kind === 'tool_call' && j(gp.json.options?.map((o) => o.id)) === '["allow","deny"]', j(gp.json));
R.check('WebShell detail matches (camelCase)', gw.status === 200 && gw.json.state === 'requested' && gw.json.toolName === 'write_file' && gw.json.inputRevision === gp.json.input_revision && gw.json.policyRevision === gp.json.policy_revision && gw.json.expiresAt === gp.json.expires_at, j(gw.json));
const turn = one(`SELECT turn_id FROM managed_agent_turn WHERE session_id='${S}'`);
R.check('Action names the public Turn', gp.json.turn_id === turn && gw.json.turnId === turn, `turn_id=${gp.json.turn_id} db=${turn}`);
R.check('public detail shows no tool arguments', !j(gp.json).includes('before') && !j(gp.json).includes(file), 'no file name/content in the Action view');
R.check('nothing ran while waiting: file absent, 0 tool executions, Turn running', readWs(storage, `child/${file}`) === null && executions(S) === 0 && pub.json.active_turn?.status === 'running', `file=${readWs(storage, `child/${file}`)} executions=${executions(S)} turn=${pub.json.active_turn?.status}`);

// --- who may answer
const bobRead = await getAction('public', S, A1, { actor: 'bob' });
const bobAns = await respond(surface, S, a1, 'allow', { key: 'bob-1', actor: 'bob' });
R.check('reader (not the creator) can read the Action', bobRead.status === 200, `HTTP ${bobRead.status}`);
R.check('reader answering gets 403 action_forbidden', bobAns.status === 403 && bobAns.json.error?.code === 'action_forbidden', `HTTP ${bobAns.status} ${j(bobAns.json.error)}`);
const bobOther = await respond(other, S, surface === 'public' ? gw.json : gp.json, 'deny', { key: 'bob-2', actor: 'bob' });
R.check(`reader answering through ${other} gets 403 too`, bobOther.status === 403 && bobOther.json.error?.code === 'action_forbidden', `HTTP ${bobOther.status} ${j(bobOther.json.error)}`);
const carol = await respond(surface, S, a1, 'allow', { key: 'carol-1', actor: 'carol' });
R.check('another creator of the same Workspace gets 403', carol.status === 403 && carol.json.error?.code === 'action_forbidden', `HTTP ${carol.status} ${j(carol.json.error)}`);
const mallory = await respond(surface, S, a1, 'allow', { key: 'mallory-1', actor: 'mallory' });
R.check('actor without Workspace access cannot see the Session', mallory.status === 404, `HTTP ${mallory.status} ${j(mallory.json.error)}`);
const anon = await respond(surface, S, a1, 'allow', { key: 'anon-1', actor: null });
R.check('request without a trusted actor is refused', [401, 403, 404].includes(anon.status), `HTTP ${anon.status} ${j(anon.json.error)}`);
const foreign = await respond(surface, S, a1, 'allow', { key: 'foreign-1', tenant: 't-other' });
R.check('another tenant is refused', [403, 404].includes(foreign.status), `HTTP ${foreign.status} ${j(foreign.json.error)}`);
R.check('refused answers admitted no operation and left the Action requested', one(`SELECT COUNT(*) FROM managed_agent_operation WHERE session_id='${S}'`) === '0' && actionRow(A1)[0] === 'requested', `operations=${one(`SELECT COUNT(*) FROM managed_agent_operation WHERE session_id='${S}'`)} state=${actionRow(A1)[0]}`);

// --- the creator answers
const K1 = `allow-${A1.slice(-8)}`;
const r1 = await respond(surface, S, a1, 'allow', { key: K1 });
R.check('creator allow -> 202 action_response operation', r1.status === 202 && r1.json.type === 'action_response' && r1.json.replayed === false, `HTTP ${r1.status} ${j(r1.json)}`);
const OP1 = opId(r1.json);
const r1b = await respond(surface, S, a1, 'allow', { key: K1 });
R.check('same key again -> same operation, replayed', r1b.status === 202 && opId(r1b.json) === OP1 && r1b.json.replayed === true, `HTTP ${r1b.status} op=${opId(r1b.json)} replayed=${r1b.json.replayed}`);
const r1c = await respond(other, S, surface === 'public' ? gw.json : gp.json, 'allow', { key: K1 });
R.check(`same key through ${other} -> same operation`, r1c.status === 202 && opId(r1c.json) === OP1 && r1c.json.replayed === true, `HTTP ${r1c.status} op=${opId(r1c.json)} replayed=${r1c.json.replayed}`);
const r1d = await respond(surface, S, a1, 'deny', { key: K1 });
R.check('same key with different content -> 409 idempotency_conflict', r1d.status === 409 && r1d.json.error?.code === 'idempotency_conflict', `HTTP ${r1d.status} ${j(r1d.json.error)}`);
const done1 = await waitOp(S, OP1);
R.check('operation completes with a decided receipt', done1.json.status === 'completed' && done1.json.action_resolution?.outcome === 'decided' && !!done1.json.action_resolution?.decision_receipt_id && !!done1.json.receipt_id, `${done1.ms} ms ${j(done1.json)}`);
const done1w = await getOp('web', S, OP1);
R.check('WebShell operation query shows the same result', done1w.json.status === 'completed' && done1w.json.actionResolution?.decisionReceiptId === done1.json.action_resolution?.decision_receipt_id, j(done1w.json));
R.check('only one operation row despite the replays', one(`SELECT COUNT(*) FROM managed_agent_operation WHERE session_id='${S}'`) === '1', j(opRow(OP1)));

// --- terminal detail stays readable, leaves the pending list
const t1p = await getAction('public', S, A1);
const t1w = await getAction('web', S, A1);
R.check('decided Action stays readable with its decision receipt (both surfaces)', t1p.json.state === 'decided' && t1p.json.decision_receipt_id === done1.json.action_resolution?.decision_receipt_id && t1w.json.state === 'decided' && t1w.json.decisionReceiptId === t1p.json.decision_receipt_id, `public=${t1p.json.state}/${t1p.json.decision_receipt_id} web=${t1w.json.state}`);
R.check('decision receipt is not a storage resource id', !/^res|resource/.test(t1p.json.decision_receipt_id ?? '') && one(`SELECT COUNT(*) FROM qwen_managed_session_resource WHERE session_id='${S}' AND resource_id='${t1p.json.decision_receipt_id}'`) === '0', t1p.json.decision_receipt_id);

// --- second approval: edit, answered through the other surface
const p2 = await waitPending(S, { surface: other, not: [A1] });
R.check('next Action (edit) appears; the decided one left the pending list', !p2.timeout && (p2.action.toolName ?? p2.action.tool_name) === 'edit' && p2.page.data.length === 1, `after ${p2.ms} ms: ${j(p2.action)}`);
const a2 = p2.action;
const A2 = idOf(a2);
R.check('write ran only after the allow', readWs(storage, `child/${file}`) === 'before', `file=${j(readWs(storage, `child/${file}`))} executions=${executions(S)}`);
const K2 = `allow-${A2.slice(-8)}`;
const r2 = await respond(other, S, a2, 'allow', { key: K2 });
const OP2 = opId(r2.json);
const done2 = await waitOp(S, OP2);
R.check(`creator allow through ${other} -> completed/decided`, r2.status === 202 && done2.json.status === 'completed' && done2.json.action_resolution?.outcome === 'decided', `${done2.ms} ms ${j(done2.json)}`);

// --- the Turn finishes
const t = await waitTurn(S);
R.check('Turn completes', t.status === 'COMPLETED', `${t.status} ${t.error} after ${t.ms} ms`);
R.check('file holds the edited content; read_file was never asked about', readWs(storage, `child/${file}`) === 'after' && one(`SELECT COUNT(*) FROM managed_agent_action WHERE session_id='${S}'`) === '2', `file=${j(readWs(storage, `child/${file}`))} actions=${one(`SELECT COUNT(*) FROM managed_agent_action WHERE session_id='${S}'`)}`);
R.check('3 tool executions, 4 model calls', executions(S) === 3 && modelCalls() - before === 4, `executions=${executions(S)} modelCalls=${modelCalls() - before}`);
R.check('model saw the three results', (await finalText(S))?.includes('results='), (await finalText(S))?.slice(0, 220));

// --- after the end
const empty = await listActions('public', S);
const emptyW = await listActions('web', S);
R.check('pending list is empty on both surfaces', empty.json.data?.length === 0 && empty.json.has_more === false && emptyW.json.data?.length === 0, `public=${j(empty.json)} web=${j(emptyW.json)}`);
const late = await respond(surface, S, a1, 'deny', { key: 'late-deny' });
R.check('new answer to a decided Action -> 409 action_already_resolved', late.status === 409 && late.json.error?.code === 'action_already_resolved', `HTTP ${late.status} ${j(late.json.error)}`);
const lateSame = await respond(surface, S, a1, 'allow', { key: 'late-allow' });
R.check('same decision under a new key after the end -> 409 action_already_resolved', lateSame.status === 409 && lateSame.json.error?.code === 'action_already_resolved', `HTTP ${lateSame.status} ${j(lateSame.json.error)}`);
const replayLate = await respond(surface, S, a1, 'allow', { key: K1 });
R.check('original key after the end -> the original operation', replayLate.status === 202 && opId(replayLate.json) === OP1 && replayLate.json.status === 'completed', `HTTP ${replayLate.status} op=${opId(replayLate.json)} status=${replayLate.json.status}`);
const ev = await api('GET', `/v1/agents/sessions/${S}/events?limit=100`);
const updates = (ev.json.data ?? []).filter((e) => e.type === 'action.updated');
R.check('Session events carry action.updated for each change (2 requested + 2 decided)', updates.length === 4, j(updates.map((e) => e.data ?? e.payload ?? e)));
R.check('Session lifecycle status unchanged by the answers', sessionRow(S)[0] === 'ACTIVE' || sessionRow(S)[0] === 'IDLE', `status=${sessionRow(S)[0]}`);
R.done({ session: S, actions: [A1, A2], operations: [OP1, OP2] });
