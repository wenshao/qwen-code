// Drive one real `qwen --acp` stdio session against the fake model.
// usage: node acp-run.mjs <armdir> <scenario> <outdir>
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
const [armDir, scen, out] = process.argv.slice(2);
const H = '/root/verify/pr10916/harness';
rmSync(out, { recursive: true, force: true });
const ws = `${out}/ws`, home = `${out}/home`;
mkdirSync(ws, { recursive: true }); mkdirSync(home, { recursive: true });
writeFileSync(`${ws}/README.md`, '# demo project\nNot a git checkout.\n');
const fake = spawn('node', [`${H}/fake-model.mjs`, `${H}/${scen}.mjs`, `${out}/requests.jsonl`], { env: { ...process.env, WS: ws } });
const url = await new Promise((res) => { let b = ''; fake.stdout.on('data', (d) => { b += d; const m = b.match(/FAKE_SERVER_READY (\S+)/); if (m) res(m[1]); }); });
const agent = spawn('node', [`${armDir}/scripts/cli-entry.js`, '--acp', '--approval-mode', 'yolo'], {
  cwd: ws, stdio: ['pipe', 'pipe', 'pipe'],
  env: { PATH: process.env.PATH, HOME: home, QWEN_HOME: `${home}/.qwen`, WS: ws, QWEN_SANDBOX: 'false', QWEN_CODE_NO_RELAUNCH: '1',
    OPENAI_API_KEY: 'dummy', OPENAI_BASE_URL: url, OPENAI_MODEL: 'fake-model' },
});
let stderr = ''; agent.stderr.on('data', (d) => (stderr += d));
const pending = new Map(); let nextId = 1; const updates = [];
const send = (j) => agent.stdin.write(JSON.stringify(j) + '\n');
createInterface({ input: agent.stdout }).on('line', (line) => {
  let msg; try { msg = JSON.parse(line); } catch { return; }
  if (msg.id !== undefined && (msg.result !== undefined || msg.error !== undefined) && pending.has(msg.id)) {
    const p = pending.get(msg.id); pending.delete(msg.id); msg.error ? p.reject(new Error(JSON.stringify(msg.error))) : p.resolve(msg.result); return;
  }
  if (msg.method === 'session/update') { updates.push(msg.params?.update); return; }
  if (msg.method === 'session/request_permission') {
    const opt = (msg.params.options || []).find((o) => o.kind?.startsWith('allow')) || msg.params.options?.[0];
    send({ jsonrpc: '2.0', id: msg.id, result: { outcome: { outcome: 'selected', optionId: opt.optionId } } }); return;
  }
  if (msg.id !== undefined && msg.method) send({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'not supported' } });
});
const req = (method, params, ms = 180000) => new Promise((resolve, reject) => {
  const id = nextId++; pending.set(id, { resolve, reject }); send({ jsonrpc: '2.0', id, method, params });
  setTimeout(() => pending.has(id) && reject(new Error(`${method} timed out`)), ms);
});
const result = { arm: armDir.split('/').pop(), scen };
try {
  await req('initialize', { protocolVersion: 1, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } } });
  await req('authenticate', { methodId: 'openai' });
  const s = await req('session/new', { cwd: ws, mcpServers: [] });
  const r = await req('session/prompt', { sessionId: s.sessionId, prompt: [{ type: 'text', text: 'Figure out the git remote and recent history of this project.' }] });
  result.stopReason = r?.stopReason;
} catch (e) { result.error = String(e.message).slice(0, 300); }
const reqs = readFileSync(`${out}/requests.jsonl`, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
result.modelRequests = reqs.filter((r) => r.kind === 'main').length;
result.toolCalls = updates.filter((u) => u?.sessionUpdate === 'tool_call').length;
const last = updates.filter((u) => u?.sessionUpdate === 'agent_message_chunk').map((u) => u.content?.text ?? '').join('');
result.lastAgentText = last.slice(-120);
writeFileSync(`${out}/result.json`, JSON.stringify(result, null, 2));
writeFileSync(`${out}/stderr.txt`, stderr);
console.log(JSON.stringify(result));
agent.kill(); fake.kill(); process.exit(0);
