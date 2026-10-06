// VERIFICATION RIG ONLY: S23c `[.][.]` passes the Hosted pattern gate; can it climb above the Session root?
import * as L from './lib.mjs';

const name = `s23c-root-climb-${L.ARM}`;
L.openLog(name);
const st = process.env.ST ?? 'a';
const ws = `ws-${st}`;
L.seedRegistry(ws, `st-${st}`);
const CASES = {
  up1: { pattern: '[.][.]/*' },
  upSibling: { pattern: '[.][.]/outside23/*.ts' },
  upSelf: { pattern: '[.][.]/w23/*.json' },
  upDeep: { pattern: '[.][.]/[.][.]/**/*' },
  viaLinkOut: { pattern: '[.][.]/[.][.]/outside23/*', path: 'lnk' },
  viaSrc: { pattern: '[.][.]/[.][.]/*', path: 'src' },
  readBack: { pattern: '[.][.]/*.json', path: 'src' },
};
const scripts = {};
for (const [k, args] of Object.entries(CASES)) scripts[k] = ({ round }) => (round === 0 ? { calls: [['glob', args]] } : { text: `DONE ${k}` });
const model = await L.startModel(scripts);
const proxy = await L.startBrokerProxy();
const h = await new L.Harness({ name: `s23c-${L.ARM}`, modelUrl: model.url, brokerUrl: proxy.url }).start();
try {
  const A = new L.HSession(h, await L.createWorkspaceSession(ws, 'w23'), L.storeConnection(h, ws));
  await A.create({ toolProfile: 'hosted-workspace-files/2' });
  for (const [k, args] of Object.entries(CASES)) {
    const t0 = Date.now();
    const r = await A.prompt(`[[S:${k}]] go`, 120_000);
    const prepared = L.ledgerSince(proxy.ledger, t0).filter((l) => /executions:prepare/.test(l)).length;
    const resp = L.toolResponses(r.events)[0]?.response ?? {};
    L.say(k, `${JSON.stringify(args.pattern)} -> prepared=${prepared} ${JSON.stringify(resp.output ?? resp.error ?? '').slice(0, 170)}`);
  }
} finally {
  await h.stop();
  await proxy.close();
  await model.close();
}
process.exitCode = L.done(name);
