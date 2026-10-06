// PR #13260 S8 (round 3, new): concurrent promote / abort / W1a restore-original on one storage, exact head, MySQL 8.4.
// Each cycle prepares a fresh operation (retire -> W1a fence -> W1b capture -> cp -a -> prepare) from the storage's CURRENT
// root, then races operator commands against `promote`. Deterministic interleavings pause the promote JVM (SIGSTOP) the
// instant its marker temporary appears in the target root (inotify), run the competing command to completion, then resume.
// Random interleavings start `abort` at a fraction of a measured promote duration. Invariants are checked after every cycle.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import * as L from './lib.mjs';
import * as W from './w1bc.mjs';
import * as P from './pop.mjs';
import * as M from './w1c.mjs';
const TAG = process.env.TAG ?? 's8';
L.openLog(`s8-${TAG}`);
const { say } = L;
const R = { tag: TAG, cycles: [] };
say(L.hostFacts());

// ---- population: one Files Session with retained history on st-a, one on st-b; then offline
await P.rollout(['a', 'b']);
L.seedWs('ws-a1', 'a'); L.seedWs('ws-b1', 'b');
const rig = await L.startRig(`s8-${TAG}`);
const S = new L.HSession(rig.h, await L.createSession('ws-a1'), 'ws-a1'); await S.create(L.FILES);
for (const t of ['WRITE notes.txt v1', 'WRITE notes.txt v2', 'WRITE notes.txt v3']) say(`   F ${t}: ${P.term(await S.prompt(t))}`);
await S.detach(); await rig.h.stop(); L.svc('stop'); await W.waitLeasesExpired('a');
const MEMBERS = W.members('a').map((m) => m.id);
// N1 (round 1) remedy: a history root born in the same tick as its only Session directory has birth == mtime.
const hst = () => L.sh(`stat -c '%W.%w|%Y.%y' ${W.historyRoot()}`);
R.historyRootBeforeTouch = hst(); L.sh(`runuser -u w1crig -- touch ${W.historyRoot()}`); R.historyRootAfterTouch = hst();
say(`   history root birth|mtime before touch: ${R.historyRootBeforeTouch} | after: ${R.historyRootAfterTouch}`);

const markerPath = (root) => path.join(root, '.qwen-managed-storage.json');
const tmpIn = (root) => { try { return fs.readdirSync(root).filter((n) => n.endsWith('.tmp')); } catch { return []; } };
const markerReg = (root) => { try { return JSON.parse(fs.readFileSync(markerPath(root), 'utf8')).registrationId; } catch (e) { return `<${e.code ?? 'bad'}>`; } };
const migFull = (id) => L.sql(`SELECT state, IFNULL(last_error_code,'-'), target_registration_id FROM managed_workspace_migration WHERE operation_id='${id}'`)[0];

let current = '/srv/pr13260/src/a';
// README: the registration (W1a) commands also inherit the deployment's canonical QWEN_HOME once a storage has migrated.
const MENV = { extraEnv: { QWEN_HOME: M.homeOf() } };
async function prepareCycle(i) {
  const src = current;
  const dst = src.startsWith('/srv/pr13260/src/') ? `/srv/pr13260/dst/a${i}` : `/srv/pr13260/src/a${i}`;
  const m0 = L.mountRow('a');
  const bundle = `/srv/pr13260/bundles/${TAG}-${i}`;
  L.sh(`rm -rf ${bundle} ${dst}`);
  const req = M.migrationRequest({ revision: m0.revision, source: src, target: dst, bundle });
  const file = M.writeRequest(req, `${TAG}-${i}`);
  const steps = [];
  steps.push(M.migSummary(await M.mig('retire', file, { label: `${TAG}-${i}-retire`, quiet: true })));
  const f = L.maint(['fence', L.TENANT, 'st-a', src, String(m0.revision), req.fenceOperationId, '--offline-confirmed'], MENV);
  steps.push(`fence exit=${f.code}`);
  L.sh(`rm -rf ${bundle} && mkdir -p ${bundle}/file-history && cp -a ${src} ${bundle}/workspace`);
  for (const s of MEMBERS) if (fs.existsSync(`${W.historyRoot()}/${s}`)) L.sh(`cp -a ${W.historyRoot()}/${s} ${bundle}/file-history/${s}`);
  L.chownRig(bundle);
  const cap = await W.w1b('capture', W.captureRequest({ op: req.captureOperationId, fence: req.fenceOperationId, revision: m0.revision, bundle, sourceRoot: src }), { label: `${TAG}-${i}-capture`, quiet: true });
  steps.push(`capture ${cap.json?.state}`);
  L.sh(`cp -a ${src} ${dst}`);
  const p = await M.mig('prepare', file, { label: `${TAG}-${i}-prepare`, quiet: true });
  steps.push(`prepare ${p.json?.state}`);
  if (p.json?.state !== 'PREPARED') throw new Error(`cycle ${i} not prepared: ${steps.join(' | ')} ${M.migSummary(p)}`);
  return { i, src, dst, req, file, m0, steps, sourceMarker: fs.readFileSync(markerPath(src), 'utf8') };
}

