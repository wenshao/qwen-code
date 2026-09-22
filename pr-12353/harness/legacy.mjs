// observe / admit (and off) must keep the legacy child heap arguments and
// report limits.memory.enforced=false. Run on both arms and diff.
// usage: node legacy.mjs <arm> <mode>
import fs from 'node:fs';
import path from 'node:path';
import { makeRun, startFakeProvider, startDaemon, acpChildren, childView, alive, sleep, waitFor, memoryStatus, PROBE } from './lib.mjs';

const [arm, mode] = process.argv.slice(2);
const name = `legacy-${arm}-${mode}`;
const run = makeRun(name);
const provider = await startFakeProvider(run);
const d = await startDaemon(run, {
  arm,
  provider,
  nodeArgs: ['--max-old-space-size=4096', '--trace-warnings', '--require', PROBE],
  env: { NODE_OPTIONS: '--max-old-space-size=3072' },
  serveArgs: ['--child-heap-mode', mode, '--memory-budget-mb', '1024', '--channel-idle-timeout-ms', '60000', '--workspace', run.ws.primary, '--workspace', run.ws.secondary],
});
const out = { arm, mode };
try {
  const st = await d.api('GET', '/daemon/status');
  const mem = memoryStatus(st.json);
  out.enforced = mem?.enforced;
  out.childHeap = mem?.childHeap;
  const s1 = await d.api('POST', '/session', { cwd: run.ws.primary, sessionScope: 'thread' });
  const pid = await waitFor(() => acpChildren(d.child.pid)[0], 20000);
  await sleep(800);
  const v = childView(pid, run);
  out.primarySession = s1.status;
  out.child = { heapFlags: v.cmdlineHeapFlags, other: v.cmdlineOther, v8HeapSizeLimitMb: v.v8HeapSizeLimitMb, gcExposed: v.gcExposed, nodeOptions: v.env?.NODE_OPTIONS ?? null };
  const r = await d.api('POST', '/session', { cwd: run.ws.secondary, sessionScope: 'thread' });
  out.secondaryWhilePrimaryRetained = { status: r.status, code: r.json?.code ?? null };
  const st2 = await d.api('GET', '/daemon/status');
  out.refusals = memoryStatus(st2.json)?.childHeap?.refusals ?? null;
  out.liveChildren = acpChildren(d.child.pid).length;
} finally {
  const pids = acpChildren(d.child.pid);
  await d.stop();
  await sleep(1000);
  out.daemonExit = d.exited();
  out.leftoverChildren = pids.filter(alive);
  out.providerRequests = provider.count();
  await provider.close();
  fs.writeFileSync(path.join(run.dir, 'report.json'), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out));
}
