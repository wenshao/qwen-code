// Drives a real bundled CLI (dist/cli.js) once against the repo's fake
// OpenAI server and prints a JSON summary of what went over the wire.
//
// usage: tsx run-cli.ts --cli <dist/cli.js> --home <QWEN_HOME> --cwd <dir>
//          --model <id> --prompt <text> [--env K=V ...] [--settings <json>]
//          [--out <file>]
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { startFakeOpenAIServer } from '../integration-tests/fake-openai-server.js';

const args = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const multi = (name: string) =>
  args.flatMap((a, i) => (a === `--${name}` ? [args[i + 1]!] : []));

const cli = opt('cli')!;
const home = opt('home')!;
const cwd = opt('cwd')!;
const model = opt('model')!;
const prompt = opt('prompt') ?? 'say hi';
const out = opt('out');
const extraSettings = opt('settings');

mkdirSync(home, { recursive: true });
mkdirSync(cwd, { recursive: true });
if (!existsSync(join(home, 'settings.json')) || extraSettings) {
  const base = {
    general: { enableAutoUpdate: false, disableAutoUpdate: true },
    security: { folderTrust: { enabled: false }, auth: { selectedType: 'openai' } },
    privacy: { usageStatisticsEnabled: false },
    ...(extraSettings ? JSON.parse(extraSettings) : {}),
  };
  writeFileSync(join(home, 'settings.json'), JSON.stringify(base, null, 2));
}

const delayMs = Number(opt('delay-ms') ?? 0);
const server = await startFakeOpenAIServer(async () => {
  if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
  return {
  content: 'ok',
  usage: { prompt_tokens: 100, completion_tokens: 1, total_tokens: 101 },
  };
});

const env: Record<string, string> = {};
for (const [k, v] of Object.entries(process.env)) {
  if (v === undefined) continue;
  if (/_PROXY$/i.test(k)) continue;
  if (/^(QWEN_|OPENAI_|DASHSCOPE|ANTHROPIC)/.test(k)) continue;
  env[k] = v;
}
env['QWEN_HOME'] = home;
env['QWEN_RUNTIME_DIR'] = join(home, 'runtime');
env['NO_PROXY'] = '127.0.0.1,localhost';
for (const kv of multi('env')) {
  const eq = kv.indexOf('=');
  env[kv.slice(0, eq)] = kv.slice(eq + 1);
}

const cliArgs = [
  cli,
  '-p',
  prompt,
  '--approval-mode',
  'yolo',
  '--auth-type',
  'openai',
  '--openai-api-key',
  'dummy',
  '--openai-base-url',
  server.baseUrl,
  '--model',
  model,
  ...multi('arg'),
];

const child = spawn(process.execPath, cliArgs, { cwd, env });
let stdout = '';
let stderr = '';
child.stdout.on('data', (d) => (stdout += d));
child.stderr.on('data', (d) => (stderr += d));
const code: number = await new Promise((r) => child.on('close', (c) => r(c ?? -1)));

const main = server.requests.map((r) => {
  const b = r.body as Record<string, unknown>;
  const msgs = (b['messages'] as Array<Record<string, unknown>>) ?? [];
  const lastUser = [...msgs].reverse().find((m) => m['role'] === 'user');
  const c = lastUser?.['content'];
  return {
    model: b['model'],
    max_tokens: b['max_tokens'],
    lastUserContentType: Array.isArray(c) ? 'array' : typeof c,
    lastUserParts: Array.isArray(c)
      ? (c as Array<Record<string, unknown>>).map((p) =>
          p['type'] === 'text'
            ? `text:${String(p['text']).slice(0, 80)}`
            : String(p['type']),
        )
      : [String(c).slice(0, 160)],
  };
});
const summary = { model, code, requests: main, stdout: stdout.slice(-4000), stderr: stderr.slice(-1500) };
if (out) writeFileSync(out, JSON.stringify({ ...summary, raw: server.requests.map((r) => r.body) }, null, 2));
console.log(JSON.stringify(summary, null, 2));
await server.close();
process.exit(0);
