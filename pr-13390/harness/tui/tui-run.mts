// usage: npx tsx tui-run.mts <arm> <rundir> <promptTokensAfter> [mcpScale]
// Real interactive TUI (bundled CLI under node-pty, rendered by xterm.js):
// code mode + a real always-loaded stdio MCP server, `/context detail` before
// the first reply (estimate path) and after it (provider-count path).
import { TerminalCapture } from './terminal-capture.mts';
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const [arm, runArg, ptAfter, mcpScale = '4'] = process.argv.slice(2);
const run = resolve(runArg);
const cli = `/root/verify/pr13390/${arm}/dist/cli.js`;
rmSync(run, { recursive: true, force: true });
mkdirSync(join(run, 'home/.qwen'), { recursive: true });
mkdirSync(join(run, 'ws'), { recursive: true });
writeFileSync(
  join(run, 'home/.qwen/settings.json'),
  JSON.stringify(
    {
      tools: { codeModeOnly: true },
      security: { folderTrust: { enabled: false } },
      ui: { hideTips: true },
      mcpServers: {
        tracker: {
          command: process.execPath,
          args: [
            '/root/verify/pr13390/harness/mcp-server.mjs',
            join(run, 'hits.jsonl'),
          ],
          env: { MCP_SCALE: mcpScale },
          alwaysLoadTools: true,
        },
      },
    },
    null,
    2,
  ),
);
const env: Record<string, string> = {};
for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'ALL_PROXY', 'all_proxy', 'NO_COLOR', 'CI']) delete env[k];
const ptFile = join(run, 'prompt-tokens.txt');
writeFileSync(ptFile, ptAfter);
Object.assign(env, {
  HOME: join(run, 'home'),
  USERPROFILE: join(run, 'home'),
  QWEN_SANDBOX: 'false',
  QWEN_CODE_NO_RELAUNCH: '1',
  TERM: 'xterm-256color',
  FORCE_COLOR: '1',
  NODE_NO_WARNINGS: '1',
  LOG: join(run, 'requests.jsonl'),
  PROMPT_TOKENS_FILE: ptFile,
});
const fake = spawn(process.execPath, ['/root/verify/pr13390/harness/fake-model.cjs'], { env, stdio: ['ignore', 'pipe', 'inherit'] });
const url: string = await new Promise((res) => {
  let b = '';
  fake.stdout!.on('data', (d) => {
    b += d;
    const m = b.match(/FAKE_SERVER_READY (\S+)/);
    if (m) res(m[1]);
  });
});
const args = ['--approval-mode', 'yolo', '--auth-type', 'openai', '--openai-api-key', 'dummy', '--openai-base-url', url, '--model', 'fake-model'];
const shots = join(run, 'shots');
mkdirSync(shots, { recursive: true });

async function submit(t: TerminalCapture, text: string) {
  await t.type(text);
  await t.idle(400, 4000);
  await t.type('\r');
}

async function session(name: string, firstPrompt?: string) {
  const t = await TerminalCapture.create({ cols: 100, rows: 150, cwd: join(run, 'ws'), env, theme: 'github-dark', chrome: true, title: `qwen (${arm === 'head' ? 'PR #13390 @ 9c75b71' : 'base fde56a8'}) ${name}`, outputDir: shots });
  await t.spawn('node', [cli, ...args]);
  await t.waitFor('Type your message', { timeout: 60000 });
  // Let the MCP server finish discovery before measuring.
  await new Promise((r) => setTimeout(r, 5000));
  await t.idle(800, 15000);
  if (firstPrompt) {
    await submit(t, firstPrompt);
    await t.waitFor('Acknowledged.', { timeout: 60000 });
    await t.idle(1500, 30000);
  }
  await submit(t, '/context detail');
  await t.waitFor('MCP tools', { timeout: 30000 });
  await t.idle(1500, 30000);
  writeFileSync(join(shots, `${name}.txt`), await t.getScreenText());
  await t.captureFull(`${name}.png`);
  await t.close();
}

await session('1-before-first-reply');
await session('2-after-first-reply', 'Say hello.');
fake.kill();
console.log('TUI_DONE');
process.exit(0);
