// VERIFICATION RIG ONLY (PR #13166): R10-1 through the shipped topology (packaged Harness -> Java Broker
// -> one Runtime worker per Session). The Harness refuses `..` and absolute spellings, so the only way a
// model reaches an out-of-boundary target is an in-Session link that leaves the mount. `write_file` builds
// with lstat on the resolved host path: a DIRECTORY behind such a link fails at build time, and before
// 0d6a6307 that build error (quoting the host path) beat the boundary refusal.
// usage: DB=.. ARM=head|base PROFILE=hosted-workspace-files/2 ST=<storage letter> node s25-r10-realstack.mjs
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import * as L from './lib.mjs';

const PROFILE = process.env.PROFILE ?? 'hosted-workspace-files/2';
const tag = PROFILE.endsWith('/2') ? 'v2' : 'v1';
const name = `s25-r10-${L.ARM}-${tag}`;
L.openLog(name);
const st = process.env.ST ?? 'b';
const ws = `ws-${st}`;
const root = `${L.ROOTS}/${st}`;
const sessionDir = `${root}/app`;
fs.mkdirSync(`${sessionDir}/src`, { recursive: true });
fs.writeFileSync(`${sessionDir}/src/index.ts`, 'export const app = 1;\n');
const outside = `${L.RUN}/outside-${st}`; // outside every Workspace mount
fs.mkdirSync(`${outside}/assets/img`, { recursive: true });
fs.writeFileSync(`${outside}/assets/readme.txt`, 'OUTSIDE\n');
fs.rmSync(`${sessionDir}/ext`, { force: true });
fs.symlinkSync(outside, `${sessionDir}/ext`);
L.seedRegistry(ws, `st-${st}`);
const realMount = fs.realpathSync(root);

const CASES = [
  ['dirBehindLink', 'write_file', { file_path: 'ext/assets', content: 'x' }, 'outside DIRECTORY through the link'],
  ['nestedDirBehindLink', 'write_file', { file_path: 'ext/assets/img', content: 'x' }, 'outside nested directory'],
  ['absentBehindLink', 'write_file', { file_path: 'ext/assets/nope.txt', content: 'x' }, 'outside, absent (control)'],
  ['readBehindLink', 'read_file', { file_path: 'ext/assets/readme.txt' }, 'outside file read (control)'],
  ['ipynbBehindLink', 'read_file', { file_path: 'ext/assets/x.ipynb', offset: 1 }, 'ipynb + offset (build error)'],
  ['ownDir', 'write_file', { file_path: 'src', content: 'x' }, 'own directory (in-boundary control)'],
  ['ownWrite', 'write_file', { file_path: 'src/new.txt', content: 'NEW\n' }, 'own new file (success-text control)'],
];
const scripts = {};
for (const [k, tool, args] of CASES) scripts[k] = ({ round }) => (round === 0 ? { calls: [[tool, args]] } : { text: `DONE ${k}` });
const model = await L.startModel(scripts);
const proxy = await L.startBrokerProxy();
const h = await new L.Harness({ name: `s25-${L.ARM}-${tag}`, modelUrl: model.url, brokerUrl: proxy.url }).start();
const rows = [];
let sessionId;
try {
  sessionId = await L.createWorkspaceSession(ws, 'app');
  const s = new L.HSession(h, sessionId, L.storeConnection(h, ws));
  const c = await s.create({ toolProfile: PROFILE });
  L.say('create', `${c.status} profile=${PROFILE} session=${sessionId}`);
  for (const [k, tool, args, note] of CASES) {
    const r = await s.prompt(`[[S:${k}]] go`);
    const resp = L.toolResponses(r.events)[0]?.response ?? {};
    const modelSaw = model.requests.filter((q) => q.script === k).at(-1)?.results?.[0] ?? '';
    const text = JSON.stringify(resp.output ?? resp.error ?? resp);
    const leak = modelSaw.includes(realMount) || text.includes(realMount) || modelSaw.includes(outside) || text.includes(outside);
    const row = { arm: L.ARM, profile: PROFILE, case: k, tool, args, note, turn: L.summarizeTurn(r), status: resp.executionStatus ?? '-', modelSaw: modelSaw.replaceAll(realMount, '<MOUNT>').replaceAll(outside, '<OUTSIDE>'), leak };
    rows.push(row);
    L.say(k, `${tool}(${JSON.stringify(args)}) -> ${row.turn} status=${row.status}${leak ? ' [HOST PATH REACHES MODEL]' : ''} :: ${row.modelSaw.slice(0, 220)}`);
  }
  L.say('fs', `outside/assets/nope.txt exists=${fs.existsSync(`${outside}/assets/nope.txt`)}; outside/assets still a dir=${fs.statSync(`${outside}/assets`).isDirectory()}`);
} finally {
  await h.stop();
  await proxy.close();
  await model.close();
}
// Durable side: every table row of this DB that carries the host mount path or the outside path.
const dump = execFileSync('docker', ['exec', L.E.MYSQL_CONTAINER, 'mysqldump', '-uroot', `-p${L.E.DBPASS}`, '--skip-extended-insert', '--no-create-info', L.DB], {
  encoding: 'utf8',
  maxBuffer: 1024 * 1024 * 1024,
  stdio: ['ignore', 'pipe', 'ignore'],
});
const perTable = {};
for (const line of dump.split('\n')) {
  const m = line.match(/^INSERT INTO `([^`]+)`/);
  if (!m || !line.includes(sessionId)) continue;
  if (line.includes(realMount) || line.includes(outside)) perTable[m[1]] = (perTable[m[1]] ?? 0) + 1;
}
L.say('durable rows of this Session quoting a host path', JSON.stringify(perTable));
fs.writeFileSync(`${L.RIG}/out/${L.DB}/${name}.json`, JSON.stringify({ rows, durable: perTable }, null, 1));
process.exitCode = L.done(name);
