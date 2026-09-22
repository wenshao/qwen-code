// Boot-time validation: percentage conflicts, flag spellings, zero-slot hosts.
// usage: node boot-matrix.mjs <arm>
import fs from 'node:fs';
import path from 'node:path';
import { makeRun, startFakeProvider, startDaemon, acpChildren, alive, sleep, waitFor, memoryStatus, procCmdline, heapFlags, ROOT } from './lib.mjs';

const [arm = 'head'] = process.argv.slice(2);
const cases = [
  { id: 'pct-execargv-enforce', mode: 'enforce', nodeArgs: ['--max-old-space-size-percentage=50'] },
  { id: 'pct-execargv-admit', mode: 'admit', nodeArgs: ['--max-old-space-size-percentage=50'] },
  { id: 'pct-underscore-enforce', mode: 'enforce', nodeArgs: ['--max_old_space_size_percentage=50'] },
  { id: 'pct-dev-nodeoptions-enforce', mode: 'enforce', env: { DEV: 'true', NODE_OPTIONS: '--max-old-space-size-percentage=50' } },
  { id: 'pct-prod-nodeoptions-enforce', mode: 'enforce', env: { NODE_OPTIONS: '--max-old-space-size-percentage=50' } },
  { id: 'underscore-fixed-enforce', mode: 'enforce', nodeArgs: ['--max_old_space_size=4096', '--max-old-space-size=2048'] },
  { id: 'zero-slot-cgroup-enforce', mode: 'enforce', wrap: ['systemd-run', '--scope', '--quiet', '-p', 'MemoryMax=900M', '-p', 'MemorySwapMax=0'] },
  { id: 'zero-slot-cgroup-admit', mode: 'admit', wrap: ['systemd-run', '--scope', '--quiet', '-p', 'MemoryMax=900M', '-p', 'MemorySwapMax=0'] },
  { id: 'zero-slot-cgroup-observe', mode: 'observe', wrap: ['systemd-run', '--scope', '--quiet', '-p', 'MemoryMax=900M', '-p', 'MemorySwapMax=0'] },
];
const only = process.env.ONLY?.split(',');
const results = [];
for (const c of cases) {
  if (only && !only.includes(c.id)) continue;
  const run = makeRun(`boot-${arm}-${c.id}`);
  const provider = await startFakeProvider(run);
  const d = await startDaemon(run, {
    arm,
    provider,
    nodeArgs: c.nodeArgs ?? [],
    env: c.env ?? {},
    wrap: c.wrap ?? [],
    serveArgs: ['--child-heap-mode', c.mode, '--memory-budget-mb', '1024', '--workspace', run.ws.primary],
  });
  await sleep(2500);
  const r = { id: c.id, arm, listened: !!d.url, runtimeUp: !!d.url && !d.exited() };
  if (r.runtimeUp) {
    const mem = memoryStatus((await d.api('GET', '/daemon/status')).json);
    r.status = { enforced: mem?.enforced, childHeap: mem?.childHeap, availableMemoryMb: mem?.availableMemoryMb, availableMemorySource: mem?.availableMemorySource, effectiveBudgetMb: mem?.effectiveBudgetMb };
    const s = await d.api('POST', '/session', { cwd: run.ws.primary, sessionScope: 'thread' });
    r.session = s.status;
    const pid = await waitFor(() => acpChildren(d.child.pid)[0], 10000);
    r.childHeapFlags = pid ? heapFlags(procCmdline(pid)) : null;
    await d.stop();
  } else {
    await Promise.race([d.exitP, sleep(15000)]);
    await d.stop();
  }
  r.exit = d.exited();
  r.stderrTail = d.log().split('\n').filter((l) => l.trim() && !/--token is visible/.test(l)).slice(-3);
  await provider.close();
  results.push(r);
  console.log(JSON.stringify(r));
}
fs.writeFileSync(path.join(ROOT, 'runs', `boot-matrix-${arm}.json`), JSON.stringify(results, null, 2));
