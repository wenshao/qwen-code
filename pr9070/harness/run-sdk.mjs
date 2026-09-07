/**
 * stream-json SDK mode (control system on) teammate-approval A/B for PR #9070.
 * Speaks the control protocol directly so the host's failure mode is exact.
 * Usage: node run-sdk.mjs <arm> <cliPath> <scenario: timeout|error> <outDir>
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

const arm = process.argv[2];
const cli = process.argv[3];
const scenario = process.argv[4] || 'timeout';
const outDir = process.argv[5];
mkdirSync(outDir, { recursive: true });

const fakeLog = join(outDir, 'wire.jsonl');
const rigDir = new URL('.', import.meta.url).pathname;
const PROBE_TOOL = process.env.PROBE_TOOL || 'run_shell_command';

function startFake() {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [join(rigDir, 'fake-openai.mjs')], {
      env: {
        ...process.env,
        FAKE_LOG: fakeLog,
        FAKE_PORT: '0',
        TEAMMATE_MARKER: 'ZZPROBEMARKERZZ',
        SCRIPT_MODE: process.env.SCRIPT_MODE || 'team',
        PROBE_TOOL,
        PROBE_ARGS: JSON.stringify({ command: 'echo pr9070-probe', description: 'probe' }),
      },
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    let buf = '';
    p.stdout.on('data', (c) => {
      buf += c;
      const m = buf.match(/FAKE_READY (\d+)/);
      if (m) resolve({ proc: p, port: Number(m[1]) });
    });
    p.on('error', reject);
    setTimeout(() => reject(new Error('fake server did not start')), 10000);
  });
}

const { proc: fake, port } = await startFake();
const baseUrl = `http://127.0.0.1:${port}/v1`;

const home = mkdtempSync(join(tmpdir(), `pr9070s-${arm}-`));
const qwenHome = join(home, '.qwen');
mkdirSync(qwenHome, { recursive: true });
const hookScript = join(qwenHome, 'ask-hook.sh');
writeFileSync(hookScript, `#!/bin/bash
cat > /dev/null
cat <<'JSON'
{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"ask","permissionDecisionReason":"probe hook forces an approval round"}}
JSON
`);
chmodSync(hookScript, 0o755);
writeFileSync(
  join(qwenHome, 'settings.json'),
  JSON.stringify({
    selectedAuthType: 'openai',
    security: { auth: { selectedType: 'openai' } },
    privacy: { usageStatisticsEnabled: false },
    hooks: { PreToolUse: [{ matcher: PROBE_TOOL, hooks: [{ type: 'command', command: hookScript, name: 'force-ask', timeout: 10000 }] }] },
  }, null, 2),
);
const workDir = join(home, 'work');
mkdirSync(workDir, { recursive: true });
writeFileSync(join(workDir, 'README.md'), 'probe workspace\n');

const env = {
  ...process.env,
  HOME: home, QWEN_HOME: qwenHome, QWEN_RUNTIME_DIR: qwenHome,
  QWEN_CODE_ENABLE_AGENT_TEAM: '1', QWEN_CODE_SUPPRESS_YOLO_WARNING: '1',
  OPENAI_API_KEY: 'fake-key', OPENAI_BASE_URL: baseUrl, OPENAI_MODEL: 'fake-model', QWEN_MODEL: 'fake-model',
  NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost',
};
for (const k of ['https_proxy', 'http_proxy', 'HTTPS_PROXY', 'HTTP_PROXY']) delete env[k];

const child = spawn(process.execPath, [
  cli,
  '--input-format', 'stream-json', '--output-format', 'stream-json',
  '--auth-type', 'openai', '--model', 'fake-model',
  '--openai-base-url', baseUrl, '--openai-api-key', 'fake-key',
  '--approval-mode', 'yolo',
], { cwd: workDir, env, stdio: ['pipe', 'pipe', 'pipe'] });

let stderr = '';
const outFrames = [];
child.stderr.on('data', (c) => (stderr += c));

const send = (o) => child.stdin.write(JSON.stringify(o) + '\n');
const controlLog = [];

const rl = createInterface({ input: child.stdout });
rl.on('line', (line) => {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  outFrames.push(msg);
  if (msg.type === 'control_response' && msg.response?.request_id === 'init-1') {
    send({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'Create a team named verify9070 and spawn one teammate to run the probe.' }] } });
    return;
  }
  if (msg.type === 'control_request' && msg.request?.subtype === 'can_use_tool') {
    const toolName = msg.request.tool_name;
    if (scenario === 'auq-deny') {
      controlLog.push({ at: Date.now(), request_id: msg.request_id, tool_name: toolName, tool_use_id: msg.request.tool_use_id });
      send({ type: 'control_response', response: { subtype: 'success', request_id: msg.request_id, response: { behavior: 'deny', message: 'Host policy: questions are disabled in this run' } } });
      return;
    }
    if (scenario === 'auq-drop') {
      controlLog.push({ at: Date.now(), request_id: msg.request_id, tool_name: toolName, tool_use_id: msg.request.tool_use_id });
      // never answer -> CLI-side can_use_tool timeout (60s) -> catch branch
      return;
    }
    if (scenario === 'auq') {
      controlLog.push({ at: Date.now(), request_id: msg.request_id, tool_name: toolName, tool_use_id: msg.request.tool_use_id });
      const updatedInput = { ...(msg.request.input || {}), answers: { '0': 'Alpha' } };
      send({ type: 'control_response', response: { subtype: 'success', request_id: msg.request_id, response: { behavior: 'allow', updatedInput } } });
      return;
    }
    const isProbe = String(msg.request.tool_use_id || '').startsWith('teammate-');
    controlLog.push({ at: Date.now(), request_id: msg.request_id, tool_name: toolName, tool_use_id: msg.request.tool_use_id });
    if (isProbe) {
      if (scenario === 'error') {
        send({ type: 'control_response', response: { subtype: 'error', request_id: msg.request_id, error: 'host approval surface unavailable' } });
      }
      // scenario 'timeout': deliberately never respond -> CLI-side 30s timeout
      return;
    }
    send({ type: 'control_response', response: { subtype: 'success', request_id: msg.request_id, response: { behavior: 'allow', updatedInput: msg.request.input } } });
  }
});

send({ type: 'control_request', request_id: 'init-1', request: { subtype: 'initialize', hooks: null } });

const deadline = Number(process.env.RUN_TIMEOUT_MS || 150000);
const timer = setTimeout(() => { try { child.stdin.end(); } catch {} setTimeout(() => child.kill('SIGKILL'), 5000); }, deadline);
const code = await new Promise((r) => child.on('exit', (c) => r(c)));
clearTimeout(timer);
fake.kill('SIGKILL');

writeFileSync(join(outDir, 'stderr.txt'), stderr);
writeFileSync(join(outDir, 'frames.json'), JSON.stringify(outFrames, null, 2));
writeFileSync(join(outDir, 'control-log.json'), JSON.stringify(controlLog, null, 2));
writeFileSync(join(outDir, 'meta.json'), JSON.stringify({ arm, cli, scenario, code, home, port }, null, 2));

const lines = existsSync(fakeLog) ? readFileSync(fakeLog, 'utf8').split('\n').filter(Boolean) : [];
const toolResults = [];
for (const l of lines) {
  const rec = JSON.parse(l);
  for (const m of rec.body.messages || []) {
    if (m.role === 'tool') {
      const c = Array.isArray(m.content) ? m.content.map((b) => b?.text ?? '').join('') : m.content;
      toolResults.push({ n: rec.n, teammate: rec.teammate, tool_call_id: m.tool_call_id, content: c });
    }
  }
}
writeFileSync(join(outDir, 'tool-results.json'), JSON.stringify(toolResults, null, 2));
const probe = toolResults.filter((t) => String(t.tool_call_id).includes('call_probe'));
console.log(`ARM=${arm} scenario=${scenario} exit=${code} requests=${lines.length} teammateApprovalCtl=${controlLog.filter(c=>String(c.tool_use_id).startsWith('teammate-')).length} probeResults=${probe.length}`);
for (const p of probe.slice(0, 1)) console.log(`  TEAMMATE SEES: ${JSON.stringify(p.content)}`);
if (!probe.length) console.log('  stderr tail:', stderr.split('\n').slice(-6).join(' | '));
