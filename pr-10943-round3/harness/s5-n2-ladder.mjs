// S5 — N2 made deterministic: delay the PTY host's start by N ms (a preload
// that blocks before the host can bind its socket) and see where `--bg`
// starts failing. The code models a ~15 s wall budget for this wait.
import * as L from './lib.mjs';

const C = new L.Checks(`s5-n2-ladder${process.env.ARM ? '-' + process.env.ARM : ''}`);
const T = new L.Transcript(`s5-n2-ladder${process.env.ARM ? '-' + process.env.ARM : ''}`);
const LADDER = (process.env.LADDER ?? '0,1000,2000,2400,2800,3500,6000,12000').split(',').map(Number);
const rows = [];
T.title(process.env.ARM === 'headmut' ? 'N2 positive control — same bundle, waitForPtyHost loop bounded by its deadline only (Linux)' : 'N2 — PTY-host ready wait: documented ~15 s budget vs measured cliff (head b8387983, Linux)');
T.note('PTY host start delayed by N ms via NODE_OPTIONS=--require preload (blocks before the host binds its socket)');
T.w(`\x1b[1m${'delay N'.padEnd(10)}${'exit'.padEnd(6)}${'wall'.padEnd(9)}${'state.json'.padEnd(22)}result\x1b[0m\n`);
for (const n of LADDER) {
  const sc = L.scenario(process.env.ARM ?? 'head', `s5-${n}`);
  const plog = L.path.join(sc.base, 'preload.log');
  const r = L.qwen(sc, ['--bg', `BGHOLD n2 ${n}`], {
    env: {
      NODE_OPTIONS: `--require ${L.path.join(L.ROOT, 'harness', 'preload.cjs')}`,
      PR10943_PTYHOST_DELAY_MS: String(n),
      PR10943_PRELOAD_LOG: plog,
    },
    timeout: 90_000,
  });
  await L.sleep(n + 1500);
  let state;
  try {
    const sid = L.execFileSync('ls', [L.jobsDir(sc)]).toString().trim().split('\n')[0];
    state = L.sessionFiles(sc, sid).state;
  } catch {
    state = undefined;
  }
  const delayed = L.existsSync(plog) ? L.readFileSync(plog, 'utf8').includes(`delayed ${n}ms`) : n === 0;
  const row = {
    n,
    code: r.code,
    ms: r.ms,
    stderr: r.stderr.trim().slice(0, 300),
    sessionState: state?.sessionState,
    processState: state?.processState,
    failure: state?.failure ?? state?.lastError ?? undefined,
    delayed,
  };
  rows.push(row);
  const res = r.code === 0 ? 'Started background session' : r.stderr.trim().split('\n')[0].replace('Could not start a background session: ', '').slice(0, 70);
  T.w(`${(n / 1000).toFixed(1).padStart(5)} s   ${String(r.code).padEnd(6)}${(r.ms / 1000).toFixed(2).padStart(5)} s   ${`${state?.sessionState}/${state?.processState}`.padEnd(22)}${r.code === 0 ? '\x1b[32m' : '\x1b[31m'}${res}\x1b[0m\n`);
  console.log(JSON.stringify(row));
  L.killScenario(sc);
}
const firstFail = rows.find((r) => r.code !== 0);
const lastOk = [...rows].reverse().find((r) => r.code === 0 && (!firstFail || r.n < firstFail.n));
const fails = rows.filter((r) => r.code !== 0);
C.check('preload-applied', rows.every((r) => r.delayed), rows.map((r) => `${r.n}:${r.delayed}`).join(' '));
if (process.env.ARM === 'headmut') {
  // Positive control: the only assertion that means anything here is that
  // every rung starts once the attempt cap is gone.
  C.check('positive-control.every-rung-starts', rows.length > 0 && rows.every((r) => r.code === 0 && r.sessionState === 'working'), rows.map((r) => `${r.n}→${r.code}/${r.ms}ms`).join(' '));
} else {
  C.check('small-delays-succeed', rows.some((r) => r.n <= 2000) && rows.filter((r) => r.n <= 2000).every((r) => r.code === 0));
  C.check(
    'N2.cliff-well-below-15s',
    !!firstFail && firstFail.n <= 3500 && /PTY host did not become ready/.test(firstFail.stderr),
    firstFail ? `first failure at N=${firstFail.n} after ${firstFail.ms} ms: ${firstFail.stderr.slice(0, 120)}` : 'no failure',
  );
  C.check('N2.failures-give-up-at-~2.6s', fails.length > 0 && fails.every((r) => r.ms < 4500), fails.map((r) => `${r.n}→${r.ms}ms`).join(' '));
  C.check('N2.failed-session-recorded', fails.length > 0 && fails.every((r) => r.sessionState === 'failed'), fails.map((r) => `${r.sessionState}/${r.processState}`).join(' '));
}
T.note(firstFail ? `cliff between N=${lastOk?.n} ms (ok) and N=${firstFail?.n} ms (fail); every failure gives up after ≈${Math.round(fails.reduce((a, r) => a + r.ms, 0) / fails.length)} ms wall` : 'no rung fails: the ~15 s deadline the code already computes is honored once the 50-attempt cap stops cutting it short');
C.save({ ladder: rows });
process.exit(0);
