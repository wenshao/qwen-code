// S4 — R14-2 end to end on Linux: the prompt sits in the detached worker's
// argv, readable by any other local account through /proc/<pid>/cmdline,
// while the same text at rest is owner-only. The home lives under /var/tmp
// so file modes, not /root's 0700, are the only barrier on the store side.
import * as L from './lib.mjs';

const C = new L.Checks('s4-r14-2-argv');
const T = new L.Transcript('s4-r14-2-argv');
const UUID = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/;
const base = '/var/tmp/pr10943-s4';
L.execFileSync('rm', ['-rf', base]);
const sc = L.scenario('head', 's4');
// Re-home the scenario under /var/tmp (traversable by other users).
for (const k of ['home', 'qhome', 'runtime', 'cwd']) {
  const p = L.path.join(base, k);
  L.mkdirSync(p, { recursive: true });
  if (k === 'qhome') L.execFileSync('cp', [L.path.join(sc.qhome, 'settings.json'), p]);
  sc[k] = p;
}
L.execFileSync('chmod', ['755', base, sc.cwd]);
sc.env = { ...sc.env, HOME: sc.home, QWEN_HOME: sc.qhome, QWEN_RUNTIME_DIR: sc.runtime };

const SECRET = 'INCIDENT-TOKEN-sk-secret-12345';
const asNobody = (args) => {
  try {
    return { ok: true, out: L.execFileSync('setpriv', ['--reuid=65534', '--regid=65534', '--clear-groups', ...args], { stdio: ['ignore', 'pipe', 'pipe'] }).toString() };
  } catch (e) {
    return { ok: false, out: String(e.stderr || e.message).trim() };
  }
};

const procMount = L.execFileSync('sh', ['-c', "grep ' /proc proc ' /proc/mounts"]).toString().trim();
T.title('R14-2 — the --bg prompt is world-readable in the worker\'s /proc/<pid>/cmdline (Linux)');
T.note(`/proc mount: ${procMount}   (no hidepid= → every account can read every cmdline)`);
T.cmd(`qwen --bg "${SECRET} please triage BGHOLD"`, 'root$');
const r = L.qwen(sc, ['--bg', `${SECRET} please triage BGHOLD`]);
T.out(r.stdout.split('\n')[0]);
T.exit(r.code, r.ms);
const sid = UUID.exec(r.stdout)?.[1];
C.check('started', r.code === 0 && !!sid);
await L.sleep(1500);
const pids = L.scenarioPids(sc);
const worker = pids.find((p) => L.role(p) === 'worker');
const others = pids.filter((p) => L.role(p) !== 'worker');
C.check('no-hidepid', !/hidepid=(1|2|invisible|noaccess)/.test(procMount), procMount);

const cmdline = asNobody(['cat', `/proc/${worker?.pid}/cmdline`]);
const visible = cmdline.ok && cmdline.out.includes(SECRET);
T.blank();
T.cmd(`cat /proc/${worker?.pid}/cmdline | tr '\\0' ' '`, 'nobody$');
T.out(cmdline.out.replace(/\0/g, ' ').replace(L.armDir('head'), '…'));
C.check('R14-2.nobody-reads-prompt-from-cmdline', visible, `uid 65534 read ${cmdline.out.length} bytes`);
const psOut = asNobody(['ps', '-eo', 'pid,user,args']);
const psLine = psOut.out.split('\n').find((l) => l.includes(SECRET)) ?? '';
T.cmd(`ps -eo pid,user,args | grep sk-secret`, 'nobody$');
T.out(psLine.replace(L.armDir('head'), '…').slice(0, 200));
C.check('R14-2.nobody-sees-prompt-in-ps', psLine.includes(SECRET));
C.check('only-worker-argv-carries-it', others.every((p) => !p.cmd.join(' ').includes(SECRET)), others.map((p) => L.role(p)).join(','));

const launchPath = L.path.join(sc.qhome, 'jobs', sid, 'launch.json');
const statePath = L.path.join(sc.qhome, 'jobs', sid, 'state.json');
const modes = L.execFileSync('stat', ['-c', '%a %U %n', L.path.join(sc.qhome, 'jobs', sid), launchPath, statePath]).toString().trim();
const atRest = L.readFileSync(launchPath, 'utf8').includes(SECRET) || L.readFileSync(statePath, 'utf8').includes(SECRET);
const nobodyLaunch = asNobody(['cat', launchPath]);
T.cmd(`cat ~/.qwen/jobs/${sid.slice(0, 8)}…/launch.json`, 'nobody$');
T.err(nobodyLaunch.out.replace(sc.qhome, '$QWEN_HOME').slice(0, 160));
T.note(modes.replace(new RegExp(sc.qhome, 'g'), '$QWEN_HOME'));
C.check('at-rest-copy-is-owner-only', atRest && !nobodyLaunch.ok && /Permission denied/.test(nobodyLaunch.out), modes);

// Lifetime: still exposed after the launcher is long gone.
await L.sleep(20_000);
const later = asNobody(['cat', `/proc/${worker?.pid}/cmdline`]);
C.check('R14-2.still-exposed-after-20s', later.ok && later.out.includes(SECRET));
T.bad(`still readable by nobody 20 s later (worker pid ${worker?.pid} alive, launcher exited)`);

C.save({ procMount, sid, workerPid: worker?.pid, modes, psLine: psLine.slice(0, 300) });
L.killScenario(sc);
process.exit(0);
