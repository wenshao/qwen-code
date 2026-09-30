// Phase H: concurrent answers race on one Action (PR #13071 review-fix round,
// head 706d402aeb). The review changed race semantics: a same decision that
// loses the write race must answer 200 like a replay, a different one gets
// 409 action_already_resolved, and a failed expiry write answers 409
// hosted_turn_recovery_required instead of 503.
import fs from 'node:fs';
import * as L from './lib.mjs';
import { fakeToolCall, startFakeOpenAIServer } from '/root/git/qwen-code-pr13071/integration-tests/fake-openai-server.ts';

L.openLog('h-race');
const ROOT = '/root/rig13071/roots/a/child';
const model = await startFakeOpenAIServer(async ({ body }) => {
  const messages = body['messages'];
  const lastUser = messages.findLastIndex((m) => m.role === 'user');
  const userText = JSON.stringify(messages[lastUser]?.content ?? '');
  const receipts = messages.slice(lastUser + 1).filter((x) => x.role === 'tool');
  if (!receipts.length) {
    const tag = userText.match(/\[\[(h\d)/)?.[1] ?? 'h?';
    return { toolCalls: [fakeToolCall('write_file', { file_path: `${tag}.txt`, content: `${tag}\n` }, `call-${tag}`)] };
  }
  return { content: 'settled' };
});
const proxy = await L.startBrokerProxy(`http://127.0.0.1:${L.BPORT}`);
const h = await new L.Harness({ name: 'h', modelUrl: model.baseUrl, brokerUrl: proxy.url }).start();
process.on('exit', () => { try { h.child?.kill('SIGKILL'); } catch {} });

L.seedRegistry('ws-a', 'st-a');
const mk = async (extra = {}) => {
  const sessionId = await L.createWorkspaceSession('ws-a');
  const s = new L.HSession(h, sessionId, L.storeConnection(h, 'ws-a'));
  const r = await s.create({ toolProfile: L.FILE_PROFILE, approvalMode: 'default', ...extra });
  if (r.status !== 200) throw new Error(`create: ${r.status} ${JSON.stringify(r.json)}`);
  return s;
};
const decision = (optionId) => ({ optionId, inputRevision: 1, policyRevision: 'hosted-tool-approval/1' });
const race = (s, requestId, bodies) => Promise.all(bodies.map((b) => s.resolve(requestId, b)));

// H1: eight concurrent identical allows -> every answer is 200, exactly one
// decision is durable, the call runs exactly once.
{
  const s = await mk();
  fs.rmSync(`${ROOT}/h1.txt`, { force: true });
  await s.submit('[[h1]] race same decision');
  const a = await L.waitForAction(s.sessionId);
  const rs = await race(s, a.requestId, Array.from({ length: 8 }, () => decision('allow')));
  const codes = rs.map((r) => r.status);
  L.check('H1 all 8 identical answers -> 200', codes.every((c) => c === 200), codes);
  L.check('H1 all bodies identical', new Set(rs.map((r) => JSON.stringify(r.json))).size === 1);
  await s.waitIdle();
  const decided = L.actionEvents(s.sessionId).filter((e) => JSON.stringify(e.payload).includes('"decided"'));
  L.check('H1 exactly one decision durable', decided.length === 1, decided.length);
  L.check('H1 call ran exactly once', fs.readFileSync(`${ROOT}/h1.txt`, 'utf8') === 'h1\n');
}

// H2: 4 allow vs 4 deny concurrently -> one side wins (200), the other gets
// 409 action_already_resolved; exactly one durable decision; file written iff
// allow won.
{
  const s = await mk();
  fs.rmSync(`${ROOT}/h2.txt`, { force: true });
  await s.submit('[[h2]] race allow vs deny');
  const a = await L.waitForAction(s.sessionId);
  const bodies = [...Array.from({ length: 4 }, () => decision('allow')), ...Array.from({ length: 4 }, () => decision('deny'))];
  const rs = await race(s, a.requestId, bodies);
  const byOption = (id) => rs.slice(id === 'allow' ? 0 : 4, id === 'allow' ? 4 : 8).map((r) => `${r.status}${r.json?.code ? `:${r.json.code}` : ''}`);
  const allowWon = rs[0].status === 200 && rs[0].json?.optionId === 'allow';
  const denyWon = rs[4].status === 200 && rs[4].json?.optionId === 'deny';
  L.check('H2 exactly one side decided', allowWon !== denyWon, [...byOption('allow'), ...byOption('deny')]);
  const losers = allowWon ? byOption('deny') : byOption('allow');
  L.check('H2 losing side all 409 action_already_resolved', losers.every((x) => x === '409:action_already_resolved'), losers);
  await s.waitIdle();
  const decided = L.actionEvents(s.sessionId).filter((e) => JSON.stringify(e.payload).includes('"decided"'));
  L.check('H2 exactly one decision durable', decided.length === 1, decided.length);
  L.check('H2 file written iff allow won', fs.existsSync(`${ROOT}/h2.txt`) === allowWon);
}

// H3: a wrong inputRevision in the same race is always 400, whoever wins.
{
  const s = await mk();
  fs.rmSync(`${ROOT}/h3.txt`, { force: true });
  await s.submit('[[h3]] race with a bad revision');
  const a = await L.waitForAction(s.sessionId);
  const rs = await race(s, a.requestId, [decision('allow'), { ...decision('allow'), inputRevision: 2 }, decision('allow')]);
  L.check('H3 bad revision -> 400 invalid_action_response', rs[1].status === 400 && rs[1].json?.code === 'invalid_action_response', rs.map((r) => r.status));
  L.check('H3 good answers unaffected', rs[0].status === 200 && rs[2].status === 200, rs.map((r) => r.status));
  await s.waitIdle();
}

// H4: the expiry write fails (journal down) -> a late answer gets 409
// hosted_turn_recovery_required, never 503, and the Session blocks.
{
  const storeProxy = await L.startPassProxy(`http://127.0.0.1:${L.HTTP}`);
  const sessionId = await L.createWorkspaceSession('ws-a');
  const s = new L.HSession(h, sessionId, L.storeConnection(h, 'ws-a', storeProxy.url));
  await s.create({ toolProfile: L.FILE_PROFILE, approvalMode: 'default', approvalTimeoutMs: 3_000 });
  await s.submit('[[h4]] expiry with a broken journal');
  const a = await L.waitForAction(sessionId);
  storeProxy.state.hook = async (entry) =>
    entry.method === 'POST' && entry.url.includes('transaction') ? 'fail-503' : 'forward';
  L.say('fault', `journal down; waiting past the 3s expiry of ${a.requestId}`);
  // The Turn's own expiry write fails too, which blocks the Session.
  let blocked = false;
  for (let i = 0; i < 100 && !blocked; i++) {
    blocked = (await s.status()).recoveryBlocked === true;
    if (!blocked) await L.sleep(100);
  }
  L.check('H4 session blocked after failed expiry write', blocked);
  const late = await s.resolve(a.requestId, decision('allow'));
  L.check('H4 late resolve -> 409 hosted_turn_recovery_required (not 503)', late.status === 409 && late.json?.code === 'hosted_turn_recovery_required', `${late.status} ${JSON.stringify(late.json)}`);
  await storeProxy.close();
}

await h.stop();
await model.close?.();
await proxy.close();
L.exitSummary();
