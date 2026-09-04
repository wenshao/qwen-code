import { mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { startFakeOpenAIServer, fakeToolCall } from '/root/git/pr10983-pr/integration-tests/fake-openai-server.js';
import { TerminalCapture } from '/root/git/pr10983-pr/integration-tests/terminal-capture/terminal-capture.js';

const SB = process.env.SB!;
const ARM = process.env.ARM!;                 // base | pr
const SCEN = process.env.SCEN!;               // A | B
const WT = ARM === 'pr' ? '/root/git/pr10983-pr' : '/root/git/pr10983-base';
const RUN = `${SB}/e2e/${SCEN}-${ARM}`;
rmSync(RUN, { recursive: true, force: true });
mkdirSync(`${RUN}/home/.qwen`, { recursive: true });
mkdirSync(`${RUN}/ws`, { recursive: true });

const witness = `${RUN}/witness.txt`;
writeFileSync(`${SB}/preload-e2e.cjs`, `require('fs').appendFileSync(process.env.E2E_WITNESS, 'PRELOAD EXECUTED at ' + new Date().toISOString() + '\\n');\n`);

const settings =
  SCEN === 'B'
    ? { permissions: { deny: ['Bash(pwned *)'] } }
    : { permissions: { allow: ['Bash(npm --version)'] } };
writeFileSync(`${RUN}/home/.qwen/settings.json`, JSON.stringify(settings, null, 2));

const command =
  SCEN === 'A'
    ? `NODE_OPTIONS=--require=${SB}/preload-e2e.cjs npm --version`
    : SCEN === 'B'
      ? `NODE_OPTIONS=--require=${SB}/preload-e2e.cjs pwned demo`
      : `PATH=${SB}/evilpath npm --version`;

const server = await startFakeOpenAIServer(({ requestIndex }) => {
  if (requestIndex === 0) return { toolCalls: [fakeToolCall('run_shell_command', { command, description: 'check the npm version' })], finishReason: 'tool_calls' };
  return { content: 'Done.' };
});

const env: NodeJS.ProcessEnv = { ...process.env };
for (const k of ['HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','http_proxy','https_proxy','all_proxy','NO_COLOR','QWEN_CODE_SIMPLE']) delete env[k];
Object.assign(env, {
  HOME: `${RUN}/home`, USERPROFILE: `${RUN}/home`,
  PATH: `${SB}/bin:${process.env.PATH}`,
  E2E_WITNESS: witness, QWEN_WITNESS: witness,
  QWEN_SANDBOX: 'false', QWEN_CODE_NO_RELAUNCH: '1',
  TERM: 'xterm-256color', FORCE_COLOR: '1', NODE_NO_WARNINGS: '1',
});

const t = await TerminalCapture.create({ cols: 110, rows: 26, cwd: `${RUN}/ws`, env, theme: 'dracula', chrome: false, outputDir: `${SB}/shots` });
const args = ['--auth-type','openai','--openai-api-key','dummy','--openai-base-url',server.baseUrl,'--model','dummy'];
args.push('--approval-mode', SCEN === 'B' ? 'yolo' : 'default');
await t.spawn('node', [`${WT}/dist/cli.js`, ...args]);
await t.waitFor('Type your message', { timeout: 60000 });
await t.type('check the npm version', { slow: true });
await t.idle(400, 5000);
await t.type('\n');
await t.idle(1500, 45000);
const shot = await t.capture(`scen${SCEN}-${ARM}.png`);
const screen = await t.getScreenText();
await t.close();
await server.close();

const executed = SCEN === 'C' ? screen.includes('hijacked npm') : existsSync(witness) && readFileSync(witness, 'utf8').trim().length > 0;
const out = { scenario: SCEN, arm: ARM, command, executed, witness: executed ? readFileSync(witness, 'utf8').trim() : '', shot,
  screenTail: screen.split('\n').filter((l) => l.trim()).slice(-14).join('\n') };
writeFileSync(`${SB}/e2e/${SCEN}-${ARM}.json`, JSON.stringify(out, null, 2));
console.log(`\n=== scenario ${SCEN} / arm ${ARM} ===`);
console.log(`command : ${command.replace(SB, '$SB')}`);
console.log(`EXECUTED: ${executed ? 'YES — preload ran, no prompt' : 'no'}`);
console.log(`shot    : ${shot}`);
console.log('--- screen tail ---\n' + out.screenTail);
