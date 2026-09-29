// Phase F: a Harness restart strands a waiting approval; loading that Session
// answers 409 hosted_turn_recovery_required (documented Stage G behavior).
import * as L from './lib.mjs';
import { fakeToolCall, startFakeOpenAIServer } from '/root/git/qwen-code-pr13071/integration-tests/fake-openai-server.ts';

L.openLog('f-restart');
const model = await startFakeOpenAIServer(async ({ body }) => {
  const messages = body['messages'];
  const lastUser = messages.findLastIndex((m) => m.role === 'user');
  const receipts = messages.slice(lastUser + 1).filter((x) => x.role === 'tool');
  if (!receipts.length) return { toolCalls: [fakeToolCall('write_file', { file_path: 'f1.txt', content: 'x\n' }, 'call-f1')] };
  return { content: 'settled' };
});
const proxy = await L.startBrokerProxy(`http://127.0.0.1:${L.BPORT}`);
const h1 = await new L.Harness({ name: 'f1', modelUrl: model.baseUrl, brokerUrl: proxy.url }).start();
process.on('exit', () => { try { h1.child?.kill('SIGKILL'); } catch {} });

L.seedRegistry('ws-a', 'st-a');
const sessionId = await L.createWorkspaceSession('ws-a');
const s = new L.HSession(h1, sessionId, L.storeConnection(h1, 'ws-a'));
const created = await s.create({ toolProfile: L.FILE_PROFILE, approvalMode: 'default' });
L.check('F0 create -> 200', created.status === 200, created.status);

const p = await s.submit('[[f]] write and wait');
const action = await L.waitForAction(sessionId);
L.check('F1 approval waiting before restart', action.state === 'requested', action.requestId);

// Kill the Harness while the approval waits.
await h1.stop('SIGKILL');
L.say('harness', 'killed while the approval was waiting');

// A fresh Harness (new bootId, new writer) loads the Session. The killed
// Harness's 60s writer lease must drain before the new writer can open the
// Session, so retry while the Store answers 503.
const h2 = await new L.Harness({ name: 'f2', modelUrl: model.baseUrl, brokerUrl: proxy.url }).start();
process.on('exit', () => { try { h2.child?.kill('SIGKILL'); } catch {} });
const s2 = new L.HSession(h2, sessionId, L.storeConnection(h2, 'ws-a'));
let l;
const deadline = Date.now() + 120_000;
do {
  l = await s2.load({ toolProfile: L.FILE_PROFILE });
  if (l.status !== 503) break;
  await L.sleep(2_000);
} while (Date.now() < deadline);
L.check('F2 load after restart -> 409 hosted_turn_recovery_required', l.status === 409 && l.json?.code === 'hosted_turn_recovery_required', `${l.status} ${JSON.stringify(l.json)}`);

// The stranded question is still visible in the durable journal.
const stranded = L.requestedActions(sessionId);
L.check('F2 requested Action still durable', stranded.some((a) => a.requestId === action.requestId && a.state === 'requested'), stranded.map((a) => `${a.requestId}:${a.state}`));

await h2.stop();
await model.close?.();
await proxy.close();
L.exitSummary();
