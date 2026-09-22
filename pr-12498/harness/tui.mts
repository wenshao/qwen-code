// Usage: tsx tui.mts <base|head> <missing|shim|vim|sandbox|unset> [strace]
import { TerminalCapture } from '/root/verify/pr12498-head/integration-tests/terminal-capture/terminal-capture.js';
import { startFakeOpenAIServer, fakeToolCall } from '/root/verify/pr12498-head/integration-tests/fake-openai-server.js';
import * as fs from 'node:fs';
import * as path from 'node:path';

const [arm, scen, traceFlag] = process.argv.slice(2) as [string, string, string?];
const tag = `${arm}-${scen}${traceFlag ? '-strace' : ''}`;
const root = `/root/verify/pr12498-runs/${tag}`;
fs.rmSync(root, { recursive: true, force: true });
const home = path.join(root, 'home');
const ws = path.join(root, 'ws');
const shimDir = path.join(root, 'bin');
fs.mkdirSync(path.join(home, '.qwen'), { recursive: true });
fs.mkdirSync(path.join(ws, '.qwen'), { recursive: true });
fs.mkdirSync(shimDir, { recursive: true });
const target = path.join(ws, 'hello.txt');
fs.writeFileSync(target, 'hello world\n');
fs.writeFileSync(path.join(home, '.qwen', 'trustedFolders.json'), JSON.stringify({ [ws]: 'TRUST_FOLDER' }));
const editor = scen === 'vim' ? 'vim' : scen === 'unset' ? undefined : 'vscode';
fs.writeFileSync(path.join(ws, '.qwen', 'settings.json'), JSON.stringify({ general: editor ? { preferredEditor: editor } : {}, tools: { approvalMode: 'default' } }, null, 2));
const shimLog = path.join(root, 'code-shim.log');
if (scen === 'shim' || scen === 'sandbox') {
  // Stand-in for the VS Code CLI: records its argv and edits the proposed
  // (right-hand) file of `code --wait --diff <old> <new>`, like a user would.
  fs.writeFileSync(path.join(shimDir, 'code'), `#!/bin/sh\necho "code $*" >> ${shimLog}\nfor last; do :; done\nprintf 'hello qwen (edited in external editor)\\n' > "$last"\n`, { mode: 0o755 });
}

const fake = await startFakeOpenAIServer(({ body }) => {
  const msgs = (body as { messages?: Array<{ role: string }> }).messages ?? [];
  const toolMsgs = msgs.filter((m) => m.role === 'tool').length;
  const last = msgs[msgs.length - 1] as { role: string; content?: unknown } | undefined;
  if (toolMsgs > 0 && last?.role === 'user' && JSON.stringify(last.content).includes('again')) return { toolCalls: [fakeToolCall('write_file', { file_path: target, content: 'hello qwen\n' })], finishReason: 'tool_calls' };
  if (toolMsgs === 0) return { toolCalls: [fakeToolCall('read_file', { file_path: target })], finishReason: 'tool_calls' };
  if (toolMsgs >= 2) return { content: 'Done.' };
  return { toolCalls: [fakeToolCall('write_file', { file_path: target, content: 'hello qwen\n' })], finishReason: 'tool_calls' };
});

