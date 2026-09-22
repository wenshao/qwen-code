// Usage: node acp-two-sessions.cjs <arm> <variant: bleed|clear>
// One `qwen --acp` process, two ACP sessions on the same repository.
// bleed: session A commits; session B (never committed) amends HEAD.
// clear: session A commits; session B switches mode default->auto; session A amends.
const { spawn, execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const [arm, variant] = process.argv.slice(2);
const root = `/root/verify/pr12463-runs/acp-${arm}-${variant}`;
fs.rmSync(root, { recursive: true, force: true });
const home = path.join(root, 'home'); const repo = path.join(root, 'repo');
fs.mkdirSync(path.join(home, '.qwen'), { recursive: true });
fs.writeFileSync(path.join(home, '.qwen', 'settings.json'), JSON.stringify({ general: { gitCoAuthor: { commit: true, pr: true } } }));
execSync(`git init -q --initial-branch=main ${repo} && cd ${repo} && git config user.email user@example.com && git config user.name "Human User" && echo seed > seed.txt && git add seed.txt && git commit -q -m "user: initial"`, { shell: '/bin/bash' });
const env = { ...process.env, HOME: home, USERPROFILE: home, QWEN_SANDBOX: 'false', QWEN_CODE_NO_RELAUNCH: '1' };
for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'ALL_PROXY', 'all_proxy', 'OPENAI_API_KEY', 'OPENAI_BASE_URL']) delete env[k];
const fake = spawn(process.execPath, [path.join(__dirname, 'fake-server.cjs')], { env: { ...process.env, FAKE_LOG: path.join(root, 'fake.jsonl') }, stdio: ['ignore', 'pipe', 'inherit'] });
fake.stdout.once('data', async (d) => {
  const url = String(d).trim().split(' ')[1];
  const cli = spawn(process.execPath, [`/root/verify/pr12463-${arm}/dist/cli.js`, '--acp', '--approval-mode', 'auto', '--auth-type', 'openai', '--openai-api-key', 'dummy', '--openai-base-url', url, '--model', 'dummy'], { cwd: repo, env, stdio: ['pipe', 'pipe', 'pipe'] });
  let err = ''; cli.stderr.on('data', (b) => (err += b));
  let id = 0; const pending = {}; const toolResults = [];
  const log = fs.createWriteStream(path.join(root, 'acp.jsonl'));
  readline.createInterface({ input: cli.stdout }).on('line', (line) => {
    log.write(line + '\n');
    let m; try { m = JSON.parse(line); } catch { return; }
    if (m.id !== undefined && pending[m.id] && (m.result !== undefined || m.error)) { pending[m.id](m); delete pending[m.id]; return; }
    if (m.method === 'session/request_permission') {
      toolResults.push({ session: m.params.sessionId, ask: true });
      cli.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: m.id, result: { outcome: { outcome: 'cancelled' } } }) + '\n');
      return;
    }
    if (m.method && m.id !== undefined) { cli.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: m.id, result: null }) + '\n'); return; }
    if (m.method === 'session/update') {
      const u = m.params.update;
      if (u.sessionUpdate === 'tool_call_update' && (u.status === 'completed' || u.status === 'failed')) {
        const text = JSON.stringify(u.content || u.rawOutput || '').slice(0, 400);
        toolResults.push({ session: m.params.sessionId, status: u.status, text });
      }
    }
  });
  const call = (method, params) => new Promise((res) => { const i = ++id; pending[i] = res; cli.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: i, method, params }) + '\n'); });
  const kill = setTimeout(() => { cli.kill('SIGKILL'); }, 180000);
  await call('initialize', { protocolVersion: 1, clientCapabilities: {} });
  const A = (await call('session/new', { cwd: repo, mcpServers: [] })).result.sessionId;
  const B = (await call('session/new', { cwd: repo, mcpServers: [] })).result.sessionId;
  const prompt = (s, text) => call('session/prompt', { sessionId: s, prompt: [{ type: 'text', text }] });
  const out = [];
  const step = async (label, s, cmd) => { const before = toolResults.length; const r = await prompt(s, 'RUN: ' + cmd); const got = toolResults.slice(before); out.push(`${label}: $ ${cmd}\n    stopReason=${r.result && r.result.stopReason} ${got.map((g) => g.ask ? 'ASK' : g.status + ' ' + (/Blocked \\"git commit --amend/.test(g.text) ? 'BLOCKED by amend guard' : g.text.slice(0, 120))).join(' | ')}`); };
  await step('session A', A, 'echo a > a.txt && git add a.txt && git commit -q -m "agent A: work"');
  if (variant === 'bleed') {
    await step('session B', B, 'git commit --amend -q -m "session B rewrote A\'s commit"');
  } else {
    const r1 = await call('session/set_mode', { sessionId: B, modeId: 'default' });
    const r2 = await call('session/set_mode', { sessionId: B, modeId: 'auto' });
    out.push(`session B: session/set_mode default -> auto (${r1.error ? 'err' : 'ok'}, ${r2.error ? 'err' : 'ok'})`);
    await step('session A', A, 'git commit --amend -q -m "agent A: work (amended)"');
  }
  clearTimeout(kill); cli.kill(); fake.kill();
  const lg = execSync('git log --format="%h %s"', { cwd: repo, encoding: 'utf8' });
  const text = `=== ${arm} / acp ${variant}  (A=${A.slice(0, 8)}, B=${B.slice(0, 8)}, one process)\n` + out.map((l) => '  ' + l).join('\n') + '\n  git log:\n' + lg.trimEnd().replace(/^/gm, '    ') + '\n';
  fs.writeFileSync(path.join(root, 'report.txt'), text); fs.writeFileSync(path.join(root, 'stderr.txt'), err);
  console.log(text);
});
