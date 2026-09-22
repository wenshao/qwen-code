// Concurrent admission under enforce: budget 1400 MiB models 2 slots x 572 MiB.
// Fire N simultaneous child-creating requests for N distinct workspaces and
// check the process table never exceeds the slot count; then kill -9 one child
// and check its slot is released for a waiting workspace.
// usage: node race.mjs <arm> <rounds>
import fs from 'node:fs';
import path from 'node:path';
import { makeRun, startFakeProvider, startDaemon, acpChildren, alive, sleep, waitFor, memoryStatus, procCmdline, heapFlags, ROOT } from './lib.mjs';

const [arm = 'head', roundsArg = '5'] = process.argv.slice(2);
const rounds = Number(roundsArg);
const results = [];
for (let round = 0; round < rounds; round++) {
  const run = makeRun(`race-${arm}-${round}`);
  const provider = await startFakeProvider(run);
  const d = await startDaemon(run, {
    arm,
    provider,
    serveArgs: ['--child-heap-mode', 'enforce', '--memory-budget-mb', '1400', '--channel-idle-timeout-ms', '60000', '--workspace', run.ws.primary, '--workspace', run.ws.secondary, '--workspace', run.ws.extra],
  });
  const r = { round };
  try {
    const mem = memoryStatus((await d.api('GET', '/daemon/status')).json);
    r.slots = mem?.childHeap?.maxConcurrentChildren;
    r.ceiling = mem?.childHeap?.perChildCeilingMb;
    await d.api('POST', '/workspaces', { cwd: run.ws.dynamic });
    // Sample the process table continuously while the burst is in flight.
    let maxSeen = 0;
    let sampling = true;
    const sampler = (async () => { while (sampling) { maxSeen = Math.max(maxSeen, acpChildren(d.child.pid).length); await sleep(20); } })();
    const targets = ['primary', 'secondary', 'extra', 'dynamic'];
    const burst = await Promise.all(targets.map((w) => d.api('POST', '/session', { cwd: run.ws[w], sessionScope: 'thread' }).then((x) => ({ w, status: x.status, code: x.json?.code ?? null, sessionId: x.json?.sessionId ?? null }))));
    await sleep(1500);
    sampling = false;
    await sampler;
    r.burst = burst.map((b) => `${b.w}:${b.status}${b.code ? '/' + b.code : ''}`);
    r.ok = burst.filter((b) => b.status === 200).length;
    r.refused = burst.filter((b) => b.status === 503 && b.code === 'acp_child_capacity_exhausted').length;
    r.maxChildrenSeen = maxSeen;
    const kids = acpChildren(d.child.pid);
    r.childFlags = kids.map((k) => heapFlags(procCmdline(k)).join(' '));
    // kill -9 one live child; a refused workspace must now be admitted
    const refusedW = burst.find((b) => b.status === 503)?.w;
    if (kids[0] && refusedW) {
      process.kill(kids[0], 'SIGKILL');
      await waitFor(() => !alive(kids[0]), 5000);
      await sleep(1000);
      const again = await d.api('POST', '/session', { cwd: run.ws[refusedW], sessionScope: 'thread' });
      await sleep(1000);
      r.afterKill = { workspace: refusedW, status: again.status, code: again.json?.code ?? null, liveChildren: acpChildren(d.child.pid).length };
    }
    r.refusalsReported = memoryStatus((await d.api('GET', '/daemon/status')).json)?.childHeap?.refusals;
  } finally {
    const pids = acpChildren(d.child.pid);
    await d.stop();
    await sleep(800);
    r.leftover = pids.filter(alive);
    r.exit = d.exited()?.code;
    await provider.close();
  }
  results.push(r);
  console.log(JSON.stringify(r));
}
fs.writeFileSync(path.join(ROOT, 'runs', `race-${arm}.json`), JSON.stringify(results, null, 2));
