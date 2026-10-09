// R1-1: the BUILT RemoteManagedRuntimeProvider against a real HTTP server whose
// first /v1/prepare answers 500 (a failed cold start), then recovers.
// usage: node probe.mjs <repo>
import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [repo] = process.argv.slice(2);
setTimeout(() => {
  console.log('RESULT probe_timeout = true');
  process.exit(3);
}, 60_000).unref();
const { RemoteManagedRuntimeProvider } = await import(
  pathToFileURL(path.join(repo, 'packages/cli/dist/src/serve/managed-runtime-provider.js')).href
);
const result = (key, value) => console.log(`RESULT ${key} = ${JSON.stringify(value)}`);
const wire = [];
let prepares = 0;
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const route = new URL(req.url, 'http://x').pathname;
    const send = (status, value) => {
      wire.push(`${req.method} ${route} -> ${status}`);
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(value === undefined ? '' : JSON.stringify(value));
    };
    if (route.endsWith('/v1/prepare')) {
      if (++prepares === 1) return send(500);
      return send(200, { protocolVersion: 1, ready: true });
    }
    if (route.endsWith('/release')) {
      const parsed = JSON.parse(body || '{}');
      return send(200, { protocolVersion: parsed.protocolVersion, released: true });
    }
    return send(200, { protocolVersion: 2, result: {} });
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = `http://127.0.0.1:${server.address().port}`;
const request = {
  protocolVersion: 1,
  tenantId: 'tenant-p8',
  workspaceId: 'workspace-p8',
  workspaceCwd: '/workspace/p8',
  sessionId: '550e8400-e29b-41d4-a716-446655440108',
  turnKind: 'bootstrap',
};
const remote = new RemoteManagedRuntimeProvider({
  baseUrl,
  token: 'runtime-secret',
  lease: { leaseId: 'lease', epoch: 1 },
});
const settle = (p) =>
  p.then(
    (v) => ({ ok: true, v }),
    (e) => ({ ok: false, e: `${e?.code ?? ''} ${e?.message ?? e}`.trim() }),
  );
const step = async (label, p) => {
  const from = wire.length;
  const r = await settle(p);
  result(label, r.ok ? (typeof r.v === 'object' ? 'client' : r.v) : r.e);
  result(`${label}_wire`, wire.slice(from));
};
await step('1_getToolV2Client_cold_start_500', remote.getToolV2Client(request));
await step('2_release', remote.release(request.sessionId, request));
await step('3_getToolV2Client_again', remote.getToolV2Client(request));
await step('4_getToolV2Client_after_2s', new Promise((r) => setTimeout(r, 2000)).then(() => remote.getToolV2Client(request)));
result('prepares_seen_by_server', prepares);
remote.dispose();
server.close();
process.exit(0);
