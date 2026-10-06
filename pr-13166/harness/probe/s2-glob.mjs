// VERIFICATION RIG ONLY: S2 glob semantics on the real stack (files/2):
// containment, sibling isolation, Workspace-relative output, pre-acquisition
// refusals, error-channel relativization, and a leak scan of wire + DB.
import fs from 'node:fs';
import * as L from './lib.mjs';

const name = `s2-glob-${L.ARM}`;
L.openLog(name);
const st = process.env.ST ?? 'b';
const ws = `ws-${st}`;
const root = `${L.ROOTS}/${st}`;
for (const d of ['services/api/src/util', 'services/web']) fs.mkdirSync(`${root}/${d}`, { recursive: true });
fs.writeFileSync(`${root}/README.md`, 'workspace root\n');
fs.writeFileSync(`${root}/services/api/src/index.ts`, 'export const api = 1;\n');
fs.writeFileSync(`${root}/services/api/src/util/helpers.ts`, 'export const h = 1;\n');
fs.writeFileSync(`${root}/services/api/package.json`, '{"name":"api"}\n');
fs.writeFileSync(`${root}/services/web/secret.txt`, 'SIBLING_SECRET\n');
fs.writeFileSync(`${root}/services/web/web.ts`, 'export const web = 1;\n');
const realRoot = fs.realpathSync(root);
L.seedRegistry(ws, `st-${st}`);

const CASES = {
  all: { pattern: '**/*' },
  sub: { pattern: '*.ts', path: 'src' },
  dotpath: { pattern: '**/*', path: './src' },
  untrimmed: { pattern: '  **/*.ts  ' },
  blankpath: { pattern: '*.json', path: '   ' },
  nomatch: { pattern: 'zzz*' },
  up: { pattern: '**/*', path: '..' },
  upnested: { pattern: '**/*', path: 'src/../..' },
  abspath: { pattern: '*', path: realRoot },
  patup: { pattern: '../**/*' },
  patabs: { pattern: '/etc/host*' },
  brace: { pattern: '{.,..}/**/*' },
  braceabs: { pattern: '{/etc,src}/*' },
  filepath: { pattern: '*', path: 'package.json' },
  missing: { pattern: '*', path: 'nope' },
  wrongkey: { pattern: '*.ts', dir_path: 'src' },
  readmissing: null, // read_file control (pre-existing channel)
};
const scripts = {};
for (const [k, args] of Object.entries(CASES))
  scripts[k] = ({ round, results }) =>
    round === 0
      ? { calls: [k === 'readmissing' ? ['read_file', { file_path: 'nope.txt' }] : ['glob', args]] }
      : { text: `DONE ${k}` };
scripts.batch = ({ round }) => (round === 0 ? { calls: [['glob', { pattern: '*.json' }], ['glob', { pattern: '*', path: '..' }]] } : { text: 'DONE batch' });
scripts.sibling = ({ round }) => (round === 0 ? { calls: [['glob', { pattern: '**/*' }]] } : { text: 'DONE sibling' });

