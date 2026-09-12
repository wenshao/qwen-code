#!/usr/bin/env node
// Minimal raw-ndjson ACP client: drives `qwen --acp` over stdio, which is the
// transport the channel/daemon paths use (no interactive Ctrl+Y available).
// Usage: node acp-probe.mjs <treeDist> <cwd> <prompt> <outJsonl>
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const [tree, cwd, prompt, outFile] = process.argv.slice(2);
const out = fs.createWriteStream(outFile, { flags: 'w' });
const rec = (dir, msg) => out.write(JSON.stringify({ t: Date.now(), dir, msg }) + '\n');

const child = spawn(process.execPath, [`${tree}/dist/cli.js`, '--acp', '--yolo'], {
  cwd,
  env: process.env,
  stdio: ['pipe', 'pipe', 'pipe'],
});
let stderr = '';
child.stderr.on('data', (d) => (stderr += d.toString()));

let nextId = 1;
const pending = new Map();
const send = (method, params) => {
  const id = nextId++;
  const frame = { jsonrpc: '2.0', id, method, params };
  rec('->', frame);
  child.stdin.write(JSON.stringify(frame) + '\n');
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
};

let buf = '';
child.stdout.on('data', (chunk) => {
  buf += chunk.toString();
  let idx;
  while ((idx = buf.indexOf('\n')) !== -1) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { rec('<-raw', line); continue; }
    rec('<-', msg);
    if (msg.id !== undefined && msg.method) {
      // Agent -> client request: answer permissions with "allow", fs with error.
      const result = msg.method === 'session/request_permission'
        ? { outcome: { outcome: 'selected', optionId: 'proceed_once' } }
        : {};
      const resp = { jsonrpc: '2.0', id: msg.id, result };
      rec('->', resp);
      child.stdin.write(JSON.stringify(resp) + '\n');
      continue;
    }
    if (msg.id !== undefined && pending.has(msg.id)) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) p.reject(new Error(JSON.stringify(msg.error)));
      else p.resolve(msg.result);
    }
  }
});

const started = Date.now();
try {
  await send('initialize', {
    protocolVersion: 1,
    clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } },
  });
  const session = await send('session/new', { cwd, mcpServers: [] });
  const promptResult = await send('session/prompt', {
    sessionId: session.sessionId,
    prompt: [{ type: 'text', text: prompt }],
  });
  console.log(JSON.stringify({
    ok: true, elapsedMs: Date.now() - started,
    stopReason: promptResult?.stopReason, promptResult,
  }));
} catch (err) {
  console.log(JSON.stringify({ ok: false, elapsedMs: Date.now() - started, error: String(err.message || err) }));
} finally {
  child.kill('SIGKILL');
  out.end();
  if (process.env['ACP_SHOW_STDERR']) console.error(stderr.slice(-2000));
}
