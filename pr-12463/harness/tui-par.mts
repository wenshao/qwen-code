// Usage: tsx tui-par.mts <arm>
// Real TUI, --approval-mode auto. Turn 1: agent commits on feature (registered).
// Turn 2: ONE model response carrying TWO run_shell_command calls:
//   [git checkout -q main] [git commit --amend -q -m ...]
// The scheduler evaluates the whole batch's permissions before executing any
// call, so the amend's guard reads HEAD while it is still the agent commit.
import { TerminalCapture } from '/root/verify/pr12463-head/integration-tests/terminal-capture/terminal-capture.js';
import { spawn, execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

const [arm] = process.argv.slice(2);
const root = `/root/verify/pr12463-audit/runs/tui-par-${arm}`;
fs.rmSync(root, { recursive: true, force: true });
const home = path.join(root, 'home');
const repo = path.join(root, 'repo');
fs.mkdirSync(path.join(home, '.qwen'), { recursive: true });
fs.writeFileSync(path.join(home, '.qwen', 'settings.json'), JSON.stringify({ general: { gitCoAuthor: { commit: true, pr: true } } }));
execSync(`git init -q --initial-branch=main ${repo} && cd ${repo} && git config user.email user@example.com && git config user.name "Human User" && git config commit.gpgsign false && echo seed > seed.txt && git add seed.txt && git commit -q -m "user: initial" && git checkout -q -b feature && git checkout -q main && echo m > m.txt && git add m.txt && git commit -q -m "user: main release notes" && git checkout -q feature`, { shell: '/bin/bash' });
const before = execSync('git log --all --graph --format="%h %s [%an]"', { cwd: repo, encoding: 'utf8' });

const fake = spawn(process.execPath, ['/root/verify/pr12463-audit/harness/fake-server-par.cjs'], { env: { ...process.env, FAKE_LOG: path.join(root, 'fake.jsonl') }, stdio: ['ignore', 'pipe', 'inherit'] });
const url: string = await new Promise((r) => fake.stdout!.once('data', (d) => r(String(d).trim().split(' ')[1]!)));

const env: NodeJS.ProcessEnv = { ...process.env, HOME: home, USERPROFILE: home, QWEN_SANDBOX: 'false', QWEN_CODE_NO_RELAUNCH: '1', TERM: 'xterm-256color', FORCE_COLOR: '1' };
for (const k of ['NO_COLOR', 'QWEN_CODE_SIMPLE', 'HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'ALL_PROXY', 'all_proxy', 'OPENAI_API_KEY', 'OPENAI_BASE_URL']) delete env[k];

const t = await TerminalCapture.create({ cols: 120, rows: 50, cwd: repo, env, theme: 'dracula', chrome: false, outputDir: root });
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
await ask('RUN: echo a > agent.txt && git add agent.txt && git commit -q -m "agent: wip on feature"');
await ask('PAR: git checkout -q main ||| git commit --amend -q -m "agent rewrote the user main commit"');
fs.writeFileSync(path.join(root, 'screen.txt'), await t.getScreenText());
const after = execSync('git log --all --graph --format="%h %s [%an]"', { cwd: repo, encoding: 'utf8' });
fs.writeFileSync(path.join(root, 'git-log.txt'), `before:\n${before}after:\n${after}`);
await t.close();
fake.kill();
console.log(`=== tui-par ${arm}\nbefore:\n${before}after:\n${after}`);
