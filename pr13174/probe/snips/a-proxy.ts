type StoreProxyEntry = { at: number; method: string; path: string; status: number | string; target: number };
const probeStoreProxy = process.env['PROBE_STORE_PROXY'] === '1';
const probeWakeMs = Number(process.env['PROBE_WAKE_MS'] ?? '5000');
const storeProxyLog: StoreProxyEntry[] = [];
let storeProxyTarget = 0;
async function startStoreProxy(): Promise<{ port: number; close: () => Promise<void> }> {
  const { request } = await import('node:http');
  const port = await freePort();
  const server = createServer((req, res) => {
    const target = storeProxyTarget;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const entry: StoreProxyEntry = { at: Date.now(), method: req.method ?? '', path: req.url ?? '', status: 'pending', target };
      storeProxyLog.push(entry);
      const upstream = request(
        { host: '127.0.0.1', port: target, method: req.method, path: req.url, headers: { ...req.headers, host: `127.0.0.1:${target}` } },
        (up) => {
          entry.status = up.statusCode ?? 0;
          res.writeHead(up.statusCode ?? 502, up.headers);
          up.on('aborted', () => res.destroy());
          up.pipe(res);
        },
      );
      upstream.on('error', (e) => {
        entry.status = `ERR ${(e as NodeJS.ErrnoException).code ?? e.message}`;
        res.destroy();
      });
      upstream.end(Buffer.concat(chunks));
    });
  });
  // Keep pooled sockets alive across the SIGSTOP window so the woken writer's first request reaches the store.
  server.keepAliveTimeout = 600_000;
  server.headersTimeout = 610_000;
  server.requestTimeout = 0;
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', () => resolve()));
  return { port, close: () => new Promise<void>((resolve) => { server.closeAllConnections?.(); server.close(() => resolve()); }) };
}

type HeldExecutionStartProxy = {
