/**
 * Scratch probe for PR #13304 verification (not part of the PR).
 * Which lost-reply shapes does the real acknowledge() replay?
 */
import { createServer, type Server } from 'node:http';
import { writeFileSync, appendFileSync } from 'node:fs';
import { afterEach, it } from 'vitest';
import { HostedWorkspaceBroker } from '../hosted-workspace-broker.js';

const OUT = process.env['PROBE_OUT'] ?? '/dev/null';
writeFileSync(OUT, '');
let server: Server | undefined;
afterEach(async () => {
  server?.closeAllConnections();
  if (server) await new Promise<void>((r) => server!.close(() => r()));
  server = undefined;
});
const identity = { protocolVersion: 1, harnessSessionId: 'session', runtimeSessionId: 'turn' };
const ok = JSON.stringify({ ...identity, executionCallId: 'execution', acknowledged: true });
type Shape = (res: import('node:http').ServerResponse) => void;
const shapes: Record<string, Shape> = {
  'reset before any response byte': (res) => res.destroy(),
  'headers sent (Content-Length), body cut mid-way': (res) => {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': String(ok.length) });
    res.write(ok.slice(0, 20));
    setTimeout(() => res.destroy(), 20);
  },
  'headers sent (chunked), body cut mid-way': (res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.write(ok.slice(0, 20));
    setTimeout(() => res.destroy(), 20);
  },
  'gateway 502 with HTML body': (res) => {
    res.writeHead(502, { 'Content-Type': 'text/html' });
    res.end('<html>bad gateway</html>');
  },
  'gateway 503 with JSON error': (res) => {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ code: 'upstream_unavailable' }));
  },
};

for (const [name, shape] of Object.entries(shapes)) {
  it(name, async () => {
    let attempts = 0;
    server = createServer(async (req, res) => {
      for await (const _ of req) void _;
      attempts++;
      if (attempts === 1) return shape(res);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(ok);
    });
    await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r));
    const address = server.address() as { port: number };
    const broker = new HostedWorkspaceBroker(
      { baseUrl: `http://127.0.0.1:${address.port}`, token: 'test' },
      { tenantId: 'tenant', workspaceId: 'workspace', sessionId: 'session' },
      'turn',
    );
    let outcome = 'resolved';
    try {
      await broker.acknowledge('execution', {
        executionCallId: 'execution',
        manifest: null,
        deliveryStatus: 'blocked',
        historyRevision: null,
      } as never);
    } catch (cause) {
      outcome = `rejected ${(cause as Error).constructor.name}: ${String((cause as Error).message).slice(0, 60)}`;
    }
    appendFileSync(OUT, `${name} | attempts=${attempts} | ${outcome}\n`);
  });
}
