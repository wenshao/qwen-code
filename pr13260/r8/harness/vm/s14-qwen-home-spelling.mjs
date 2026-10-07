// PR #13260 S14 (R1-2 at 5120e58a): how the maintenance process's QWEN_HOME spelling decides migration, on the real stack.
// Every request carries the canonical fileHistoryRoot; only the inherited QWEN_HOME string differs.
//  st-a canonical (control) · st-b trailing slash · st-c doubled separators · st-d refused spellings on prepare (dot, parent,
//  symlink alias, relative, unset), then canonical. A step refused under its spelling is retried once with the canonical home.
// Then the deployment restarts with QWEN_HOME spelled with a trailing slash (then doubled), and every migrated storage runs a
// Turn + undo on its target.
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import * as L from './lib.mjs';
import * as W from './w1bc.mjs';
import * as P from './pop.mjs';
import * as M from './w1c.mjs';
const TAG = process.env.TAG ?? 's14';
L.openLog(`s14-${TAG}`);
const { say } = L;
const R = { tag: TAG, server: L.env().JAR, dist: L.env().DIST, migJar: M.MIG_JAR, storages: {}, restarts: [] };
const ST = ['a', 'b', 'c', 'd'];
const SRC = (s) => `/srv/w1c-src/${s}`; const DST = (s) => `/srv/w1c-dst/${s}`;
const QH = M.homeOf(); const base = QH.slice(0, QH.lastIndexOf('/')); const leaf = QH.slice(QH.lastIndexOf('/') + 1);
const SP = {
  canonical: QH,
  trailing: `${QH}/`,
  doubled: `${base.replace('/var/lib/', '/var/lib//')}//${leaf}//`,
  dot: `${base}/./${leaf}`,
  parent: `${base}/x/../${leaf}`,
  symlink: `${base}/home-link-${L.DB()}`,
  relative: leaf,
  unset: null,
};
const read = (root, f) => { try { return fs.readFileSync(`${root}/${f}`, 'utf8').trim(); } catch (e) { return `<${e.code}>`; } };
say(L.hostFacts()); say(`   server ${L.env().JAR} dist ${L.env().DIST} | migration jar ${M.MIG_JAR}`);
await P.rollout(ST);
L.sh(`mkdir -p ${base}/x && ln -sfn ${QH} ${SP.symlink}`);
say(`   spellings: ${Object.entries(SP).map(([k, v]) => `${k}=${v === null ? '<unset>' : JSON.stringify(v)}`).join(' ')}`);
for (const s of ST) L.seedWs(`ws-${s}1`, s);
const rig = await L.startRig(`s14-${TAG}`);
const S = {}; const PR = {};
for (const s of ST) {
  S[s] = new L.HSession(rig.h, await L.createSession(`ws-${s}1`), `ws-${s}1`);
  const c = await S[s].create(L.FILES); const t1 = await S[s].prompt('WRITE notes.txt one'); PR[s] = t1.promptId;
  say(`   st-${s} ${S[s].sessionId.slice(0, 8)} create=${c.status} ${P.term(t1)} ${P.term(await S[s].prompt('WRITE notes.txt two'))}`);
  await S[s].detach();
}
await rig.h.stop(); for (const s of ST) await W.waitLeasesExpired(s);
L.sh(`touch -d '+1 second' ${W.historyRoot()}`);  // N1
const brief = (r) => (r.code === 0 ? M.migSummary(r).slice(0, 40) : `REFUSED ${(r.workerLine || r.cause || '').slice(0, 90)}`);
async function step(s, cmd, file, spelling) {
  const r = await M.mig(cmd, file, { label: `${TAG}-${s}-${cmd}-${spelling}`, home: SP[spelling], quiet: true });
  const out = { cmd, spelling, exit: r.code, result: brief(r) };
  say(`   st-${s} ${cmd.padEnd(7)} QWEN_HOME=${spelling.padEnd(9)} → ${out.result}`);
  return { r, out };
}
async function migrate(s, spelling, { matrix = [] } = {}) {
  const req = M.migrationRequest({ revision: L.mountRow(s).revision, storage: s, source: SRC(s), target: DST(s), bundle: `/srv/w1c-bundles/${TAG}-${s}` });
  const file = M.writeRequest(req, `${TAG}-${s}`); const steps = [];
  const run = async (cmd, sp) => { const x = await step(s, cmd, file, sp); steps.push(x.out); return x.r; };
  const runOrCanonical = async (cmd) => { const r = await run(cmd, spelling); if (r.code !== 0 && spelling !== 'canonical') return run(cmd, 'canonical'); return r; };
  await runOrCanonical('retire');
  L.maint(['fence', L.TENANT, `st-${s}`, SRC(s), String(req.mountRevision), req.fenceOperationId, '--offline-confirmed']);
  W.prepareBundle(`${TAG}-${s}`, { storage: s, sessions: W.members(s).map((m) => m.id) });
  await W.w1b('capture', W.captureRequest({ op: req.captureOperationId, fence: req.fenceOperationId, revision: req.mountRevision, storage: s, bundle: req.bundleRoot }), { label: `${TAG}-${s}-capture`, quiet: true });
  L.sh(`cp -a ${SRC(s)} ${DST(s)}`);
  for (const sp of matrix) await run('prepare', sp);
  await runOrCanonical('prepare');
  const q = await runOrCanonical('promote');
  const row = M.migRow(req.migrationOperationId);
  R.storages[s] = { spelling, steps, final: row ? `${row.state}${row.error !== '-' ? ` lastError=${row.error}` : ''}` : 'none', mount: L.mstr(L.mountRow(s)) };
  say(`   st-${s} final: ${R.storages[s].final} | ${R.storages[s].mount}`);
  return q;
}
say('== maintenance under each spelling');
await migrate('a', 'canonical');
await migrate('b', 'trailing');
await migrate('c', 'doubled');
await migrate('d', 'canonical', { matrix: ['dot', 'parent', 'symlink', 'relative', 'unset'] });

