// S10 — N1 re-measured on Linux: a supervisor outlives its deleted home.
// SHORT: home path short enough for the in-home socket. LONG: >100-byte home
// path, so the socket falls back to the per-uid runtime dir.
import * as L from './lib.mjs';

const C = new L.Checks('s10-n1-stale-socket');
const T = new L.Transcript('s10-n1-stale-socket');
const extra = {};
T.title('N1 — delete ~/.qwen while its supervisor still runs, then --bg again (head b8387983, Linux)');
for (const kind of ['short', 'long']) {
  const sc = L.scenario('head', `s10-${kind}`);
  if (kind === 'long') {
    const deep = L.path.join(sc.base, 'a-very-long-directory-name-to-push-the-socket-path-past-one-hundred-bytes', 'qwen-home');
    L.mkdirSync(deep, { recursive: true });
    L.execFileSync('cp', [L.path.join(sc.qhome, 'settings.json'), deep]);
    sc.qhome = deep;
    sc.env = { ...sc.env, QWEN_HOME: deep };
  }
  const r1 = L.qwen(sc, ['--bg', 'BGPONG n1 first']);
  await L.sleep(1000);
  const sup = L.scenarioPids(sc).find((p) => L.role(p) === 'supervisor');
  const sockPath = L.readJson(L.path.join(sc.qhome, 'daemon', 'supervisor.json'))?.socketPath;
  // Delete the home (and recreate it with only its settings) while the supervisor runs.
  const settings = L.readFileSync(L.path.join(sc.qhome, 'settings.json'), 'utf8');
  L.execFileSync('rm', ['-rf', sc.qhome]);
  L.mkdirSync(sc.qhome, { recursive: true });
  L.writeFileSync(L.path.join(sc.qhome, 'settings.json'), settings);
  const r2 = L.qwen(sc, ['--bg', 'BGPONG n1 second'], { timeout: 60_000 });
  T.cmd(`QWEN_HOME=<${kind} path> qwen --bg …; rm -rf $QWEN_HOME; qwen --bg …`);
  T.note(`socket: ${sockPath?.replace(sc.base, '…')}  (${Buffer.byteLength(sockPath ?? '')} bytes)`);
  T.out(r2.stdout.split('\n')[0] || '');
  T.err(r2.stderr.trim().slice(0, 200));
  T.exit(r2.code, r2.ms);
  extra[kind] = { first: r1.code, second: r2.code, stderr: r2.stderr.trim().slice(0, 300), sockPath, oldSupervisor: sup?.pid };
  if (kind === 'short') C.check('n1.short-path-recovers', r1.code === 0 && r2.code === 0, `second exit ${r2.code}`);
  else C.check('n1.long-path-stale-socket-opaque-failure', r1.code === 0 && r2.code === 1 && /exited before becoming ready/.test(r2.stderr), `second exit ${r2.code}: ${r2.stderr.trim().slice(0, 140)}`);
  // kill both generations
  L.killScenario(sc);
  if (sup) {
    try {
      process.kill(sup.pid, 'SIGKILL');
    } catch {
      /* gone */
    }
  }
}
C.save(extra);
process.exit(0);
