// PR #12930 fault-injection preload (vitest fork workers only).
// Loaded via NODE_OPTIONS=--require; inert in the daemon / ACP children.
//   PR12930_FAULT=none|delay:<ms>|404|cut|eof
//   PR12930_LOG=<file>  JSONL timeline: SSE GET dispatch/response, kill -KILL
'use strict';
const fs = require('node:fs');
const isDaemonOrChild = process.argv.some((a) => /[\\/]cli\.js$/.test(a));
const inVitestWorker = /tinypool[\\/]dist[\\/]entry[\\/]process\.js$/.test(process.argv[1] || '');
if (!isDaemonOrChild && inVitestWorker) {
  const mode = process.env.PR12930_FAULT || 'none';
  const logFile = process.env.PR12930_LOG;
  const t0 = Date.now();
  const log = (ev, extra = {}) => {
    if (!logFile) return;
    fs.appendFileSync(logFile, JSON.stringify({ t: Date.now(), ev, pid: process.pid, ...extra }) + '\n');
  };
  const EVENTS_RE = /\/session\/([^/]+)\/events(?:\?|$)/;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async function wrappedFetch(input, init) {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const m = EVENTS_RE.exec(url);
    const method = (init && init.method) || 'GET';
    if (!m || method !== 'GET') return realFetch(input, init);
    let target = url;
    if (mode.startsWith('delay:')) {
      const ms = Number(mode.slice(6));
      log('sse_get_delayed', { ms });
      await new Promise((r) => setTimeout(r, ms));
    }
    if (mode === 'stall') {
      // The SSE open never completes (e.g. a wedged daemon); only the
      // caller's abort signal ends it.
      log('sse_get_stalled');
      return new Promise((_, reject) => {
        const sig = init && init.signal;
        if (sig) sig.addEventListener('abort', () => { log('sse_get_stall_aborted', { reason: String(sig.reason) }); reject(sig.reason); }, { once: true });
      });
    }
    if (mode === '404') target = url.replace(m[1], '00000000-0000-4000-8000-00000000dead');
    log('sse_get_dispatch', { session: m[1], mode });
    const res = await realFetch(target, init);
    log('sse_response', { status: res.status });
    if (mode === 'hold' && res.ok && res.body) {
      // Stream stays open but never delivers anything (e.g. the daemon is
      // slow to notice the dead child); ends only when the consumer aborts.
      const reader = res.body.getReader();
      log('sse_body_held');
      const body = new ReadableStream({
        pull() { return new Promise(() => {}); },
        cancel() { log('sse_body_cancelled_by_consumer'); return reader.cancel().catch(() => {}); },
      });
      return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers });
    }
    if ((mode === 'cut' || mode === 'eof') && res.ok && res.body) {
      const reader = res.body.getReader();
      const body = new ReadableStream({
        async pull(controller) {
          // Hand the consumer nothing from the real stream: either fail the
          // transport after the handshake, or end it cleanly.
          await new Promise((r) => setTimeout(r, 300));
          reader.cancel().catch(() => {});
          if (mode === 'cut') {
            log('sse_body_injected_error');
            controller.error(new TypeError('terminated (injected: socket reset after SSE handshake)'));
          } else {
            log('sse_body_injected_eof');
            controller.close();
          }
        },
      });
      return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers });
    }
    return res;
  };
  const cp = require('node:child_process');
  const realExecSync = cp.execSync;
  cp.execSync = function patchedExecSync(cmd, ...rest) {
    if (typeof cmd === 'string' && /^kill -KILL /.test(cmd)) log('kill_sent', { cmd });
    const out = realExecSync.call(this, cmd, ...rest);
    if (typeof cmd === 'string' && /^kill -KILL /.test(cmd)) log('kill_returned', { cmd });
    return out;
  };
  require('node:module').syncBuiltinESMExports();
  log('preload_active', { mode, t0 });
}
