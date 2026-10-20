// TUI loop-dialog capture for PR #14858.
// usage: npx tsx tui.ts <arm:head|base> <scen> <tag> '<model settings json>'
import { TerminalCapture } from '/root/verify/pr14858/wt-head/integration-tests/terminal-capture/terminal-capture.ts';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';

const [arm, scen, tag, modelJson] = process.argv.slice(2);
const R = '/root/verify/pr14858';
const out = `${R}/runs/${arm}/${tag}`;
const home = `${out}/home`;
mkdirSync(`${home}/.qwen`, { recursive: true });
writeFileSync(
  `${home}/.qwen/settings.json`,
  JSON.stringify({
    security: { auth: { selectedType: 'openai' } },
    ui: { theme: 'Qwen Dark' },
    model: JSON.parse(modelJson || '{}'),
    privacy: { usageStatisticsEnabled: false },
  }),
);
const url = readFileSync(`${R}/fake-url`, 'utf8').trim();
const env: Record<string, string> = {};
for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
for (const k of ['NO_COLOR', 'QWEN_CODE_SIMPLE', 'QWEN_HOME', 'HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'ALL_PROXY', 'all_proxy'])
  delete env[k];
Object.assign(env, {
  HOME: home,
  USERPROFILE: home,
  QWEN_SANDBOX: 'false',
  QWEN_CODE_NO_RELAUNCH: '1',
  TERM: 'xterm-256color',
  FORCE_COLOR: '1',
  NODE_NO_WARNINGS: '1',
});

const t = await TerminalCapture.create({
  cols: 110,
  rows: 34,
  cwd: `${R}/ws`,
  env,
  theme: 'github-dark' as never,
  chrome: false,
  outputDir: out,
});
try {
  const opentui = process.env.OPENTUI === '1';
  if (opentui) Object.assign(env, { QWEN_TUI_RENDERER: 'opentui', QWEN_TUI_RENDERER_STRICT: '1' });
  await t.spawn(opentui ? '/root/.bun/bin/bun' : 'node', [
    `${R}/wt-${arm}/dist/cli.js`,
    '--approval-mode', 'yolo',
    '--auth-type', 'openai',
    '--openai-api-key', 'dummy',
    '--openai-base-url', url,
    '--model', 'fake',
  ]);
  await t.waitFor('Type your message', { timeout: 60000 });
  await t.idle(800, 10000);
  await t.type(`SCEN=${scen} go`);
  await t.idle(400, 4000);
  await t.type('\n');
  if (opentui) {
    const deadline = Date.now() + 120000;
    for (;;) {
      const txt = await t.getScreenText();
      if (/Loop detection halted|A potential loop/.test(txt)) break;
      if (Date.now() > deadline) throw new Error('opentui: no loop text');
      await new Promise((r) => setTimeout(r, 500));
    }
    await t.idle(800, 10000);
    await t.capture(`opentui.png`);
    writeFileSync(`${out}/opentui.txt`, await t.getScreenText());
    console.log(`OPENTUI ${arm} ${tag} ok`);
    await t.close();
    process.exit(0);
  }
  await t.waitFor('A potential loop was detected', { timeout: 120000 });
  await t.idle(800, 10000);
  await t.capture(`tui-dialog.png`);
  writeFileSync(`${out}/tui-dialog.txt`, await t.getScreenText());
  // Esc dismisses the dialog with "keep"
  await t.type('\x1b');
  await t.idle(1200, 10000);
  await t.capture(`tui-after.png`);
  writeFileSync(`${out}/tui-after.txt`, await t.getScreenText());
  console.log(`TUI ${arm} ${tag} ok`);
} finally {
  await t.close();
}
