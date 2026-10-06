// VERIFICATION RIG ONLY: S3 in-context symlinks that leave the Session directory.
// services/api/peek -> ../web (the sibling Session's directory), services/api/dangling -> ../web/not-yet.txt
// PROFILE=hosted-workspace-files/2 (head) or hosted-workspace-files/1 (main arm, glob cases skipped).
import fs from 'node:fs';
import * as L from './lib.mjs';

const PROFILE = process.env.PROFILE ?? 'hosted-workspace-files/2';
const name = `s3-symlink-${L.ARM}`;
L.openLog(name);
const st = process.env.ST ?? 'e';
const ws = `ws-${st}`;
const root = `${L.ROOTS}/${st}`;
for (const d of ['services/api/src', 'services/web']) fs.mkdirSync(`${root}/${d}`, { recursive: true });
fs.writeFileSync(`${root}/services/api/src/index.ts`, 'export const api = 1;\n');
fs.writeFileSync(`${root}/services/web/secret.txt`, 'SIBLING_SECRET\n');
for (const f of ['new-from-a.txt', 'not-yet.txt']) fs.rmSync(`${root}/services/web/${f}`, { force: true });
fs.rmSync(`${root}/services/web/sub`, { recursive: true, force: true });
for (const [l, t] of [['peek', '../web'], ['dangling', '../web/not-yet.txt']]) {
  fs.rmSync(`${root}/services/api/${l}`, { force: true });
  fs.symlinkSync(t, `${root}/services/api/${l}`);
}
const realRoot = fs.realpathSync(root);
L.seedRegistry(ws, `st-${st}`);
const GLOB = PROFILE.endsWith('/2');
const CASES = {
  ...(GLOB
    ? {
        globLinkPath: ['glob', { pattern: '*', path: 'peek' }],
        globLinkPattern: ['glob', { pattern: 'peek/**/*' }],
        globAll: ['glob', { pattern: '**/*' }],
        globStar: ['glob', { pattern: '*' }],
        globTs: ['glob', { pattern: '**/*.ts' }],
        globSrc: ['glob', { pattern: '**/*', path: 'src' }],
      }
    : {}),
  readThrough: ['read_file', { file_path: 'peek/secret.txt' }],
  editThrough: ['edit', { file_path: 'peek/secret.txt', old_string: 'SIBLING_SECRET', new_string: 'EDITED_BY_A' }],
  overwriteThrough: ['write_file', { file_path: 'peek/secret.txt', content: 'OVERWRITTEN_BY_A\n' }],
  createThrough: ['write_file', { file_path: 'peek/new-from-a.txt', content: 'WRITTEN_BY_A\n' }],
  createDeepThrough: ['write_file', { file_path: 'peek/sub/deep.txt', content: 'DEEP_BY_A\n' }],
  danglingWrite: ['write_file', { file_path: 'dangling', content: 'VIA_DANGLING_LINK\n' }],
  readOwn: ['read_file', { file_path: 'src/index.ts' }],
};
const scripts = {};
for (const [k, call] of Object.entries(CASES)) scripts[k] = ({ round }) => (round === 0 ? { calls: [call] } : { text: `DONE ${k}` });
const model = await L.startModel(scripts);
const proxy = await L.startBrokerProxy();
const h = await new L.Harness({ name: `s3-${L.ARM}`, modelUrl: model.url, brokerUrl: proxy.url }).start();
const web = (f) => (fs.existsSync(`${root}/services/web/${f}`) ? fs.readFileSync(`${root}/services/web/${f}`, 'utf8').trim() : '<absent>');
try {
  L.say('setup', `arm=${L.ARM} profile=${PROFILE} ws=${ws} root=${realRoot}`);
  const A = new L.HSession(h, await L.createWorkspaceSession(ws, 'services/api'), L.storeConnection(h, ws));
  L.say('create A', (await A.create({ toolProfile: PROFILE })).status);
  const res = {};
  for (const k of Object.keys(CASES)) {
    const n = model.requests.length;
    const r = await A.prompt(`[[S:${k}]] run`);
    const resp = L.toolResponses(r.events)[0]?.response ?? {};
    const seen = model.requests.slice(n).flatMap((q) => q.results).join('\n');
    res[k] = { resp, seen };
    L.say(k, `${JSON.stringify(CASES[k])} -> ${L.summarizeTurn(r)}`);
    L.say(`${k} result`, JSON.stringify(resp).slice(0, 500));
    L.say(`${k} model saw`, seen.slice(0, 300));
    L.say(`${k} host path`, `durable record: ${JSON.stringify(resp).includes(realRoot)}; model: ${seen.includes(realRoot)}`);
  }
  L.say('fs', `web/secret.txt=${JSON.stringify(web('secret.txt'))} web/new-from-a.txt=${JSON.stringify(web('new-from-a.txt'))} web/sub/deep.txt=${JSON.stringify(web('sub/deep.txt'))} web/not-yet.txt=${JSON.stringify(web('not-yet.txt'))}`);
  const st2 = await A.status();
  L.say('status', JSON.stringify(st2));
  fs.writeFileSync(`${L.RIG}/out/${L.DB}/${name}.json`, JSON.stringify({ profile: PROFILE, cases: CASES, res, fs: { secret: web('secret.txt'), created: web('new-from-a.txt'), deep: web('sub/deep.txt'), dangling: web('not-yet.txt') } }, null, 1));
} finally {
  await h.stop();
  await proxy.close();
  await model.close();
}
process.exitCode = L.done(name);
