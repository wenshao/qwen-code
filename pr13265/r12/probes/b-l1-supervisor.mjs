// PR #13265 round 2 — the H3 supervisor on real Linux cgroup v2.
// Runs inside a privileged container (cgroupns private) against the PR's
// built core/cli dist. CGROUP_ROOT is a delegated directory under
// /sys/fs/cgroup; DIST points at the copied dist tree of one build.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const DIST = process.env.DIST;
const ROOT = process.env.CGROUP_ROOT;
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;
if (!DIST || !ROOT) throw new Error('DIST and CGROUP_ROOT are required');
const { ManagedChildRunSupervisor } = await import('@qwen-code/qwen-code-core/managed-runtime/managed-child-run-supervisor.js');
const { HookCommandCgroup } = await import('@qwen-code/qwen-code-core/hooks/hook-command-cgroup.js');
const { ManagedBackgroundShellRegistry } = await import('@armcli/serve/managed-background-shell-registry.js');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = {};
const log = (tag, v) => console.log(`[${tag}] ${typeof v === 'string' ? v : JSON.stringify(v)}`);
const unitDir = (name) => path.join(ROOT, name);
const procs = (name) => {
  try {
    return fs.readFileSync(path.join(unitDir(name), 'cgroup.procs'), 'utf8').trim().split('\n').filter(Boolean).map(Number);
  } catch {
    return null;
  }
};
const events = (name) => {
  try {
    return fs.readFileSync(path.join(unitDir(name), 'cgroup.events'), 'utf8').replace(/\n/g, ' ').trim();
  } catch {
    return 'NO UNIT';
  }
};
const describe = (pids) =>
  (pids ?? []).map((pid) => {
    try {
      const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
      const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
      const cmd = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').filter(Boolean).join(' ').slice(0, 60);
      return `${pid} st=${fields[0]} sid=${fields[3]} ${cmd}`;
    } catch {
      return `${pid} gone`;
    }
  });
const sleepers = (tag) =>
  execFileSync('sh', ['-c', `ps -eo pid,stat,args | grep -F "${tag}" | grep -v grep || true`], { encoding: 'utf8' }).trim();

function stubSink() {
  const calls = [];
  const chunks = { stdout: [], stderr: [] };
  return {
    calls,
    chunks,
    write: (stream, chunk) => chunks[stream].push(Buffer.from(chunk)),
    setStarted: (pid) => calls.push(`setStarted(${pid})`),
    setProcessResult: (r) => calls.push(`setProcessResult(exit=${r.exitCode},signal=${r.signal})`),
    finish: async (stream, eof) => calls.push(`finish(${stream},${eof})`),
    finalize: async (status, _parts, error) => {
      calls.push(`finalize(${status}${error ? ',' + error.message : ''})`);
      return { executionStatus: status, error };
    },
  };
}
function stubPublisher() {
  const calls = [];
  return { calls, finish: async (_identity, envelope) => calls.push(`publisher.finish(${envelope.executionStatus})`) };
}
const want = (id) => !ONLY || ONLY.includes(id);

async function start(sup, name, command, sink) {
  return sup.start({
    unitName: name,
    executable: '/bin/sh',
    args: ['-c', command],
    env: { PATH: process.env.PATH },
    cwd: '/tmp',
    onOutput: (stream, chunk) => sink.write(stream, chunk),
  });
}

const sup = ManagedChildRunSupervisor.create({ cgroupRoot: ROOT });

// L1/L2: a loud tree with a setsid daemon and a TERM-ignoring child; stop it.
if (want('L1')) {
  const name = 'qwen-bg-l1';
  const sink = stubSink();
  const tag = 'sleep 301';
  const p = await start(sup, name, `echo out; echo err >&2; (setsid sh -c 'sleep 3011' >/dev/null 2>&1 </dev/null &); (trap '' TERM; sleep 3012) & sleep 3013`, sink);
  await sleep(1200);
  const members = procs(name);
  log('L1 unit', { events: events(name), members: describe(members) });
  log('L1 captured', { stdout: Buffer.concat(sink.chunks.stdout).toString(), stderr: Buffer.concat(sink.chunks.stderr).toString() });
  const t0 = Date.now();
  const evidence = await p.terminate(1500);
  const ms = Date.now() - t0;
  await sleep(200);
  log('L2 terminate', { evidence, ms, unitAfter: events(name), unitDirExists: fs.existsSync(unitDir(name)), survivors: sleepers(tag) || 'none' });
  out.L1 = { members: (members ?? []).length, populated: true };
  out.L2 = { evidence, ms, unitRemoved: !fs.existsSync(unitDir(name)), survivors: sleepers(tag) ? sleepers(tag).split('\n').length : 0 };
}

