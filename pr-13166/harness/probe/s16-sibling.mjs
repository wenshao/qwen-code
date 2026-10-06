// VERIFICATION RIG ONLY: S16 the R4-2 boundary on the real topology. Session B (services/web) is a real,
// active Hosted Session; Session A (services/api) holds peek -> ../web and a workspace-package link
// node_modules/@acme/ui -> ../../../../libs/ui (inside the mount, not a Session).
import fs from 'node:fs';
import * as L from './lib.mjs';

const PROFILE = process.env.PROFILE ?? 'hosted-workspace-files/2';
const name = `s16-sibling-${L.ARM}-${PROFILE.endsWith('/2') ? 'v2' : 'v1'}`;
L.openLog(name);
const st = process.env.ST ?? 'd';
const ws = `ws-${st}`;
const root = `${L.ROOTS}/${st}`;
for (const d of ['services/api/src', 'services/web', 'libs/ui/src', 'services/api/node_modules/@acme']) fs.mkdirSync(`${root}/${d}`, { recursive: true });
fs.writeFileSync(`${root}/services/api/src/index.ts`, 'export const api = 1;\n');
fs.writeFileSync(`${root}/services/web/secret.txt`, 'SIBLING_SECRET\n');
fs.writeFileSync(`${root}/libs/ui/src/index.ts`, "export const Button = 'ui-source';\n");
for (const [l, t] of [['services/api/peek', '../web'], ['services/api/node_modules/@acme/ui', '../../../../libs/ui']]) {
  fs.rmSync(`${root}/${l}`, { force: true });
  fs.symlinkSync(t, `${root}/${l}`);
}
fs.rmSync(`${root}/services/web/pwn.txt`, { force: true });
L.seedRegistry(ws, `st-${st}`);
const CASES = {
  readSibling: ['read_file', { file_path: 'peek/secret.txt' }],
  readDep: ['read_file', { file_path: 'node_modules/@acme/ui/src/index.ts' }],
  writeSibling: ['write_file', { file_path: 'peek/pwn.txt', content: 'PWN\n' }],
  ...(PROFILE.endsWith('/2')
    ? { globLinkPath: ['glob', { pattern: '*', path: 'peek' }], globThroughLink: ['glob', { pattern: 'peek/**/*' }], globAll: ['glob', { pattern: '**/*' }] }
    : {}),
};
const scripts = { warmB: ({ round }) => (round === 0 ? { calls: [['read_file', { file_path: 'secret.txt' }]] } : { text: 'DONE B' }) };
for (const [k, call] of Object.entries(CASES)) scripts[k] = ({ round }) => (round === 0 ? { calls: [call] } : { text: `DONE ${k}` });
const model = await L.startModel(scripts);
const proxy = await L.startBrokerProxy();
const h = await new L.Harness({ name: `s16-${L.ARM}`, modelUrl: model.url, brokerUrl: proxy.url }).start();
try {
  const B = new L.HSession(h, await L.createWorkspaceSession(ws, 'services/web'), L.storeConnection(h, ws));
  await B.create({ toolProfile: PROFILE });
  const rb = await B.prompt('[[S:warmB]] go');
  L.say('Session B (services/web) active', `${L.summarizeTurn(rb)} -> ${JSON.stringify(L.toolResponses(rb.events)[0]?.response ?? {}).slice(0, 80)}`);
  const A = new L.HSession(h, await L.createWorkspaceSession(ws, 'services/api'), L.storeConnection(h, ws));
  await A.create({ toolProfile: PROFILE });
  for (const k of Object.keys(CASES)) {
    const r = await A.prompt(`[[S:${k}]] go`);
    L.say(k, `${JSON.stringify(CASES[k])} -> ${L.summarizeTurn(r)} ${JSON.stringify(L.toolResponses(r.events)[0]?.response ?? {}).slice(0, 220)}`);
  }
  L.say('fs', `services/web/pwn.txt exists: ${fs.existsSync(`${root}/services/web/pwn.txt`)}`);
  const bindings = L.sql(`SELECT LEFT(b.binding_id,8), b.isolation_class, SUBSTRING_INDEX(b.runtime_endpoint,':',-1) FROM qwen_runtime_binding b WHERE b.workspace_id='${ws}'`);
  L.say('runtime bindings in this Workspace', JSON.stringify(bindings));
} finally {
  await h.stop();
  await proxy.close();
  await model.close();
}
process.exitCode = L.done(name);
