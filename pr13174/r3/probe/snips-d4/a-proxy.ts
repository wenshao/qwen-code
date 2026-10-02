// PROBE (D4 lost reply): an HTTP proxy between Spring and the Harness that can
// drop one prompt reply after the Harness answered it, then hold every later
// request until released.
type DropProxy = {
  port: number;
  arm: () => void;
  release: () => void;
  dropped: () => { status: number; at: number; path: string } | undefined;
  log: Array<{ at: number; method: string; path: string; status: number | string; held: boolean }>;
};
async function startDropProxy(targetPort: number): Promise<DropProxy> {
  const { request } = await import('node:http');
  let armed = false;
  let holding = false;
  let droppedInfo: { status: number; at: number; path: string } | undefined;
  const queue: Array<() => void> = [];
  const log: DropProxy['log'] = [];
  const forward = (req: import('node:http').IncomingMessage, body: Buffer, res: import('node:http').ServerResponse, held: boolean) => {
    const entry = { at: Date.now(), method: req.method ?? '', path: (req.url ?? '').replace(/\?.*$/, ''), status: 'pending' as number | string, held };
    log.push(entry);
    const drop = armed && req.method === 'POST' && /\/session\/[^/]+\/prompt$/.test(entry.path);
    if (drop) armed = false;
    const upstream = request(
      { host: '127.0.0.1', port: targetPort, method: req.method, path: req.url, headers: { ...req.headers, host: `127.0.0.1:${targetPort}` } },
      (reply) => {
        entry.status = reply.statusCode ?? 0;
        if (drop) {
          reply.resume();
          reply.on('end', () => {
            droppedInfo = { status: reply.statusCode ?? 0, at: Date.now(), path: entry.path };
            holding = true;
            req.socket.destroy();
          });
          return;
        }
        res.writeHead(reply.statusCode ?? 502, reply.headers);
        reply.on('aborted', () => res.destroy());
        res.on('close', () => reply.destroy());
        reply.pipe(res);
      },
    );
    upstream.on('error', (error) => {
      entry.status = `ERR ${(error as NodeJS.ErrnoException).code ?? error.message}`;
      res.destroy();
    });
    upstream.end(body);
  };
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      if (holding) queue.push(() => forward(req, body, res, true));
      else forward(req, body, res, false);
    });
  });
  server.keepAliveTimeout = 600_000;
  server.headersTimeout = 610_000;
  server.requestTimeout = 0;
  const port = await freePort();
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', () => resolve()));
  return {
    port,
    arm: () => { armed = true; },
    release: () => { holding = false; for (const run of queue.splice(0)) run(); },
    dropped: () => droppedInfo,
    log,
  };
}

type HeldExecutionStartProxy = {
