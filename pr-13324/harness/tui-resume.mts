// usage: npx tsx tui-resume.mts <reader-arm> <source-run> <out-dir> <renderer: ink|opentui>
// Resume ONE existing session in the real interactive TUI and capture it.
import { TerminalCapture } from './terminal-capture.mts';
import { spawn } from 'node:child_process';
import { cpSync, mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [arm, src, out, renderer] = process.argv.slice(2);
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(join(src, 'home'), join(out, 'home'), { recursive: true });
const sid = readFileSync(join(src, 'session.txt'), 'utf8').trim();
const env: Record<string, string> = {};
for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'ALL_PROXY', 'all_proxy', 'NO_COLOR', 'CI']) delete env[k];
Object.assign(env, {
  HOME: join(out, 'home'),
  USERPROFILE: join(out, 'home'),
  QWEN_SANDBOX: 'false',
  QWEN_CODE_NO_RELAUNCH: '1',
  TERM: 'xterm-256color',
  FORCE_COLOR: '1',
  NODE_NO_WARNINGS: '1',
  LOG: join(out, 'requests.jsonl'),
  QWEN_TUI_RENDERER: renderer,
  ...(renderer === 'opentui' ? { QWEN_TUI_RENDERER_STRICT: '1' } : {}),
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
const t = await TerminalCapture.create({ cols: 110, rows: 42, cwd: join(src, 'ws'), env, theme: 'github-dark', chrome: true, title: `qwen (${arm} reader, ${renderer}) --resume`, outputDir: out });
await t.spawn(process.env.RUNTIME || 'node', [`/root/verify/pr13324/${arm}/dist/cli.js`, '--approval-mode', 'yolo', '--auth-type', 'openai', '--openai-api-key', 'dummy', '--openai-base-url', url, '--model', 'fake-model', '--resume', sid]);
let waitError = '';
try {
  await t.waitFor(process.env.WAIT_TEXT || 'Goal complete', { timeout: 60000 });
  await t.idle(2500, 30000);
} catch (e) {
  waitError = String(e);
}
writeFileSync(join(out, 'wait-error.txt'), waitError);
writeFileSync(join(out, 'screen.txt'), await t.getScreenText());
await t.captureFull('resumed.png');
await t.close();
fake.kill();
console.log('RESUME_DONE', arm, renderer);
process.exit(0);
