// VERIFICATION RIG ONLY: smoke — one /2 Session, one glob call.
import fs from 'node:fs';
import * as L from './lib.mjs';

L.openLog('s0-smoke');
const model = await L.startModel({
  g: ({ round, results }) => (round === 0 ? { calls: [['glob', { pattern: '**/*' }]] } : { text: `DONE ${JSON.stringify(results)}` }),
});
const proxy = await L.startBrokerProxy();
const h = await new L.Harness({ name: 'smoke', modelUrl: model.url, brokerUrl: proxy.url }).start();
try {
  const root = `${L.ROOTS}/a`;
  for (const d of ['services/api/src', 'services/web']) fs.mkdirSync(`${root}/${d}`, { recursive: true });
  fs.writeFileSync(`${root}/services/api/src/index.ts`, 'export const x = 1;\n');
  fs.writeFileSync(`${root}/services/web/secret.txt`, 'sibling secret\n');
  L.seedRegistry('ws-a', 'st-a');
  const id = await L.createWorkspaceSession('ws-a', 'services/api');
  L.say('session', id);
  const s = new L.HSession(h, id, L.storeConnection(h, 'ws-a'));
  const c = await s.create({ toolProfile: 'hosted-workspace-files/2' });
  L.say('create', `${c.status} ${JSON.stringify(c.json).slice(0, 300)}`);
  const r = await s.prompt('[[S:g]] find files');
  L.say('turn', L.summarizeTurn(r));
  for (const t of L.toolTrace(r.events, 400)) L.say('trace', t);
  L.say('tools', JSON.stringify(model.requests.map((q) => q.tools)));
  L.say('model saw', JSON.stringify(model.requests.at(-1)?.results));
  L.say('broker', L.ledgerSince(proxy.ledger, 0).join(' | '));
  L.say('holders', JSON.stringify(L.holders()));
} finally {
  await h.stop();
  await proxy.close();
  await model.close();
}
