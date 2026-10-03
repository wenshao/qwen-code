// VERIFICATION RIG ONLY: S17 the 4096-alternative glob budget at 62a1f9d3 — its edges, and two shapes the
// comma-counting scan does not count: a numeric range and groups nested inside one outer group.
// CASES picks the order; a wedging case should run last in its Workspace.
import fs from 'node:fs';
import * as L from './lib.mjs';

const name = `s17-budget-${L.ARM}-${process.env.TAG ?? 'x'}`;
L.openLog(name);
const st = process.env.ST ?? 'a';
fs.mkdirSync(`${L.ROOTS}/${st}/w/src`, { recursive: true });
fs.writeFileSync(`${L.ROOTS}/${st}/w/src/a.ts`, 'export {};\n');
L.seedRegistry(`ws-${st}`, `st-${st}`);
const ALL = {
  brace12: '{a,b}'.repeat(12) + '/*',
  brace13: '{a,b}'.repeat(13) + '/*',
  nestedSmall: '{{a,b}{a,b}{a,b},c}/*',
  range4000: '{1..4000}/*',
  range20000: '{1..20000}/*',
  nested14: '{' + '{a,b}'.repeat(14) + ',c}/*',
};
const order = (process.env.CASES ?? 'brace12,brace13,nestedSmall,range20000').split(',');
const scripts = {};
for (const k of order) scripts[k] = ({ round }) => (round === 0 ? { calls: [['glob', { pattern: ALL[k] }]] } : { text: `DONE ${k}` });
scripts.read = ({ round }) => (round === 0 ? { calls: [['read_file', { file_path: 'src/a.ts' }]] } : { text: 'DONE read' });
const model = await L.startModel(scripts);
const proxy = await L.startBrokerProxy();
const h = await new L.Harness({ name: `s17-${L.ARM}-${process.env.TAG ?? 'x'}`, modelUrl: model.url, brokerUrl: proxy.url }).start();
try {
  const A = new L.HSession(h, await L.createWorkspaceSession(`ws-${st}`, 'w'), L.storeConnection(h, `ws-${st}`));
  await A.create({ toolProfile: 'hosted-workspace-files/2' });
  for (const k of order) {
    const t0 = Date.now();
    const r = await A.prompt(`[[S:${k}]] go`, 900_000);
    const prepared = L.ledgerSince(proxy.ledger, t0).filter((l) => /executions:prepare/.test(l)).length;
    const unknown = L.ledgerSince(proxy.ledger, t0).filter((l) => /execution_unknown/.test(l)).length;
    const resp = L.toolResponses(r.events)[0]?.response ?? {};
    L.say(k, `${ALL[k].length} B ${JSON.stringify(ALL[k]).slice(0, 40)} -> ${L.summarizeTurn(r)} wall=${Date.now() - t0}ms prepared=${prepared} unknown409=${unknown} result=${JSON.stringify(resp.output ?? resp.error ?? '').slice(0, 150)}`);
    if (r.status2?.recoveryBlocked) {
      const next = await A.prompt('[[S:read]] go');
      L.say(`${k} next Turn`, L.summarizeTurn(next));
      L.say(`${k} lease`, JSON.stringify(L.holders().filter((x) => x[1] !== '<none>').map((x) => x[1].slice(0, 8))));
      L.say(`${k} harness log`, h.log().split('\n').filter((l) => /blocked/i.test(l)).map((l) => l.replace(/^.*qwen serve: /, '')).slice(-1)[0] ?? '<none>');
      break;
    }
  }
} finally {
  await h.stop();
  await proxy.close();
  await model.close();
}
process.exitCode = L.done(name);
