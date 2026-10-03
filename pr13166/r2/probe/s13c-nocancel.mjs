// VERIFICATION RIG ONLY: S13c the same 72-byte brace14 glob without a cancel, in an idle Workspace.
import fs from 'node:fs';
import * as L from './lib.mjs';

const name = `s13c-nocancel-${L.ARM}`;
L.openLog(name);
const st = process.env.ST ?? 'l';
fs.mkdirSync(`${L.ROOTS}/${st}/w/src`, { recursive: true });
fs.writeFileSync(`${L.ROOTS}/${st}/w/src/a.ts`, 'export {};\n');
L.seedRegistry(`ws-${st}`, `st-${st}`);
const model = await L.startModel({
  brace14: ({ round }) => (round === 0 ? { calls: [['glob', { pattern: '{a,b}'.repeat(14) + '/*' }]] } : { text: 'DONE brace14' }),
  read: ({ round }) => (round === 0 ? { calls: [['read_file', { file_path: 'src/a.ts' }]] } : { text: 'DONE read' }),
});
const proxy = await L.startBrokerProxy();
const h = await new L.Harness({ name: `s13c-${L.ARM}`, modelUrl: model.url, brokerUrl: proxy.url }).start();
try {
  const A = new L.HSession(h, await L.createWorkspaceSession(`ws-${st}`, 'w'), L.storeConnection(h, `ws-${st}`));
  await A.create({ toolProfile: 'hosted-workspace-files/2' });
  const t0 = Date.now();
  const r = await A.prompt('[[S:brace14]] go', 900_000);
  const resp = L.toolResponses(r.events)[0]?.response ?? {};
  L.say('A brace14, no cancel', `${L.summarizeTurn(r)} wall=${Date.now() - t0}ms result=${JSON.stringify(resp.output ?? resp.error ?? '').slice(0, 160)}`);
  L.say('broker', L.ledgerSince(proxy.ledger, t0).map((l) => l.replace(/[0-9a-f-]{36}/g, ':id')).join(' | '));
  const r2 = await A.prompt('[[S:read]] go');
  L.say('A next Turn', L.summarizeTurn(r2));
  L.say('lease', JSON.stringify(L.holders().filter((x) => x[1] !== '<none>').map((x) => x[1].slice(0, 8))));
  L.say('harness log', h.log().split('\n').filter((l) => /blocked|failed|recovery|timeout/i.test(l)).map((l) => l.replace(/^.*qwen serve: /, '')).join(' || ').slice(0, 600) || '<none>');
} finally {
  await h.stop();
  await proxy.close();
  await model.close();
}
process.exitCode = L.done(name);
