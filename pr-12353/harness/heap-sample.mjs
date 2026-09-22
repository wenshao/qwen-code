// Does the per-child heap peak the design leans on actually reach daemon
// status under enforce? Attach one SSE watcher, wait for the 5 s poll.
import { makeRun, startFakeProvider, startDaemon, sleep, memoryStatus, TOKEN } from './lib.mjs';
const [arm = 'head'] = process.argv.slice(2);
const run = makeRun(`heap-sample-${arm}`);
const provider = await startFakeProvider(run);
const d = await startDaemon(run, { arm, provider, serveArgs: ['--child-heap-mode', 'enforce', '--memory-budget-mb', '1024', '--workspace', run.ws.primary] });
try {
  const s = await d.api('POST', '/session', { cwd: run.ws.primary, sessionScope: 'thread' });
  const ac = new AbortController();
  const sse = fetch(`${d.url}/session/${s.json.sessionId}/events`, { headers: { authorization: `Bearer ${TOKEN}`, accept: 'text/event-stream' }, signal: ac.signal }).catch(() => null);
  const before = await d.api('GET', '/daemon/status?detail=full');
  await sleep(12000);
  const after = await d.api('GET', '/daemon/status?detail=full');
  ac.abort();
  const pick = (j) => { const m = j?.runtime?.memory ?? null; return m ? { children: m.children ?? null } : null; };
  console.log(JSON.stringify({ limit: memoryStatus(after.json)?.childHeap, before: pick(before.json), after: pick(after.json) }, null, 1));
  void sse;
} finally { await d.stop(); await provider.close(); }