say('== deployment restart with a non-canonical-but-equivalent QWEN_HOME spelling; Turn + undo on every target');
const migrated = ST.filter((s) => /COMPLETED/.test(R.storages[s]?.final ?? ''));
const roots = ST.map((s) => `ROOT_${s}=${migrated.includes(s) ? DST(s) : ''}`);
for (const spelling of ['trailing', 'doubled']) {
  say('  ', L.svc(...roots, `QHOME=${SP[spelling]}`, 'restart').split('\n').at(-1).slice(0, 220));
  for (let i = 0; i < 300; i++) { const hr = await fetch('http://127.0.0.1:8288/actuator/health').catch(() => null); if (hr?.ok) break; await L.sleep(1000); }
  const h = await new L.Harness({ name: `s14-${TAG}-${spelling}`, modelUrl: rig.model.baseUrl, brokerUrl: rig.proxy.url, port: Number(process.env.HPORT ?? 0) }).start();
  const rs = { spelling, value: SP[spelling], turns: {} };
  for (const s of migrated) {
    S[s].bind(h); const ld = await S[s].load(L.FILES);
    const t = await S[s].prompt(`WRITE ${spelling}.txt on-target`);
    const wrote = read(`${DST(s)}/project`, `${spelling}.txt`); const src = read(`${SRC(s)}/project`, `${spelling}.txt`);
    const u = await h.json(`/session/${S[s].sessionId}/files/rewind`, { promptId: t.promptId, requestId: randomUUID() }, { clientId: S[s].clientId });
    rs.turns[s] = { load: ld.status, turn: P.term(t), target: wrote, source: src, undo: `${u.status}${u.json?.code ? ` ${u.json.code}` : ''}`, removed: !fs.existsSync(`${DST(s)}/project/${spelling}.txt`) };
    say(`   QWEN_HOME=${spelling} st-${s}: load=${ld.status} ${rs.turns[s].turn} target=${wrote} source=${src} undo ${rs.turns[s].undo} removed=${rs.turns[s].removed}`);
    await S[s].detach().catch(() => {});
  }
  R.restarts.push(rs); await h.stop();
}
await rig.stop(); L.svc('stop');
fs.writeFileSync(`${L.OUT}/s14-${TAG}.json`, JSON.stringify(R, null, 1));
say('S14-DONE');
