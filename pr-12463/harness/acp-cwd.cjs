// Usage: node acp-cwd.cjs <arm> <variant: own|cross>
// One `qwen --acp` process started in repoA (process.cwd()).
// own:   one session with cwd=repoB commits then amends in repoB.
// cross: session A (cwd=repoA) commits; session B (cwd=repoB) amends repoB's
//        human HEAD.
const { spawn, execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const [arm, variant] = process.argv.slice(2);
const root = `/root/verify/pr12463-audit/runs/acp-cwd-${arm}-${variant}`;
fs.rmSync(root, { recursive: true, force: true });
const home = path.join(root, 'home');
const repoA = path.join(root, 'repoA');
const repoB = path.join(root, 'repoB');
fs.mkdirSync(path.join(home, '.qwen'), { recursive: true });
fs.writeFileSync(path.join(home, '.qwen', 'settings.json'), JSON.stringify({ general: { gitCoAuthor: { commit: true, pr: true } } }));
for (const r of [repoA, repoB]) execSync(`git init -q --initial-branch=main ${r} && cd ${r} && git config user.email user@example.com && git config user.name "Human User" && git config commit.gpgsign false && echo seed > seed.txt && git add seed.txt && git commit -q -m "user: initial ${path.basename(r)}"`, { shell: '/bin/bash' });
const env = { ...process.env, HOME: home, USERPROFILE: home, QWEN_SANDBOX: 'false', QWEN_CODE_NO_RELAUNCH: '1' };
for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'ALL_PROXY', 'all_proxy', 'OPENAI_API_KEY', 'OPENAI_BASE_URL']) delete env[k];
const fake = spawn(process.execPath, [path.join(__dirname, 'fake-server.cjs')], { env: { ...process.env, FAKE_LOG: path.join(root, 'fake.jsonl') }, stdio: ['ignore', 'pipe', 'inherit'] });
fake.stdout.once('data', async (d) => {
  const url = String(d).trim().split(' ')[1];
  const cli = spawn(process.execPath, [`/root/verify/pr12463-${arm}/dist/cli.js`, '--acp', '--approval-mode', 'auto', '--auth-type', 'openai', '--openai-api-key', 'dummy', '--openai-base-url', url, '--model', 'dummy'], { cwd: repoA, env, stdio: ['pipe', 'pipe', 'pipe'] });
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
        toolResults.push({ session: m.params.sessionId, status: u.status, text: JSON.stringify(u.content || u.rawOutput || '').slice(0, 400) });
      }
    }
  });
  const call = (method, params) => new Promise((res) => { const i = ++id; pending[i] = res; cli.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: i, method, params }) + '\n'); });
  const kill = setTimeout(() => { cli.kill('SIGKILL'); }, 180000);
  await call('initialize', { protocolVersion: 1, clientCapabilities: {} });
  const newS = async (cwd) => { const r = await call('session/new', { cwd, mcpServers: [] }); if (!r.result) throw new Error(JSON.stringify(r.error)); const s = r.result.sessionId; const mr = await call('session/set_mode', { sessionId: s, modeId: 'auto' }); return { s, mode: mr.error ? 'set_mode err ' + JSON.stringify(mr.error) : 'auto' }; };
  const out = [];
  const step = async (label, s, cmd) => { const before = toolResults.length; const r = await call('session/prompt', { sessionId: s, prompt: [{ type: 'text', text: 'RUN: ' + cmd }] }); const got = toolResults.slice(before); out.push(`${label}: $ ${cmd}\n    stopReason=${r.result && r.result.stopReason} ${got.map((g) => g.ask ? 'ASK' : g.status + ' ' + (/Blocked \\"git commit --amend/.test(g.text) ? 'BLOCKED by amend guard' : g.text.slice(0, 100))).join(' | ')}`); };
  try {
    if (variant === 'own') {
      const B = await newS(repoB); out.push(`session B cwd=repoB mode=${B.mode}`);
      await step('session B', B.s, 'echo b > b.txt && git add b.txt && git commit -q -m "agent B: work"');
      await step('session B', B.s, 'git commit --amend -q -m "agent B: work (amended)"');
    } else {
      const A = await newS(repoA); const B = await newS(repoB); out.push(`A cwd=repoA mode=${A.mode}; B cwd=repoB mode=${B.mode}`);
      await step('session A', A.s, 'echo a > a.txt && git add a.txt && git commit -q -m "agent A: work"');
      await step('session B', B.s, 'git commit --amend -q -m "session B rewrote repoB human commit"');
    }
  } catch (e) { out.push('ERROR ' + e.message); }
  clearTimeout(kill); cli.kill(); fake.kill();
  const lg = (r) => execSync('git log --format="%h %s [%an]"', { cwd: r, encoding: 'utf8' });
  const text = `=== ${arm} / acp-cwd ${variant} (process cwd = repoA)\n` + out.map((l) => '  ' + l).join('\n') + '\n  repoA log:\n' + lg(repoA).trimEnd().replace(/^/gm, '    ') + '\n  repoB log:\n' + lg(repoB).trimEnd().replace(/^/gm, '    ') + '\n';
  fs.writeFileSync(path.join(root, 'report.txt'), text); fs.writeFileSync(path.join(root, 'stderr.txt'), err);
  console.log(text);
});
