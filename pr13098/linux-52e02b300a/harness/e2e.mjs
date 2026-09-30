// PR #13098 real-stack E2E (Linux): packaged Hosted Harness (dist/cli.js) +
// MySQL-backed Spring Session Store + embedded Runtime Broker + fake model.
// Ordinary approval paths are regression controls for the queued-expiry
// guard; E5 races a late answer against the Turn's own expiry write through
// a delaying Store proxy; E6 documents restart recovery-blocking. The exact
// decision encoding from the design notes is verified against MySQL bytes.
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import * as L from './lib.mjs';
import { fakeToolCall, startFakeOpenAIServer } from '/root/git/qwen-code-pr13098/integration-tests/fake-openai-server.ts';

L.openLog('e2e');
const ROOT = '/root/rig13098/roots/a/child';
const DECISION = (optionId) => ({ optionId, inputRevision: 1, policyRevision: 'hosted-tool-approval/1' });

const model = await startFakeOpenAIServer(async ({ body }) => {
  const messages = body['messages'];
  const lastUser = messages.findLastIndex((m) => m.role === 'user');
  const userText = JSON.stringify(messages[lastUser]?.content ?? '');
  const receipts = messages.slice(lastUser + 1).filter((x) => x.role === 'tool');
  if (!receipts.length) {
    const tag = userText.match(/\[\[(\w+)\]/)?.[1] ?? 'x';
    return { toolCalls: [fakeToolCall('write_file', { file_path: `${tag}.txt`, content: `${tag}\n` }, `call-${tag}`)] };
  }
  return { content: 'settled' };
});
const proxy = await L.startBrokerProxy(`http://127.0.0.1:${L.BPORT}`);
const h = await new L.Harness({ name: 'e2e', modelUrl: model.baseUrl, brokerUrl: proxy.url }).start();
process.on('exit', () => { try { h.child?.kill('SIGKILL'); } catch {} });

// S0: packaged server startup smoke — authenticated health + capabilities.
{
  const health = await fetch(`${h.baseUrl}/health`, { headers: h.headers() });
  const caps = await fetch(`${h.baseUrl}/capabilities`, { headers: h.headers() });
  const noauth = await fetch(`${h.baseUrl}/capabilities`);
  L.check('S0 /health authenticated -> 200', health.status === 200, health.status);
  L.check('S0 /capabilities authenticated -> 200', caps.status === 200, caps.status);
  L.check('S0 /capabilities without token refused', noauth.status === 401 || noauth.status === 403, noauth.status);
}

L.seedRegistry('ws-a', 'st-a');
const mk = async (harness = h, extra = {}) => {
  const sessionId = await L.createWorkspaceSession('ws-a');
  const s = new L.HSession(harness, sessionId, L.storeConnection(harness, 'ws-a'));
  const r = await s.create({ toolProfile: L.FILE_PROFILE, approvalMode: 'default', ...extra });
  if (r.status !== 200) throw new Error(`create: ${r.status} ${JSON.stringify(r.json)}`);
  return s;
};

// E1: owner allows — call runs; durable decision bytes/digest match the exact
// encoding the design notes pin for Java (compact JSON, fixed key order,
// lowercase hex SHA-256 without prefix), verified against the MySQL journal.
{
  const s = await mk();
  fs.rmSync(`${ROOT}/e1.txt`, { force: true });
  await s.submit('[[e1]] allow me');
  const a = await L.waitForAction(s.sessionId);
  L.check('E1 options metadata has exactly the documented fields',
    JSON.stringify(Object.keys(a.options).sort()) ===
    JSON.stringify(['createdAt', 'expiresAt', 'functionCallId', 'inputRevision', 'options', 'policyRevision', 'requestId', 'toolName', 'turnId', 'v'].sort()),
    Object.keys(a.options));
  const r = await s.resolve(a.requestId, DECISION('allow'));
  L.check('E1 allow -> 200 decided', r.status === 200 && r.json?.state === 'decided' && r.json?.optionId === 'allow', `${r.status} ${JSON.stringify(r.json)}`);
  await s.waitIdle();
  L.check('E1 allowed call ran', fs.readFileSync(`${ROOT}/e1.txt`, 'utf8') === 'e1\n');
  const events = L.actionEvents(s.sessionId);
  const decided = events.find((e) => JSON.stringify(e.payload).includes('"decided"'));
  const ref = decided?.payload?.decisionRef;
  const bytes = L.readResource(s.sessionId, ref?.resourceId);
  const expected = `{"v":1,"optionId":"allow","inputRevision":1,"policyRevision":"hosted-tool-approval/1"}`;
  L.check('E1 durable decision bytes are the exact documented encoding', bytes === expected, JSON.stringify(bytes));
  const digest = createHash('sha256').update(Buffer.from(expected, 'utf8')).digest('hex');
  L.check('E1 recorded digest is lowercase hex SHA-256, no prefix', ref?.digest === digest && /^[0-9a-f]{64}$/.test(ref?.digest ?? ''), ref?.digest);
  const replay = await s.resolve(a.requestId, DECISION('allow'));
  L.check('E1 same decision replays as 200', replay.status === 200, replay.status);
  const conflict = await s.resolve(a.requestId, DECISION('deny'));
  L.check('E1 different decision -> 409 action_already_resolved', conflict.status === 409 && conflict.json?.code === 'action_already_resolved', `${conflict.status} ${JSON.stringify(conflict.json)}`);
}

// E2: owner denies — refusal is recorded and the call never runs.
{
  const s = await mk();
  fs.rmSync(`${ROOT}/e2.txt`, { force: true });
  await s.submit('[[e2]] deny me');
  const a = await L.waitForAction(s.sessionId);
  const r = await s.resolve(a.requestId, DECISION('deny'));
  L.check('E2 deny -> 200 decided(deny)', r.status === 200 && r.json?.optionId === 'deny', `${r.status} ${JSON.stringify(r.json)}`);
  await s.waitIdle();
  L.check('E2 denied call never ran', !fs.existsSync(`${ROOT}/e2.txt`));
  const decided = L.actionEvents(s.sessionId).filter((e) => JSON.stringify(e.payload).includes('"decided"'));
  L.check('E2 exactly one decision durable', decided.length === 1, decided.length);
}

// E3: nobody answers — the Turn expires its own Action; a late answer is
// refused and stays refused on replay (regression control for the route).
{
  const s = await mk(h, { approvalTimeoutMs: 5_000 });
  fs.rmSync(`${ROOT}/e3.txt`, { force: true });
  const t0 = Date.now();
  await s.submit('[[e3]] nobody answers');
  const a = await L.waitForAction(s.sessionId);
  await s.waitIdle(60_000);
  const elapsed = Date.now() - t0;
  L.check('E3 turn ended around one timeout (<20s)', elapsed < 20_000, `${elapsed}ms`);
  L.check('E3 expired call never ran', !fs.existsSync(`${ROOT}/e3.txt`));
  const late = await s.resolve(a.requestId, DECISION('allow'));
  L.check('E3 late answer -> 409 action_expired', late.status === 409 && late.json?.code === 'action_expired', `${late.status} ${JSON.stringify(late.json)}`);
  const late2 = await s.resolve(a.requestId, DECISION('allow'));
  L.check('E3 repeated late answer -> same 409, no new write', late2.status === 409 && late2.json?.code === 'action_expired');
  const expired = L.actionEvents(s.sessionId).filter((e) => JSON.stringify(e.payload).includes('"expired"'));
  L.check('E3 exactly one expiry durable', expired.length === 1, expired.length);
}

// E4: cancellation still releases the Action and refuses the call.
{
  const s = await mk();
  fs.rmSync(`${ROOT}/e4.txt`, { force: true });
  await s.submit('[[e4]] cancel me');
  const a = await L.waitForAction(s.sessionId);
  const c = await s.cancel();
  L.check('E4 cancel -> 204', c.status === 204, c.status);
  await s.waitIdle(60_000);
  L.check('E4 cancelled call never ran', !fs.existsSync(`${ROOT}/e4.txt`));
  const cancelled = L.actionEvents(s.sessionId).filter((e) => JSON.stringify(e.payload).includes('"cancelled"'));
  L.check('E4 Action cancelled durably', cancelled.length === 1, cancelled.length);
  const late = await s.resolve(a.requestId, DECISION('allow'));
  L.check('E4 late answer -> 409 action_cancelled', late.status === 409 && late.json?.code === 'action_cancelled', `${late.status} ${JSON.stringify(late.json)}`);
}

// E5: a late answer queues its expiry write behind the Turn's own in-flight
// expiry write (held by a delaying Store proxy — a real slow Store write).
// The second write must resolve idempotently: one durable expiry, and the
// answer still reads 409 action_expired. Exercises the modified
// endHostedAction path end-to-end through the packaged Harness.
{
  const store = await L.startPassProxy(`http://127.0.0.1:${L.HTTP}`);
  const HOLD_MS = 10_000;
  let delayed = 0;
  const sessionId = await L.createWorkspaceSession('ws-a');
  const s = new L.HSession(h, sessionId, L.storeConnection(h, 'ws-a', store.url));
  const created = await s.create({ toolProfile: L.FILE_PROFILE, approvalMode: 'default', approvalTimeoutMs: 8_000 });
  L.check('E5 create via Store proxy -> 200', created.status === 200, created.status);
  fs.rmSync(`${ROOT}/e5.txt`, { force: true });
  await s.submit('[[e5]] race the turn expiry');
  const a = await L.waitForAction(s.sessionId);
  // Arm the hook only now: the next Session write is the Turn's own expiry,
  // due at options.expiresAt. The proxy holds it like a slow Store flush.
  store.state.hook = async (entry) => {
    if (delayed === 0 && entry.method === 'POST' && /journal|transaction/i.test(entry.url)) {
      delayed++;
      entry.status = `delayed-${HOLD_MS}ms`;
      await L.sleep(HOLD_MS);
    }
    return 'forward';
  };
  const t0 = Date.now();
  while (!delayed && Date.now() - t0 < 20_000) await L.sleep(50);
  L.check('E5 Store proxy held the Turn expiry write', delayed === 1, delayed);
  // Answer deterministically late: past expiresAt while the Turn's expiry
  // write is still held inside the authority's queue.
  const wait = a.options.expiresAt + 500 - Date.now();
  if (wait > 0) await L.sleep(wait);
  L.check('E5 answer is past the Action expiry', Date.now() >= a.options.expiresAt, `${Date.now() - a.options.expiresAt}ms late`);
  const late = await s.resolve(a.requestId, DECISION('allow'));
  L.check('E5 late answer behind held expiry -> 409 action_expired', late.status === 409 && late.json?.code === 'action_expired', `${late.status} ${JSON.stringify(late.json)}`);
  await s.waitIdle(60_000);
  const expired = L.actionEvents(s.sessionId).filter((e) => JSON.stringify(e.payload).includes('"expired"'));
  L.check('E5 exactly one expiry durable after the queue race', expired.length === 1, expired.map((e) => e.sequence));
  L.check('E5 expired call never ran', !fs.existsSync(`${ROOT}/e5.txt`));
  for (const e of store.ledger) L.say('ledger', `${e.method} ${e.url} -> ${e.status}`);
  await store.close();
}

// E6: a Harness killed mid-approval strands the Session; after the writer
// lease drains, reload refuses with hosted_turn_recovery_required — the
// recovery-blocked protection the design notes describe (Stage G territory).
{
  const s = await mk(h, { approvalTimeoutMs: 60_000 });
  fs.rmSync(`${ROOT}/e6.txt`, { force: true });
  await s.submit('[[e6]] kill mid-approval');
  const a = await L.waitForAction(s.sessionId);
  await h.stop('SIGKILL');
  await L.sleep(2_000);
  const h2 = await new L.Harness({ name: 'e2e2', modelUrl: model.baseUrl, brokerUrl: proxy.url }).start();
  process.on('exit', () => { try { h2.child?.kill('SIGKILL'); } catch {} });
  const s2 = new L.HSession(h2, s.sessionId, L.storeConnection(h2, 'ws-a'));
  const seen = [];
  let loaded = null;
  for (let i = 0; i < 40; i++) {
    loaded = await s2.load({ toolProfile: L.FILE_PROFILE });
    const code = loaded.json?.code ?? loaded.status;
    if (seen.at(-1) !== code) seen.push(code);
    if (loaded.status === 200 || code === 'hosted_turn_recovery_required') break;
    await L.sleep(3_000);
  }
  L.check('E6 lease held -> 503, then drained -> 409 recovery-blocked',
    seen[0] === 'managed_session_open_failed' && loaded.json?.code === 'hosted_turn_recovery_required',
    seen);
  L.check('E6 killed call never ran', !fs.existsSync(`${ROOT}/e6.txt`));
  const decided = L.actionEvents(s.sessionId).filter((e) => !JSON.stringify(e.payload).includes('"requested"'));
  L.check('E6 no outcome was recorded for the stranded Action', decided.length === 0, decided.length);
  await h2.stop();
}

await model.close?.();
await proxy.close();
L.exitSummary();
