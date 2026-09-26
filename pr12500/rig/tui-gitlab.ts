// usage: node rig12500/tui-gitlab.ts <arm> <outDir> <idleSeconds>
// Real bundled CLI TUI against the GitLab 19.4 replica (tools-only; prompts/list, resources/list, ping
// -> HTTP 404 + JSON-RPC -32601). Captures /mcp, a real tool call, and /mcp again after idling.
import fs from 'node:fs';
import path from 'node:path';
import { TerminalCapture } from '../integration-tests/terminal-capture/terminal-capture.ts';

const [arm, outDir, idleArg] = process.argv.slice(2);
const idleSeconds = Number(idleArg ?? 0);
const R = '/Users/wenshao/git/rig12500-run';
const modelPort = fs.readFileSync(`${R}/model-${arm}.port`, 'utf8').trim();
const glPort = fs.readFileSync(`${R}/gitlab-${arm}.port`, 'utf8').trim();
const home = `${R}/tui-home-${arm}`;
fs.rmSync(home, { recursive: true, force: true });
fs.rmSync(`${home}-rt`, { recursive: true, force: true });
fs.mkdirSync(home, { recursive: true });
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(
  `${home}/settings.json`,
  JSON.stringify({
    mcpServers: {
      gitlab: {
        httpUrl: `http://127.0.0.1:${glPort}/api/v4/mcp`,
        headers: { Authorization: 'Bearer glpat-fake-token' },
        alwaysLoadTools: true,
      },
    },
    security: { auth: { selectedType: 'openai' } },
    general: { enableAutoUpdate: false },
    ui: { theme: 'GitHub' },
  }),
);
const labels: Record<string, string> = { head: 'PR #12500 head 8a0d3bf', base: 'base 99fd765' };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const t = await TerminalCapture.create({
  cols: 110,
  rows: 34,
  cwd: `${R}/ws`,
  env: {
    HOME: process.env.HOME,
    PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin:/usr/sbin:/sbin`,
    TERM: 'xterm-256color',
    FORCE_COLOR: '1',
    NODE_NO_WARNINGS: '1',
    NO_PROXY: '*',
    QWEN_HOME: home,
    QWEN_RUNTIME_DIR: `${home}-rt`,
    QWEN_DEBUG_LOG_FILE: '1',
    LANG: 'en_US.UTF-8',
  },
  theme: 'github-dark',
  chrome: true,
  title: `qwen (${labels[arm]}) — GitLab 19.4 replica MCP (404 + -32601)`,
  outputDir: outDir,
});
await t.spawn('node', [
  `/Users/wenshao/git/wt12500-${arm}/dist/cli.js`,
  '--approval-mode', 'yolo',
  '--auth-type', 'openai',
  '--openai-api-key', 'dummy',
  '--openai-base-url', `http://127.0.0.1:${modelPort}/v1`,
  '--model', 'dummy',
]);
await t.waitFor('Type your message', { timeout: 60000 });
await sleep(4000);
await t.idle(1500, 20000);
const T0 = Date.now();
fs.writeFileSync(`${outDir}/${arm}-t0.txt`, new Date(T0).toISOString());

async function openMcp(tag: string) {
  await t.type('/mcp');
  await sleep(600);
  await t.type('\n');
  await sleep(2500);
  await t.idle(1000, 15000);
  await t.capture(`${arm}-${tag}-mcp.png`);
  fs.writeFileSync(`${outDir}/${arm}-${tag}-mcp.txt`, await t.getScreenText());
  await t.type('\u001b');
  await sleep(1200);
}

await openMcp('01');
await t.type('CALL:mcp__gitlab__get_mcp_server_version which GitLab MCP version is this?');
await sleep(500);
await t.type('\n');
await sleep(6000);
await t.idle(1500, 30000);
await t.capture(`${arm}-02-toolcall.png`);
fs.writeFileSync(`${outDir}/${arm}-02-toolcall.txt`, await t.getScreenText());

if (idleSeconds > 0) {
  while (Date.now() - T0 < idleSeconds * 1000) await sleep(5000);
  await t.idle(1000, 15000);
  await openMcp('03');
}
await t.close();
process.exit(0);