const env: NodeJS.ProcessEnv = { ...process.env, HOME: home, USERPROFILE: home, QWEN_SANDBOX: 'false', QWEN_CODE_NO_RELAUNCH: '1', TERM: 'xterm-256color', FORCE_COLOR: '1', PATH: `${shimDir}:/usr/bin:/bin` };
for (const k of ['NO_COLOR', 'QWEN_CODE_SIMPLE', 'HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'ALL_PROXY', 'all_proxy', 'OPENAI_API_KEY', 'OPENAI_BASE_URL', 'SANDBOX']) delete env[k];
if (scen === 'sandbox') env['SANDBOX'] = 'qwen-sandbox';

const armLabel = arm === 'base' ? 'base  main @ 99bf4ce8' : 'head  PR #12498 @ d418fc99';
const scenLabel: Record<string, string> = {
  missing: 'preferredEditor=vscode, `code` NOT on PATH',
  shim: 'preferredEditor=vscode, `code` on PATH',
  vim: 'preferredEditor=vim, vim on PATH',
  sandbox: 'preferredEditor=vscode, `code` on PATH, SANDBOX set',
  unset: 'preferredEditor unset',
  hotswap: 'preferredEditor vscode (missing) -> vim while dialog open',
};
const t = await TerminalCapture.create({ cols: 104, rows: 34, cwd: ws, env, theme: 'dracula', chrome: true, title: `${armLabel} — ${scenLabel[scen]}`, outputDir: '/root/verify/pr12498-shots' });
const events: string[] = [];
const mark = (s: string) => { events.push(`${(Date.now() / 1000).toFixed(6)} ${s}`); };
const cli = [`/root/verify/pr12498-${arm}/dist/cli.js`, '--auth-type', 'openai', '--openai-api-key', 'dummy', '--openai-base-url', fake.baseUrl, '--model', 'dummy'];
if (traceFlag) await t.spawn('/usr/bin/strace', ['-f', '-ttt', '-e', 'trace=execve', '-s', '200', '-o', path.join(root, 'strace.log'), process.execPath, ...cli]);
else await t.spawn(process.execPath, cli);
await t.waitFor('Type your message', { timeout: 90000 });
await t.idle(800, 10000);
mark('ready');
await t.type('Overwrite hello.txt with "hello qwen".');
await t.idle(400, 4000);
await t.type('\n');
await t.waitFor('Apply this change?', { timeout: 60000 });
await t.idle(1000, 10000);
mark('dialog');
const dialogText = await t.getScreenText();
fs.writeFileSync(path.join(root, 'dialog.txt'), dialogText);
await t.capture(`${tag}-1-dialog.png`);

const optLines = dialogText.split('\n').filter((l) => /^\s*[›>]?\s*\d+\.\s/.test(l)).map((l) => l.trim());
const modifyIdx = optLines.findIndex((l) => l.includes('Modify with external editor'));
const result: Record<string, unknown> = { arm, scen, options: optLines, modifyOffered: modifyIdx >= 0 };

if (scen === 'hotswap') {
  // settings.json is hot-reloaded by SettingsWatcher; switch the editor while
  // the same dialog stays open.
  fs.writeFileSync(path.join(ws, '.qwen', 'settings.json'), JSON.stringify({ general: { preferredEditor: 'vim' }, tools: { approvalMode: 'default' } }, null, 2));
  const start = Date.now();
  while (!(await t.getScreenText()).includes('Modify with external editor') && Date.now() - start < 15000) await new Promise((r) => setTimeout(r, 250));
  await t.idle(800, 5000);
  result['afterSwapMs'] = Date.now() - start;
  const txt = await t.getScreenText();
  fs.writeFileSync(path.join(root, 'after-swap.txt'), txt);
  result['afterSwapOptions'] = txt.split('\n').filter((l) => /^\s*[›>]?\s*\d+\.\s/.test(l)).map((l) => l.trim());
  await t.capture(`${tag}-2-after-swap.png`);
  for (let i = 0; i < 3; i++) { await t.type('\x1b[B'); await t.idle(200, 2000); }
  await t.idle(800, 5000);
  const txt2 = await t.getScreenText();
  result['afterRerenderOptions'] = txt2.split('\n').filter((l) => /^\s*[›>]?\s*\d+\.\s/.test(l)).map((l) => l.trim());
  await t.type('\x1b');
  await t.idle(1500, 10000);
  await t.type('Please try that again.');
  await t.idle(400, 4000);
  await t.type('\n');
  await t.waitFor('Apply this change?', { timeout: 60000 });
  await t.idle(1000, 10000);
  const txt3 = await t.getScreenText();
  fs.writeFileSync(path.join(root, 'second-dialog.txt'), txt3);
  result['secondDialogOptions'] = txt3.split('\n').filter((l) => /^\s*[›>]?\s*\d+\.\s/.test(l)).map((l) => l.trim()).slice(-4);
  await t.capture(`${tag}-3-second-dialog.png`);
} else if (traceFlag) {
  // Drive re-renders while the dialog stays open: move the cursor around.
  for (let i = 0; i < 6; i++) { await t.type('\x1b[B'); await t.idle(150, 2000); }
  for (let i = 0; i < 6; i++) { await t.type('\x1b[A'); await t.idle(150, 2000); }
  mark('rerenders-done');
} else if (modifyIdx >= 0 && scen !== 'unset') {
  for (let i = 0; i < modifyIdx; i++) { await t.type('\x1b[B'); await t.idle(150, 2000); }
  await t.type('\r');
  if (scen === 'vim') {
    await t.idle(1500, 10000);
    await t.capture(`${tag}-2-editor.png`);
    fs.writeFileSync(path.join(root, 'editor.txt'), await t.getScreenText());
    await t.type(':qa\r');
  }
  await t.idle(2500, 20000);
  fs.writeFileSync(path.join(root, 'after-modify.txt'), await t.getScreenText());
  await t.capture(`${tag}-2-after-modify.png`);
  result['afterModifyHasDialog'] = (await t.getScreenText()).includes('Apply this change?');
  if (scen === 'shim') {
    // Accept the edited proposal.
    await t.type('\r');
    await t.idle(2500, 20000);
    await t.capture(`${tag}-3-accepted.png`);
  }
}
// Dismiss anything left and exit.
await t.type('\x1b');
await t.idle(800, 5000);
fs.writeFileSync(path.join(root, 'final.txt'), await t.getScreenText());
fs.writeFileSync(path.join(root, 'events.txt'), events.join('\n') + '\n');
result['fileAfter'] = fs.readFileSync(target, 'utf8');
result['shimCalls'] = fs.existsSync(shimLog) ? fs.readFileSync(shimLog, 'utf8').trim().split('\n') : [];
result['modelRequests'] = fake.requests.length;
await t.close();
await fake.close();
fs.writeFileSync(path.join(root, 'result.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
