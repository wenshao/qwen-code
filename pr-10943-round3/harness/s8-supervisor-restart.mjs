// S8 — what a supervisor restart does to an already-running --bg session.
// MODE=kill: SIGKILL the supervisor (crash/OOM). MODE=shutdown: its own
// shutdown RPC with keepWorkers. Then the next `--bg` starts a fresh
// supervisor; watch the first session's worker and the model ledger.
import * as L from './lib.mjs';

const MODE = process.env.MODE ?? 'kill';
const WAIT = Number(process.env.WAIT ?? 20_000);
const C = new L.Checks(`s8-restart-${MODE}`);
const T = new L.Transcript(`s8-restart-${MODE}`);
const UUID = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/;
const sc = L.scenario('head', `s8-${MODE}`);
const f1 = L.path.join(sc.cwd, 'first.txt');
const led0 = L.ledgerLen();
T.title(`supervisor ${MODE === 'kill' ? 'SIGKILL (crash)' : 'shutdown RPC (keepWorkers)'} while a --bg session lives (head b8387983)`);
T.cmd(`qwen --bg "BGWRITE:${L.path.basename(f1)}"`);
const r1 = L.qwen(sc, ['--bg', `BGWRITE:${f1}`]);
const sid1 = UUID.exec(r1.stdout)?.[1];
T.out(r1.stdout.split('\n')[0]);
await L.waitFor(() => L.existsSync(f1), { timeout: 40_000 });
await L.sleep(WAIT);
const before = L.scenarioPids(sc);
const sup = before.find((p) => L.role(p) === 'supervisor');
const w1 = before.find((p) => L.role(p) === 'worker');
const h1 = before.find((p) => L.role(p) === 'pty-host');
const st0 = L.sessionFiles(sc, sid1).state;
T.note(`after ${WAIT / 1000} s: supervisor ${sup?.pid}, host ${h1?.pid}, worker ${w1?.pid}; state ${st0?.sessionState}/${st0?.processState}`);
if (MODE === 'kill') {
  process.kill(sup.pid, 'SIGKILL');
  T.cmd(`kill -9 ${sup.pid}   # supervisor crashes`);
} else {
  const client = await L.supervisorClient(sc);
  await client.shutdown(true).catch(() => {});
  T.note('supervisor shutdown RPC with keepWorkers=true');
}
await L.waitFor(() => !L.scenarioPids(sc).some((p) => p.pid === sup.pid), { timeout: 10_000 });
const mid = L.scenarioPids(sc);
T.note(`after the supervisor went: ${mid.map((p) => `${L.role(p)} ${p.pid}`).join(', ')}`);
const f2 = L.path.join(sc.cwd, 'second.txt');
T.cmd(`qwen --bg "BGWRITE:${L.path.basename(f2)}"   # next launch starts a fresh supervisor`);
const r2 = L.qwen(sc, ['--bg', `BGWRITE:${f2}`]);
T.out(r2.stdout.split('\n')[0] || r2.stderr.trim());
T.exit(r2.code, r2.ms);
await L.waitFor(() => L.existsSync(f2), { timeout: 40_000 });
await L.sleep(WAIT);
const after = L.scenarioPids(sc);
const st1 = L.sessionFiles(sc, sid1).state;
const wk1 = L.sessionFiles(sc, sid1).worker;
const workersFor1 = after.filter((p) => L.role(p) === 'worker' && p.cmd.includes(sid1));
const turns1 = L.ledgerSince(led0).filter((l) => l.kind === 'bgwrite' && l.lastUser.includes(f1)).length;
T.note(`session 1 now: state ${st1?.sessionState}/${st1?.processState}; worker pids ${workersFor1.map((p) => p.pid).join(',') || 'none'} (was ${w1?.pid})`);
T.note(`model ledger: session 1's prompt ran ${turns1} time(s)`);
T.cmd('qwen sessions ps');
const ps = L.qwen(sc, ['sessions', 'ps']);
T.out(ps.stdout);
C.check('second-launch-ok', r2.code === 0, `exit ${r2.code} ${r2.stderr.trim().slice(0, 120)}`);
C.check('first-worker-survived-restart', workersFor1.some((p) => p.pid === w1?.pid), `before ${w1?.pid} after ${workersFor1.map((p) => p.pid)}`);
C.check('first-prompt-not-rerun', turns1 === 1, `${turns1} bgwrite turns for session 1`);
C.check('first-session-not-marked-failed', st1?.sessionState !== 'failed', `${st1?.sessionState}/${st1?.processState} ${JSON.stringify(st1?.failure ?? '')}`);
C.save({ sid1, before: before.map((p) => ({ r: L.role(p), pid: p.pid })), after: after.map((p) => ({ r: L.role(p), pid: p.pid, sid: p.cmd.includes(sid1) })), st0, st1, wk1, turns1, ps: ps.stdout });
L.killScenario(sc);
process.exit(0);
