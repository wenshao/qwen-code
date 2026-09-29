// Phase D: cancel while an approval waits (PR #13071). The waiting Action is
// cancelled, nothing runs, the Workspace is released and the Turn settles as
// cancelled; a later answer gets 409 action_cancelled.
import fs from 'node:fs';
import * as L from './lib.mjs';
import { fakeToolCall, startFakeOpenAIServer } from '/root/git/qwen-code-pr13071/integration-tests/fake-openai-server.ts';

L.openLog('d-cancel');
const ROOT = '/root/rig13071/roots/a/child';
const model = await startFakeOpenAIServer(async ({ body }) => {
  const messages = body['messages'];
  const lastUser = messages.findLastIndex((m) => m.role === 'user');
  const receipts = messages.slice(lastUser + 1).filter((x) => x.role === 'tool');
  if (!receipts.length) return { toolCalls: [fakeToolCall('write_file', { file_path: 'd1-never.txt', content: 'x\n' }, 'call-d1')] };
  return { content: 'settled' };
});
const proxy = await L.startBrokerProxy(`http://127.0.0.1:${L.BPORT}`);
const h = await new L.Harness({ name: 'd', modelUrl: model.baseUrl, brokerUrl: proxy.url }).start();
process.on('exit', () => { try { h.child?.kill('SIGKILL'); } catch {} });

L.seedRegistry('ws-a', 'st-a');
const sessionId = await L.createWorkspaceSession('ws-a');
const s = new L.HSession(h, sessionId, L.storeConnection(h, 'ws-a'));
const created = await s.create({ toolProfile: L.FILE_PROFILE, approvalMode: 'default' });
L.check('D0 create -> 200', created.status === 200, created.status);
fs.rmSync(`${ROOT}/d1-never.txt`, { force: true });

const p = await s.submit('[[d]] write then cancel');
L.check('D1 prompt admitted', p.status === 202, p.status);
const action = await L.waitForAction(sessionId);
L.say('action', `requested ${action.requestId}; cancelling the turn`);

const c = await s.cancel();
L.check('D1 cancel -> 204', c.status === 204, c.status);
const st = await s.waitIdle(30_000);
const settled = L.journalEvents(sessionId).find((e) => e.kind === 'turn.settled' && e.payload?.turnId === p.promptId);
L.check('D1 turn settled as cancelled', settled?.payload?.outcome === 'cancelled', JSON.stringify(settled?.payload));
const cancelled = L.actionEvents(sessionId).filter((e) => JSON.stringify(e.payload).includes('"cancelled"') && JSON.stringify(e.payload).includes(action.requestId));
L.check('D1 Action cancelled durably', cancelled.length === 1, L.requestedActions(sessionId).map((a) => `${a.requestId}:${a.state}`));
L.check('D1 nothing ran', !fs.existsSync(`${ROOT}/d1-never.txt`) && !proxy.ledger.some((e) => e.url.includes('executions:prepare')));
L.check('D1 workspace released', proxy.ledger.some((e) => e.url.includes('release') || e.url.includes(':release')), L.ledgerSince(proxy.ledger, 0).slice(-6));

const late = await s.resolve(action.requestId, { optionId: 'allow', inputRevision: 1, policyRevision: 'hosted-tool-approval/1' });
L.check('D2 resolve after cancel -> 409 action_cancelled', late.status === 409 && late.json?.code === 'action_cancelled', `${late.status} ${JSON.stringify(late.json)}`);

// The Session still works: a fresh prompt is admitted and asks again.
const p2 = await s.submit('[[d2]] second chance');
L.check('D3 next prompt admitted', p2.status === 202, p2.status);
const action2 = await L.waitForAction(sessionId);
L.check('D3 next turn asks again', action2.requestId !== action.requestId && action2.state === 'requested');
const ok = await s.resolve(action2.requestId, { optionId: 'allow', inputRevision: 1, policyRevision: 'hosted-tool-approval/1' });
L.check('D3 allow -> 200, turn completes', ok.status === 200);
await s.waitIdle();
L.check('D3 file written this time', fs.existsSync(`${ROOT}/d1-never.txt`));

await h.stop();
await model.close?.();
await proxy.close();
L.exitSummary();
