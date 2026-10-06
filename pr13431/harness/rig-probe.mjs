// Rig-only probe, loaded first by an instrumented copy of dist/cli.js.
// It records what the daemon's fetch pool sees from the Store proxy: the
// keep-alive hint on each reply, how long a socket sat idle before it was
// reused, who closed each socket, and every transport error. Passive unless
// the `lag.on` flag file exists next to it (see the lag section below).
import dc from 'node:diagnostics_channel';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = process.env.RIG_PROBE_OUT ?? path.join(here, 'out');
fs.mkdirSync(outDir, { recursive: true });
let parent = '';
try {
  parent = fs
    .readFileSync(`/proc/${process.ppid}/cmdline`, 'utf8')
    .split('\0')
    .join(' ');
} catch {}
const driver = /hosted-([a-z-]+)-driver\.ts/.exec(parent)?.[1] ?? 'other';
const logFile = path.join(outDir, `${driver}.${process.pid}.jsonl`);
const t0 = Date.now();
const write = (event) =>
  fs.appendFileSync(
    logFile,
    JSON.stringify({ t: Date.now() - t0, ...event }) + '\n',
  );
write({ ev: 'start', driver, pid: process.pid, ppid: process.ppid });

const sockets = new WeakMap();
const requestSocket = new WeakMap();
let nextSocket = 1;
const header = (raw, name) => {
  const values = [];
  for (let i = 0; i + 1 < raw.length; i += 2)
    if (String(raw[i]).toLowerCase() === name) values.push(String(raw[i + 1]));
  return values.length ? values.join(', ') : null;
};
const isStore = (request) =>
  /\/internal\/managed-(?:session-store|tool-publications)\//.test(request.path ?? '');

dc.subscribe('undici:client:connected', ({ socket, connectParams }) => {
  const state = {
    id: nextSocket++,
    origin: `${connectParams?.protocol ?? ''}//${connectParams?.hostname ?? ''}:${connectParams?.port ?? ''}`,
    opened: Date.now(),
    lastDone: null,
    requests: 0,
    peerEnded: null,
    keepAlive: null,
    store: false,
  };
  sockets.set(socket, state);
  socket.once('end', () => {
    state.peerEnded = Date.now();
  });
  socket.once('close', () => {
    const idle = state.lastDone === null ? null : Date.now() - state.lastDone;
    write({
      ev: 'close',
      sock: state.id,
      origin: state.origin,
      store: state.store,
      requests: state.requests,
      idleAtClose: idle,
      closedBy: state.peerEnded === null ? 'client' : 'server',
      keepAlive: state.keepAlive,
    });
  });
});

dc.subscribe('undici:client:sendHeaders', ({ request, socket }) => {
  const state = sockets.get(socket);
  if (!state) return;
  requestSocket.set(request, state);
  state.requests++;
  if (isStore(request)) state.store = true;
  write({
    ev: 'send',
    sock: state.id,
    origin: state.origin,
    store: isStore(request),
    n: state.requests,
    idle: state.lastDone === null ? null : Date.now() - state.lastDone,
    method: request.method,
    path: String(request.path).replace(/[?].*$/, ''),
  });
});

dc.subscribe('undici:request:headers', ({ request, response }) => {
  const state = requestSocket.get(request);
  const keepAlive = header(response.headers, 'keep-alive');
  if (state) state.keepAlive = keepAlive;
  write({
    ev: 'resp',
    sock: state?.id ?? null,
    store: isStore(request),
    status: response.statusCode,
    keepAlive,
    connection: header(response.headers, 'connection'),
  });
});

dc.subscribe('undici:request:trailers', ({ request }) => {
  const state = requestSocket.get(request);
  if (state) state.lastDone = Date.now();
});

dc.subscribe('undici:request:error', ({ request, error }) => {
  const state = requestSocket.get(request);
  write({
    ev: 'error',
    sock: state?.id ?? null,
    store: isStore(request),
    method: request.method,
    path: String(request.path).replace(/[?].*$/, ''),
    idle: state?.lastDone == null ? null : Date.now() - state.lastDone,
    code: error?.code ?? null,
    message: String(error?.message ?? error),
  });
});

// Lag injection (only with `lag.on`): the #13419 lag probe in generic form.
// When a Store request follows at least 1 s of Store idleness, hold it (and
// any Store request that arrives meanwhile) until the pool has been idle for
// 5.8 s, then block the event loop for 0.6 s and release them together. A
// proxy that closes idle sockets at ~6 s then lands its FIN inside the block.
if (driver !== 'other' && fs.existsSync(path.join(here, 'lag.on'))) {
  const realFetch = globalThis.fetch;
  let lastStoreDone = 0;
  let gate = null;
  dc.subscribe('undici:request:trailers', ({ request }) => {
    if (isStore(request)) lastStoreDone = Date.now();
  });
  globalThis.fetch = async function rigFetch(input, init) {
    const url = new URL(
      typeof input === 'string' || input instanceof URL ? input : input.url,
    );
    if (!isStore({ path: url.pathname })) return realFetch(input, init);
    if (gate) await gate;
    else {
      const idle = Date.now() - lastStoreDone;
      if (lastStoreDone && idle >= 1000 && idle < 5800) {
        gate = (async () => {
          await new Promise((resolve) => setTimeout(resolve, 5800 - idle));
          const end = Date.now() + 600;
          while (Date.now() < end);
          write({ ev: 'lag', idleBefore: idle, path: url.pathname });
        })();
        try {
          await gate;
        } finally {
          gate = null;
        }
      }
    }
    return realFetch(input, init);
  };
  write({ ev: 'lag-armed' });
}
