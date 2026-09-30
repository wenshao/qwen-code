// S9 (Linux, delegated cgroup v2): managed command Hooks on the real stack — execution inside a fresh cgroup unit,
// detached descendant, TERM-ignoring child on cancellation, deny, recipe env on argv.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { repairLeak, Report, Harness, HSession, startModel, workspace, createWorkspaceSession, storeConnection, script, call, turn, toolTrace, pin, hookRecords, setControl, RUN, j, sleep } from './lib.mjs';
import { STORAGE } from './manifest.mjs';
const R = new Report(process.env.ARGV_FIXED ? 's9-linux-99db' : 's9-linux');
const CL = '/lx/cmd/ledger.jsonl';
const cmdLedger = () => (fs.existsSync(CL) ? fs.readFileSync(CL, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
// A zombie (killed, reparented to a PID 1 that does not reap) counts as dead.
const alive = (pid) => {
  try {
    return !/^State:\s+Z/m.test(fs.readFileSync(`/proc/${pid}/status`, "utf8"));
  } catch {
    return false;
  }
};
const units = () => fs.readdirSync('/sys/fs/cgroup/hooks').filter((d) => d.startsWith('qwen-hook-'));
fs.rmSync(CL, { force: true });
for (const f of ['/lx/cmd/detached.pid', '/lx/cmd/stubborn.pid']) fs.rmSync(f, { force: true });
setControl({});
const model = await startModel();
const h = await new Harness({ name: 's9', modelUrl: model.url }).start();
try {
  const w = await workspace(STORAGE['ws-lx1'], 'ws-lx1');
  const id = await createWorkspaceSession(w.workspaceId);
  const s = new HSession(h, id, storeConnection(h, w.workspaceId));
  await s.create({ hookCatalog: pin('ws-lx1') });
  // A: PreToolUse command runs in a fresh unit; UserPromptSubmit command leaves a detached descendant (timeout 5 s)
  const t0 = Date.now();
  let p = await s.prompt(script([[call('write_file', { file_path: 'plain.txt', content: 'P' })]], 'LX_A'));
  const led = cmdLedger();
  const pre = led.find((e) => e.hook === 'pre');
  const det = led.find((e) => e.hook === 'detach');
  const dpid = fs.existsSync('/lx/cmd/detached.pid') ? fs.readFileSync('/lx/cmd/detached.pid', 'utf8').trim() : null;
  R.check('A: PreToolUse command ran inside a fresh qwen-hook-* cgroup unit and its context reached the model', p.terminal?.[0]?.type === 'turn_complete' && /\/hooks\/qwen-hook-/.test(pre?.cgroup ?? '') && model.requests.some((q) => q.markers.includes('CMD-CTX')), `${turn(p)} cgroup=${pre?.cgroup} HOME=${pre?.home}`);
  const detRec = hookRecords(id, 'hook_execution').find((r) => r.rec.hookId === 'cmd-detach')?.rec;
  R.check('A: detached (setsid) descendant was killed by the unit, not left running', dpid && !alive(dpid), `detached pid=${dpid} alive=${dpid && alive(dpid)} cgroup=${det?.cgroup} record=${detRec?.run.state}/${j(detRec?.run.execution)} turnMs=${Date.now() - t0}`);
  R.note('A: UserPromptSubmit with a detached child — receipt', j(await (async () => { const r = await fs.promises.readFile(`${RUN}/../lx/hooks.json`).catch(() => null); return detRec ? { state: detRec.run.state, execution: detRec.run.execution } : null; })()));
  R.check('A: no qwen-hook-* unit left behind', units().length === 0, `units=${units().join(',') || '<none>'}`);
  // B: deny
  p = await s.prompt(script([[call('write_file', { file_path: 'blocked.txt', content: 'NO' })]], 'LX_B'));
  R.check('B: command PreToolUse deny prevents the write', p.terminal?.[0]?.type === 'turn_complete' && !fs.existsSync(`${w.dir}/blocked.txt`), `${toolTrace(p.events).filter((x) => x.startsWith('result')).join(' ')}`);
  // C: cancellation of a long Notification command whose child ignores SIGTERM
  const opP = s.hookOp('Notification', { message: 'long', notification_type: 'rig' }, undefined, { timeoutMs: 180_000 });
  let child;
  for (let i = 0; i < 100 && !(child = hookRecords(id, 'hook_execution').find((r) => r.rec.hookId === 'cmd-long')?.rec) ; i++) await sleep(100);
  for (let i = 0; i < 100 && !fs.existsSync('/lx/cmd/stubborn.pid'); i++) await sleep(100);
  await sleep(1000);
  const stubborn = fs.readFileSync('/lx/cmd/stubborn.pid', 'utf8').trim();
  const unitsDuring = units();
  const c0 = Date.now();
  const cancel = await s.hookStatus(child.hookExecutionId, true);
  const op = await opP;
  const cMs = Date.now() - c0;
  const after = hookRecords(id, 'hook_execution').find((r) => r.rec.hookId === 'cmd-long')?.rec;
  R.check('C: cancel drains the unit (TERM, then cgroup.kill for the TERM-ignoring child) and settles', !alive(stubborn) && units().length === 0 && after?.resultRef, `cancel=${cancel.status} ${cancel.json?.state} op=${op.status} ${j(op.json).slice(0, 120)} stubborn=${stubborn} alive=${alive(stubborn)} unitsDuring=${unitsDuring.length} unitsAfter=${units().length} settled=${after?.run.state}/${j(after?.run.execution)} ${cMs}ms`);
  const next = await s.prompt(script([], 'LX_NEXT'));
  R.check('C: Session accepts the next prompt', next.terminal?.[0]?.type === 'turn_complete', turn(next));
  await s.detach();
  // D: recipe env on argv, on the real stack
  const w2 = await workspace(STORAGE['ws-lx2'], 'ws-lx2');
  R.note('rig repair (F1 leak from an aborted earlier attempt)', String(await repairLeak(STORAGE['ws-lx2'])));
  const id2 = await createWorkspaceSession(w2.workspaceId);
  const s2 = new HSession(h, id2, storeConnection(h, w2.workspaceId));
  await s2.create({ hookCatalog: pin('ws-lx2') });
  const opD = s2.hookOp('Notification', { message: 'secret', notification_type: 'rig' }, undefined, { timeoutMs: 60_000 });
  let launcher;
  let seen = [];
  for (let i = 0; i < 80 && seen.length === 0; i++) {
    await sleep(150);
    for (const pid of fs.readdirSync("/proc").filter((x) => /^\d+$/.test(x))) {
      let argv;
      try {
        argv = fs.readFileSync(`/proc/${pid}/cmdline`, "latin1").split("\0");
      } catch {
        continue;
      }
      if (argv[1] !== "--input-type=commonjs" || !argv.some((x) => x.includes("/qwen-hook-"))) continue;
      try {
        seen = execFileSync("setpriv", ["--reuid=65534", "--regid=65534", "--clear-groups", "cat", `/proc/${pid}/cmdline`]).toString("latin1").split("\0").filter((x) => x.includes("RIG_SECRET")).map((x) => x.slice(x.indexOf("RIG_SECRET") - 1, x.indexOf("RIG_SECRET") + 36));
        launcher = pid;
      } catch {
        /* exited meanwhile */
      }
    }
  }
  const rd = await opD;
  const secretHook = cmdLedger().find((e) => e.hook === 'secret');
  let environ = 'n/a';
  if (launcher) { try { environ = execFileSync('setpriv', ['--reuid=65534', '--regid=65534', '--clear-groups', 'cat', `/proc/${launcher}/environ`], { stdio: ['ignore', 'pipe', 'pipe'] }).toString().includes('RIG-ARGV') ? 'READABLE' : 'readable-no-secret'; } catch { environ = 'denied'; } }
  R.check(process.env.ARGV_FIXED ? 'D: recipe env is NOT readable by another uid (argv and environ)' : 'D: [bot claim 1] recipe env is readable from the launcher argv by another uid (nobody)', process.env.ARGV_FIXED ? Boolean(launcher) && seen.length === 0 && environ === 'denied' && secretHook?.secretEnv === 'RIG-ARGV-SECRET-4411' : seen.length > 0, `launcher pid=${launcher} readAsNobody=${j(seen)} environAsNobody=${environ} hookSawSecret=${secretHook?.secretEnv === 'RIG-ARGV-SECRET-4411'} op=${rd.status}`);
  await s2.detach();
} finally {
  await h.close();
  await model.close();
  R.done();
}
