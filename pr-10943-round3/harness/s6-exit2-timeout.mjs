// S6 — the exit-2 "may still be starting" path, driven for real: stall the
// supervisor's first store write for a session past the client's 30 s
// dispatch cap, then let it finish.
import * as L from './lib.mjs';

const C = new L.Checks('s6-exit2-timeout');
const T = new L.Transcript('s6-exit2-timeout');
const STALL = Number(process.env.STALL ?? 33_000);
const sc = L.scenario('head', 's6');
const plog = L.path.join(sc.base, 'preload.log');
const out = L.path.join(sc.cwd, 'late.txt');
T.title(`exit 2 — supervisor store write stalled ${STALL / 1000} s (> 30 s client cap), head b8387983`);
T.cmd(`qwen --bg "BGWRITE:${out}"; echo "exit=$?"`);
const r = L.qwen(sc, ['--bg', `BGWRITE:${out}`], {
  env: {
    NODE_OPTIONS: `--require ${L.path.join(L.ROOT, 'harness', 'preload.cjs')}`,
    PR10943_STALL_MS: String(STALL),
    PR10943_PRELOAD_LOG: plog,
  },
  timeout: 120_000,
});
T.out(r.stdout);
T.err(r.stderr);
T.exit(r.code, r.ms);
C.check('stall-injected', L.existsSync(plog) && /supervisor store stall/.test(L.readFileSync(plog, 'utf8')), L.existsSync(plog) ? L.readFileSync(plog, 'utf8').trim().split('\n')[0] : 'no log');
C.check('exit2.code', r.code === 2, `exit ${r.code} after ${r.ms} ms`);
C.check('exit2.sentence', /^The background session may still be starting: .*Check: qwen sessions ps/m.test(r.stderr), r.stderr.trim());
C.check('exit2.near-30s-cap', r.ms >= 29_000 && r.ms < 36_000, `${r.ms} ms`);
const wrote = await L.waitFor(() => L.existsSync(out), { timeout: STALL + 30_000 });
C.check('exit2.truthful-session-ran-anyway', !!wrote, wrote ? 'worker wrote the file after the stall' : 'nothing ran');
const sid = (() => {
  try {
    return L.execFileSync('ls', [L.jobsDir(sc)]).toString().trim().split('\n')[0];
  } catch {
    return undefined;
  }
})();
const st = sid ? L.sessionFiles(sc, sid).state : undefined;
T.cmd('qwen sessions ps   # after the stall released');
const ps = L.qwen(sc, ['sessions', 'ps']);
T.out(ps.stdout);
T.note(`state.json: ${st?.sessionState}/${st?.processState}; ${L.path.basename(out)} ${wrote ? 'written by the worker' : 'missing'}`);
C.check('exit2.session-listed', ps.stdout.includes(sid?.slice(0, 8) ?? '@@'));
C.save({ code: r.code, ms: r.ms, stderr: r.stderr, sid, state: st, preload: L.existsSync(plog) ? L.readFileSync(plog, 'utf8') : '' });
L.killScenario(sc);
process.exit(0);
