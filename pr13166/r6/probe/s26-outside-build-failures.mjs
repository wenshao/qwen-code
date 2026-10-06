// VERIFICATION RIG ONLY: S26 R10-1 through the Hosted Harness — out-of-Session targets reached through an
// inward-looking link (`peek → ../web`) whose tool build()/validation fails. Does the answer name the
// sibling's real directory (`web`) or the Runtime host path, or the sanitized boundary refusal?
import fs from 'node:fs';
import * as L from './lib.mjs';

const name = `s26-outside-build-${L.ARM}`;
L.openLog(name);
const st = process.env.ST ?? 'e';
const ws = `ws-${st}`;
const top = `${L.ROOTS}/${st}`;
const api = `${top}/services/api`;
for (const d of ['services/api/src', 'services/web']) fs.mkdirSync(`${top}/${d}`, { recursive: true });
fs.writeFileSync(`${api}/src/index.ts`, 'export {};\n');
fs.writeFileSync(`${top}/services/web/secret.txt`, 'SIBLING_SECRET\n');
fs.rmSync(`${api}/peek`, { force: true });
fs.symlinkSync('../web', `${api}/peek`);
const realTop = fs.realpathSync(top);
L.seedRegistry(ws, `st-${st}`);
const CASES = {
  gMissing: ['glob', { pattern: '*', path: 'peek/nope' }],
  gFile: ['glob', { pattern: '*', path: 'peek/secret.txt' }],
  gDir: ['glob', { pattern: '*', path: 'peek' }],
  rMissing: ['read_file', { file_path: 'peek/nope.txt' }],
  rDir: ['read_file', { file_path: 'peek' }],
  rFile: ['read_file', { file_path: 'peek/secret.txt' }],
  rMissingInside: ['read_file', { file_path: 'src/nope.ts' }],
};
const scripts = {};
for (const [k, call] of Object.entries(CASES)) scripts[k] = ({ round }) => (round === 0 ? { calls: [call] } : { text: `DONE ${k}` });
const model = await L.startModel(scripts);
const proxy = await L.startBrokerProxy();
const h = await new L.Harness({ name: `s26-${L.ARM}`, modelUrl: model.url, brokerUrl: proxy.url }).start();
try {
  const A = new L.HSession(h, await L.createWorkspaceSession(ws, 'services/api'), L.storeConnection(h, ws));
  await A.create({ toolProfile: 'hosted-workspace-files/2' });
  for (const [k, call] of Object.entries(CASES)) {
    const t0 = Date.now();
    const r = await A.prompt(`[[S:${k}]] go`, 120_000);
    const prepared = L.ledgerSince(proxy.ledger, t0).filter((l) => /executions:prepare/.test(l)).length;
    const text = JSON.stringify(L.toolResponses(r.events)[0]?.response ?? {});
    const host = text.includes(realTop) || text.includes(top);
    const sibling = /(^|[^a-z])web([^a-z]|$)/.test(text.split(realTop).join('').split(top).join(''));
    L.say(k, `${call[0]} ${JSON.stringify(call[1].path ?? call[1].file_path)} -> prepared=${prepared} hostPath=${host} namesWeb=${sibling} ${text.split(realTop).join('<HOST>').split(top).join('<HOST>').slice(0, 220)}`);
  }
  await A.detach();
} finally {
  await h.stop();
  await proxy.close();
  await model.close();
}
process.exitCode = L.done(name);
