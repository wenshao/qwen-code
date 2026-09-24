// valid ready + first attest OK (adoption), every later attest 409; normal SIGTERM
import { createServer } from 'node:http';
import process from 'node:process';
let buf = ''; let n = 0;
process.stdin.on('data', (c) => (buf += c));
process.stdin.on('end', () => {
  const b = JSON.parse(buf);
  const s = createServer((q, r) => {
    q.resume();
    q.on('end', () => {
      n++;
      if (n === 1) {
        r.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        r.end(JSON.stringify({ protocolVersion: 2, runtimeInstanceId: b.runtimeInstanceId, runtimeIncarnation: b.runtimeIncarnation, leaseId: b.leaseId, epoch: b.epoch, provisionRequestId: b.provisionRequestId, tenantId: b.tenantId, workspaceId: b.workspaceId, workspaceGeneration: b.workspaceGeneration, workspaceCwd: b.workspaceCwd, capabilityDigest: b.capabilityDigest, isolationClass: b.isolationClass }));
      } else {
        r.writeHead(409, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        r.end('{"error":{"code":"stale"}}');
      }
    });
  });
  s.listen(0, '127.0.0.1', () => process.stdout.write(JSON.stringify({ type: 'ready', version: 1, runtimeInstanceId: b.runtimeInstanceId, runtimeIncarnation: b.runtimeIncarnation, leaseId: b.leaseId, epoch: b.epoch, url: `http://127.0.0.1:${s.address().port}` }) + '\n'));
});
