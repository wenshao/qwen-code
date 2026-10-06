// VERIFICATION RIG ONLY: S23 round-5 glob search roots through symlinks (fef2893cf6, 268ea8f876):
// inward links as `path`, a climbing pattern under a deep link, outward/absolute links, and a Session
// whose cwd is itself a symlink.
import fs from 'node:fs';
import * as L from './lib.mjs';

const name = `s23-symlink-roots-${L.ARM}`;
L.openLog(name);
const st = process.env.ST ?? 'a';
const ws = `ws-${st}`;
const top = `${L.ROOTS}/${st}`;
const root = `${top}/w23`;
fs.rmSync(root, { recursive: true, force: true });
fs.rmSync(`${top}/w23-alias`, { force: true });
for (const d of ['src/util', 'nested/a/b', `../outside23`]) fs.mkdirSync(`${root}/${d}`, { recursive: true });
fs.writeFileSync(`${root}/src/index.ts`, 'export {};\n');
fs.writeFileSync(`${root}/src/util/helper.ts`, 'export {};\n');
fs.writeFileSync(`${root}/package.json`, '{"name":"w23"}\n');
fs.writeFileSync(`${top}/outside23/leak.ts`, 'OUTSIDE\n');
fs.symlinkSync('src', `${root}/lnk`);
fs.symlinkSync('../../../src', `${root}/nested/a/b/lnk2`);
fs.symlinkSync('../outside23', `${root}/out`);
fs.symlinkSync('/etc', `${root}/abs`);
fs.symlinkSync('w23', `${top}/w23-alias`);
L.seedRegistry(ws, `st-${st}`);
const CASES = {
  inward: { pattern: '**/*.ts', path: 'lnk' },
  deep: { pattern: '*.ts', path: 'nested/a/b/lnk2' },
  climbShallow: { pattern: '../*.json', path: 'lnk' },
  climbDeep: { pattern: '../*.json', path: 'nested/a/b/lnk2' },
  outward: { pattern: '*', path: 'out' },
  absolute: { pattern: 'host*', path: 'abs' },
  viaPattern: { pattern: 'out/*.ts' },
  all: { pattern: '**/*.ts' },
};
const scripts = {};
for (const [k, args] of Object.entries(CASES)) scripts[k] = ({ round }) => (round === 0 ? { calls: [['glob', args]] } : { text: `DONE ${k}` });
scripts.readClimb = ({ round }) => (round === 0 ? { calls: [['read_file', { file_path: 'package.json' }]] } : { text: 'DONE' });
const model = await L.startModel(scripts);
const proxy = await L.startBrokerProxy();
const h = await new L.Harness({ name: `s23-${L.ARM}`, modelUrl: model.url, brokerUrl: proxy.url }).start();
const show = (r) => {
  const resp = L.toolResponses(r.events)[0]?.response ?? {};
  return JSON.stringify(resp.output ?? resp.error ?? '').replace(/sorted by modification time \(newest first\):\\n---\\n/, '| ').slice(0, 220);
};
try {
  const A = new L.HSession(h, await L.createWorkspaceSession(ws, 'w23'), L.storeConnection(h, ws));
  await A.create({ toolProfile: 'hosted-workspace-files/2' });
  for (const k of Object.keys(CASES)) {
    const r = await A.prompt(`[[S:${k}]] go`, 120_000);
    L.say(k, `${JSON.stringify(CASES[k])} -> ${L.summarizeTurn(r)} ${show(r)}`);
  }
  await A.detach();
  // A Session whose saved cwd is itself a symlink to the same directory.
  try {
    const B = new L.HSession(h, await L.createWorkspaceSession(ws, 'w23-alias'), L.storeConnection(h, ws));
    await B.create({ toolProfile: 'hosted-workspace-files/2' });
    const r = await B.prompt('[[S:all]] go', 120_000);
    L.say('alias cwd', `${L.summarizeTurn(r)} ${show(r)}`);
  } catch (e) {
    L.say('alias cwd', `refused: ${String(e.message ?? e).slice(0, 220)}`);
  }
} finally {
  await h.stop();
  await proxy.close();
  await model.close();
}
process.exitCode = L.done(name);
