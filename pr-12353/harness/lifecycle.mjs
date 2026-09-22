// Real-daemon lifecycle for `--child-heap-mode enforce` (1 slot / 768 MiB):
// primary + startup-secondary + dynamically added workspace, retained-session
// protection, capacity refusal, idle reclamation, and shutdown cleanup.
// usage: node lifecycle.mjs <arm> <mode> <runName>
import fs from 'node:fs';
import path from 'node:path';
import { makeRun, startFakeProvider, startDaemon, acpChildren, childView, alive, sleep, waitFor, memoryStatus, PROBE } from './lib.mjs';

const [arm = 'head', mode = 'enforce', name = `lifecycle-${arm}-${mode}`] = process.argv.slice(2);
const run = makeRun(name);
const provider = await startFakeProvider(run);
const checks = [];
const check = (label, ok, detail) => {
  checks.push({ label, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail !== undefined ? '  ' + JSON.stringify(detail) : ''}`);
};
const steps = [];
const step = (label, data) => { steps.push({ label, ...data }); };

const d = await startDaemon(run, {
  arm,
  provider,
  // Larger inherited fixed heap flag + an unrelated flag + the probe preload,
  // all on the daemon's own command line (process.execArgv).
  nodeArgs: ['--max-old-space-size=4096', '--trace-warnings', '--require', PROBE],
  // NODE_OPTIONS with a competing heap flag; a production launch scrubs it.
  env: { NODE_OPTIONS: '--max-old-space-size=3072' },
  serveArgs: ['--child-heap-mode', mode, '--memory-budget-mb', '1024', '--channel-idle-timeout-ms', '60000', '--workspace', run.ws.primary, '--workspace', run.ws.secondary],
});
const report = { arm, mode, url: d.url, daemonPid: d.child.pid, checks, steps };
try {
  const st = await d.api('GET', '/daemon/status');
  const mem = memoryStatus(st.json);
  step('status at boot', { memory: mem });
  const expectEnforced = mode === 'enforce';
  check('status.limits.memory.enforced', mem?.enforced === expectEnforced, mem?.enforced);
  check('childHeap.mode', mem?.childHeap?.mode === mode, mem?.childHeap?.mode);
  check('childHeap.maxConcurrentChildren == 1', mem?.childHeap?.maxConcurrentChildren === 1, mem?.childHeap?.maxConcurrentChildren);
  check('childHeap.perChildCeilingMb == 768', mem?.childHeap?.perChildCeilingMb === 768, mem?.childHeap?.perChildCeilingMb);

  const views = {};
  const newChild = async (known) => waitFor(() => acpChildren(d.child.pid).find((p) => !known.includes(p)), 20000);

  // 1. two retained sessions in the primary workspace share one child
  const s1 = await d.api('POST', '/session', { cwd: run.ws.primary, sessionScope: 'thread' });
  const primaryPid = await newChild([]);
  await sleep(500);
  const s2 = await d.api('POST', '/session', { cwd: run.ws.primary, sessionScope: 'thread' });
  await sleep(500);
  views.primary = childView(primaryPid, run);
  step('primary: two sessions', { s1: s1.status, s2: s2.status, s1id: s1.json.sessionId, s2id: s2.json.sessionId, children: acpChildren(d.child.pid), primary: views.primary });
  check('primary session 1 created', s1.status === 200, s1.status);
  check('primary session 2 created', s2.status === 200, s2.status);
  check('two retained sessions share one child', acpChildren(d.child.pid).length === 1 && s1.json.sessionId !== s2.json.sessionId, acpChildren(d.child.pid));

  // 2. dynamic registration at full capacity still succeeds
  const reg = await d.api('POST', '/workspaces', { cwd: run.ws.dynamic });
  step('register dynamic workspace at capacity', { status: reg.status, body: reg.json });
  check('dynamic registration succeeds at capacity', reg.status >= 200 && reg.status < 300, reg.status);

  // 3. new child requested at capacity: refused while the primary child retains sessions
  const r1 = await d.api('POST', '/session', { cwd: run.ws.secondary, sessionScope: 'thread' });
  step('secondary at capacity (2 retained)', { status: r1.status, body: r1.json, ms: r1.ms });
  check('secondary refused at capacity (2 retained)', r1.status === 503 && JSON.stringify(r1.json).includes('acp_child_capacity_exhausted'), { status: r1.status, code: r1.json?.code });
  const del1 = await d.api('DELETE', `/session/${s1.json.sessionId}`);
  await sleep(500);
  const r2 = await d.api('POST', '/session', { cwd: run.ws.secondary, sessionScope: 'thread' });
  step('secondary after closing ONE retained session', { del: del1.status, status: r2.status, body: r2.json });
  check('still refused with one retained session left', r2.status === 503 && alive(primaryPid), { status: r2.status, primaryAlive: alive(primaryPid) });
  const r2d = await d.api('POST', '/session', { cwd: run.ws.dynamic, sessionScope: 'thread' });
  check('dynamic also refused while primary retains a session', r2d.status === 503, r2d.status);

  // 4. close all retained sessions -> the other workspace reclaims the idle child
  const del2 = await d.api('DELETE', `/session/${s2.json.sessionId}`);
  await sleep(500);
  check('primary child still alive after drain (idle timeout 60s)', alive(primaryPid), { del: del2.status });
  const r3 = await d.api('POST', '/session', { cwd: run.ws.secondary, sessionScope: 'thread' });
  const secondaryPid = await newChild([primaryPid]);
  await sleep(500);
  views.secondary = childView(secondaryPid, run);
  step('secondary after all primary sessions closed', { status: r3.status, body: r3.json, primaryAlive: alive(primaryPid), secondary: views.secondary, children: acpChildren(d.child.pid) });
  check('secondary session created by reclaiming idle primary child', r3.status === 200, r3.status);
  check('replaced primary pid is gone', !alive(primaryPid), primaryPid);
  check('exactly one live child after reclaim', acpChildren(d.child.pid).length === 1, acpChildren(d.child.pid));

  // 5. same for the dynamically registered workspace
  const del3 = await d.api('DELETE', `/session/${r3.json.sessionId}`);
  await sleep(500);
  const r4 = await d.api('POST', '/session', { cwd: run.ws.dynamic, sessionScope: 'thread' });
  const dynamicPid = await newChild([primaryPid, secondaryPid]);
  await sleep(500);
  views.dynamic = childView(dynamicPid, run);
  step('dynamic after secondary closed', { del: del3.status, status: r4.status, body: r4.json, secondaryAlive: alive(secondaryPid), dynamic: views.dynamic, children: acpChildren(d.child.pid) });
  check('dynamic session created by reclaiming idle secondary child', r4.status === 200, r4.status);
  check('replaced secondary pid is gone', !alive(secondaryPid), secondaryPid);

  // child heap arguments, per workspace kind
  for (const [kind, v] of Object.entries(views)) {
    if (mode === 'enforce') {
      check(`${kind} child: exactly one --max-old-space-size=768 + --expose-gc`, JSON.stringify(v?.cmdlineHeapFlags) === JSON.stringify(['--max-old-space-size=768', '--expose-gc']), v?.cmdlineHeapFlags);
      check(`${kind} child: V8 heap_size_limit 816 MiB (= node --max-old-space-size=768)`, v?.v8HeapSizeLimitMb === 816, v?.v8HeapSizeLimitMb);
    }
    check(`${kind} child: gc exposed`, v?.gcExposed === true, v?.gcExposed);
    check(`${kind} child: unrelated --trace-warnings and --require preserved`, JSON.stringify(v?.cmdlineOther) === JSON.stringify(['--trace-warnings', '--require', PROBE]), v?.cmdlineOther);
    check(`${kind} child: no NODE_OPTIONS reaches it (production launch scrubs it)`, v?.env?.NODE_OPTIONS === null, v?.env);
    check(`${kind} child: cwd is its workspace`, v?.cwd === run.ws[kind], v?.cwd);
  }

  const st2 = await d.api('GET', '/daemon/status');
  step('status at end', { memory: memoryStatus(st2.json), runtimeMemory: st2.json?.runtime?.memory ?? null });
  report.views = views;
  report.allChildPids = [primaryPid, secondaryPid, dynamicPid];
} finally {
  const pids = acpChildren(d.child.pid);
  await d.stop();
  await sleep(1500);
  report.afterShutdown = { daemonExit: d.exited(), childrenAlive: [...new Set([...(report.allChildPids ?? []), ...pids])].filter(alive) };
  check('daemon exited cleanly', d.exited()?.code === 0, d.exited());
  check('no ACP child left after shutdown', report.afterShutdown.childrenAlive.length === 0, report.afterShutdown.childrenAlive);
  check('zero provider (model) requests', provider.count() === 0, provider.count());
  await provider.close();
  report.passed = checks.filter((c) => c.ok).length;
  report.failed = checks.filter((c) => !c.ok).length;
  fs.writeFileSync(path.join(run.dir, 'report.json'), JSON.stringify(report, null, 2));
  console.log(`== ${name}: ${report.passed} passed, ${report.failed} failed`);
}
