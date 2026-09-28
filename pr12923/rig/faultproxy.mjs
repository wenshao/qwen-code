// Transparent HTTP/WebSocket proxy that sits between nginx and the daemon.
// It forwards everything unchanged, records a ledger of every request, and can
// inject one-shot faults:
//   - 'drop-response': forward the request, let the daemon finish it, read the
//     whole upstream response, then destroy the client socket. The client sees
//     a network error although the daemon applied the request ("lost response").
//   - 'status': answer with a fixed status without forwarding (e.g. 503).
import http from 'node:http';
import net from 'node:net';

export function startFaultProxy({ port, target }) {
  const ledger = [];
  const faults = [];
  let seq = 0;
  const state = { target };
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      const url = new URL(req.url, 'http://x');
      const entry = {
        seq: ++seq,
        at: Date.now(),
        method: req.method,
        path: url.pathname,
        query: url.search,
        reqBytes: body.length,
      };
      ledger.push(entry);
      const fault = faults.find((f) => !f.used && f.match(entry));
      if (fault) {
        if (!fault.persistent) fault.used = true;
        fault.hits = (fault.hits ?? 0) + 1;
        entry.fault = fault.action;
      }
      if (fault?.action === 'html200') {
        entry.status = 200;
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end('<!doctype html><html><body>SPA fallback</body></html>');
        return;
      }
      if (fault?.action === 'status') {
        entry.status = fault.status;
        res.writeHead(fault.status, { 'content-type': 'text/html' });
        res.end(`<html><body>${fault.status} injected by fault proxy</body></html>`);
        return;
      }
      if (fault?.action === 'delay') {
        setTimeout(forward, fault.ms);
        return;
      }
      forward();
      function forward() {
      // Like nginx's default $proxy_host: the upstream sees its own authority.
      const headers = { ...req.headers, host: `127.0.0.1:${state.target}` };
      const up = http.request(
        {
          host: '127.0.0.1',
          port: state.target,
          method: req.method,
          path: req.url,
          headers,
        },
        (upRes) => {
          entry.status = upRes.statusCode;
          if (fault?.action === 'drop-response') {
            const upChunks = [];
            upRes.on('data', (c) => upChunks.push(c));
            upRes.on('end', () => {
              entry.droppedBody = Buffer.concat(upChunks).toString('utf8').slice(0, 300);
              res.socket?.destroy();
            });
            return;
          }
          res.writeHead(upRes.statusCode, upRes.headers);
          upRes.pipe(res);
        },
      );
      up.on('error', (e) => {
        entry.error = String(e);
        res.socket?.destroy();
      });
      up.end(body);
      }
    });
  });
  server.on('upgrade', (req, socket, head) => {
    ledger.push({ seq: ++seq, at: Date.now(), method: 'UPGRADE', path: req.url, reqBytes: 0 });
    const upstream = net.connect(state.target, '127.0.0.1', () => {
      let raw = `${req.method} ${req.url} HTTP/${req.httpVersion}\r\n`;
      for (let i = 0; i < req.rawHeaders.length; i += 2)
        raw += /^host$/i.test(req.rawHeaders[i])
          ? `Host: 127.0.0.1:${state.target}\r\n`
          : `${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}\r\n`;
      upstream.write(raw + '\r\n');
      if (head?.length) upstream.write(head);
      upstream.pipe(socket);
      socket.pipe(upstream);
    });
    upstream.on('error', () => socket.destroy());
    socket.on('error', () => upstream.destroy());
  });
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () =>
      resolve({
        port: server.address().port,
        ledger,
        faults,
        setTarget: (p) => (state.target = p),
        addFault: (f) => faults.push({ ...f, used: false }),
        clear: () => {
          ledger.length = 0;
          faults.length = 0;
        },
        close: () =>
          new Promise((r) => {
            server.closeAllConnections?.();
            server.close(() => r());
          }),
      }),
    );
  });
}
