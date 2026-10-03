// VERIFICATION RIG ONLY: S12 inputs for the round-4 items left to the maintainer.
// Monorepo Workspace: packages/cli (the Session) + packages/ui, with the workspace-package link
// packages/cli/node_modules/@acme/ui -> ../../../ui and a root .gitignore that ignores node_modules.
// PROFILE=hosted-workspace-files/1 for the R4-2 / R3-1 / R4-10 A/B (main vs head2), /2 adds the glob cases.
import fs from 'node:fs';
import * as L from './lib.mjs';

const PROFILE = process.env.PROFILE ?? 'hosted-workspace-files/1';
const name = `s12-maintainer-${L.ARM}-${PROFILE.endsWith('/2') ? 'v2' : 'v1'}${process.env.NOLOOP ? '-noloop' : ''}`;
L.openLog(name);
const st = process.env.ST ?? 'f';
const ws = `ws-${st}`;
const root = `${L.ROOTS}/${st}`;
const files = {
  '.gitignore': 'node_modules/\n',
  'packages/cli/package.json': '{"name":"@acme/cli","dependencies":{"@acme/ui":"workspace:*"}}\n',
  'packages/cli/src/main.ts': "import { Button } from '@acme/ui';\nexport const main = Button;\n",
  'packages/ui/package.json': '{"name":"@acme/ui","main":"src/index.ts"}\n',
  'packages/ui/src/index.ts': "export const Button = 'ui-source';\n",
};
for (const [f, c] of Object.entries(files)) {
  fs.mkdirSync(`${root}/${f}`.replace(/\/[^/]+$/, ''), { recursive: true });
  fs.writeFileSync(`${root}/${f}`, c);
}
fs.mkdirSync(`${root}/packages/cli/node_modules/@acme`, { recursive: true });
fs.rmSync(`${root}/packages/cli/node_modules/@acme/ui`, { force: true });
fs.symlinkSync('../../../ui', `${root}/packages/cli/node_modules/@acme/ui`);
fs.rmSync(`${root}/packages/ui/src/created-by-cli.ts`, { force: true });
fs.rmSync(`${root}/packages/cli/loop`, { force: true });
if (!process.env.NOLOOP) fs.symlinkSync('loop', `${root}/packages/cli/loop`);
const realRoot = fs.realpathSync(root);
L.seedRegistry(ws, `st-${st}`);
const DEP = 'node_modules/@acme/ui/src/index.ts';
const CASES = {
  readDep: ['read_file', { file_path: DEP }],
  editDep: ['edit', { file_path: DEP, old_string: 'ui-source', new_string: 'edited-from-cli' }],
  writeNewThroughDep: ['write_file', { file_path: 'node_modules/@acme/ui/src/created-by-cli.ts', content: 'export {};\n' }],
  readThroughFile: ['read_file', { file_path: 'package.json/main' }],
  readLoop: ['read_file', { file_path: 'loop/x' }],
  readMissing: ['read_file', { file_path: 'src/nope.ts' }],
  ...(PROFILE.endsWith('/2')
    ? { globAll: ['glob', { pattern: '**/*' }], globTs: ['glob', { pattern: '**/*.ts' }], globSrc: ['glob', { pattern: '**/*', path: 'src' }] }
    : {}),
};
const scripts = {};
for (const [k, call] of Object.entries(CASES)) scripts[k] = ({ round }) => (round === 0 ? { calls: [call] } : { text: `DONE ${k}` });
const model = await L.startModel(scripts);
const proxy = await L.startBrokerProxy();
const h = await new L.Harness({ name: `s12-${L.ARM}`, modelUrl: model.url, brokerUrl: proxy.url }).start();
const out = {};
try {
  L.say('setup', `arm=${L.ARM} profile=${PROFILE} Session=packages/cli link node_modules/@acme/ui -> ../../../ui`);
  const A = new L.HSession(h, await L.createWorkspaceSession(ws, 'packages/cli'), L.storeConnection(h, ws));
  L.say('create', (await A.create({ toolProfile: PROFILE })).status);
  for (const k of Object.keys(CASES)) {
    const n = model.requests.length;
    const r = await A.prompt(`[[S:${k}]] go`);
    const resp = L.toolResponses(r.events)[0]?.response ?? {};
    const seen = model.requests.slice(n).flatMap((q) => q.results).join('\n');
    out[k] = { resp, seen };
    L.say(k, `${JSON.stringify(CASES[k])} -> ${L.summarizeTurn(r)}`);
    L.say(`${k} model saw`, seen.slice(0, 260));
    L.say(`${k} record`, JSON.stringify(resp).slice(0, 300));
    L.say(`${k} host path`, `model: ${seen.includes(realRoot)}; durable record: ${JSON.stringify(resp).includes(realRoot)}`);
  }
  const ui = fs.readFileSync(`${root}/packages/ui/src/index.ts`, 'utf8').trim();
  L.say('fs', `packages/ui/src/index.ts=${JSON.stringify(ui)} created-by-cli.ts=${fs.existsSync(`${root}/packages/ui/src/created-by-cli.ts`)}`);
  fs.writeFileSync(`${L.RIG}/out/${L.DB}/${name}.json`, JSON.stringify({ profile: PROFILE, cases: CASES, out }, null, 1));
} finally {
  await h.stop();
  await proxy.close();
  await model.close();
}
process.exitCode = L.done(name);
