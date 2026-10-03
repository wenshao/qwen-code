// S1 — central claim A/B on Linux: `qwen --bg` and the supervisor spawn shape.
import * as L from './lib.mjs';

const ARM = process.env.ARM;
if (ARM !== 'head' && ARM !== 'base') throw new Error('ARM=head|base required');
const C = new L.Checks(`s1-core-${ARM}`);
const T = new L.Transcript(`s1-core-${ARM}`);
const UUID = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/;
const extra = {};

const sc = L.scenario(ARM, 's1');
T.title(`${ARM} @ ${ARM === 'head' ? 'b8387983' : 'b3dda468'} — Linux ${process.version}`);
const out1 = L.path.join(sc.cwd, 'out1.txt');
const led0 = L.ledgerLen();
T.cmd(`qwen --bg "BGWRITE:${out1}"`);
const r1 = L.qwen(sc, ['--bg', `BGWRITE:${out1}`]);
T.out(r1.stdout);
T.err(r1.stderr.split('\n').filter((l) => /Unknown|Could not|needs/.test(l)).join('\n'));
T.exit(r1.code, r1.ms);
extra.first = { code: r1.code, ms: r1.ms, stdout: r1.stdout, stderr: r1.stderr.slice(-800) };

if (ARM === 'base') {
  C.check('base.bg.rejected', r1.code === 1 && /Unknown argument: bg/.test(r1.stderr), `exit ${r1.code}`);
  await L.sleep(1500);
  C.check('base.bg.no-supervisor', L.scenarioPids(sc).length === 0, `${L.scenarioPids(sc).length} pids`);
  C.check('base.bg.no-session', !L.existsSync(L.jobsDir(sc)) || L.execFileSync('ls', [L.jobsDir(sc)]).toString().trim() === '');
} else {
  const sid = UUID.exec(r1.stdout)?.[1];
  C.check('head.bg.exit0', r1.code === 0, `exit ${r1.code} in ${r1.ms} ms`);
  C.check(
    'head.bg.stdout-contract',
    /^Started background session [0-9a-f-]{36}\nSee it with: qwen sessions ps\n$/.test(r1.stdout),
    JSON.stringify(r1.stdout),
  );
  extra.sid = sid;
  await L.sleep(1000);
  const pids = L.scenarioPids(sc);
  const sup = pids.filter((p) => L.role(p) === 'supervisor');
  const host = pids.filter((p) => L.role(p) === 'pty-host');
  const worker = pids.filter((p) => L.role(p) === 'worker');
  extra.tree = pids.map((p) => ({ pid: p.pid, ppid: p.ppid, role: L.role(p), argv: p.cmd.slice(1) }));
  C.check('head.tree.one-supervisor-detached', sup.length === 1 && sup[0].ppid === 1, JSON.stringify(sup.map((p) => [p.pid, p.ppid])));
  C.check('head.tree.host-under-supervisor', host.length === 1 && host[0].ppid === sup[0]?.pid);
  C.check('head.tree.worker-under-host', worker.length === 1 && worker[0].ppid === host[0]?.pid);
  const wargv = worker[0]?.cmd ?? [];
  C.check(
    'head.worker.argv',
    wargv.includes('--session-id') && wargv[wargv.indexOf('--session-id') + 1] === sid && wargv.includes(`--prompt-interactive=BGWRITE:${out1}`),
    wargv.slice(1).join(' '),
  );
  T.note('process tree (ppid ← pid):');
  for (const p of pids) T.out(`  ${L.role(p).padEnd(10)} pid ${p.pid}  ppid ${p.ppid}  ${p.cmd.slice(2).join(' ').slice(0, 110)}`);

  const wrote = await L.waitFor(() => L.existsSync(out1), { timeout: 40_000 });
  C.check('head.worker.ran-prompt', wrote && L.readFileSync(out1, 'utf8') === 'written by the background worker\n');
  await L.sleep(1500);
  const led = L.ledgerSince(led0).filter((l) => l.lastUser.includes(out1));
  const turns = led.filter((l) => l.kind === 'bgwrite').length;
  const done = led.filter((l) => l.kind === 'bgwrite-done').length;
  C.check('head.worker.prompt-delivered-once', turns === 1 && done === 1, `bgwrite=${turns} done=${done}`);
  T.ok(`worker wrote ${L.path.basename(out1)}; model ledger: ${turns} tool-call turn, ${done} follow-up`);

  const f = L.sessionFiles(sc, sid);
  extra.state = f.state;
  extra.worker = f.worker;
  C.check('head.state.working', f.state?.sessionState === 'working' && f.state?.ownership === 'managed', `${f.state?.sessionState}/${f.state?.processState}`);
  C.check(
    'head.worker.linux-identity-fields',
    f.worker?.platform === 'linux' && !!f.worker?.hostProcStart && !!f.worker?.workerProcStart && Number.isInteger(f.worker?.pidNs),
    `hostProcStart=${f.worker?.hostProcStart} workerProcStart=${f.worker?.workerProcStart} pidNs=${f.worker?.pidNs}`,
  );
  C.check('head.worker.pids-match-tree', f.worker?.hostPid === host[0]?.pid && f.worker?.workerPid === worker[0]?.pid);
  T.note(`state.json: sessionState=${f.state?.sessionState} processState=${f.state?.processState}`);
  T.note(`worker.json (linux): hostProcStart=${f.worker?.hostProcStart}`);
  T.note(`                     workerProcStart=${f.worker?.workerProcStart} pidNs=${f.worker?.pidNs}`);

  // Warm launch reuses the same supervisor.
  const out2 = L.path.join(sc.cwd, 'out2.txt');
  T.blank();
  T.cmd(`qwen --bg "BGWRITE:${out2}"`);
  const r2 = L.qwen(sc, ['--bg', `BGWRITE:${out2}`]);
  T.out(r2.stdout);
  T.err(r2.stderr);
  T.exit(r2.code, r2.ms);
  extra.second = { code: r2.code, ms: r2.ms };
  await L.sleep(800);
  const sup2 = L.scenarioPids(sc).filter((p) => L.role(p) === 'supervisor');
  C.check('head.warm.reuses-supervisor', r2.code === 0 && sup2.length === 1 && sup2[0].pid === sup[0]?.pid, `ms=${r2.ms}`);
  const wrote2 = await L.waitFor(() => L.existsSync(out2), { timeout: 40_000 });
  C.check('head.warm.worker-ran', !!wrote2);

  // sessions ps (R15-2 / O1 measured on Linux)
  T.blank();
  T.cmd('qwen sessions ps');
  const ps = L.qwen(sc, ['sessions', 'ps']);
  T.out(ps.stdout);
  T.err(ps.stderr);
  const psj = L.qwen(sc, ['sessions', 'ps', '--json']);
  const lines = psj.stdout.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  extra.ps = ps.stdout;
  extra.psJson = lines;
  const forSid = lines.filter((l) => JSON.stringify(l).includes(sid));
  C.check('head.ps.lists-session', ps.code === 0 && ps.stdout.includes(sid.slice(0, 8)));
  C.check('head.ps.R15-2-two-rows-per-session', forSid.length === 2 && forSid.some((l) => l.managed === true) && forSid.some((l) => l.kind === 'tui'), `${forSid.length} json lines for one session`);
  extra.psRowsForSid = forSid.length;
  extra.psRowsTotal = lines.length;
  T.note(`sessions ps --json: ${lines.length} lines for 2 background sessions; ${forSid.length} carry session ${sid.slice(0, 8)}…`);
}

