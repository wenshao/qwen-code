// Gates: base baseline, startup validation, profile admission, and the default
// no-tool path on a Broker-enabled Harness (zero Broker traffic).
import * as L from './lib.mjs';
import { fakeToolCall, startFakeOpenAIServer } from '../wt-pr/integration-tests/fake-openai-server.ts';

const DB = 'rig1';
L.openLog('s5-gates');
const model = await startFakeOpenAIServer(async ({ body }) => {
  const text = JSON.stringify(body['messages']);
  if (text.includes('[[SHELL]]')) return { toolCalls: [fakeToolCall('run_shell_command', { command: 'touch refused-shell' })] };
  if (text.includes('[[WRITE]]')) return { toolCalls: [fakeToolCall('write_file', { file_path: 'nt.txt', content: 'x' })] };
  return { content: 'plain text answer' };
});
const proxy = await L.startBrokerProxy('http://127.0.0.1:19831');

try {
  // 1) Base (daaac2223) with Broker flags: refused at startup.
  process.env.ARM = 'base';
  const base = new L.Harness({ name: 'gate-base', modelUrl: model.baseUrl, brokerUrl: proxy.url });
  try {
    await base.start();
    L.say('base+broker', 'started (unexpected)');
    await base.stop();
  } catch (e) {
    L.say('base+broker', String((e as Error).message).match(/Error: [^\n]*/)?.[0] ?? String(e).slice(0, 200));
  }
  process.env.ARM = 'pr';

  // 2) PR Harness without Broker: toolProfile is refused.
  const plain = await new L.Harness({ name: 'gate-plain', modelUrl: model.baseUrl }).start();
  if (L.sql(DB, "SELECT COUNT(*) FROM managed_workspace_registry WHERE workspace_id='ws-p'")[0][0] === '0') L.seedRegistry(DB, 'ws-p', 'st-p');
  const sid = await L.createWorkspaceSession(18831, 'ws-p');
  const s0 = new L.HSession(plain, sid, L.storeConnection(plain, 'ws-p', 18831));
  const r0 = await s0.create();
  L.say('no-broker + toolProfile', `${r0.status} ${JSON.stringify(r0.json)}`);
  await plain.stop();

  // 3) PR Harness with Broker.
  const h = await new L.Harness({ name: 'gate-broker', modelUrl: model.baseUrl, brokerUrl: proxy.url }).start();
  const sid2 = await L.createWorkspaceSession(18831, 'ws-p');
  const s2 = new L.HSession(h, sid2, L.storeConnection(h, 'ws-p', 18831));
  const bad = await s2.create({ toolProfile: 'hosted-workspace-files/2' });
  L.say('unknown profile', `${bad.status} ${JSON.stringify(bad.json)}`);

  // 4) Default no-tool Session on the Broker-enabled Harness.
  const sid3 = await L.createWorkspaceSession(18831, 'ws-p');
  const s3 = new L.HSession(h, sid3, L.storeConnection(h, 'ws-p', 18831));
  L.say('no-tool create', (await s3.create({})).status);
  const t0 = Date.now();
  const a = await s3.prompt('hello [[TEXT]]');
  L.say('no-tool text', L.summarizeTurn(a));
  const b = await s3.prompt('[[WRITE]]');
  L.say('no-tool tool call', L.summarizeTurn(b));
  L.say('no-tool log', h.log().split('\n').filter((l) => l.includes('failed')).slice(-1)[0]?.replace(/^.*qwen serve: /, ''));
  L.say('no-tool broker traffic', JSON.stringify(L.ledgerSince(proxy.ledger, t0)));
  await s3.detach();
  const lp = await s3.load({ toolProfile: L.PROFILE });
  L.say('no-tool session loaded with toolProfile', `${lp.status} ${JSON.stringify(lp.json)}`);
  await h.stop();
} finally {
  await proxy.close();
  await model.close();
}
