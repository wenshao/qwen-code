// usage: npx tsx tui-run.mts <arm> <rundir>
// Real interactive TUI (bundled CLI under node-pty, rendered by xterm.js).
import { TerminalCapture } from './terminal-capture.mts';
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const [arm, run] = process.argv.slice(2);
const cli = `/root/verify/pr13324/${arm}/dist/cli.js`;
rmSync(run, { recursive: true, force: true });
mkdirSync(join(run, 'home/.qwen'), { recursive: true });
mkdirSync(join(run, 'ws'), { recursive: true });
writeFileSync(join(run, 'ws/fact.txt'), 'ORIGINAL_FILE_FACT\n');
writeFileSync(
  join(run, 'home/.qwen/settings.json'),
  JSON.stringify({ tools: { codeModeOnly: true }, security: { folderTrust: { enabled: false } }, ui: { hideTips: true } }),
);
const env: Record<string, string> = {};
for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'ALL_PROXY', 'all_proxy', 'NO_COLOR', 'CI']) delete env[k];
Object.assign(env, {
  HOME: join(run, 'home'),
  USERPROFILE: join(run, 'home'),
  QWEN_SANDBOX: 'false',
  QWEN_CODE_NO_RELAUNCH: '1',
  TERM: 'xterm-256color',
  FORCE_COLOR: '1',
  NODE_NO_WARNINGS: '1',
  LOG: join(run, 'requests.jsonl'),
  FIXTURE: join(run, 'ws/fact.txt'),
  MISSING: join(run, 'ws/missing.txt'),
});
const fake = spawn(process.execPath, ['/root/verify/pr13324/harness/fake-model.cjs'], { env, stdio: ['ignore', 'pipe', 'inherit'] });
const url: string = await new Promise((resolve) => {
  let b = '';
  fake.stdout!.on('data', (d) => {
    b += d;
    const m = b.match(/FAKE_SERVER_READY (\S+)/);
    if (m) resolve(m[1]);
  });
});
const args = ['--approval-mode', 'yolo', '--auth-type', 'openai', '--openai-api-key', 'dummy', '--openai-base-url', url, '--model', 'fake-model'];
const shots = join(run, 'shots');
mkdirSync(shots, { recursive: true });

async function session(extra: string[], name: string, prompt?: string, waitText?: string) {
  const t = await TerminalCapture.create({ cols: 110, rows: 42, cwd: join(run, 'ws'), env, theme: 'github-dark', chrome: true, title: `qwen (${arm}) ${name}`, outputDir: shots });
  await t.spawn('node', [cli, ...args, ...extra]);
  await t.waitFor('Type your message', { timeout: 60000 });
  await t.idle(800, 15000);
  if (prompt) {
    await t.type(prompt);
    await t.idle(400, 4000);
    await t.type('\r');
    if (waitText) await t.waitFor(waitText, { timeout: 120000 });
    await t.idle(2500, 60000);
  }
  writeFileSync(join(shots, `${name}.txt`), await t.getScreenText());
  await t.captureFull(`${name}.png`);
  await t.close();
}

await session([], '1-goal-live', '/goal Read fact.txt and compute 6 * 7', 'omplete');
const chats = readdirSync(join(run, 'home/.qwen/projects')).map((p) => join(run, 'home/.qwen/projects', p, 'chats')).filter(existsSync);
const sid = readdirSync(chats[0]).find((f) => f.endsWith('.jsonl'))!.replace(/\.jsonl$/, '');
writeFileSync(join(run, 'session.txt'), sid);
await session(['--resume', sid], '2-resumed');
fake.kill();
console.log('TUI_DONE', sid, readFileSync(join(run, 'requests.jsonl'), 'utf8').split('\n').filter(Boolean).length, 'requests');
process.exit(0);