// L3: natural exit while a setsid daemon (stdio detached) lives on, via the registry.
if (want('L3')) {
  const name = 'qwen-bg-l3';
  const tag = 'sleep 3031';
  const sink = stubSink();
  const publisher = stubPublisher();
  const reg = new ManagedBackgroundShellRegistry();
  const p = await start(sup, name, `(setsid sh -c 'sleep 3031' >/dev/null 2>&1 </dev/null &); echo started; exit 0`, sink);
  const completion = reg.register({ unitName: name, sessionId: 'session-l3', process: p, sink, publisher, identity: {} });
  const receipt = await Promise.race([completion, sleep(10_000).then(() => 'TIMEOUT')]);
  await sleep(300);
  log('L3 after root exit', {
    receipt,
    holdAfter: reg.hasHolds('session-l3'),
    unitEvents: events(name),
    unitDirExists: fs.existsSync(unitDir(name)),
    members: describe(procs(name)),
    daemon: sleepers(tag) || 'none',
    sinkCalls: sink.calls,
    publisherCalls: publisher.calls,
  });
  out.L3 = { holdReleased: !reg.hasHolds('session-l3'), unitPopulated: /populated 1/.test(events(name)), unitDirExists: fs.existsSync(unitDir(name)), daemonAlive: !!sleepers(tag), evidence: receipt?.evidence ?? receipt };
  // clean up the daemon through the unit, then remove it
  try {
    const u = HookCommandCgroup.attach(ROOT, name) ?? null;
    log('L3 cleanup attach', u ? 'unit' : 'undefined');
  } catch (e) {
    log('L3 cleanup attach', `${e.name}`);
  }
  fs.writeFileSync(path.join(unitDir(name), 'cgroup.kill'), '1');
  await sleep(300);
  try { fs.rmdirSync(unitDir(name)); } catch (e) { log('L3 rmdir', e.code); }
}

// L3b: natural exit while a background child keeps the pipes open (inherited stdout).
if (want('L3b')) {
  const name = 'qwen-bg-l3b';
  const sink = stubSink();
  const publisher = stubPublisher();
  const reg = new ManagedBackgroundShellRegistry();
  const p = await start(sup, name, `(sleep 3033 &) ; echo started; exit 0`, sink);
  const t0 = Date.now();
  const receipt = await Promise.race([reg.register({ unitName: name, sessionId: 'session-l3b', process: p, sink, publisher, identity: {} }), sleep(20_000).then(() => 'TIMEOUT')]);
  const ms = Date.now() - t0;
  log('L3b inherited pipes', { receipt, msUntilRelease: ms, holdAfter: reg.hasHolds('session-l3b'), unitEvents: events(name), daemon: sleepers('sleep 3033') || 'none', sinkCalls: sink.calls });
  out.L3b = { msUntilRelease: ms, holdReleased: !reg.hasHolds('session-l3b'), unitPopulated: /populated 1/.test(events(name)), daemonAlive: !!sleepers('sleep 3033'), finished: sink.calls.filter((c) => c.startsWith('finish')) };
  fs.writeFileSync(path.join(unitDir(name), 'cgroup.kill'), '1');
  await sleep(300);
  try { fs.rmdirSync(unitDir(name)); } catch {}
}
// L4: exit evidence for an ordinary exit code and for a signal death.
if (want('L4')) {
  for (const [id, cmd] of [['exit7', 'exit 7'], ['selfkill', 'kill -KILL $$'], ['segv', 'kill -SEGV $$']]) {
    const name = `qwen-bg-l4-${id}`;
    const sink = stubSink();
    const reg = new ManagedBackgroundShellRegistry();
    const p = await start(sup, name, cmd, sink);
    const receipt = await Promise.race([reg.register({ unitName: name, sessionId: 's4', process: p, sink, publisher: stubPublisher(), identity: {} }), sleep(10_000).then(() => 'TIMEOUT')]);
    log(`L4 ${id}`, { command: cmd, evidence: receipt.evidence, sinkCalls: sink.calls.filter((c) => c.startsWith('setProcessResult') || c.startsWith('finalize')) });
    out[`L4_${id}`] = receipt.evidence;
    try { fs.rmdirSync(unitDir(name)); } catch {}
  }
}

// L5: re-attach by unit name from a fresh supervisor (a replacement worker).
if (want('L5')) {
  const name = 'qwen-bg-l5';
  const sink = stubSink();
  await start(sup, name, `sleep 3051`, sink);
  await sleep(500);
  const fresh = ManagedChildRunSupervisor.create({ cgroupRoot: ROOT });
  const viaSupervisor = fresh.attach(name);
  const viaCgroup = HookCommandCgroup.attach(ROOT, name);
  const missing = HookCommandCgroup.attach(ROOT, 'qwen-bg-does-not-exist');
  log('L5 attach', { unitExists: fs.existsSync(unitDir(name)), events: events(name), supervisorAttach: viaSupervisor === undefined ? 'undefined' : viaSupervisor.directory, cgroupAttach: viaCgroup === undefined ? 'undefined' : viaCgroup.directory, missing: missing === undefined ? 'undefined' : 'unit' });
  out.L5 = { unitExists: fs.existsSync(unitDir(name)), attached: viaCgroup !== undefined };
  fs.writeFileSync(path.join(unitDir(name), 'cgroup.kill'), '1');
  await sleep(300);
  try { fs.rmdirSync(unitDir(name)); } catch {}
}