const model = await L.startModel(scripts);
const proxy = await L.startBrokerProxy();
const h = await new L.Harness({ name: `s2-${L.ARM}`, modelUrl: model.url, brokerUrl: proxy.url }).start();
const results = {};
try {
  L.say('setup', `arm=${L.ARM} ws=${ws} root=${realRoot}`);
  const A = new L.HSession(h, await L.createWorkspaceSession(ws, 'services/api'), L.storeConnection(h, ws));
  L.say('create A', (await A.create({ toolProfile: 'hosted-workspace-files/2' })).status);
  for (const k of [...Object.keys(CASES), 'batch']) {
    const t0 = Date.now();
    const n = model.requests.length;
    const r = await A.prompt(`[[S:${k}]] run`);
    const ledger = L.ledgerSince(proxy.ledger, t0);
    const seen = model.requests.slice(n).flatMap((q) => q.results);
    const responses = L.toolResponses(r.events);
    results[k] = { r, ledger, seen, responses, prepared: ledger.filter((l) => /executions:prepare/.test(l)).length };
    L.say(k, `${JSON.stringify(CASES[k] ?? 'read_file nope.txt')} -> ${L.summarizeTurn(r)} prepare=${results[k].prepared}`);
    for (const t of L.toolTrace(r.events, 360)) L.say(`${k} trace`, t);
  }
  const B = new L.HSession(h, await L.createWorkspaceSession(ws, 'services/web'), L.storeConnection(h, ws));
  L.say('create B', (await B.create({ toolProfile: 'hosted-workspace-files/2' })).status);
  const rb = await B.prompt('[[S:sibling]] run');
  L.say('sibling B', L.summarizeTurn(rb));
  for (const t of L.toolTrace(rb.events, 360)) L.say('sibling trace', t);

  const out = (k) => JSON.stringify(results[k].responses);
  const ok = (k) => results[k].responses[0]?.response?.executionStatus === 'success' || /Found \d+ file/.test(out(k));
  L.check('all: Session files listed', ['src/index.ts', 'src/util/helpers.ts', 'package.json'].every((p) => out('all').includes(p)), out('all').slice(0, 300));
  L.check('all: no sibling Session file / Workspace-root file', !/secret\.txt|web\.ts|README\.md/.test(out('all')));
  L.check('all: searched "within ." (Session root)', out('all').includes('within .'));
  L.check('sub: path=src -> src/index.ts', out('sub').includes('src/index.ts') && !out('sub').includes('helpers'), out('sub').slice(0, 300));
  L.check('dotpath: ./src accepted', out('dotpath').includes('src/index.ts'), out('dotpath').slice(0, 200));
  L.check('untrimmed pattern trimmed and matches', out('untrimmed').includes('src/index.ts'), out('untrimmed').slice(0, 200));
  L.check('blank path treated as omitted', out('blankpath').includes('package.json'), out('blankpath').slice(0, 200));
  L.check('nomatch: "No files found ... within ."', out('nomatch').includes('No files found') && out('nomatch').includes('within .'), out('nomatch').slice(0, 200));
  for (const k of ['up', 'upnested', 'abspath', 'patup', 'patabs'])
    L.check(`${k}: refused before acquisition (0 executions prepared)`, results[k].prepared === 0 && /Hosted glob requires/.test(out(k) + JSON.stringify(results[k].seen)), `prepare=${results[k].prepared} ${out(k).slice(0, 160)}`);
  for (const k of ['brace', 'braceabs'])
    L.check(`${k}: dispatched, refused by the worker's output containment`, results[k].prepared === 1 && /must stay within the Session working directory/.test(out(k)) && !/SIBLING_SECRET|secret\.txt|\/etc\//.test(out(k)), `prepare=${results[k].prepared} ${out(k).slice(0, 200)}`);
  L.check('filepath: error, no host path', /error/.test(out('filepath')) && !out('filepath').includes(realRoot), out('filepath').slice(0, 300));
  L.check('missing: error, no host path', /error/.test(out('missing')) && !out('missing').includes(realRoot), out('missing').slice(0, 300));
  L.say('wrongkey', `observed: ${out('wrongkey').slice(0, 300)}`);
  L.say('readmissing', `read_file control: ${out('readmissing').slice(0, 300)}`);
  L.say('batch', `observed: ${out('batch').slice(0, 400)} prepare=${results.batch.prepared}`);
  const outB = JSON.stringify(L.toolResponses(rb.events));
  L.check('sibling B sees only its own files', outB.includes('secret.txt') && outB.includes('web.ts') && !outB.includes('index.ts'), outB.slice(0, 300));

  // Leak scan: the Runtime host layout (mount root) on the wire and in the DB.
  const globKeys = Object.keys(CASES).filter((k) => k !== 'readmissing');
  const modelSeen = globKeys.flatMap((k) => results[k].seen).join('\n');
  L.check('model-visible glob results: no Runtime host path', !modelSeen.includes(realRoot), `${modelSeen.length} chars scanned`);
  // Tool results only: the `abspath` case puts the host path into the model's own call arguments.
  const transcript = JSON.stringify([...globKeys.map((k) => results[k].responses), L.toolResponses(rb.events)]);
  L.check('Harness transcript tool results (glob turns): no Runtime host path', !transcript.includes(realRoot), `${transcript.length} chars`);
  const brokerBodies = proxy.ledger.map((e) => `${e.reqBody}\n${e.resBody ?? ''}`).join('\n');
  L.say('broker wire', `Broker req/resp bodies containing the mount root: ${proxy.ledger.filter((e) => `${e.reqBody}${e.resBody}`.includes(realRoot)).map((e) => e.url.replace(/\/internal\/runtime-broker\/v1/, '').replace(/[0-9a-f-]{36}/g, ':id')).join(', ') || 'none'} (of ${proxy.ledger.length})`);
  L.say('read_file control on the wire', `read_file nope.txt result carries host path: ${out('readmissing').includes(realRoot)}`);
  L.say('db scan', `${realRoot}: ${JSON.stringify(L.dbScan(realRoot))}`);
  fs.writeFileSync(`${L.RIG}/out/${L.DB}/${name}.json`, JSON.stringify(Object.fromEntries(Object.entries(results).map(([k, v]) => [k, { args: CASES[k], turn: L.summarizeTurn(v.r), prepared: v.prepared, responses: v.responses, ledger: v.ledger }])), null, 1));
  L.say('holders', JSON.stringify(L.holders()));
} finally {
  await h.stop();
  await proxy.close();
  await model.close();
}
process.exitCode = L.done(name);
