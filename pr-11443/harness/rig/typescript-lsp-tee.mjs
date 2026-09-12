#!/usr/bin/env node
// stdio JSON-RPC tee: spawns the real LSP server given in argv and appends one
// JSON line per client->server / server->client frame to $LSP_WIRE_LOG.
// The file name contains "typescript" so LspServerManager.isTypescriptServer()
// still classifies the proxied server as tsserver (warmup path stays live).
import { spawn } from 'node:child_process';
import { appendFileSync } from 'node:fs';

const LOG = process.env.LSP_WIRE_LOG;
const [cmd, ...args] = process.argv.slice(2);
const child = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'inherit'] });

function summarize(dir, msg) {
  const rec = { t: Date.now(), dir, pid: process.pid };
  if (msg.method) rec.method = msg.method;
  if (msg.id !== undefined) rec.id = msg.id;
  const p = msg.params;
  if (p?.textDocument) {
    rec.uri = p.textDocument.uri;
    if (p.textDocument.version !== undefined) rec.version = p.textDocument.version;
    if (typeof p.textDocument.text === 'string') rec.text = p.textDocument.text;
  }
  if (p?.contentChanges) {
    rec.changes = p.contentChanges.map((c) => ({ range: c.range, text: c.text }));
  }
  if (p?.position) rec.position = p.position;
  if (dir === 's2c' && msg.result?.capabilities) {
    rec.textDocumentSync = msg.result.capabilities.textDocumentSync;
  }
  return rec;
}

function framer(dir, onFrame) {
  let buf = Buffer.alloc(0);
  return (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    for (;;) {
      const sep = buf.indexOf('\r\n\r\n');
      if (sep < 0) return;
      const m = /Content-Length:\s*(\d+)/i.exec(buf.subarray(0, sep).toString());
      if (!m) return;
      const len = Number(m[1]);
      if (buf.length < sep + 4 + len) return;
      const body = buf.subarray(sep + 4, sep + 4 + len).toString('utf8');
      buf = buf.subarray(sep + 4 + len);
      try {
        onFrame(summarize(dir, JSON.parse(body)));
      } catch {
        /* ignore */
      }
    }
  };
}

const log = (rec) => {
  if (!LOG) return;
  if (rec.dir === 's2c' && !rec.textDocumentSync) return; // keep responses quiet
  appendFileSync(LOG, JSON.stringify(rec) + '\n');
};
const c2s = framer('c2s', log);
const s2c = framer('s2c', log);
process.stdin.on('data', (d) => {
  c2s(d);
  child.stdin.write(d);
});
child.stdout.on('data', (d) => {
  s2c(d);
  process.stdout.write(d);
});
process.stdin.on('end', () => child.stdin.end());
child.on('exit', (code) => process.exit(code ?? 0));
process.on('SIGTERM', () => child.kill('SIGTERM'));