// L6: a second start with a unit name already in use.
if (want('L6')) {
  const name = 'qwen-bg-l6';
  const sink = stubSink();
  await start(sup, name, `sleep 3061`, sink);
  let second;
  try {
    await start(sup, name, `sleep 3062`, stubSink());
    second = 'STARTED';
  } catch (e) {
    second = `${e.name}: ${e.message}`;
  }
  log('L6 second start, same unit', { second, firstStillRunning: !!sleepers('sleep 3061'), unitDirExists: fs.existsSync(unitDir(name)) });
  out.L6 = { second, firstStillRunning: !!sleepers('sleep 3061') };
  fs.writeFileSync(path.join(unitDir(name), 'cgroup.kill'), '1');
  await sleep(300);
  try { fs.rmdirSync(unitDir(name)); } catch {}
}

// L2b: a tree that obeys TERM — terminate settles inside the grace window.
if (want('L2b')) {
  const name = 'qwen-bg-l2b';
  const sink = stubSink();
  const p = await start(sup, name, `(setsid sh -c 'sleep 3021' >/dev/null 2>&1 </dev/null &); sleep 3022`, sink);
  await sleep(800);
  const t0 = Date.now();
  const evidence = await p.terminate(1500);
  log('L2b terminate (TERM obeyed)', { evidence, ms: Date.now() - t0, unitDirExists: fs.existsSync(unitDir(name)), survivors: sleepers('sleep 302') || 'none' });
  out.L2b = { evidence, unitRemoved: !fs.existsSync(unitDir(name)) };
}
// L2c: how long the unit takes to drain after terminate() answered null.
if (want('L2c')) {
  const name = 'qwen-bg-l2c';
  const sink = stubSink();
  const p = await start(sup, name, `(trap '' TERM; sleep 3023) & sleep 3024`, sink);
  await sleep(800);
  const evidence = await p.terminate(500);
  const t1 = Date.now(); let polls = 0;
  while (!/populated 0/.test(events(name)) && Date.now() - t1 < 5000) { polls++; await new Promise((r) => setImmediate(r)); }
  const drainMs = Date.now() - t1;
  const second = await p.terminate(500);
  log('L2c', { first: evidence, emptyAfterMs: drainMs, polls, secondCall: second, unitDirExistsAfterSecond: fs.existsSync(unitDir(name)) });
  out.L2c = { first: evidence, emptyAfterMs: drainMs, secondCall: second, unitRemovedAfterSecond: !fs.existsSync(unitDir(name)) };
}
// L7: the registry's own terminate (what close/stopAll uses), TERM-ignoring child.
if (want('L7')) {
  const name = 'qwen-bg-l7';
  const sink = stubSink();
  const reg = new ManagedBackgroundShellRegistry();
  const p = await start(sup, name, `(trap '' TERM; sleep 3071) & sleep 3072`, sink);
  reg.register({ unitName: name, sessionId: 's7', process: p, sink, publisher: stubPublisher(), identity: {} });
  await sleep(800);
  const receipt = await reg.terminate(name, 1000);
  await sleep(200);
  log('L7 registry.terminate', { receipt, holdAfter: reg.hasHolds('s7'), unitEvents: events(name), unitDirExists: fs.existsSync(unitDir(name)), survivors: sleepers('sleep 307') || 'none' });
  out.L7 = { evidence: receipt?.evidence, holdReleased: !reg.hasHolds('s7'), unitDirLeft: fs.existsSync(unitDir(name)) };
}
// L8: plain natural exit, nothing left behind — is the unit removed?
if (want('L8')) {
  const name = 'qwen-bg-l8';
  const sink = stubSink();
  const reg = new ManagedBackgroundShellRegistry();
  const p = await start(sup, name, `echo hi`, sink);
  const receipt = await reg.register({ unitName: name, sessionId: 's8', process: p, sink, publisher: stubPublisher(), identity: {} });
  await sleep(200);
  log('L8 natural exit', { evidence: receipt.evidence, unitEvents: events(name), unitDirExists: fs.existsSync(unitDir(name)), supervisorSize: sup.size });
  out.L8 = { unitDirLeft: fs.existsSync(unitDir(name)), supervisorSize: sup.size };
}
log('RESULT', out);
setTimeout(() => process.exit(0), 200);
