/**
 * stream-json *direct* mode (no SDK control system) teammate-approval A/B for PR #9070.
 * Usage: node run-direct.mjs <arm> <cliPath> <approvalMode> <outDir>
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const arm = process.argv[2];
const cli = process.argv[3];
const approvalMode = process.argv[4] || 'yolo';
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
        PROBE_TOOL,
        PROBE_ARGS: process.env.PROBE_ARGS || JSON.stringify({ command: 'echo pr9070-probe', description: 'probe' }),
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

const home = mkdtempSync(join(tmpdir(), `pr9070d-${arm}-`));
const qwenHome = join(home, '.qwen');
mkdirSync(qwenHome, { recursive: true });
const hookScript = join(qwenHome, 'ask-hook.sh');
writeFileSync(
  hookScript,
  `#!/bin/bash
cat > /dev/null
cat <<'JSON'
{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"ask","permissionDecisionReason":"probe hook forces an approval round"}}
JSON
`,
);
chmodSync(hookScript, 0o755);
writeFileSync(
  join(qwenHome, 'settings.json'),
  JSON.stringify(
    {
      selectedAuthType: 'openai',
      security: { auth: { selectedType: 'openai' } },
      privacy: { usageStatisticsEnabled: false },
      hooks: {
        PreToolUse: [
          { matcher: PROBE_TOOL, hooks: [{ type: 'command', command: hookScript, name: 'force-ask', timeout: 10000 }] },
        ],
      },
    },
    null,
    2,
  ),
);
const workDir = join(home, 'work');
mkdirSync(workDir, { recursive: true });
writeFileSync(join(workDir, 'README.md'), 'probe workspace\n');

const env = {
  ...process.env,
  HOME: home,
  QWEN_HOME: qwenHome,
  QWEN_RUNTIME_DIR: qwenHome,
  QWEN_CODE_ENABLE_AGENT_TEAM: '1',
  QWEN_CODE_SUPPRESS_YOLO_WARNING: '1',
  OPENAI_API_KEY: 'fake-key',
  OPENAI_BASE_URL: baseUrl,
  OPENAI_MODEL: 'fake-model',
  QWEN_MODEL: 'fake-model',
  NO_PROXY: '127.0.0.1,localhost',
  no_proxy: '127.0.0.1,localhost',
};
for (const k of ['https_proxy', 'http_proxy', 'HTTPS_PROXY', 'HTTP_PROXY']) delete env[k];

const args = [
  cli,
  '--input-format', 'stream-json',
  '--output-format', 'stream-json',
  '--auth-type', 'openai',
  '--model', 'fake-model',
  '--openai-base-url', baseUrl,
  '--openai-api-key', 'fake-key',
  '--approval-mode', approvalMode,
];

const child = spawn(process.execPath, args, { cwd: workDir, env, stdio: ['pipe', 'pipe', 'pipe'] });
let stdout = '';
let stderr = '';
child.stdout.on('data', (c) => (stdout += c));
child.stderr.on('data', (c) => (stderr += c));

child.stdin.write(
  JSON.stringify({
    type: 'user',
    message: { role: 'user', content: [{ type: 'text', text: 'Create a team named verify9070 and spawn one teammate to run the probe.' }] },
  }) + '\n',
);

const deadline = Number(process.env.RUN_TIMEOUT_MS || 120000);
const timer = setTimeout(() => { try { child.stdin.end(); } catch {} setTimeout(() => child.kill('SIGKILL'), 5000); }, deadline);
const code = await new Promise((r) => child.on('exit', (c) => r(c)));
clearTimeout(timer);
fake.kill('SIGKILL');

writeFileSync(join(outDir, 'stdout.txt'), stdout);
writeFileSync(join(outDir, 'stderr.txt'), stderr);
writeFileSync(join(outDir, 'meta.json'), JSON.stringify({ arm, cli, approvalMode, code, home, port }, null, 2));

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
console.log(`ARM=${arm} exit=${code} requests=${lines.length} probeResults=${probe.length}`);
for (const p of probe.slice(0, 1)) console.log(`  TEAMMATE SEES: ${JSON.stringify(p.content)}`);
const teamLines = stderr.split('\n').filter((l) => l.includes('[team]'));
for (const l of teamLines.slice(0, 2)) console.log(`  STDERR: ${l}`);
if (!probe.length) console.log('  stderr tail:', stderr.split('\n').slice(-6).join(' | '));
