// Runs a real bundled CLI once against a real OpenAI-compatible endpoint,
// logging the actual request bodies via --openai-logging.
// usage: node run-real.mjs <cli> <dir> <keyEnvName> <baseUrl> <model> <prompt> [K=V ...]
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, writeFileSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
const [cli, dir, keyName, baseUrl, model, prompt, ...kvs] = process.argv.slice(2);
const s = JSON.parse(readFileSync(process.env.HOME + '/.qwen/settings.json', 'utf8'));
const key = s.env[keyName];
const home = join(dir, 'home'), proj = join(dir, 'proj'), logs = join(dir, 'openai-logs');
mkdirSync(home, { recursive: true }); mkdirSync(proj, { recursive: true });
writeFileSync(join(home, 'settings.json'), JSON.stringify({
  general: { enableAutoUpdate: false, disableAutoUpdate: true },
  security: { folderTrust: { enabled: false }, auth: { selectedType: 'openai' } },
  privacy: { usageStatisticsEnabled: false },
  memory: { enableManagedAutoMemory: false },
}, null, 2));
try { copyFileSync(new URL('../../qwen-11959/pr11959-rig/red.png', import.meta.url), join(proj, 'red.png')); } catch {}
const env = {};
for (const [k, v] of Object.entries(process.env)) {
  if (/_PROXY$/i.test(k) || /^(QWEN_|OPENAI_|DASHSCOPE|ANTHROPIC)/.test(k)) continue;
  env[k] = v;
}
Object.assign(env, { QWEN_HOME: home, QWEN_RUNTIME_DIR: join(home, 'runtime'), OPENAI_API_KEY: key, QWEN_CODE_MODELS_DEV_REFRESH: 'off' });
for (const kv of kvs) { const i = kv.indexOf('='); env[kv.slice(0, i)] = kv.slice(i + 1); }
const child = spawn(process.execPath, [cli, '-p', prompt, '--approval-mode', 'yolo', '--auth-type', 'openai',
  '--openai-base-url', baseUrl, '--model', model, '--openai-logging', '--openai-logging-dir', logs], { cwd: proj, env });
let out = '', err = '';
child.stdout.on('data', (d) => (out += d)); child.stderr.on('data', (d) => (err += d));
const code = await new Promise((r) => child.on('close', r));
let reqs = [];
try {
  for (const f of readdirSync(logs).sort()) {
    const j = JSON.parse(readFileSync(join(logs, f), 'utf8'));
    const req = j.request ?? j.req ?? j;
    const msgs = req.messages ?? [];
    const lastUser = [...msgs].reverse().find((m) => m.role === 'user');
    const c = lastUser?.content;
    reqs.push({ file: f, max_tokens: req.max_tokens, lastUserContent: Array.isArray(c) ? c.map((p) => p.type === 'text' ? 'text:' + p.text.slice(0, 120) : p.type) : String(c).slice(0, 200), error: j.error ? JSON.stringify(j.error).slice(0, 300) : undefined });
  }
} catch (e) { reqs = ['no logs: ' + e.message]; }
const red = (x) => x.replaceAll(key, '<redacted>');
const summary = { model, code, stdout: red(out).slice(-1500), stderr: red(err).slice(-1500), requests: reqs };
writeFileSync(join(dir, 'summary.json'), red(JSON.stringify(summary, null, 2)));
console.log(red(JSON.stringify(summary, null, 2)));
