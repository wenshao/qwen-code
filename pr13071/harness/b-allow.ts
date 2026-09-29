// Phase B: allow / deny / replay through the real stack (PR #13071).
// A default-mode Session asks before write_file; the driver answers through
// the real resolve route and verifies the durable journal, the Runtime
// dispatch (broker ledger) and the bytes on the Workspace disk.
import fs from 'node:fs';
import * as L from './lib.mjs';
import { fakeToolCall, startFakeOpenAIServer } from '/root/git/qwen-code-pr13071/integration-tests/fake-openai-server.ts';

L.openLog('b-allow');
const ROOT = '/root/rig13071/roots/a/child';
const seen = [];
const model = await startFakeOpenAIServer(async ({ body }) => {
  const messages = body['messages'];
  const lastUser = messages.findLastIndex((m) => m.role === 'user');
  const receipts = messages.slice(lastUser + 1).filter((x) => x.role === 'tool');
  const round = seen.length;
  if (!receipts.length) {
    if (round === 0) return { toolCalls: [fakeToolCall('write_file', { file_path: 'b1-hello.txt', content: 'allowed-by-rig\n' }, 'call-b1')] };
    return { toolCalls: [fakeToolCall('write_file', { file_path: 'b2-denied.txt', content: 'should-never-exist\n' }, 'call-b2')] };
  }
  seen.push(JSON.stringify(receipts.at(-1)?.content ?? ''));
  return { content: `round ${round} settled` };
});
const proxy = await L.startBrokerProxy(`http://127.0.0.1:${L.BPORT}`);
const h = await new L.Harness({ name: 'b', modelUrl: model.baseUrl, brokerUrl: proxy.url }).start();
process.on('exit', () => { try { h.child?.kill('SIGKILL'); } catch {} });

L.seedRegistry('ws-a', 'st-a');
const sessionId = await L.createWorkspaceSession('ws-a');
const s = new L.HSession(h, sessionId, L.storeConnection(h, 'ws-a'));
const created = await s.create({ toolProfile: L.FILE_PROFILE, approvalMode: 'default' });
L.check('B0 create default -> 200', created.status === 200 && created.json?.approvalMode === 'default', `${created.status} ${JSON.stringify(created.json)}`);

for (const f of ['b1-hello.txt', 'b2-denied.txt']) fs.rmSync(`${ROOT}/${f}`, { force: true });

// --- Turn 1: allow -------------------------------------------------------
const t0 = Date.now();
const p1 = await s.submit('[[b1]] write hello');
L.check('B1 prompt admitted', p1.status === 202, p1.status);
const action = await L.waitForAction(sessionId);
L.say('action', `requested ${action.requestId} tool=${action.options.toolName} policy=${action.options.policyRevision} expiresIn=${action.options.expiresAt - Date.now()}ms`);
L.check('B1 Action options durable', action.options.toolName === 'write_file' && action.options.policyRevision === 'hosted-tool-approval/1' && action.options.inputRevision === 1, action.options);
L.check('B1 options are allow/deny', JSON.stringify(action.options.options.map((o) => o.id)) === '["allow","deny"]', action.options.options);
L.check('B1 nothing ran while waiting', !fs.existsSync(`${ROOT}/b1-hello.txt`) && !proxy.ledger.some((e) => e.url.includes('executions:prepare')), L.ledgerSince(proxy.ledger, t0));
L.check('B1 no tool result committed yet', !L.journalEvents(sessionId).some((e) => e.kind === 'message.committed' && JSON.stringify(e.payload).includes('tool_result')));

const decision = { optionId: 'allow', inputRevision: 1, policyRevision: 'hosted-tool-approval/1' };
const r1 = await s.resolve(action.requestId, decision);
L.check('B2 resolve allow -> 200 decided', r1.status === 200 && r1.json?.state === 'decided' && r1.json?.optionId === 'allow', `${r1.status} ${JSON.stringify(r1.json)}`);
const st1 = await s.waitIdle();
L.check('B2 turn completed', (await s.transcript()).some((e) => e.type === 'turn_complete' && e.promptId === p1.promptId));
L.check('B2 file written through Runtime', fs.readFileSync(`${ROOT}/b1-hello.txt`, 'utf8') === 'allowed-by-rig\n');
L.check('B2 broker dispatched after allow', proxy.ledger.some((e) => e.url.includes('executions:prepare') && e.t > t0));

// Replay + conflicts.
const replay = await s.resolve(action.requestId, decision);
L.check('B3 replay same decision -> 200 same body', replay.status === 200 && JSON.stringify(replay.json) === JSON.stringify(r1.json), `${replay.status} ${JSON.stringify(replay.json)}`);
const conflict = await s.resolve(action.requestId, { ...decision, optionId: 'deny' });
L.check('B3 conflicting decision -> 409 action_already_resolved', conflict.status === 409 && conflict.json?.code === 'action_already_resolved', `${conflict.status} ${JSON.stringify(conflict.json)}`);
const badRev = await s.resolve(action.requestId, { ...decision, inputRevision: 2 });
L.check('B3 wrong inputRevision -> 400 invalid_action_response', badRev.status === 400 && badRev.json?.code === 'invalid_action_response', `${badRev.status} ${JSON.stringify(badRev.json)}`);
const missing = await s.resolve('tool_approval_00000000000000000000000000000000', decision);
L.check('B3 unknown requestId -> 404 action_not_found', missing.status === 404 && missing.json?.code === 'action_not_found', `${missing.status} ${JSON.stringify(missing.json)}`);
const malformed = await s.resolve(action.requestId, { optionId: 'allow' });
L.check('B3 malformed body -> 400 invalid_action_response', malformed.status === 400 && malformed.json?.code === 'invalid_action_response', `${malformed.status} ${JSON.stringify(malformed.json)}`);

// Durable journal: requested then decided.
const states = L.requestedActions(sessionId).filter((a) => a.requestId === action.requestId);
L.check('B3 journal recorded the decision', L.actionEvents(sessionId).some((e) => JSON.stringify(e.payload).includes(action.requestId) && JSON.stringify(e.payload).includes('"decided"')));

// --- Turn 2: deny --------------------------------------------------------
const p2 = await s.submit('[[b2]] write again');
const action2 = await L.waitForAction(sessionId);
L.check('B4 second turn asks again', action2.requestId !== action.requestId && action2.options.toolName === 'write_file');
const d2 = await s.resolve(action2.requestId, { optionId: 'deny', inputRevision: 1, policyRevision: 'hosted-tool-approval/1' });
L.check('B4 resolve deny -> 200 decided', d2.status === 200 && d2.json?.optionId === 'deny', `${d2.status} ${JSON.stringify(d2.json)}`);
await s.waitIdle();
const t2 = await s.transcript();
L.check('B4 turn completed after refusal', t2.some((e) => e.type === 'turn_complete' && e.promptId === p2.promptId));
L.check('B4 denied file never written', !fs.existsSync(`${ROOT}/b2-denied.txt`));
L.check('B4 model saw the refusal', seen.some((x) => x.includes('denied')), seen);

// The whole session stayed healthy: status not blocked.
const st = await s.status();
L.check('B5 session not recovery-blocked', st.recoveryBlocked === false, st);

await h.stop();
await model.close?.();
await proxy.close();
L.exitSummary();
