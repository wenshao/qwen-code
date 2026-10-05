// PR #13265 round 5 — L20: the Monitor worker pieces landed in b20dbdbf15
// and 61fb973991, on real cgroup v2: ManagedMonitorWatcher (line splitting,
// end reporting, terminate) and ManagedMonitorRegistry + ManagedMonitorRuntime
// (holds and the monitor-status answer). Built per arm like L19.
import fs from 'node:fs';
import path from 'node:path';
import { ManagedMonitorWatcher } from '@armcli/serve/managed-monitor-watcher.js';
import { ManagedMonitorRegistry } from '@armcli/serve/managed-monitor-registry.js';
import { ManagedMonitorRuntime } from '@armcli/serve/managed-monitor-runtime.js';
import { ManagedChildRunSupervisor } from '@qwen-code/qwen-code-core/managed-runtime/managed-child-run-supervisor.js';
import { monitorUnitNameOf } from '@qwen-code/qwen-code-core/managed-runtime/managed-monitor-protocol.js';

const ROOT = process.env.CGROUP_ROOT;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const populated = (unit) => { try { return fs.readFileSync(path.join(ROOT, unit, 'cgroup.events'), 'utf8').includes('populated 1') ? 'populated' : 'empty'; } catch { return 'no unit'; } };
const supervisor = ManagedChildRunSupervisor.create({ cgroupRoot: ROOT });
const watcher = new ManagedMonitorWatcher(supervisor);
const out = { arm: process.env.ARM };

async function watch(id, command, { waitMs = 60_000 } = {}) {
  const lines = [];
  let exitedAt = null;
  let exits = 0;
  let failed = null;
  let linesAfterExit = 0;
  let handle;
  let done;
  const ended = new Promise((r) => { done = r; });
  try {
    handle = await watcher.start({ command }, (line) => {
      lines.push(line);
      if (exitedAt !== null) linesAfterExit++;
    }, (f) => {
      exits++;
      failed = f;
      exitedAt ??= lines.length;
      done();
    }, { unitName: `qwen-mon-l20-${id}`, cwd: '/tmp' });
  } catch (e) {
    return { startError: `${e.name}: ${e.message}` };
  }
  await Promise.race([ended, sleep(waitMs)]);
  await sleep(1500); // let any late data events arrive
  return { handle, lines, linesAtExit: exitedAt, linesAfterExit, exits, failed };
}

// a. multi-byte text across pipe chunk boundaries
{
  const text = '中文测试行，用于验证多字节字符在管道块边界被切开时的行为。';
  const r = await watch('utf8', `yes '${text}' | head -n 30000`);
  if (r.startError) out.utf8 = r;
  else out.utf8 = {
    lines: r.lines.length, expected: 30000,
    linesWithReplacementChar: r.lines.filter((l) => l.includes('�')).length,
    linesNotEqualToInput: r.lines.filter((l) => l !== text).length,
  };
}
// b. a fast writer: does the end arrive before the last lines?
{
  const runs = [];
  for (let i = 0; i < 5; i++) {
    const r = await watch(`seq-${i}`, 'seq 1 200000');
    if (r.startError) { runs.push(r); break; }
    runs.push({ lines: r.lines.length, linesAtExit: r.linesAtExit, linesAfterExit: r.linesAfterExit, last: r.lines.at(-1), exits: r.exits });
  }
  out.endBeforeLastLines = runs;
}
// c. the end of a failing command
{
  const r = await watch('fail', 'echo before; exit 7');
  out.exit7 = r.startError ? r : { lines: r.lines, exits: r.exits, failed: r.failed };
}
// d. terminate through the handle
{
  const t0 = Date.now();
  const r = await watch('term', "(trap '' TERM; sleep 3292) & sleep 3293", { waitMs: 300 });
  if (r.startError) out.terminate = r;
  else {
    let answer;
    try { answer = await r.handle.terminate(); } catch (e) { answer = `threw ${e.message}`; }
    await sleep(1500);
    out.terminate = { resolved: answer === undefined ? 'void' : answer, ms: Date.now() - t0, unit: populated('qwen-mon-l20-term') };
  }
}
// e. registry + route (1a594573ef shape; ce04b2112f wraps the Shell registry, covered by L19)
if (process.env.REGISTRY === "1") {
  const registry = new ManagedMonitorRegistry();
  const route = new ManagedMonitorRuntime(registry);
  const ask = (target, kind = 'monitor-status', session = 'rs-mon') => route.control(session, { kind, operationId: `op-${target}`, sessionKey: { tenantId: 't', sessionId: 's' }, targetOperationId: target }).catch((e) => ({ error: e.message }));
  const reg = {};
  for (const [target, command] of [['mon-natural', 'sleep 0.3; exit 0'], ['mon-daemon', 'setsid sleep 3294 </dev/null >/dev/null 2>&1 & exit 0']]) {
    const unitName = monitorUnitNameOf(target);
    let p;
    try {
      p = await supervisor.start({ unitName, executable: '/bin/sh', args: ['-c', command], env: { PATH: process.env.PATH }, cwd: '/tmp', onOutput: () => {} });
    } catch (e) { reg[target] = { startError: e.name }; continue; }
    registry.register({ unitName, sessionId: 'rs-mon', process: p });
    await sleep(1500);
    reg[target] = {
      processExited: p.exited,
      holdBeforeAnyQuestion: registry.hasHolds('rs-mon'),
      status: (await ask(target)).state,
      holdAfterStatus: registry.hasHolds('rs-mon'),
      unit: populated(unitName),
    };
  }
  out.registry = reg;
}
console.log(`[RESULT] ${JSON.stringify(out)}`);
for (const d of fs.readdirSync(ROOT).filter((n) => n.startsWith('qwen-mon-'))) {
  try { fs.writeFileSync(path.join(ROOT, d, 'cgroup.kill'), '1'); } catch {}
}
await sleep(500);
for (const d of fs.readdirSync(ROOT).filter((n) => n.startsWith('qwen-mon-'))) { try { fs.rmdirSync(path.join(ROOT, d)); } catch {} }
process.exit(0);
