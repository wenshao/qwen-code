#!/usr/bin/env node
// Minimal stdio LSP server whose hover answer is the server's OWN copy of the
// hovered line — so "what did the client deliver" is directly observable.
//   FAKE_SYNC   JSON for capabilities.textDocumentSync ("absent" = omit field)
//   FAKE_LOG    append one JSON line per notification/request received
import { appendFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SYNC = process.env.FAKE_SYNC ?? '2';
const LOG = process.env.FAKE_LOG;
const docs = new Map(); // uri -> { text, version }
const log = (r) => LOG && appendFileSync(LOG, JSON.stringify({ t: Date.now(), pid: process.pid, ...r }) + '\n');

function offsetAt(text, pos) {
  const lines = text.split(/(?<=\r\n|\r|\n)/);
  let off = 0;
  for (let i = 0; i < pos.line && i < lines.length; i++) off += lines[i].length;
  return off + pos.character;
}

// One warning per server-known document, quoting the server's copy of line 1.
const diag = (d) => ({
  range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
  severity: 2,
  source: 'fake-lsp',
  message: `server copy v${d.version}: ${d.text.split(/\r\n|\r|\n/)[0]}`,
});

function send(msg) {
  const body = Buffer.from(JSON.stringify({ jsonrpc: '2.0', ...msg }));
  process.stdout.write(`Content-Length: ${body.length}\r\n\r\n`);
  process.stdout.write(body);
}

function handle(msg) {
  const p = msg.params || {};
  const uri = p.textDocument?.uri;
  switch (msg.method) {
    case 'initialize': {
      const capabilities = { hoverProvider: true };
      if (SYNC !== 'absent') capabilities.textDocumentSync = JSON.parse(SYNC);
      send({ id: msg.id, result: { capabilities } });
      return;
    }
    case 'textDocument/didOpen':
      log({ m: 'didOpen', uri, version: p.textDocument.version, text: p.textDocument.text });
      docs.set(uri, { text: p.textDocument.text, version: p.textDocument.version });
      return;
    case 'textDocument/didChange': {
      const d = docs.get(uri);
      log({ m: 'didChange', uri, version: p.textDocument.version, known: !!d, changes: p.contentChanges });
      if (!d) return;
      for (const c of p.contentChanges) {
        if (!c.range) d.text = c.text;
        else d.text = d.text.slice(0, offsetAt(d.text, c.range.start)) + c.text + d.text.slice(offsetAt(d.text, c.range.end));
      }
      d.version = p.textDocument.version;
      return;
    }
    case 'textDocument/didClose':
      log({ m: 'didClose', uri });
      docs.delete(uri);
      return;
    case 'textDocument/hover': {
      const d = docs.get(uri);
      log({ m: 'hover', uri, known: !!d, version: d?.version });
      let line;
      if (d) line = d.text.split(/\r\n|\r|\n/)[p.position.line];
      else {
        try {
          line = '(never opened; disk says) ' + readFileSync(fileURLToPath(uri), 'utf8').split(/\r\n|\r|\n/)[p.position.line];
        } catch {
          line = '(never opened; unreadable)';
        }
      }
      send({ id: msg.id, result: { contents: { kind: 'plaintext', value: `server-copy v${d?.version ?? '-'}: ${line}` } } });
      return;
    }
    case 'textDocument/diagnostic': {
      const d = docs.get(uri);
      log({ m: 'diagnostic', uri, known: !!d });
      send({ id: msg.id, result: { kind: 'full', items: d ? [diag(d)] : [] } });
      return;
    }
    case 'workspace/diagnostic': {
      log({ m: 'workspaceDiagnostic', knownDocs: [...docs.keys()].map((u) => u.split('/').pop()) });
      send({ id: msg.id, result: { items: [...docs].map(([u, d]) => ({ uri: u, kind: 'full', version: d.version, items: [diag(d)] })) } });
      return;
    }
    case 'shutdown':
      send({ id: msg.id, result: null });
      return;
    case 'exit':
      process.exit(0);
    default:
      if (msg.id !== undefined && msg.method) send({ id: msg.id, error: { code: -32601, message: `unsupported ${msg.method}` } });
  }
}

let buf = Buffer.alloc(0);
process.stdin.on('data', (chunk) => {
  buf = Buffer.concat([buf, chunk]);
  for (;;) {
    const sep = buf.indexOf('\r\n\r\n');
    if (sep < 0) return;
    const len = Number(/Content-Length:\s*(\d+)/i.exec(buf.subarray(0, sep).toString())[1]);
    if (buf.length < sep + 4 + len) return;
    const body = buf.subarray(sep + 4, sep + 4 + len).toString('utf8');
    buf = buf.subarray(sep + 4 + len);
    handle(JSON.parse(body));
  }
});