// The supervisor's own spawn shape, driven directly.
const sc2 = L.scenario(ARM, 's1sup');
T.blank();
T.cmd('qwen --internal-agent-view-supervisor   # the argv the supervisor spawns itself with');
const child = L.spawn(L.NODE, [sc2.entry, '--internal-agent-view-supervisor'], {
  cwd: sc2.cwd,
  env: sc2.env,
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serr = '';
child.stderr.on('data', (d) => (serr += d));
let exited = null;
child.on('exit', (code) => (exited = code));
await L.waitFor(() => exited !== null || L.existsSync(L.path.join(sc2.qhome, 'daemon', 'supervisor.json')), { timeout: 15_000 });
await L.sleep(500);
if (ARM === 'base') {
  await L.waitFor(() => exited !== null, { timeout: 10_000 });
  T.err(serr.split('\n').filter((l) => /Unknown/.test(l)).join('\n'));
  T.exit(exited);
  C.check('base.supervisor-shape.rejected', exited === 1 && /Unknown arguments?: .*internal-agent-view-supervisor/.test(serr), `exit ${exited}`);
} else {
  const rec = L.readJson(L.path.join(sc2.qhome, 'daemon', 'supervisor.json'));
  C.check('head.supervisor-shape.serves', exited === null && rec?.pid === child.pid, `supervisor.json pid=${rec?.pid} child=${child.pid}`);
  const client = await L.supervisorClient(sc2);
  let status;
  try {
    status = await client.status();
  } catch (e) {
    status = { error: String(e) };
  }
  C.check('head.supervisor-shape.status-rpc', status && !status.error, JSON.stringify(status).slice(0, 200));
  T.ok(`serving: supervisor.json pid ${rec?.pid}; status RPC answered`);
  await client.shutdown(false).catch(() => {});
  await L.waitFor(() => exited !== null, { timeout: 10_000 });
  C.check('head.supervisor-shape.shutdown', exited !== null, `exit ${exited}`);
  T.note(`shutdown RPC → exit ${exited}`);
}
if (exited === null) child.kill('SIGKILL');

C.save(extra);
if (process.env.KEEP !== '1') {
  L.killScenario(sc);
  L.killScenario(sc2);
}
process.exit(0);
