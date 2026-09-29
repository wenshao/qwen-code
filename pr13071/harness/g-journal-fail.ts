// Phase G: the journal fails while an approval waits (PR #13071). The answer's
// own write fails -> 409 hosted_turn_recovery_required, the waiting Turn is
// woken and blocks the Session within about a second; the blocked Session
// still answers recorded state but writes nothing.
import * as L from './lib.mjs';
import { fakeToolCall, startFakeOpenAIServer } from '/root/git/qwen-code-pr13071/integration-tests/fake-openai-server.ts';

L.openLog('g-journal-fail');
const model = await startFakeOpenAIServer(async ({ body }) => {
  const messages = body['messages'];
  const lastUser = messages.findLastIndex((m) => m.role === 'user');
  const receipts = messages.slice(lastUser + 1).filter((x) => x.role === 'tool');
  if (!receipts.length) return { toolCalls: [fakeToolCall('write_file', { file_path: 'g1.txt', content: 'x\n' }, 'call-g1')] };
  return { content: 'settled' };
});
const proxy = await L.startBrokerProxy(`http://127.0.0.1:${L.BPORT}`);
const h = await new L.Harness({ name: 'g', modelUrl: model.baseUrl, brokerUrl: proxy.url }).start();
process.on('exit', () => { try { h.child?.kill('SIGKILL'); } catch {} });

L.seedRegistry('ws-a', 'st-a');
const sessionId = await L.createWorkspaceSession('ws-a');
// The Session Store sits behind the fault proxy.
const storeProxy = await L.startPassProxy(`http://127.0.0.1:${L.HTTP}`);
const s = new L.HSession(h, sessionId, L.storeConnection(h, 'ws-a', storeProxy.url));
const created = await s.create({ toolProfile: L.FILE_PROFILE, approvalMode: 'default' });
L.check('G0 create via fault proxy -> 200', created.status === 200, `${created.status} ${JSON.stringify(created.json)}`);

const p = await s.submit('[[g]] write and wait');
const action = await L.waitForAction(sessionId);
L.check('G1 approval waiting', action.state === 'requested', action.requestId);

// Break every journal append from here on.
storeProxy.state.hook = async (entry, body) =>
  entry.method === 'POST' && (entry.url.includes(':append') || entry.url.includes('transaction') || entry.url.includes('journal')) ? 'fail-503' : 'forward';
L.say('fault', 'journal appends now fail with 503');

const t0 = Date.now();
const r = await s.resolve(action.requestId, { optionId: 'allow', inputRevision: 1, policyRevision: 'hosted-tool-approval/1' });
L.check('G2 resolve with failed journal -> 409 hosted_turn_recovery_required', r.status === 409 && r.json?.code === 'hosted_turn_recovery_required', `${r.status} ${JSON.stringify(r.json)}`);

// The waiting Turn notices the stopped writes within about a second and the
// Session becomes recovery-blocked.
let blockedAt = -1;
for (let i = 0; i < 100; i++) {
  const st = await s.status();
  if (st.recoveryBlocked) { blockedAt = Date.now() - t0; break; }
  await L.sleep(100);
}
L.check('G3 session blocked within ~1s', blockedAt >= 0 && blockedAt < 5_000, `${blockedAt}ms`);

// The Turn ends in-process instead of waiting for the expiry; its settle
// write itself fails (the journal is down), so the observable is the prompt
// becoming idle while blocked, not a durable turn.settled.
const end = Date.now() + 30_000;
let idle;
while (Date.now() < end && !idle) {
  const st = await s.status();
  if (st.recoveryBlocked && !st.hasActivePrompt) idle = st;
  if (!idle) await L.sleep(300);
}
L.check('G3 waiting turn ended without an answer', !!idle, JSON.stringify(idle));

// The blocked Session still answers what it recorded, writes nothing.
const again = await s.resolve(action.requestId, { optionId: 'allow', inputRevision: 1, policyRevision: 'hosted-tool-approval/1' });
L.check('G4 blocked session answers 409, no write', again.status === 409 && again.json?.code === 'hosted_turn_recovery_required', `${again.status} ${JSON.stringify(again.json)}`);
L.check('G4 Action still only requested durably', L.requestedActions(sessionId).every((a) => a.state === 'requested'), L.requestedActions(sessionId).map((a) => `${a.requestId}:${a.state}`));

await h.stop();
await model.close?.();
await proxy.close();
await storeProxy.close();
L.exitSummary();
