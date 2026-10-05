// Daemon preload (local verification only). Two env-free knobs via the import URL query:
//   log=<file>   log every rejected fetch() to a Managed Session Store / publication URL,
//                with the undici cause chain; the rejection is rethrown untouched.
//   stall=<ms>&flag=<file>[&nth=N]  when <file> exists (the driver creates it for one armed
//                javaLoad), the Nth /resources/ fetch (default 1st) deletes it and blocks the event
//                loop for <ms> synchronously before dispatching — a deterministic stand-in
//                for a runner CPU stall. Nothing else changes.
import { appendFileSync, existsSync, rmSync } from 'node:fs';
const query = new URL(import.meta.url).searchParams;
const log = query.get('log');
const stallMs = Number(query.get('stall') ?? 0);
const flag = query.get('flag');
const nth = Number(query.get('nth') ?? 1);
let seen = 0;
// nth=burst: stall on the first /resources/ fetch issued while another one is still in
// flight, i.e. inside verifyWorkspaceRestore's parallel read burst (open-phase reads are
// sequential, so they never qualify).
const burst = query.get('nth') === 'burst';
// on=commit: count /transactions:commit fetches instead of /resources/ ones.
const target = query.get('on') === 'commit' ? '/transactions:commit' : '/resources/';
let inflight = 0;
const original = globalThis.fetch;
const note = (entry) => log && appendFileSync(log, JSON.stringify({ t: Date.now(), pid: process.pid, ...entry }) + '\n');
if (log) {
  note({ loaded: true, argv: process.argv.slice(1, 4), stallMs });
  globalThis.fetch = async function verifyFetch(input, init) {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const path = url.replace(/^https?:\/\/[^/]+/, '').replace(/sessions\/[^/]+/, 'sessions/<id>').replace(/\?.*$/, '');
    const resource = url.includes('/resources/');
    if (stallMs > 0 && flag && url.includes(target) && existsSync(flag) && (burst ? inflight >= 1 : ++seen === nth)) {
      rmSync(flag, { force: true });
      seen = 0;
      note({ stall: stallMs, nth: burst ? 'burst' : nth, inflight, before: path });
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, stallMs);
    }
    const t0 = Date.now();
    if (resource) inflight++;
    try {
      return await original.call(this, input, init);
    } catch (error) {
      if (url.includes('/internal/managed-')) {
        const chain = [];
        let cause = error;
        for (let i = 0; i < 5 && cause; i++) {
          chain.push(`${cause.name}:${cause.message}${cause.code ? ':' + cause.code : ''}`);
          cause = cause.cause;
        }
        note({ fetchRejected: true, ms: Date.now() - t0, method: init?.method ?? 'GET', path, chain });
      }
      throw error;
    } finally {
      if (resource) inflight--;
    }
  };
}
