// VERIFICATION RIG ONLY: S19 round-4 head checks — the new brace gate's edges, glob pattern shapes the gate
// does not cover (extglob / wildcard backtracking), escaped file_path spellings (R6-1) through the Harness,
// and the file-tool resolution errors (R4-10). CASES picks the order; a wedging case should run last.
import fs from 'node:fs';
import * as L from './lib.mjs';

const name = `s19-r4-${L.ARM}-${process.env.TAG ?? 'x'}`;
L.openLog(name);
const st = process.env.ST ?? 'a';
const ws = `ws-${st}`;
const root = `${L.ROOTS}/${st}`;
for (const d of ['services/api/src', 'services/web']) fs.mkdirSync(`${root}/${d}`, { recursive: true });
fs.writeFileSync(`${root}/services/api/src/index.ts`, 'export {};\n');
fs.writeFileSync(`${root}/services/api/package-lock.json`, '{}\n');
fs.writeFileSync(`${root}/services/api/package.json`, '{"name":"api"}\n');
fs.writeFileSync(`${root}/services/api/a-b-c-d-e-f-g-h-i-j-k-l-m-n-o.ts`, 'export {};\n');
fs.writeFileSync(`${root}/services/web/secret.txt`, 'SIBLING_SECRET\n');
fs.rmSync(`${root}/services/api/peek`, { force: true });
fs.symlinkSync('../web', `${root}/services/api/peek`);
fs.rmSync(`${root}/services/api/loop`, { force: true });
fs.symlinkSync('loop', `${root}/services/api/loop`);
const realRoot = fs.realpathSync(root);
L.seedRegistry(ws, `st-${st}`);
const G = (pattern) => ['glob', { pattern }];
const ALL = {
  brace6: G('{a,b}'.repeat(6) + '/*'),
  brace7: G('{a,b}'.repeat(7) + '/*'),
  range64: G('{1..64}/*'),
  range65: G('{1..65}/*'),
  range20000: G('{1..20000}/*'),
  nested14: G('{' + '{a,b}'.repeat(14) + ',c}/*'),
  legit: G('**/*.{ts,tsx,js,jsx,json,md}'),
  escRead: ['read_file', { file_path: 'pe\\ek/secret.txt' }],
  escRead2: ['read_file', { file_path: 'peek/secret\\.txt' }],
  enotdir: ['read_file', { file_path: 'package.json/main' }],
  eloop: ['read_file', { file_path: 'loop/x' }],
  star10: G('*?'.repeat(10) + 'Z'),
  extglob3: G('+(?|?|?)Z'),
  star20: G('*?'.repeat(20) + 'Z'),
  extglob2: G('+(?|?)Z'),
  legitDash: G('src/**/*-*.ts'),
  legitClass: G('**/[a-z]*.json'),
};
const order = (process.env.CASES ?? Object.keys(ALL).join(',')).split(',');
const scripts = {};
for (const k of order) scripts[k] = ({ round }) => (round === 0 ? { calls: [ALL[k]] } : { text: `DONE ${k}` });
scripts.read = ({ round }) => (round === 0 ? { calls: [['read_file', { file_path: 'src/index.ts' }]] } : { text: 'DONE read' });
const model = await L.startModel(scripts);
const proxy = await L.startBrokerProxy();
const h = await new L.Harness({ name: `s19-${L.ARM}-${process.env.TAG ?? 'x'}`, modelUrl: model.url, brokerUrl: proxy.url }).start();
try {
  const A = new L.HSession(h, await L.createWorkspaceSession(ws, 'services/api'), L.storeConnection(h, ws));
  await A.create({ toolProfile: 'hosted-workspace-files/2' });
  for (const k of order) {
    const t0 = Date.now();
    const r = await A.prompt(`[[S:${k}]] go`, 900_000);
    const ledger = L.ledgerSince(proxy.ledger, t0);
    const prepared = ledger.filter((l) => /executions:prepare/.test(l)).length;
    const unknown = ledger.filter((l) => /execution_unknown/.test(l)).length;
    const resp = L.toolResponses(r.events)[0]?.response ?? {};
    const text = JSON.stringify(resp.output ?? resp.error ?? '');
    L.say(k, `${JSON.stringify(ALL[k][1]).slice(0, 60)} -> ${L.summarizeTurn(r)} wall=${Date.now() - t0}ms prepared=${prepared} unknown409=${unknown} hostPath=${JSON.stringify(resp).includes(realRoot)} result=${text.slice(0, 170)}`);
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
