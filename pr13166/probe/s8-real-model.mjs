// VERIFICATION RIG ONLY: S8 real model (qwen3.8-max) on the real stack.
// Same task in a files/2 Session (glob) and a files/1 Session (no search), plus a
// monorepo layout whose Session directory holds a link to a library outside it.
import fs from 'node:fs';
import path from 'node:path';
import * as L from './lib.mjs';

const MODEL = process.env.REAL_MODEL ?? 'qwen3.8-max';
const name = `s8-real-model-${L.ARM}${process.env.TAG ? '-' + process.env.TAG : ''}`;
L.openLog(name);
function project(dir) {
  const files = {
    'README.md': '# orders-service\n\nHTTP API for orders and users.\n',
    'package.json': '{"name":"orders-service","version":"1.4.0","scripts":{"start":"node dist/server.js"}}\n',
    'src/server.ts': "import { users } from './routes/users';\nimport { orders } from './routes/orders';\nexport const routes = [users, orders];\n",
    'src/routes/users.ts': "export const users = '/users';\n",
    'src/routes/orders.ts': "export const orders = '/orders';\n",
    'src/lib/db.ts': "export const pool = { max: 10 };\n",
    'test/server.test.ts': "test('routes', () => {});\n",
    'deploy/k8s/base/deployment.yaml': 'kind: Deployment\nspec:\n  template:\n    spec:\n      containers:\n        - name: app\n          envFrom:\n            - configMapRef: { name: app-config }\n',
    'deploy/k8s/overlays/staging/app.config.json': '{"listenPort": 9443, "logLevel": "debug"}\n',
    'deploy/k8s/overlays/prod/app.config.json': '{"listenPort": 8443, "logLevel": "warn"}\n',
  };
  for (const [f, c] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(`${dir}/${f}`), { recursive: true });
    fs.writeFileSync(`${dir}/${f}`, c);
  }
}
const TASK =
  'Which port does the PRODUCTION deployment of this service listen on? The setting is in a config file somewhere in this project, but I do not know its path. Use your tools to find it. Answer with the port and the file path relative to the project root.';
const OVERVIEW = 'First list every file in this project so I get an overview, then answer: ' + TASK;

const proxy = await L.startBrokerProxy();
const h = await new L.Harness({ name: `s8-${L.ARM}`, brokerUrl: proxy.url, realModel: MODEL }).start();
const runs = [];
async function run(label, ws, st, cwd, profile, prompt) {
  L.seedRegistry(ws, `st-${st}`);
  const s = new L.HSession(h, await L.createWorkspaceSession(ws, cwd), L.storeConnection(h, ws));
  const c = await s.create({ toolProfile: profile });
  const r = await s.prompt(prompt, 300_000);
  const trace = L.toolTrace(r.events, 220);
  const text = L.assistantText(r.events).replace(/\s+/g, ' ').trim();
  L.say(label, `${profile} create=${c.status} ${L.summarizeTurn(r)} toolCalls=${trace.filter((t) => t.startsWith('call')).length}`);
  for (const t of trace) L.say(`${label} trace`, t);
  L.say(`${label} answer`, text.slice(0, 600));
  runs.push({ label, profile, turn: L.summarizeTurn(r), trace, answer: text });
  return { r, text, trace };
}
try {
  L.say('setup', `model=${MODEL} arm=${L.ARM}`);
  const only = (process.env.ONLY ?? 'v2,v1,mono').split(',');
  if (only.includes('v2')) {
    project(`${L.ROOTS}/j/app`);
    const a = await run('files/2', 'ws-j', 'j', 'app', 'hosted-workspace-files/2', TASK);
    L.check('files/2: real model finds 8443 in deploy/k8s/overlays/prod/app.config.json', /8443/.test(a.text) && /overlays\/prod\/app\.config\.json/.test(a.text), a.text.slice(0, 200));
    L.check('files/2: model used glob', a.trace.some((t) => t.startsWith('call glob')));
  }
  if (only.includes('v1')) {
    project(`${L.ROOTS}/k/app`);
    const b = await run('files/1', 'ws-k', 'k', 'app', 'hosted-workspace-files/1', TASK);
    L.say('files/1 outcome', `answer names 8443: ${/8443/.test(b.text)}; read_file calls: ${b.trace.filter((t) => t.startsWith('call read_file')).length}`);
  }
  if (only.includes('mono')) {
    project(`${L.ROOTS}/l/services/app`);
    fs.mkdirSync(`${L.ROOTS}/l/libs/shared`, { recursive: true });
    fs.writeFileSync(`${L.ROOTS}/l/libs/shared/index.ts`, 'export const shared = true;\n');
    fs.rmSync(`${L.ROOTS}/l/services/app/shared`, { force: true });
    fs.symlinkSync('../../libs/shared', `${L.ROOTS}/l/services/app/shared`);
    const m = await run('monorepo files/2', 'ws-l', 'l', 'services/app', 'hosted-workspace-files/2', OVERVIEW);
    L.say('monorepo outcome', `glob calls: ${m.trace.filter((t) => t.startsWith('call glob')).length}; refused results: ${m.trace.filter((t) => /must stay within the Session/.test(t)).length}; answer names 8443: ${/8443/.test(m.text)}`);
  }
  fs.writeFileSync(`${L.RIG}/out/${L.DB}/${name}.json`, JSON.stringify(runs, null, 1));
} finally {
  await h.stop();
  await proxy.close();
}
process.exitCode = L.done(name);
