/**
 * Headless (`qwen -p`) teammate-approval A/B runner for PR #9070.
 * Usage: node run-headless.mjs <arm> <cliPath> [approvalMode]
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const arm = process.argv[2];
const cli = process.argv[3];
const approvalMode = process.argv[4] || 'default';
const outDir = process.argv[5] || join(process.cwd(), 'out', arm);
mkdirSync(outDir, { recursive: true });

const fakeLog = join(outDir, 'wire.jsonl');
const rigDir = new URL('.', import.meta.url).pathname;

function startFake() {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [join(rigDir, 'fake-openai.mjs')], {
      env: {
        ...process.env,
        FAKE_LOG: fakeLog,
        FAKE_PORT: '0',
        TEAMMATE_MARKER: 'ZZPROBEMARKERZZ',
        PROBE_TOOL: process.env.PROBE_TOOL || 'run_shell_command',
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

const home = mkdtempSync(join(tmpdir(), `pr9070-${arm}-`));
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
          {
            matcher: process.env.PROBE_TOOL || 'run_shell_command',
            hooks: [{ type: 'command', command: hookScript, name: 'force-ask', timeout: 10000 }],
          },
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
  OPENAI_API_KEY: 'fake-key',
  OPENAI_BASE_URL: baseUrl,
  OPENAI_MODEL: 'fake-model',
  QWEN_MODEL: 'fake-model',
  NO_PROXY: '127.0.0.1,localhost',
  no_proxy: '127.0.0.1,localhost',
};
delete env.https_proxy;
delete env.http_proxy;
delete env.HTTPS_PROXY;
delete env.HTTP_PROXY;

const args = [
  cli,
  '-p',
  'Create a team named verify9070 and spawn one teammate to run the probe.',
  '--auth-type',
  'openai',
  '--model',
  'fake-model',
  '--openai-base-url',
  baseUrl,
  '--openai-api-key',
  'fake-key',
  '--approval-mode',
  approvalMode,
];

const child = spawn(process.execPath, args, { cwd: workDir, env, stdio: ['ignore', 'pipe', 'pipe'] });
let stdout = '';
let stderr = '';
child.stdout.on('data', (c) => (stdout += c));
child.stderr.on('data', (c) => (stderr += c));

const timeout = setTimeout(() => child.kill('SIGKILL'), Number(process.env.RUN_TIMEOUT_MS || 180000));
const code = await new Promise((r) => child.on('exit', (c) => r(c)));
clearTimeout(timeout);
fake.kill('SIGKILL');

writeFileSync(join(outDir, 'stdout.txt'), stdout);
writeFileSync(join(outDir, 'stderr.txt'), stderr);
writeFileSync(join(outDir, 'meta.json'), JSON.stringify({ arm, cli, approvalMode, code, home, port }, null, 2));

// Extract the tool result the *teammate* received for call_probe.
const lines = existsSync(fakeLog) ? readFileSync(fakeLog, 'utf8').split('\n').filter(Boolean) : [];
const toolResults = [];
for (const l of lines) {
  const rec = JSON.parse(l);
  for (const m of rec.body.messages || []) {
    if (m.role === 'tool') {
      toolResults.push({ n: rec.n, teammate: rec.teammate, tool_call_id: m.tool_call_id, content: m.content });
    }
  }
}
const probe = toolResults.filter((t) => String(t.tool_call_id).includes('call_probe'));
writeFileSync(join(outDir, 'tool-results.json'), JSON.stringify(toolResults, null, 2));
console.log(`ARM=${arm} exit=${code} requests=${lines.length} probeResults=${probe.length}`);
for (const p of probe.slice(0, 2)) console.log(`  [teammate=${p.teammate}] ${JSON.stringify(p.content).slice(0, 400)}`);
if (!probe.length) {
  console.log('  stderr tail:', stderr.split('\n').slice(-8).join(' | '));
}
