// VERIFICATION RIG ONLY (PR #13168 R2) P5: what the context read admits through symlinks, vs
// what read_file admits through the same link (the #13166 Session-directory containment).
//   services/api/QWEN.md   -> ../web/secret.txt   (a SIBLING Session's directory, inside the Workspace)
//   services/api/AGENTS.md -> <outside the Workspace mount>/host-secret.txt
//   services/mono/QWEN.md  -> ../../QWEN.md       (Workspace-root shared rules: the monorepo pattern)
//   services/big/QWEN.md   =  100,000 chars (truncation)
import fs from 'node:fs';
import * as L from './lib.mjs';
import { startGateProxy, ctxOps, sysText } from './lib2.mjs';

const PROFILE = process.env.PROFILE ?? 'hosted-workspace-files/1';
const st = process.env.ST ?? 'd';
const ws = `ws-${st}`;
const name = `p5-boundary-${L.ARM}-${st}`;
L.openLog(name);
const root = `${L.ROOTS}/${st}`;
const outside = `${L.RUN}/outside-${st}`;
fs.mkdirSync(outside, { recursive: true });
fs.writeFileSync(`${outside}/host-secret.txt`, 'HOST_SECRET_OUTSIDE_WORKSPACE\n');
for (const d of ['services/api', 'services/web', 'services/mono', 'services/big']) fs.mkdirSync(`${root}/${d}`, { recursive: true });
fs.writeFileSync(`${root}/QWEN.md`, 'WS_ROOT_SHARED_RULES\n');
fs.writeFileSync(`${root}/services/web/secret.txt`, 'SIBLING_SECRET_7731 (belongs to the services/web Session)\n');
fs.writeFileSync(`${root}/services/web/QWEN.md`, 'WEB_SESSION_RULES\n');
for (const d of ['api', 'mono', 'big']) fs.writeFileSync(`${root}/services/${d}/proof.txt`, `proof-${d}\n`);
const link = (target, at) => {
  fs.rmSync(at, { force: true });
  fs.symlinkSync(target, at);
};
link('../web/secret.txt', `${root}/services/api/QWEN.md`);
link(`${outside}/host-secret.txt`, `${root}/services/api/AGENTS.md`);
link('../../QWEN.md', `${root}/services/mono/QWEN.md`);
fs.writeFileSync(`${root}/services/big/QWEN.md`, 'BIG_HEAD_MARKER\n' + 'x'.repeat(100_000) + '\nBIG_TAIL_MARKER\n');
L.seedRegistry(ws, `st-${st}`);
const realRoot = fs.realpathSync(root);

const model = await L.startModel({
  t: ({ round }) => (round === 0 ? { calls: [['read_file', { file_path: 'proof.txt' }]] } : { text: 'DONE' }),
  rq: ({ round }) => (round === 0 ? { calls: [['read_file', { file_path: 'QWEN.md' }]] } : { text: 'DONE' }),
  ra: ({ round }) => (round === 0 ? { calls: [['read_file', { file_path: 'AGENTS.md' }]] } : { text: 'DONE' }),
});
const proxy = await startGateProxy();
const h = await new L.Harness({ name: `p5-${L.ARM}-${st}`, modelUrl: model.url, brokerUrl: proxy.url }).start();
const out = {};
try {
  // A real sibling Session exists in services/web.
  const web = new L.HSession(h, await L.createWorkspaceSession(ws, 'services/web'), L.storeConnection(h, ws));
  L.say('create web (sibling) Session', (await web.create({ toolProfile: PROFILE })).status);
  for (const cwd of ['services/api', 'services/mono', 'services/big']) {
    const s = new L.HSession(h, await L.createWorkspaceSession(ws, cwd), L.storeConnection(h, ws));
    L.say(`create ${cwd}`, (await s.create({ toolProfile: PROFILE })).status);
    const n = model.requests.length;
    const t0 = Date.now();
    const r = await s.prompt('[[S:t]] read proof');
    const second = model.requests.slice(n)[1];
    const sys = second ? sysText(second) : '';
    const ctxResp = ctxOps(proxy.ledger, t0)[0]?.resBody ?? '';
    let files = [];
    try {
      files = JSON.parse(ctxResp).result.files.map((f) => ({ name: f.name, chars: f.text.length, head: f.text.slice(0, 60), tail: f.text.slice(-70) }));
    } catch {}
    out[cwd] = { turn: L.summarizeTurn(r), files, sys: { sibling: sys.includes('SIBLING_SECRET_7731'), host: sys.includes('HOST_SECRET_OUTSIDE_WORKSPACE'), root: sys.includes('WS_ROOT_SHARED_RULES'), bigHead: sys.includes('BIG_HEAD_MARKER'), bigTail: sys.includes('BIG_TAIL_MARKER'), truncNote: sys.includes('[Truncated: the file exceeds the Hosted context limit.]'), hostPath: sys.includes(realRoot) } };
    L.say(`${cwd} turn`, L.summarizeTurn(r));
    L.say(`${cwd} workspace-context result`, JSON.stringify(files));
    L.say(`${cwd} system instruction of request #2`, JSON.stringify(out[cwd].sys));
    if (cwd === 'services/api') {
      for (const [k, label] of [['rq', 'read_file QWEN.md (same link)'], ['ra', 'read_file AGENTS.md (outside link)']]) {
        const rr = await s.prompt(`[[S:${k}]] read it`);
        const resp = L.toolResponses(rr.events)[0]?.response ?? {};
        out[`${cwd} ${k}`] = { status: resp.executionStatus, raw: JSON.stringify(resp).slice(0, 400), trace: L.toolTrace(rr.events, 300), leaked: JSON.stringify(resp).includes('SIBLING_SECRET') || JSON.stringify(resp).includes('HOST_SECRET') };
        L.say(`${cwd} ${label}`, JSON.stringify(out[`${cwd} ${k}`]));
      }
    }
  }
  const api = out['services/api'];
  L.check('outside-Workspace AGENTS.md link is skipped', !api.sys.host && !api.files.some((f) => f.name === 'AGENTS.md'));
  L.check('read_file refuses the sibling link (Session-directory containment, #13166)', out['services/api rq'].status === 'error' && !out['services/api rq'].leaked, JSON.stringify(out['services/api rq']));
  L.say('OBSERVE', `sibling Session file injected into api Session system instruction: ${api.sys.sibling}`);
  L.check('[expected-by-design?] context read stays inside the Session directory (sibling secret NOT injected)', !api.sys.sibling, `sibling injected=${api.sys.sibling}`);
  L.say('OBSERVE', `Workspace-root QWEN.md reached through services/mono/QWEN.md link: ${out['services/mono'].sys.root}`);
  const big = out['services/big'];
  const bigQ = big.files.find((f) => f.name === 'QWEN.md');
  L.check('oversized QWEN.md truncated to 65,536 chars with explicit note', bigQ?.chars === 65536 && big.sys.truncNote && big.sys.bigHead && !big.sys.bigTail, JSON.stringify(bigQ));
  L.check('no host path in any system instruction', Object.values(out).every((v) => !v.sys?.hostPath));
  fs.writeFileSync(`${L.RIG}/out/${L.DB}/${name}.json`, JSON.stringify(out, null, 1));
} finally {
  await h.stop();
  await proxy.close();
  await model.close();
}
process.exitCode = L.done(name);
