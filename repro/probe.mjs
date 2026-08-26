// Byte-for-byte the daemon's own WORKER_TLS_TRUST_PROBE (run-qwen-serve.ts),
// run standalone so the handshake a channel worker performs can be observed
// directly. argv: <daemonUrl> <timeoutMs>; NODE_EXTRA_CA_CERTS supplies the
// exact bundle the supervisor hands workers.
import { isIP } from 'node:net';
import * as tls from 'node:tls';
const url = new URL(process.argv[2]);
const timeoutMs = Number(process.argv[3] ?? 5000);
const hostname = url.hostname.replace(/^\[|\]$/g, '');
let socket;
let settled = false;
const finish = (result) => {
  if (settled) return;
  settled = true;
  process.stdout.write(JSON.stringify(result) + '\n');
  socket?.destroy();
};
try {
  socket = tls.connect(
    {
      host: hostname,
      port: Number(url.port || '443'),
      rejectUnauthorized: true,
      ...(isIP(hostname) === 0 ? { servername: hostname } : {}),
    },
    () => {
      const peer = socket.getPeerCertificate(true);
      const chain = [];
      let cur = peer;
      const seen = new Set();
      while (cur && cur.fingerprint256 && !seen.has(cur.fingerprint256)) {
        seen.add(cur.fingerprint256);
        chain.push({ subject: cur.subject?.CN, validTo: cur.valid_to, serial: cur.serialNumber });
        cur = cur.issuerCertificate;
      }
      finish({ ok: true, authorized: socket.authorized, verifiedChain: chain });
    },
  );
  socket.once('error', (error) =>
    finish({ ok: false, code: error.code ?? 'WORKER_TLS_VERIFY_FAILED', message: error.message }),
  );
  socket.setTimeout(timeoutMs, () =>
    finish({ ok: false, code: 'WORKER_TLS_VERIFY_TIMEOUT', message: 'TLS verification probe timed out.' }),
  );
} catch (error) {
  finish({ ok: false, code: error.code ?? 'WORKER_TLS_VERIFY_FAILED', message: error.message });
}
