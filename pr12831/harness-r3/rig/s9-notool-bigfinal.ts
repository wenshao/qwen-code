// Control for Q4: a 90 KB final answer on the default no-tool Hosted path.
import * as L from './lib.mjs';
import { startFakeOpenAIServer } from '../wt-pr/integration-tests/fake-openai-server.ts';
L.openLog(`s9-notool-bigfinal-${process.env.ARM ?? 'r2'}`);
const model = await startFakeOpenAIServer(async () => ({ content: '终'.repeat(30_000) }));
const h = await new L.Harness({ name: 'notool-big', modelUrl: model.baseUrl }).start();
try {
  const id = await L.createWorkspaceSession(18833, 'ws-r4j').catch(async () => {
    L.seedRegistry('rig3', 'ws-r4j', 'st-r4j');
    return L.createWorkspaceSession(18833, 'ws-r4j');
  });
  const s = new L.HSession(h, id, L.storeConnection(h, 'ws-r4j', 18833));
  L.say('create (no toolProfile)', (await s.create({})).status);
  const r = await s.prompt('write me a long answer');
  L.say('turn', L.summarizeTurn(r));
  L.say('harness', h.log().split('\n').filter((l) => /failed:|recovery blocked/.test(l)).map((l) => l.replace(/^.*qwen serve: /, '')).join(' || ') || '<none>');
} finally {
  await h.stop();
  await model.close();
}
