// VERIFICATION RIG ONLY: S10 ignore files — a git repository at the Workspace root with a root
// .gitignore, a Session pinned to services/api with its own .gitignore (R1-20 and the deferred
// "silent .gitignore filtering" probe).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import * as L from './lib.mjs';

const name = `s10-gitignore-${L.ARM}`;
L.openLog(name);
const st = process.env.ST ?? 'k';
const ws = `ws-${st}`;
const root = `${L.ROOTS}/${st}`;
const files = {
  '.gitignore': '*.log\nbuild/\n',
  'services/api/.gitignore': '.env\n',
  'services/api/.env': 'API_TOKEN=rig\n',
  'services/api/debug.log': 'log\n',
  'services/api/build/out.js': 'built\n',
  'services/api/src/a.ts': 'export {};\n',
};
for (const [f, c] of Object.entries(files)) {
  fs.mkdirSync(`${root}/${f}`.replace(/\/[^/]+$/, ''), { recursive: true });
  fs.writeFileSync(`${root}/${f}`, c);
}
if (!fs.existsSync(`${root}/.git`)) execFileSync('git', ['init', '-q', root]);
L.seedRegistry(ws, `st-${st}`);
const one = (call) => ({ round }) => (round === 0 ? { calls: [call] } : { text: 'DONE' });
const model = await L.startModel({
  all: one(['glob', { pattern: '**/*' }]),
  env: one(['glob', { pattern: '.env' }]),
  log: one(['glob', { pattern: '*.log' }]),
  readenv: one(['read_file', { file_path: '.env' }]),
});
const proxy = await L.startBrokerProxy();
const h = await new L.Harness({ name: `s10-${L.ARM}`, modelUrl: model.url, brokerUrl: proxy.url }).start();
try {
  const A = new L.HSession(h, await L.createWorkspaceSession(ws, 'services/api'), L.storeConnection(h, ws));
  L.say('create', (await A.create({ toolProfile: 'hosted-workspace-files/2' })).status);
  for (const k of ['all', 'env', 'log', 'readenv']) {
    const r = await A.prompt(`[[S:${k}]] go`);
    const resp = L.toolResponses(r.events)[0]?.response ?? {};
    L.say(k, `${L.summarizeTurn(r)} -> ${JSON.stringify(resp.output ?? resp.error).slice(0, 300)}`);
  }
} finally {
  await h.stop();
  await proxy.close();
  await model.close();
}
process.exitCode = L.done(name);
