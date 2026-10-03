// VERIFICATION RIG ONLY: S11 round-2 delta at the Harness — R2-3 (trim before judging the pattern),
// R4-11 (path: null is the omitted case), R4-9 (stray file_path on a glob call). ARM picks the Harness.
import fs from 'node:fs';
import * as L from './lib.mjs';

const name = `s11-delta-${L.ARM}`;
L.openLog(name);
const st = process.env.ST ?? 'd';
const ws = `ws-${st}`;
const root = `${L.ROOTS}/${st}`;
for (const d of ['services/api/src', 'services/web']) fs.mkdirSync(`${root}/${d}`, { recursive: true });
fs.writeFileSync(`${root}/services/api/src/index.ts`, 'export const api = 1;\n');
fs.writeFileSync(`${root}/services/api/package.json`, '{"name":"api"}\n');
fs.writeFileSync(`${root}/services/web/secret.txt`, 'SIBLING_SECRET\n');
fs.rmSync(`${root}/services/api/peek`, { force: true });
fs.symlinkSync('../web', `${root}/services/api/peek`);
L.seedRegistry(ws, `st-${st}`);
const CASES = {
  wsDotdot: [['glob', { pattern: ' ../**/*' }]],
  tabAbs: [['glob', { pattern: '\t/etc/host*' }]],
  nullPathBatch: [['glob', { pattern: '*.json', path: null }], ['read_file', { file_path: 'package.json' }]],
  strayFileInside: [['glob', { pattern: '*.ts', path: 'src', file_path: 'src/index.ts' }]],
  strayFileThroughLink: [['glob', { pattern: '*.ts', path: 'src', file_path: 'peek/secret.txt' }]],
};
const scripts = {};
for (const [k, calls] of Object.entries(CASES)) scripts[k] = ({ round }) => (round === 0 ? { calls } : { text: `DONE ${k}` });
const model = await L.startModel(scripts);
const proxy = await L.startBrokerProxy();
const h = await new L.Harness({ name: `s11-${L.ARM}`, modelUrl: model.url, brokerUrl: proxy.url }).start();
try {
  const A = new L.HSession(h, await L.createWorkspaceSession(ws, 'services/api'), L.storeConnection(h, ws));
  L.say('create', (await A.create({ toolProfile: 'hosted-workspace-files/2' })).status);
  for (const k of Object.keys(CASES)) {
    const t0 = Date.now();
    const r = await A.prompt(`[[S:${k}]] go`);
    const prepared = L.ledgerSince(proxy.ledger, t0).filter((l) => /executions:prepare/.test(l)).length;
    L.say(k, `${JSON.stringify(CASES[k])} -> ${L.summarizeTurn(r)} prepared=${prepared}`);
    for (const x of L.toolResponses(r.events)) L.say(`${k} result`, `${x.name}: ${JSON.stringify(x.response).slice(0, 260)}`);
  }
} finally {
  await h.stop();
  await proxy.close();
  await model.close();
}
process.exitCode = L.done(name);
