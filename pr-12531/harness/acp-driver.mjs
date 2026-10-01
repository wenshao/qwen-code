// Drive the real ACP agent (`qwen --acp`) for PR #12531 scenarios: real MCP stdio servers + scripted model.
// usage: ARMS_SEL=base,head node acp-driver.mjs <outDir> <scenarioId...>
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { ARMS, SCENARIOS, reg, setupRun, startFake, cleanEnv } from './scenarios.mjs';

const [outDir, ...ids] = process.argv.slice(2);
const sel = (process.env.ARMS_SEL ?? 'base,head').split(',');
const results = [];

async function runAcp(arm, sc) {
  const run = path.join(outDir, sc.id, arm);
  const { home, ws, hits, modelLog } = setupRun(sc, run);
  const target = reg(...sc.target);
  const fake = await startFake(modelLog, target);
  const env = { ...cleanEnv, HOME: home, USERPROFILE: home, QWEN_SANDBOX: 'false', QWEN_CODE_NO_RELAUNCH: '1',
    NO_PROXY: '127.0.0.1,localhost', OPENAI_API_KEY: 'dummy', OPENAI_BASE_URL: fake.url, OPENAI_MODEL: 'dummy' };
  const p = spawn(process.execPath, [`${ARMS[arm]}/scripts/cli-entry.js`, '--acp', '--approval-mode', sc.mode], { cwd: ws, env, stdio: ['pipe', 'pipe', 'pipe'] });
  const stderr = [];
  p.stderr.on('data', (d) => stderr.push(String(d)));
  const transcript = [];
  let nextId = 1;
  const pending = new Map();
  const permissionRequests = [];
  const toolUpdates = [];
  const send = (o) => { transcript.push({ dir: 'out', ...o }); p.stdin.write(JSON.stringify(o) + '\n'); };
  const call = (method, params) => new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    send({ jsonrpc: '2.0', id, method, params });
  });
  readline.createInterface({ input: p.stdout }).on('line', (line) => {
    let m; try { m = JSON.parse(line); } catch { return; }
    transcript.push({ dir: 'in', ...m });
    if (m.id !== undefined && (m.result !== undefined || m.error !== undefined) && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id); pending.delete(m.id);
      m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
    } else if (m.method === 'session/request_permission') {
      permissionRequests.push(m.params?.toolCall?.title ?? m.params?.toolCall?.toolCallId);
      send({ jsonrpc: '2.0', id: m.id, result: { outcome: { outcome: 'cancelled' } } });
    } else if (m.method === 'session/update') {
      const u = m.params?.update;
      if (u?.sessionUpdate === 'tool_call' || u?.sessionUpdate === 'tool_call_update') {
        toolUpdates.push({ kind: u.sessionUpdate, status: u.status, title: u.title,
          text: (u.content ?? []).map((c) => c.content?.text ?? '').join('').slice(0, 200) });
      }
    } else if (m.id !== undefined && m.method) {
      send({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'not supported by verify driver' } });
    }
  });
  let verdict = 'OTHER', err = null;
  try {
    await call('initialize', { protocolVersion: 1, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } } });
    await call('authenticate', { methodId: 'openai' });
    const s = await call('session/new', { cwd: ws, mcpServers: [] });
    await new Promise((r) => setTimeout(r, 1500));
    await Promise.race([
      call('session/prompt', { sessionId: s.sessionId, prompt: [{ type: 'text', text: 'VERIFY-PR12531: call the tool' }] }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('prompt timeout')), 90000)),
    ]);
  } catch (e) { err = String(e).slice(0, 300); }
  p.kill();
  fake.proc.kill();
  const hitLines = fs.readFileSync(hits, 'utf8').trim().split('\n').filter(Boolean);
  const modelLines = fs.existsSync(modelLog) ? fs.readFileSync(modelLog, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
  const toolResult = modelLines.flatMap((m) => m.toolResults).at(-1) ?? '';
  const executed = hitLines.length > 0;
  verdict = executed ? 'EXECUTED' : permissionRequests.length ? 'ASK (request_permission)' : /deny rule|denied/i.test(toolResult) ? 'DENY-RULE' : 'OTHER';
  const row = { id: sc.id, arm, path: 'ACP', verdict, executed, permissionRequests: permissionRequests.length, toolResult: toolResult.slice(0, 240), err };
  fs.writeFileSync(path.join(run, 'acp-transcript.jsonl'), transcript.map((t) => JSON.stringify(t)).join('\n'));
  fs.writeFileSync(path.join(run, 'acp-stderr.txt'), stderr.join(''));
  fs.writeFileSync(path.join(run, 'row.json'), JSON.stringify(row, null, 2));
  console.log(`ACP ${sc.id.padEnd(4)} ${arm.padEnd(4)} ${verdict.padEnd(24)} permReq=${permissionRequests.length} ${err ?? ''} | ${toolResult.slice(0, 120)}`);
  return row;
}

for (const id of ids) {
  const sc = SCENARIOS.find((s) => s.id === id);
  for (const arm of sel) results.push(await runAcp(arm, sc));
}
fs.writeFileSync(path.join(outDir, 'acp-results.json'), JSON.stringify(results, null, 2));
process.exit(0);
