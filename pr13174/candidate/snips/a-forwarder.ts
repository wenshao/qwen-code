type StoreForwarder = {
  baseUrl: string;
  retarget: (port: number) => void;
  answeredBy: (
    port: number,
  ) => Array<{ method: string; path: string; status: number | string }>;
  close: () => Promise<void>;
};

// The freeze arm's former Harness writes to the Session Store through the
// Spring that loaded it. That Spring is killed, so without a stable address
// the woken writer only meets a refused connection and the store-side fence
// is never exercised. The forwarder keeps the address alive; a request whose
// store died under it is held and replayed to the next store, so the frozen
// writer's first request after SIGCONT meets the replacement's fence.
async function startStoreForwarder(
  initialTarget: number,
): Promise<StoreForwarder> {
  let target = initialTarget;
  const held: Array<() => void> = [];
  const seen: Array<{
    method: string;
    path: string;
    target: number;
    status: number | string;
  }> = [];
  const forward = (
    req: import('node:http').IncomingMessage,
    body: Buffer,
    res: import('node:http').ServerResponse,
    entry: (typeof seen)[number],
  ) => {
    const port = target;
    const upstream = httpRequest(
      {
        host: '127.0.0.1',
        port,
        method: req.method,
        path: req.url,
        headers: { ...req.headers, host: `127.0.0.1:${port}` },
      },
      (reply) => {
        entry.target = port;
        entry.status = reply.statusCode ?? 0;
        res.writeHead(reply.statusCode ?? 502, reply.headers);
        reply.on('aborted', () => res.destroy());
        reply.pipe(res);
      },
    );
    upstream.on('error', () => {
      if (entry.status !== 'pending') {
        res.destroy();
      } else if (port === target) {
        held.push(() => forward(req, body, res, entry));
      } else {
        forward(req, body, res, entry);
      }
    });
    upstream.end(body);
  };
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const entry = {
        method: req.method ?? '',
        path: (req.url ?? '').replace(/\?.*$/, ''),
        target: 0,
        status: 'pending' as number | string,
      };
      seen.push(entry);
      forward(req, Buffer.concat(chunks), res, entry);
    });
  });
  // Pooled sockets must survive the SIGSTOP window; otherwise the woken
  // writer's next request dies on a closed socket before reaching a store.
  server.keepAliveTimeout = 600_000;
  server.headersTimeout = 610_000;
  server.requestTimeout = 0;
  const port = await freePort();
  await new Promise<void>((resolve) =>
    server.listen(port, '127.0.0.1', () => resolve()),
  );
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    retarget: (next) => {
      target = next;
      for (const replay of held.splice(0)) replay();
    },
    answeredBy: (storePort) =>
      seen
        .filter((entry) => entry.target === storePort)
        .map(({ method, path: requestPath, status }) => ({
          method,
          path: requestPath,
          status,
        })),
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

type HeldExecutionStartProxy = {
