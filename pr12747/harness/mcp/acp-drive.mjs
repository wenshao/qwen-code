// S5: one real `qwen --acp` process, a real stdio MCP server with `$id` in a tool schema,
// a scripted model; several ACP sessions in the same process call the tool with bad arguments.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
const [, , arm, repo, outFile] = process.argv;
const root = fs.realpathSync(fs.mkdtempSync(`/tmp/p12747-s5-${arm}-`));
const home = path.join(root, 'home'); const qhome = path.join(home, '.qwen'); const ws = path.join(root, 'ws');
fs.mkdirSync(qhome, { recursive: true }); fs.mkdirSync(ws);
const mcpLog = path.join(root, 'mcp.log'); const fakeLog = path.join(root, 'fake.log'); const portFile = path.join(root, 'port');
fs.writeFileSync(mcpLog, ''); fs.writeFileSync(fakeLog, '');
const here = path.dirname(new URL(import.meta.url).pathname);
const fake = spawn(process.execPath, [path.join(here, 'fake-openai.mjs')], { env: { ...process.env, FAKE_LOG: fakeLog, FAKE_PORT_FILE: portFile }, stdio: 'inherit' });
while (!fs.existsSync(portFile) || !fs.readFileSync(portFile, 'utf8')) await new Promise((r) => setTimeout(r, 50));
const port = fs.readFileSync(portFile, 'utf8');
fs.writeFileSync(path.join(qhome, 'settings.json'), JSON.stringify({
  ui: { enableFollowupSuggestions: false },
  security: { auth: { selectedType: 'openai' }, folderTrust: { enabled: false } },
  model: { name: 'fake-model' },
  mcpServers: { probe: { command: process.execPath, args: [path.join(here, 'mcp-id-server.mjs')], env: { MCP_LOG: mcpLog, MCP_SDK: path.join(repo, 'node_modules/@modelcontextprotocol/sdk/dist/esm') }, trust: true, alwaysLoadTools: true } },
}, null, 1));
const env = { PATH: process.env.PATH, HOME: home, QWEN_HOME: qhome, QWEN_RUNTIME_DIR: path.join(root, 'runtime'), OPENAI_API_KEY: 'fake-key', OPENAI_BASE_URL: `http://127.0.0.1:${port}/v1`, OPENAI_MODEL: 'fake-model', NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost', TERM: 'dumb', SV_LOG: process.env.SV_LOG ?? '', ...(process.env.DBG ? { QWEN_DEBUG_LOG_FILE: '1' } : {}) };
const agent = spawn(process.execPath, [process.env.ENTRY ?? path.join(repo, 'dist/cli.js'), '--acp', '--no-chat-recording'], { cwd: ws, env, stdio: ['pipe', 'pipe', 'pipe'] });
let stderr = ''; agent.stderr.on('data', (c) => (stderr += c));
const pending = new Map(); let nextId = 1; const updates = [];
const send = (msg) => agent.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...msg }) + '\n');
const request = (method, params) => new Promise((resolve, reject) => { const id = nextId++; pending.set(id, { resolve, reject }); send({ id, method, params }); });
readline.createInterface({ input: agent.stdout }).on('line', (line) => {
  let m; try { m = JSON.parse(line); } catch { return; }
  if (m.id !== undefined && pending.has(m.id) && !m.method) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result); return; }
  if (m.method === 'session/request_permission') {
    const opt = m.params.options.find((o) => o.kind === 'allow_once') ?? m.params.options[0];
    updates.push({ sessionId: m.params.sessionId, kind: 'permission', title: m.params.toolCall?.title });
    send({ id: m.id, result: { outcome: { outcome: 'selected', optionId: opt.optionId } } }); return;
  }
  if (m.method && m.id !== undefined) { send({ id: m.id, error: { code: -32601, message: 'not supported' } }); return; }
  if (m.method === 'session/update') updates.push({ sessionId: m.params.sessionId, ...m.params.update });
});
const out = []; const log = (s) => { out.push(s); console.log(s); };
const mcpCalls = () => fs.readFileSync(mcpLog, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
try {
  await request('initialize', { protocolVersion: 1, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } } });
  const sessions = {};
  const newSession = async (name) => { sessions[name] = (await request('session/new', { cwd: ws, mcpServers: [] })).sessionId; };
  const prompt = async (name, tool, args) => {
    const before = mcpCalls().filter((e) => e.event === 'callTool').length;
    const sid = sessions[name]; const mark = updates.length;
    await request('session/prompt', { sessionId: sid, prompt: [{ type: 'text', text: `CALL ${tool} ARGS ${args}` }] });
    const mine = updates.slice(mark).filter((u) => u.sessionId === sid);
    const final = mine.filter((u) => u.sessionUpdate === 'tool_call_update' || u.sessionUpdate === 'tool_call').at(-1);
    const content = (final?.content ?? []).map((c) => c.content?.text ?? c.text ?? '').join(' ').replace(/\s+/g, ' ');
    const reached = mcpCalls().filter((e) => e.event === 'callTool').slice(before);
    log(`  ${name} ${tool.padEnd(12)} ${args.padEnd(12)} -> tool ${String(final?.status).padEnd(9)} | MCP server received: ${reached.length ? JSON.stringify(reached.map((r) => r.args)) : 'nothing'} | ${content.slice(0, 110)}`);
  };
  const waitFor = async (pred, ms, what) => { const t0 = Date.now(); while (!pred()) { if (Date.now() - t0 > ms) throw new Error('timeout waiting for ' + what); await new Promise((r) => setTimeout(r, 250)); } return (Date.now() - t0) / 1000; };
  const ev = (e) => mcpCalls().filter((x) => x.event === e);
  log(`## ${arm}: one qwen --acp process (${path.basename(repo)}); MCP tool 'lookup' has $id, 'lookup_plain' has none`);
  log('# 1) settings-level MCP server, three ACP sessions');
  await newSession('A'); await waitFor(() => ev('listTools').length >= 1, 60000, 'discovery'); await new Promise((r) => setTimeout(r, 1500));
  await prompt('A', 'lookup', '{"cnt":3}');
  await newSession('B'); await prompt('B', 'lookup', '{"cnt":3}');
  await prompt('B', 'lookup_plain', '{"cnt":3}');
  await prompt('B', 'lookup', '{"count":3}');
  await newSession('C'); await prompt('C', 'lookup', '{"count":0}');
  log(`  MCP server processes: ${ev('start').length}, listTools calls: ${ev('listTools').length} for 3 sessions (discovery is shared)`);
  log('# 2) the MCP server is restarted through the daemon control method (Web Shell / POST /workspace/mcp/probe/restart)');
  const pid0 = ev('start').at(-1).pid;
  const rr = await request('qwen/control/workspace/mcp/restart', { serverName: 'probe' });
  await waitFor(() => ev('listTools').length >= 2, 60000, 'rediscovery'); await new Promise((r) => setTimeout(r, 1000));
  log(`  restart reply: ${JSON.stringify(rr).slice(0, 120)}; MCP pid ${pid0} -> ${ev('start').at(-1).pid}, listTools calls now ${ev('listTools').length}`);
  await prompt('A', 'lookup', '{"cnt":3}');
  await prompt('A', 'lookup', '{"count":0}');
  await prompt('A', 'lookup_plain', '{"count":0}');
  await prompt('B', 'lookup', '{"count":3}');
} catch (e) {
  log(`ERROR ${e.message}\n${stderr.slice(-2000)}`);
} finally {
  agent.kill('SIGTERM'); fake.kill('SIGTERM');
  fs.writeFileSync(outFile, out.join('\n') + '\n');
  fs.copyFileSync(mcpLog, outFile.replace(/\.log$/, '.mcp.jsonl')); fs.copyFileSync(fakeLog, outFile.replace(/\.log$/, '.model.jsonl'));
  console.log('ROOT=' + root); setTimeout(() => process.exit(0), 500);
}
