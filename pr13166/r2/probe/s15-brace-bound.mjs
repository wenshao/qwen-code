// VERIFICATION RIG ONLY: S15 the candidate brace bound on the real stack — the over-wide patterns that
// wedged head2 are refused before acquisition, and a pattern at the bound still runs.
import fs from 'node:fs';
import * as L from './lib.mjs';

const name = `s15-brace-bound-${L.ARM}`;
L.openLog(name);
const st = process.env.ST ?? 'a';
fs.mkdirSync(`${L.ROOTS}/${st}/w/src`, { recursive: true });
fs.writeFileSync(`${L.ROOTS}/${st}/w/src/a.ts`, 'export {};\n');
L.seedRegistry(`ws-${st}`, `st-${st}`);
const CASES = {
  brace10: '{a,b}'.repeat(10) + '/*',
  brace14: '{a,b}'.repeat(14) + '/*',
  range20000: '{1..20000}/*',
  normal: '**/*.ts',
};
const scripts = {};
for (const [k, pattern] of Object.entries(CASES)) scripts[k] = ({ round }) => (round === 0 ? { calls: [['glob', { pattern }]] } : { text: `DONE ${k}` });
const model = await L.startModel(scripts);
const proxy = await L.startBrokerProxy();
const h = await new L.Harness({ name: `s15-${L.ARM}`, modelUrl: model.url, brokerUrl: proxy.url }).start();
try {
  const A = new L.HSession(h, await L.createWorkspaceSession(`ws-${st}`, 'w'), L.storeConnection(h, `ws-${st}`));
  await A.create({ toolProfile: 'hosted-workspace-files/2' });
  for (const k of Object.keys(CASES)) {
    const t0 = Date.now();
    const r = await A.prompt(`[[S:${k}]] go`, 300_000);
    const prepared = L.ledgerSince(proxy.ledger, t0).filter((l) => /executions:prepare/.test(l)).length;
    const resp = L.toolResponses(r.events)[0]?.response ?? {};
    L.say(k, `${CASES[k].length} B -> ${L.summarizeTurn(r)} prepared=${prepared} result=${JSON.stringify(resp.output ?? resp.error ?? '').slice(0, 170)}`);
    if (k !== 'brace10' && k !== 'normal') L.check(`${k}: refused before acquisition, Session usable`, prepared === 0 && r.status2?.recoveryBlocked === false, `prepared=${prepared}`);
    else L.check(`${k}: runs`, r.terminal?.[0]?.type === 'turn_complete' && resp.executionStatus === 'success', `${r.ms}ms`);
  }
  L.check('Workspace lease free afterwards', L.holders().every((x) => x[1] === '<none>'), JSON.stringify(L.holders().filter((x) => x[1] !== '<none>')));
} finally {
  await h.stop();
  await proxy.close();
  await model.close();
}
process.exitCode = L.done(name);
