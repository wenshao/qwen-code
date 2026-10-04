// usage: node acp-load.cjs <cli.js> <sessionId> <cwd> <out.json>
// Real ACP agent over stdio: initialize -> session/load, record every
// session/update the agent replays for the stored transcript.
'use strict';
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const [cli, sessionId, cwd, outFile] = process.argv.slice(2);
const child = spawn(process.execPath, [cli, '--acp', '--auth-type', 'openai', '--openai-api-key', 'dummy', '--openai-base-url', process.env.FAKE_URL, '--model', 'fake-model'], {
  cwd,
  env: process.env,
  stdio: ['pipe', 'pipe', 'pipe'],
});
let buf = '';
let id = 0;
const pending = new Map();
const updates = [];
let stderr = '';
child.stderr.on('data', (d) => (stderr += d));
child.stdout.on('data', (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i);
    buf = buf.slice(i + 1);
    if (!line.trim()) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    if (msg.id !== undefined && pending.has(msg.id) && (msg.result !== undefined || msg.error !== undefined)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    } else if (msg.method === 'session/update') {
      updates.push(msg.params.update);
    } else if (msg.method && msg.id !== undefined) {
      // Agent -> client request (e.g. permission); answer generically.
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: {} }) + '\n');
    }
  }
});
const call = (method, params) =>
  new Promise((resolve) => {
    const myId = ++id;
    pending.set(myId, resolve);
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: myId, method, params }) + '\n');
  });
(async () => {
  const timer = setTimeout(() => { fs.writeFileSync(outFile, JSON.stringify({ timeout: true, updates, stderr: stderr.slice(-2000) }, null, 2)); process.exit(2); }, 60000);
  const init = await call('initialize', { protocolVersion: 1, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } } });
  const load = await call('session/load', { sessionId, cwd, mcpServers: [] });
  await new Promise((r) => setTimeout(r, 1500));
  clearTimeout(timer);
  const announced = new Set(updates.filter((u) => u.sessionUpdate === 'tool_call').map((u) => u.toolCallId));
  const summary = {
    initError: init.error ?? null,
    loadError: load.error ?? null,
    updateKinds: updates.reduce((a, u) => ((a[u.sessionUpdate] = (a[u.sessionUpdate] || 0) + 1), a), {}),
    toolCalls: updates.filter((u) => u.sessionUpdate === 'tool_call').map((u) => u.toolCallId),
    toolCallUpdates: updates.filter((u) => u.sessionUpdate === 'tool_call_update').map((u) => `${u.toolCallId}:${u.status ?? ''}`),
    unannouncedCompletions: updates
      .filter((u) => u.sessionUpdate === 'tool_call_update' && !announced.has(u.toolCallId))
      .map((u) => u.toolCallId),
  };
  fs.writeFileSync(outFile, JSON.stringify({ summary, updates }, null, 2));
  console.log(JSON.stringify(summary));
  child.kill();
  process.exit(0);
})();