// Start a promote whose JVM is SIGSTOPped as soon as its marker temporary is created in the target root.
function pausedPromote(c, label) {
  const cfg = L.env();
  const env = { PATH: '/usr/local/bin:/usr/bin:/bin', W1_JDBC_URL: `jdbc:mysql://127.0.0.1:${cfg.DBPORT}/${L.DB()}?allowPublicKeyRetrieval=true&useSSL=false`,
    W1_JDBC_USER: 'root', W1_JDBC_PASSWORD: cfg.DBPASS, ...M.CRED, QWEN_HOME: M.homeOf() };
  const args = ['-Duser.timezone=UTC', '-jar', M.MIG_JAR, 'promote', c.file, '--offline-confirmed'];
  const child = spawn('/opt/pr13260/jdk/bin/java', args, { ...L.RUNAS, env, cwd: '/tmp', stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = ''; let stderr = ''; child.stdout.on('data', (d) => { stdout += d; }); child.stderr.on('data', (d) => { stderr += d; });
  const t0 = Date.now();
  let resolvePaused; const paused = new Promise((r) => { resolvePaused = r; });
  const watcher = fs.watch(c.dst, (ev, name) => {
    if (String(name).endsWith('.tmp') && !child.killed) {
      try { process.kill(child.pid, 'SIGSTOP'); } catch { /* gone */ }
      watcher.close();
      resolvePaused({ at: Date.now() - t0, ev, name: String(name), row: migFull(c.req.migrationOperationId), fence: M.fenceRow('a'), tmp: tmpIn(c.dst) });
    }
  });
  const done = new Promise((r) => child.on('close', (code) => { watcher.close(); const lines = stdout.split('\n').filter(Boolean); let json = null; try { json = JSON.parse(lines.at(-1)); } catch { /* refusal */ }
    const workerLine = stderr.split('\n').find((l) => /^[a-z0-9_]{1,64}: /.test(l)) ?? '';
    const cause = [...`${stdout}\n${stderr}`.matchAll(/(?:Exception|Error|Failure): ([^\n]+)/g)].map((m) => m[1]).at(-1) ?? '';
    fs.writeFileSync(path.join(L.OUT, `mig-${label}.txt`), `$ java ${args.join(' ')}\nexit=${code}\n--- stdout\n${stdout}\n--- stderr\n${stderr}`);
    r({ code, json, workerLine, cause, ms: Date.now() - t0, stdout, stderr }); }));
  return { child, paused, done, resume: () => process.kill(child.pid, 'SIGCONT') };
}
const outcome = (r) => r.code === 0 ? `exit=0 ${r.json?.state}${r.json?.result_json ? ` rev=${r.json.result_json.mountRevision}` : ''}` : `exit=${r.code} REFUSED ${(r.workerLine || r.cause || r.stderr?.trim().split('\n').at(-1) || '').slice(0, 110)}`;

// Invariants after a cycle; returns the list of violations (empty = all hold).
function check(c, extra = {}) {
  const row = migFull(c.req.migrationOperationId); const m = L.mountRow('a'); const fence = M.fenceRow('a');
  const v = [];
  const st = row?.[0];
  if (!['COMPLETED', 'ABORTED'].includes(st)) v.push(`final migration state ${st}`);
  if (fence) v.push(`storage fence still installed (${fence.slice(0, 8)})`);
  if (st === 'COMPLETED') {
    if (m.revision !== c.m0.revision + 1) v.push(`revision ${c.m0.revision}->${m.revision} (want +1)`);
    if (m.state !== 'READY' || m.root !== c.dst) v.push(`mount ${m.state} @ ${m.root}`);
    if (markerReg(c.dst) !== row[2]) v.push(`target marker reg ${markerReg(c.dst)} != ${row[2]}`);
    if (tmpIn(c.dst).length) v.push(`temporary left in target: ${tmpIn(c.dst)}`);
  }
  if (st === 'ABORTED') {
    if (m.revision !== c.m0.revision) v.push(`aborted but revision ${c.m0.revision}->${m.revision}`);
    if (m.root !== c.src) v.push(`aborted but mount root ${m.root}`);
  }
  if (fs.readFileSync(markerPath(c.src), 'utf8') !== c.sourceMarker) v.push('source marker changed');
  return { state: st, lastError: row?.[1], mount: `${m.state} rev ${c.m0.revision}->${m.revision} @ ${m.root === c.dst ? 'target' : m.root === c.src ? 'source' : m.root}`,
    fence: fence ? 'installed' : 'cleared', targetMarker: markerReg(c.dst) === row?.[2] ? 'migration marker' : markerReg(c.dst) === JSON.parse(c.sourceMarker).registrationId ? 'source copy' : markerReg(c.dst),
    targetTmp: tmpIn(c.dst).length, violations: v, ...extra };
}
// Close out a cycle: an aborted operation goes back to service through W1a restore-original at the source.
function settle(c, res) {
  if (res.state === 'ABORTED') {
    const ro = L.maint(['restore-original', L.TENANT, 'st-a', c.src, String(c.m0.revision), c.req.fenceOperationId, '--offline-confirmed'], MENV);
    res.restoreOriginal = `exit=${ro.code}${ro.code ? ` ${ro.cause}` : ''} -> ${L.mstr(L.mountRow('a')).slice(0, 40)}`;
  } else if (res.state === 'COMPLETED') current = c.dst;
  return res;
}
const log = (c, name, res) => { say(`   [${c.i}] ${name}: ${res.summary}`); say(`       final: ${res.state} lastError=${res.lastError} | mount ${res.mount} | fence ${res.fence} | target marker=${res.targetMarker} tmp=${res.targetTmp}${res.restoreOriginal ? ` | restore-original ${res.restoreOriginal}` : ''} | violations: ${res.violations.length ? res.violations.join('; ') : 'none'}`);
  R.cycles.push({ i: c.i, name, src: c.src, dst: c.dst, steps: c.steps, ...res }); };

let i = 0;
let promoteMs = null;
say('== D1 promote paused at its marker temporary -> abort -> resume promote');
{ const c = await prepareCycle(++i); const p = pausedPromote(c, `${TAG}-${c.i}-promote`); const at = await Promise.race([p.paused, p.done.then((r) => ({ at: -1, row: ['never-paused'], fence: null, tmp: [], early: outcome(r) }))]);
  const ab = await M.mig('abort', c.file, { label: `${TAG}-${c.i}-abort`, quiet: true }); p.resume(); const pr = await p.done;
  const res = check(c); res.summary = `paused ${at.at} ms (row ${at.row[0]}, fence ${at.fence ? 'installed' : 'cleared'}, tmp ${at.tmp.join(',')}) | abort ${outcome(ab)} | resumed promote ${outcome(pr)}`;
  log(c, 'D1 abort while promote paused', settle(c, res)); }

say('== D2 promote paused at its marker temporary -> second promote -> resume first');
{ const c = await prepareCycle(++i); const p = pausedPromote(c, `${TAG}-${c.i}-promote-a`); const at = await Promise.race([p.paused, p.done.then((r) => ({ at: -1, row: ['never-paused'], fence: null, tmp: [], early: outcome(r) }))]);
  const p2 = await M.mig('promote', c.file, { label: `${TAG}-${c.i}-promote-b`, quiet: true }); const midRev = L.mountRow('a').revision; p.resume(); const pr = await p.done;
  const res = check(c); res.summary = `paused ${at.at} ms | second promote ${outcome(p2)} (revision then ${midRev}) | resumed first ${outcome(pr)} | revision after both ${L.mountRow('a').revision}`;
  log(c, 'D2 promote vs promote', settle(c, res)); }

say('== D3 promote paused at its marker temporary -> W1a restore-original -> resume promote');
{ const c = await prepareCycle(++i); const p = pausedPromote(c, `${TAG}-${c.i}-promote`); const at = await Promise.race([p.paused, p.done.then((r) => ({ at: -1, row: ['never-paused'], fence: null, tmp: [], early: outcome(r) }))]);
  const ro = L.maint(['restore-original', L.TENANT, 'st-a', c.src, String(c.m0.revision), c.req.fenceOperationId, '--offline-confirmed'], MENV);
  const mid = L.mstr(L.mountRow('a')).slice(0, 40); p.resume(); const pr = await p.done;
  const res = check(c); res.summary = `paused ${at.at} ms | restore-original exit=${ro.code} ${ro.code ? ro.cause.slice(0, 90) : ro.out} (mount then ${mid}) | resumed promote ${outcome(pr)}`;
  log(c, 'D3 W1a restore-original while promote paused', settle(c, res)); }

say('== D4 W1a restore-original while PREPARED (no promote running), then promote');
{ const c = await prepareCycle(++i);
  const ro = L.maint(['restore-original', L.TENANT, 'st-a', c.src, String(c.m0.revision), c.req.fenceOperationId, '--offline-confirmed'], MENV);
  const pr = await M.mig('promote', c.file, { label: `${TAG}-${c.i}-promote`, quiet: true }); if (pr.code === 0) promoteMs = pr.ms;
  const res = check(c); res.summary = `restore-original exit=${ro.code} ${ro.code ? ro.cause.slice(0, 90) : ro.out} | promote ${outcome(pr)}`;
  log(c, 'D4 restore-original vs PREPARED', settle(c, res)); }

say('== R abort at a fraction of the promote duration (unpaused, real concurrency)');
for (const frac of [0.05, 0.3, 0.6, 0.85, 0.95, 1.1]) {
  const c = await prepareCycle(++i);
  const t0 = Date.now();
  const pp = M.mig('promote', c.file, { label: `${TAG}-${c.i}-promote`, quiet: true });
  const delay = Math.round(frac * (promoteMs ?? 6000));
  await L.sleep(delay);
  const ab = await M.mig('abort', c.file, { label: `${TAG}-${c.i}-abort`, quiet: true }); const abAt = Date.now() - t0;
  const pr = await pp;
  const res = check(c); res.summary = `abort started at +${delay} ms (finished +${abAt} ms) ${outcome(ab)} | promote ${outcome(pr)} (${pr.ms} ms)`;
  log(c, `R abort@${frac}`, settle(c, res));
}
say('== R promote || promote (two processes started together)');
for (let k = 0; k < 3; k++) {
  const c = await prepareCycle(++i);
  const [a, b] = await Promise.all([M.mig('promote', c.file, { label: `${TAG}-${c.i}-promote-a`, quiet: true }), M.mig('promote', c.file, { label: `${TAG}-${c.i}-promote-b`, quiet: true })]);
  const res = check(c); res.summary = `A ${outcome(a)} | B ${outcome(b)} | identical receipts=${a.stdout === b.stdout}`;
  log(c, `R promote||promote #${k + 1}`, settle(c, res));
}

say('== final: the storage is serviceable at its final root (fresh Spring with that mapping, cold load, write, undo)');
say('  ', L.svc(`ROOT_a=${current}`, 'start').split('\n').at(-1).slice(0, 200));
const h2 = await new L.Harness({ name: `s8-${TAG}-after`, modelUrl: rig.model.baseUrl, brokerUrl: rig.proxy.url, port: Number(process.env.HPORT ?? 0) }).start();
S.bind(h2); const ld = await S.load(L.FILES); const t = await S.prompt('WRITE final.txt after-races');
R.final = { root: current, load: ld.status, turn: P.term(t), file: (() => { try { return fs.readFileSync(`${current}/project/final.txt`, 'utf8'); } catch (e) { return `<${e.code}>`; } })(), mount: L.mstr(L.mountRow('a')) };
say(`   final root ${current}: load=${ld.status} turn=${R.final.turn} final.txt=${R.final.file} | ${R.final.mount}`);
R.violations = R.cycles.reduce((n, x) => n + x.violations.length, 0);
say(`   cycles=${R.cycles.length} outcomes: ${Object.entries(R.cycles.reduce((a, x) => { a[x.state] = (a[x.state] ?? 0) + 1; return a; }, {})).map(([k, v]) => `${k}×${v}`).join(' ')} | invariant violations=${R.violations}`);
await S.detach().catch(() => {}); await h2.stop(); await rig.stop(); L.svc('stop');
fs.writeFileSync(`${L.OUT}/s8-${TAG}.json`, JSON.stringify(R, null, 1));
say('S8-DONE');
