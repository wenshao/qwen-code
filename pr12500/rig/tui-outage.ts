// usage: node rig12562/tui-outage.ts <arm> <gitlabPortFile> <mode> <outDir>
// Real TUI: connect to the GitLab replica (healthy), then switch the replica into an outage
// mode, let the model call a GitLab tool, and read /mcp.
import fs from 'node:fs';
import path from 'node:path';
import { TerminalCapture } from '../integration-tests/terminal-capture/terminal-capture.ts';

const [arm, portFile, mode, outDir] = process.argv.slice(2);
const R = '/Users/wenshao/git/rig12500-run';
const modelPort = fs.readFileSync(`${R}/model-${arm}.port`, 'utf8').trim();
const glPort = fs.readFileSync(portFile, 'utf8').trim();
fs.mkdirSync(outDir, { recursive: true });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const control = (m: string) =>
  fetch(`http://127.0.0.1:${glPort}/__control`, { method: 'POST', body: JSON.stringify({ mode: m }) });
await control('normal');

const home = `${R}/home-${arm}-${glPort}`;
fs.mkdirSync(home, { recursive: true });
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
const labels: Record<string, string> = {
  head: 'PR #12500 head 8a0d3bf',
  alt12562: 'competing PR #12562 head 1e17509',
  base: 'base 99fd765',
};
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
    LANG: 'en_US.UTF-8',
  },
  theme: 'github-dark',
  chrome: true,
  title: `qwen (${labels[arm]}) — replica outage mode: ${mode}`,
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

async function mcp(tag: string) {
  await t.type('/mcp');
  await sleep(600);
  await t.type('\n');
  await sleep(2500);
  await t.idle(1000, 15000);
  const shot = `${arm}-${mode}-${tag}.png`;
  await t.capture(shot);
  const text = await t.getScreenText();
  fs.writeFileSync(`${outDir}/${arm}-${mode}-${tag}.txt`, text);
  await t.type('\u001b');
  await sleep(1200);
  return /gitlab\s+·\s+(\S+\s+\w+)/.exec(text)?.[1] ?? '?';
}

const before = await mcp('1-before');
await control(mode);
await t.type('CALL:mcp__gitlab__get_mcp_server_version what version is the gitlab server?');
await sleep(500);
await t.type('\n');
await sleep(8000);
await t.idle(1500, 30000);
await t.capture(`${arm}-${mode}-2-toolcall.png`);
fs.writeFileSync(`${outDir}/${arm}-${mode}-2-toolcall.txt`, await t.getScreenText());
const after = await mcp('3-after');
fs.appendFileSync(`${outDir}/summary.txt`, `${arm}\t${mode}\tbefore=${before}\tafter=${after}\n`);
await control('normal');
await t.close();
process.exit(0);
