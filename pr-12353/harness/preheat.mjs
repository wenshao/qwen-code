// 1-slot enforce: does the primary preheat occupy the slot at boot, and can a
// secondary-workspace request reclaim that never-used preheated child?
import { makeRun, startFakeProvider, startDaemon, acpChildren, childView, alive, sleep, waitFor, memoryStatus, procCmdline, heapFlags } from './lib.mjs';
const [arm = 'head', mode = 'enforce'] = process.argv.slice(2);
const run = makeRun(`preheat-${arm}-${mode}`);
const provider = await startFakeProvider(run);
const d = await startDaemon(run, { arm, provider, serveArgs: ['--child-heap-mode', mode, '--memory-budget-mb', '1024', '--channel-idle-timeout-ms', '60000', '--workspace', run.ws.primary, '--workspace', run.ws.secondary] });
const out = { arm, mode };
try {
  await sleep(4000);
  const pre = acpChildren(d.child.pid);
  out.childrenAtBootNoRequests = pre.map((p) => ({ pid: p, cwd: childView(p, run).cwd.split('/').pop(), heap: heapFlags(procCmdline(p)) }));
  const s = await d.api('POST', '/session', { cwd: run.ws.secondary, sessionScope: 'thread' });
  await sleep(1500);
  out.secondaryFirst = { status: s.status, code: s.json?.code ?? null, preheatedAlive: pre.map(alive), children: acpChildren(d.child.pid).map((p) => childView(p, run).cwd.split('/').pop()) };
  const p = await d.api('POST', '/session', { cwd: run.ws.primary, sessionScope: 'thread' });
  out.primaryWhileSecondaryRetained = { status: p.status, code: p.json?.code ?? null };
} finally {
  await d.stop();
  await provider.close();
  console.log(JSON.stringify(out));
}
