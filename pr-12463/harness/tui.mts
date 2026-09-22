// Usage: tsx tui.ts <arm> <scenario: fix|clear>
import { TerminalCapture } from '/root/verify/pr12463-head/integration-tests/terminal-capture/terminal-capture.js';
import { spawn, execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

const [arm, scen] = process.argv.slice(2);
const root = `/root/verify/pr12463-runs/tui-${arm}-${scen}`;
fs.rmSync(root, { recursive: true, force: true });
const home = path.join(root, 'home');
const repo = path.join(root, 'repo');
fs.mkdirSync(path.join(home, '.qwen'), { recursive: true });
fs.writeFileSync(path.join(home, '.qwen', 'settings.json'), JSON.stringify({ general: { gitCoAuthor: { commit: true, pr: true } } }));
execSync(`git init -q --initial-branch=main ${repo} && cd ${repo} && git config user.email user@example.com && git config user.name "Human User" && git config commit.gpgsign false && echo seed > seed.txt && git add seed.txt && git commit -q -m "user: initial"`, { shell: '/bin/bash' });
if (scen === 'probe') execSync(`cd ${repo} && git checkout -q -b feature && echo f > f.txt && git add f.txt && git commit -q -m "user: feature work" && git checkout -q main && echo m > m.txt && git add m.txt && git commit -q -m "user: main release notes" && git checkout -q feature`, { shell: '/bin/bash' });

const fake = spawn(process.execPath, ['/root/verify/pr12463-harness/fake-server.cjs'], { env: { ...process.env, FAKE_LOG: path.join(root, 'fake.jsonl') }, stdio: ['ignore', 'pipe', 'inherit'] });
const url: string = await new Promise((r) => fake.stdout!.once('data', (d) => r(String(d).trim().split(' ')[1]!)));

const env: NodeJS.ProcessEnv = { ...process.env, HOME: home, USERPROFILE: home, QWEN_SANDBOX: 'false', QWEN_CODE_NO_RELAUNCH: '1', TERM: 'xterm-256color', FORCE_COLOR: '1' };
for (const k of ['NO_COLOR', 'QWEN_CODE_SIMPLE', 'HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'ALL_PROXY', 'all_proxy', 'OPENAI_API_KEY', 'OPENAI_BASE_URL']) delete env[k];

const t = await TerminalCapture.create({ cols: 110, rows: 42, cwd: repo, env, theme: 'dracula', chrome: true, title: `qwen-code — PR #12463 ${arm === 'base' ? 'base (main @ c822995d)' : 'head (0cf69caf)'} — --approval-mode auto` , outputDir: '/root/verify/pr12463-shots' });
await t.spawn(process.execPath, [`/root/verify/pr12463-${arm}/dist/cli.js`, '--approval-mode', 'auto', '--auth-type', 'openai', '--openai-api-key', 'dummy', '--openai-base-url', url, '--model', 'dummy']);
await t.waitFor('Type your message', { timeout: 60000 });
await t.idle(800, 10000);

async function ask(text: string) {
  await t.type(text);
  await t.idle(400, 4000);
  await t.type('\n');
  const before = t.getOutput().split('Scripted steps finished').length;
  const start = Date.now();
  while (t.getOutput().split('Scripted steps finished').length === before && Date.now() - start < 60000) await new Promise((r) => setTimeout(r, 200));
  await t.idle(1200, 15000);
}
if (scen === 'probe') {
  await ask('RUN: echo a > agent.txt && git add agent.txt && git commit -q -m "agent: wip on feature" && git checkout -q main');
  await ask('RUN: git log --format="%h %s" -1 && git commit --amend -q -m "agent rewrote this" && git log --all --format="%h %s" --graph');
} else {
await ask('RUN: echo feat > feature.txt && git add feature.txt && git commit -q -m "agent: add feature"');
}
if (scen === 'clear') {
  await t.type('/clear');
  await t.idle(400, 4000);
  await t.type('\n');
  await t.idle(1500, 15000);
}
if (scen !== 'probe') await ask('RUN: git commit --amend -q -m "agent: add feature (amended)" && git log --format="%h %s" -2');
await t.capture(`${arm}-${scen}.png`);
fs.writeFileSync(path.join(root, 'screen.txt'), await t.getScreenText());
fs.writeFileSync(path.join(root, 'git-log.txt'), execSync('git log --all --graph --format="%h %s [%an]"', { cwd: repo, encoding: 'utf8' }));
await t.close();
fake.kill();
console.log(fs.readFileSync(path.join(root, 'git-log.txt'), 'utf8'));
