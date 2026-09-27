// Confirms why other Sessions of ws-q/ws-r/ws-s fail after Q1-Q3: the Broker
// answers workspace_busy because the blocked Session still holds the storage.
import * as L from './lib.mjs';
import { fakeToolCall, startFakeOpenAIServer } from '../wt-pr/integration-tests/fake-openai-server.ts';
const HTTP = 18833;
L.openLog('s7b-busy-confirm');
const model = await startFakeOpenAIServer(async ({ body }) => {
  const m = body['messages'] as Array<{ role: string }>;
  return m.at(-1)?.role === 'tool' ? { content: 'done' } : { toolCalls: [fakeToolCall('write_file', { file_path: 'late.txt', content: 'x' })] };
});
const proxy = await L.startBrokerProxy('http://127.0.0.1:19833');
const h = await new L.Harness({ name: 'r2-confirm', modelUrl: model.baseUrl, brokerUrl: proxy.url }).start();
try {
  for (const st of ['q', 'r', 's']) {
    const s = new L.HSession(h, await L.createWorkspaceSession(HTTP, `ws-${st}`), L.storeConnection(h, `ws-${st}`, HTTP));
    await s.create();
    const t0 = Date.now();
    const r = await s.prompt('write late.txt');
    L.say(`ws-${st}`, `${L.summarizeTurn(r)} | ${L.ledgerSince(proxy.ledger, t0).join('; ')}`);
  }
  L.say('holders', JSON.stringify(L.holders('rig3').filter((r) => r[1] !== '<none>').map((r) => r[1].slice(0, 8))));
} finally {
  await h.stop();
  await proxy.close();
  await model.close();
}
