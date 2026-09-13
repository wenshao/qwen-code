import { register } from 'node:module';
import http from 'node:http';
// The ACP child inherits execArgv, so only instrument the serve daemon itself.
const isAcpChild = process.argv.includes('--acp');
if (!isAcpChild) {
  register('./probe-loader.mjs', import.meta.url);
  globalThis.__probeBypassLiveCaller = true;
  const PORT = Number(process.env.PROBE_PORT || 19646);
  const server = http.createServer(async (req, res) => {
    let raw = '';
    for await (const c of req) raw += c;
    if (!req.url?.startsWith('/wait')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ captured: Boolean(globalThis.__probeLTS), pid: process.pid }));
      return;
    }
    const body = JSON.parse(raw || '{}');
    const svc = globalThis.__probeLTS;
    if (!svc) {
      res.writeHead(503, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'LiveTaskService not constructed yet' }));
      return;
    }
    const t0 = Date.now();
    try {
      const result = await svc.handle({
        callerSessionId: body.callerSessionId ?? 'probe-caller',
        name: 'wait_threads',
        arguments: { targets: [{ threadId: body.threadId }], timeoutMs: body.timeoutMs ?? 20000 },
      });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ startedAt: t0, elapsedMs: Date.now() - t0, result }));
    } catch (error) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ startedAt: t0, elapsedMs: Date.now() - t0, error: String(error) }));
    }
  });
  server.on('error', (e) => console.error('probe server error', String(e)));
  server.listen(PORT, '127.0.0.1');
  server.unref();
}
