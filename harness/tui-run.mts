/**
 * PR #9541 TUI arm: boot the built CLI against the fake OpenAI server,
 * produce a Chinese session, run /compress, screenshot the result.
 *
 * Usage: npx tsx tmp-probe/tui-run.mts <armLabel> <outDir>
 */
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { TerminalCapture } from '../integration-tests/terminal-capture/terminal-capture.js';

const arm = process.argv[2] ?? 'arm';
const outDir = process.argv[3] ?? '/tmp/tui-out';
const repoRoot = process.cwd();
const home = `/tmp/qwen-tui-${arm}`;
const workspace = `${home}/workspace`;

rmSync(home, { recursive: true, force: true });
mkdirSync(`${home}/.qwen`, { recursive: true });
mkdirSync(workspace, { recursive: true });
mkdirSync(outDir, { recursive: true });

writeFileSync(
  `${home}/.qwen/settings.json`,
  JSON.stringify(
    {
      general: { vimMode: false, disableUpdateNag: true },
      privacy: { usageStatisticsEnabled: false },
      ui: { hideBanner: true, hideTips: true },
      // Keep automatic compaction out of the way: this arm compares what the
      // MANUAL /compress does with an identical session on both builds.
      context: { autoCompactThreshold: 0.99 },
      model: {
        generationConfig: {
          // Window chosen so ~4 long Chinese turns land near half of it in
          // REAL provider tokens — the region where the guard decides.
          contextWindowSize: 128000,
          // Force the cold compression path (no prompt-cache sharing).
          enableCacheControl: false,
        },
      },
    },
    null,
    2,
  ),
);

const reqLog = `${outDir}/${arm}-requests.jsonl`;
writeFileSync(reqLog, '');

const server = spawn(
  'node',
  [`${repoRoot}/tmp-probe/fake-openai.cjs`],
  {
    env: {
      ...process.env,
      REQ_LOG: reqLog,
      FAKE_WINDOW: '128000',
      ZH_REPLY_CHARS: '20000',
    },
    stdio: ['ignore', 'pipe', 'inherit'],
  },
);
const baseUrl: string = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('server timeout')), 10000);
  server.stdout.on('data', (d) => {
    const m = /FAKE_SERVER_READY (\S+)/.exec(String(d));
    if (m) {
      clearTimeout(timer);
      resolve(m[1]);
    }
  });
});
console.log(`[${arm}] fake server at ${baseUrl}`);

const env: NodeJS.ProcessEnv = { ...process.env };
for (const k of [
  'HTTP_PROXY',
  'http_proxy',
  'HTTPS_PROXY',
  'https_proxy',
  'ALL_PROXY',
  'all_proxy',
  'NO_COLOR',
  'QWEN_CODE_SIMPLE',
])
  delete env[k];
env['HOME'] = home;
env['USERPROFILE'] = home;
env['QWEN_SANDBOX'] = 'false';
env['QWEN_CODE_NO_RELAUNCH'] = '1';
env['TERM'] = 'xterm-256color';
env['FORCE_COLOR'] = '1';
env['NO_PROXY'] = '127.0.0.1,localhost';

const term = await TerminalCapture.create({
  cols: 110,
  rows: 34,
  cwd: workspace,
  env,
  theme: 'one-dark',
  chrome: false,
});

await term.spawn('node', [
  `${repoRoot}/dist/cli.js`,
  '--approval-mode',
  'yolo',
  '--auth-type',
  'openai',
  '--openai-api-key',
  'dummy',
  '--openai-base-url',
  baseUrl,
  '--model',
  'dummy',
]);

await term.waitFor('Type your message', { timeout: 60000 });
await term.idle(500, 8000);

// Six turns of long Chinese model output, so the session lands around half of
// the 128,000-token window in REAL provider tokens.
for (let turn = 1; turn <= 6; turn++) {
  await term.type(`请用中文继续说明第 ${turn} 部分的压缩验证背景`);
  await term.idle(400, 5000);
  await term.type('\n');
  await term.idle(1500, 120000);
}
await term.capture(`${arm}-1-session.png`, outDir);

// Manual compression.
await term.type('/compress');
await term.idle(400, 8000);
await term.type('\n');
await term.idle(1500, 60000);
await term.capture(`${arm}-2-compress.png`, outDir);
const screen = await term.getScreenText();
writeFileSync(`${outDir}/${arm}-screen.txt`, screen);
console.log(`[${arm}] screen text saved (${screen.length} chars)`);

await term.close();
server.kill();
console.log(`[${arm}] done`);
