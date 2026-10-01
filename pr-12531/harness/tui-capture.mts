// Real interactive TUI capture for PR #12531: real MCP stdio servers + scripted model.
// usage: npx tsx tui-capture.mts <outDir> <scenarioId> <arm...>
import fs from 'node:fs';
import path from 'node:path';
import { TerminalCapture } from './terminal-capture.mts';
import { ARMS, SCENARIOS, reg, setupRun, startFake, cleanEnv } from './scenarios.mjs';

const [outDir, scId, ...arms] = process.argv.slice(2);
const sc = SCENARIOS.find((s) => s.id === scId)!;
const target = reg(...(sc.target as [string, string]));
fs.mkdirSync(outDir, { recursive: true });

for (const arm of arms) {
  const run = path.join(outDir, `${scId}-${arm}`);
  const { home, ws, hits, modelLog } = setupRun(sc, run);
  const fake = await startFake(modelLog, target);
  const env = {
    ...cleanEnv, HOME: home, USERPROFILE: home, QWEN_SANDBOX: 'false', QWEN_CODE_NO_RELAUNCH: '1',
    NO_PROXY: '127.0.0.1,localhost', TERM: 'xterm-256color', FORCE_COLOR: '1', NODE_NO_WARNINGS: '1',
  } as NodeJS.ProcessEnv;
  const t = await TerminalCapture.create({ cols: 110, rows: 30, cwd: ws, env, theme: 'github-dark' as any, chrome: true,
    title: `${arm} @ ${arm === 'base' ? 'e083d6a6b8' : '985683eb4d'}${arm === 'fix' ? ' + suggested patch' : ''} — ${sc.id}`, outputDir: run });
  await t.spawn(process.execPath, [`${ARMS[arm]}/scripts/cli-entry.js`, '--approval-mode', sc.mode, '--auth-type', 'openai',
    '--openai-api-key', 'dummy', '--openai-base-url', fake.url, '--model', 'dummy']);
  await t.waitFor('Type your message', { timeout: 60000 });
  await t.idle(1500, 20000);
  await t.type('VERIFY-PR12531: call the tool');
  await t.idle(400, 4000);
  await t.type('\n');
  // Wait for one of: tool executed (final text), confirmation dialog, deny message.
  const deadline = Date.now() + 60000;
  let screen = '';
  while (Date.now() < deadline) {
    screen = await t.getScreenText();
    if (/FINAL tool result|Allow once|allow once|Yes, allow|denied|Matching deny rule/i.test(screen)) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  await t.idle(1500, 15000);
  screen = await t.getScreenText();
  await t.capture(`${scId}-${arm}.png`, outDir);
  fs.writeFileSync(path.join(run, 'screen.txt'), screen);
  const hitLines = fs.readFileSync(hits, 'utf8').trim().split('\n').filter(Boolean);
  console.log(`${scId} ${arm}: hits=${hitLines.length} ${hitLines.join(' ')}`);
  await t.close();
  fake.proc.kill();
}
process.exit(0);
