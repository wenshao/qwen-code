// Phase C: approval expiry (PR #13071). A Session with approvalTimeoutMs=5s:
// the first question expires unanswered, its call is refused, and every later
// call in the Turn is refused without being asked about.
import fs from 'node:fs';
import * as L from './lib.mjs';
import { fakeToolCall, startFakeOpenAIServer } from '/root/git/qwen-code-pr13071/integration-tests/fake-openai-server.ts';

L.openLog('c-expiry');
const ROOT = '/root/rig13071/roots/a/child';
const seen = [];
const model = await startFakeOpenAIServer(async ({ body }) => {
  const messages = body['messages'];
  const lastUser = messages.findLastIndex((m) => m.role === 'user');
  const receipts = messages.slice(lastUser + 1).filter((x) => x.role === 'tool');
  if (!receipts.length) return { toolCalls: [fakeToolCall('write_file', { file_path: 'c1-never.txt', content: 'x\n' }, 'call-c1')] };
  seen.push(JSON.stringify(receipts.at(-1)?.content ?? ''));
  if (seen.length === 1) return { toolCalls: [fakeToolCall('write_file', { file_path: 'c2-never.txt', content: 'y\n' }, 'call-c2')] };
  return { content: 'settled' };
});
const proxy = await L.startBrokerProxy(`http://127.0.0.1:${L.BPORT}`);
const h = await new L.Harness({ name: 'c', modelUrl: model.baseUrl, brokerUrl: proxy.url }).start();
process.on('exit', () => { try { h.child?.kill('SIGKILL'); } catch {} });

L.seedRegistry('ws-a', 'st-a');
const sessionId = await L.createWorkspaceSession('ws-a');
const s = new L.HSession(h, sessionId, L.storeConnection(h, 'ws-a'));
const created = await s.create({ toolProfile: L.FILE_PROFILE, approvalMode: 'default', approvalTimeoutMs: 5_000 });
L.check('C0 create timeout=5s -> 200', created.status === 200, `${created.status} ${JSON.stringify(created.json)}`);
for (const f of ['c1-never.txt', 'c2-never.txt']) fs.rmSync(`${ROOT}/${f}`, { force: true });

const t0 = Date.now();
const p = await s.submit('[[c]] two writes, nobody answers');
L.check('C1 prompt admitted', p.status === 202, p.status);
const action = await L.waitForAction(sessionId);
L.say('action', `requested ${action.requestId}, expires in ${action.options.expiresAt - Date.now()}ms`);

// Nobody answers; the Turn should end about one timeout after the question.
const st = await s.waitIdle(60_000);
const elapsed = Date.now() - t0;
const t = await s.transcript();
L.check('C1 turn completed without any answer', t.some((e) => e.type === 'turn_complete' && e.promptId === p.promptId));
L.check('C1 ended around one timeout (<20s)', elapsed < 20_000, `${elapsed}ms`);

const all = L.requestedActions(sessionId);
const expired = L.actionEvents(sessionId).filter((e) => JSON.stringify(e.payload).includes('"expired"'));
L.check('C2 exactly one Action was requested', all.length === 1, all.map((a) => `${a.requestId}:${a.state}`));
L.check('C2 the Action expired durably', expired.length === 1 && JSON.stringify(expired[0].payload).includes(action.requestId));
L.check('C2 neither file was written', !fs.existsSync(`${ROOT}/c1-never.txt`) && !fs.existsSync(`${ROOT}/c2-never.txt`));
L.check('C2 no Runtime dispatch happened', !proxy.ledger.some((e) => e.url.includes('executions:prepare')));
L.check('C2 first refusal says expired', seen[0]?.includes('expired'), seen[0]?.slice(0, 200));
L.check('C2 second call refused without asking', seen[1]?.includes('not been asked') || seen[1]?.includes('not asked'), seen[1]?.slice(0, 200));

// A late answer is refused and stays refused on replay.
const late = await s.resolve(action.requestId, { optionId: 'allow', inputRevision: 1, policyRevision: 'hosted-tool-approval/1' });
L.check('C3 late resolve -> 409 action_expired', late.status === 409 && late.json?.code === 'action_expired', `${late.status} ${JSON.stringify(late.json)}`);
const late2 = await s.resolve(action.requestId, { optionId: 'allow', inputRevision: 1, policyRevision: 'hosted-tool-approval/1' });
L.check('C3 repeated late resolve -> same 409', late2.status === 409 && late2.json?.code === 'action_expired');

await h.stop();
await model.close?.();
await proxy.close();
L.exitSummary();
