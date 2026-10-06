// VERIFICATION RIG ONLY: S25 round-6 (0d6a6307) R10-1 / R11-2 through the Hosted Harness.
// R10-1: a file tool whose build() fails (target is a directory) — does the answer or the durable
// record carry the Runtime host path, for in-Session, linked-sibling and root-bound targets?
// R11-2: a glob `path` whose raw spelling and unescaped spelling name different directories.
import fs from 'node:fs';
import * as L from './lib.mjs';

const name = `s25-build-errors-${L.ARM}`;
L.openLog(name);
const st = process.env.ST ?? 'a';
const ws = `ws-${st}`;
const top = `${L.ROOTS}/${st}`;
const api = `${top}/services/api`;
for (const d of ['services/api/src', 'services/api/shared\\ notes', 'services/web', 'outside25']) fs.mkdirSync(`${top}/${d}`, { recursive: true });
fs.writeFileSync(`${api}/src/index.ts`, 'export {};\n');
fs.writeFileSync(`${api}/shared\\ notes/inside.md`, 'INSIDE\n');
fs.writeFileSync(`${top}/services/web/secret.txt`, 'SIBLING_SECRET\n');
fs.writeFileSync(`${top}/outside25/leak.md`, 'OUTSIDE\n');
for (const [link, target] of [[`${api}/peek`, '../web'], [`${api}/shared notes`, '../../outside25']]) {
  fs.rmSync(link, { force: true });
  fs.symlinkSync(target, link);
}
const realTop = fs.realpathSync(top);
L.seedRegistry(ws, `st-${st}`);
const CASES = {
  wDir: ['write_file', { file_path: 'src', content: 'x' }],
  eDir: ['edit', { file_path: 'src', old_string: 'a', new_string: 'b' }],
  rDir: ['read_file', { file_path: 'src' }],
  wLinkDir: ['write_file', { file_path: 'peek', content: 'x' }],
  wViaLink: ['write_file', { file_path: 'peek/new.txt', content: 'x' }],
  gBackslash: ['glob', { pattern: '*', path: 'shared\\ notes' }],
  gSpace: ['glob', { pattern: '*', path: 'shared notes' }],
};
const ROOT_CASES = {
  rootWDir: ['write_file', { file_path: 'services/web', content: 'x' }],
  rootEDir: ['edit', { file_path: 'services/web', old_string: 'a', new_string: 'b' }],
};
const scripts = {};
for (const [k, call] of Object.entries({ ...CASES, ...ROOT_CASES })) scripts[k] = ({ round }) => (round === 0 ? { calls: [call] } : { text: `DONE ${k}` });
const model = await L.startModel(scripts);
const proxy = await L.startBrokerProxy();
const h = await new L.Harness({ name: `s25-${L.ARM}`, modelUrl: model.url, brokerUrl: proxy.url }).start();
const hostPaths = [realTop, top, L.RUN].map((p) => p.replace(/\/$/, ''));
const leaks = (text) => hostPaths.filter((p) => text.includes(p)).length > 0;
const run = async (A, cases) => {
  for (const [k, call] of Object.entries(cases)) {
    const t0 = Date.now();
    const r = await A.prompt(`[[S:${k}]] go`, 120_000);
    const prepared = L.ledgerSince(proxy.ledger, t0).filter((l) => /executions:prepare/.test(l)).length;
    const resp = L.toolResponses(r.events)[0]?.response ?? {};
    const text = JSON.stringify(resp);
    const shown = text.split(realTop).join('<HOST>').split(top).join('<HOST>');
    L.say(k, `${call[0]} ${JSON.stringify(call[1].file_path ?? call[1].path)} -> ${L.summarizeTurn(r)} prepared=${prepared} hostPath=${leaks(text)} ${shown.slice(0, 230)}`);
  }
};
try {
  const A = new L.HSession(h, await L.createWorkspaceSession(ws, 'services/api'), L.storeConnection(h, ws));
  await A.create({ toolProfile: 'hosted-workspace-files/2' });
  await run(A, CASES);
  await A.detach();
  const R = new L.HSession(h, await L.createWorkspaceSession(ws, '.'), L.storeConnection(h, ws));
  await R.create({ toolProfile: 'hosted-workspace-files/2' });
  await run(R, ROOT_CASES);
  await R.detach();
  L.say('model saw host path', String(model.requests.some((q) => leaks(JSON.stringify(q.messages)))));
  for (const p of [realTop, top]) L.say(`db rows containing ${p === realTop ? 'realpath' : 'lexical'} host root`, JSON.stringify(L.dbScan(p)));
  L.say('web dir untouched', JSON.stringify(fs.readdirSync(`${top}/services/web`)));
} finally {
  await h.stop();
  await proxy.close();
  await model.close();
}
process.exitCode = L.done(name);
