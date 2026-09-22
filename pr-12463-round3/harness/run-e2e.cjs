// Usage: node run-e2e.cjs <arm> <scenario>
// Drives the REAL bundled CLI (dist/cli.js) over the SDK stream-json protocol
// (--input-format/--output-format stream-json, --approval-mode auto) inside a
// fresh temp git repo. One CLI process per scenario, so the process-global
// session-commit registry lives across all turns. The scripted fake model turns
// every "RUN: <cmd>" line into one run_shell_command call; the AUTO classifier
// is stubbed to allow, so any block below comes from the deterministic guard.
const { spawn, execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const SCEN = require('./scenarios.cjs');
const [arm, name] = process.argv.slice(2);
const sc = SCEN[name];
if (!sc) { console.error('unknown scenario ' + name); process.exit(2); }
const turns = sc.turns || [{ steps: sc.steps }];
const armDir = process.env.ARM_DIR || `/root/verify/pr12463-${arm}`;
const REAL = process.env.REAL === '1';
const root = `/root/verify/pr12463-runs/${arm}${REAL ? '-real' : ''}/${name}${process.env.RUN_TAG ? '-' + process.env.RUN_TAG : ''}`;
// REAL=1 proxies AUTO-classifier requests to a real OpenAI-compatible model.
// Provide REAL_CLASSIFIER_URL (…/chat/completions), REAL_CLASSIFIER_KEY, REAL_MODEL.
const realEnv = REAL ? { REAL_CLASSIFIER_URL: process.env.REAL_CLASSIFIER_URL, REAL_CLASSIFIER_KEY: process.env.REAL_CLASSIFIER_KEY, REAL_CLASSIFIER_MODEL: process.env.REAL_MODEL } : {};
fs.rmSync(root, { recursive: true, force: true });
const home = path.join(root, 'home');
const ws = path.join(root, 'ws');
fs.mkdirSync(path.join(home, '.qwen'), { recursive: true });
fs.mkdirSync(ws, { recursive: true });
const settings = { general: { gitCoAuthor: { commit: true, pr: true } }, ...(sc.settings || {}) };
fs.writeFileSync(path.join(home, '.qwen', 'settings.json'), JSON.stringify(settings, null, 2));
const sh = (cmd, cwd = ws) => execSync(cmd, { cwd, encoding: 'utf8', shell: '/bin/bash', env: { ...process.env, HOME: home } });
sh(sc.setup);
const repo = path.join(ws, sc.repo || 'repo');
const LOG = 'git log --all --format="%h %s [%an]" --graph';
const snapshot = () => sh(sc.inspect || LOG, repo);
const before = snapshot();
const env = { ...process.env, HOME: home, USERPROFILE: home, QWEN_SANDBOX: 'false', QWEN_CODE_NO_RELAUNCH: '1', TERM: 'xterm-256color' };
for (const k of ['NO_COLOR', 'QWEN_CODE_SIMPLE', 'HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'ALL_PROXY', 'all_proxy', 'OPENAI_API_KEY', 'OPENAI_BASE_URL', 'OPENAI_MODEL']) delete env[k];
const fakeLog = path.join(root, 'fake.jsonl');
const fake = spawn(process.execPath, [path.join(__dirname, 'fake-server.cjs')], { env: { ...process.env, ...realEnv, FAKE_SCRIPT: JSON.stringify(turns.filter((t) => t.say)).split('{REPO}').join(repo), FAKE_LOG: fakeLog }, stdio: ['ignore', 'pipe', 'inherit'] });
fake.stdout.once('data', async (d) => {
  const url = String(d).trim().split(' ')[1];
  const args = [path.join(armDir, 'dist/cli.js'), '--approval-mode', 'auto', '--auth-type', 'openai', '--openai-api-key', 'dummy', '--openai-base-url', url, '--model', 'dummy', '--input-format', 'stream-json', '--output-format', 'stream-json'];
  const cli = spawn(process.execPath, args, { cwd: repo, env, stdio: ['pipe', 'pipe', 'pipe'] });
  const raw = fs.createWriteStream(path.join(root, 'stream.jsonl'));
  let err = '';
  cli.stderr.on('data', (b) => (err += b));
  const waiters = [];
  const byId = {};
  const calls = [];
  const events = [];
  const send = (o) => cli.stdin.write(JSON.stringify(o) + '\n');
  const waitFor = (pred) => new Promise((res) => waiters.push({ pred, res }));
  readline.createInterface({ input: cli.stdout }).on('line', (line) => {
    raw.write(line + '\n');
    let ev; try { ev = JSON.parse(line); } catch { return; }
    if (ev.type === 'control_request' && ev.request && ev.request.subtype === 'can_use_tool') {
      // AUTO fell back to manual approval: record it and deny, like a headless host with no UI.
      events.push({ kind: 'ask', tool: ev.request.tool_name, command: ev.request.input && ev.request.input.command });
      send({ type: 'control_response', response: { subtype: 'success', request_id: ev.request_id, response: { behavior: 'deny', message: 'harness: manual approval requested, denied' } } });
    }
    const content = ev.message && Array.isArray(ev.message.content) ? ev.message.content : [];
    for (const c of content) {
      if (c.type === 'tool_use') { byId[c.id] = { turn: events.length, command: (c.input && c.input.command) || (c.name + ' ' + JSON.stringify(c.input)) }; calls.push(byId[c.id]); }
      if (c.type === 'tool_result') {
        const r = byId[c.tool_use_id] || {};
        r.is_error = !!c.is_error;
        r.result = typeof c.content === 'string' ? c.content : JSON.stringify(c.content);
      }
    }
    for (let i = waiters.length - 1; i >= 0; i--) if (waiters[i].pred(ev)) { waiters[i].res(ev); waiters.splice(i, 1); }
  });
  const kill = setTimeout(() => cli.kill('SIGKILL'), 240000);
  send({ type: 'control_request', request_id: 'init', request: { subtype: 'initialize' } });
  await waitFor((ev) => ev.type === 'control_response');
  for (const t of turns) {
    if (t.mode) {
      const id = 'mode-' + t.mode + '-' + events.length;
      send({ type: 'control_request', request_id: id, request: { subtype: 'set_permission_mode', mode: t.mode } });
      const r = await waitFor((ev) => ev.type === 'control_response' && ev.response && ev.response.request_id === id);
      events.push({ kind: 'mode', mode: t.mode, ok: r.response.subtype });
      continue;
    }
    events.push({ kind: 'turn', say: t.say, steps: t.steps });
    send({ type: 'user', session_id: '', message: { role: 'user', content: t.say || t.steps.map((s) => 'RUN: ' + s).join('\n') }, parent_tool_use_id: null });
    await waitFor((ev) => ev.type === 'result');
  }
  cli.stdin.end();
  cli.on('exit', (code) => {
    clearTimeout(kill);
    fake.kill();
    fs.writeFileSync(path.join(root, 'stderr.txt'), err);
    const after = snapshot();
    const verdictOf = (c) => c.is_error === undefined ? 'NO RESULT' : /Blocked "git commit --amend"/.test(c.result || '') ? 'BLOCKED by amend guard' : c.is_error ? 'ERROR' : 'EXECUTED';
    calls.forEach((c) => (c.verdict = verdictOf(c)));
    fs.writeFileSync(path.join(root, 'summary.json'), JSON.stringify({ arm, scenario: name, exit: code, events, calls, before, after }, null, 2));
    const lines = [`=== ${arm} / ${name}  (cli exit ${code})`];
    for (const e of events) if (e.kind === 'mode') lines.push(`  [set_permission_mode ${e.mode}: ${e.ok}]`); else if (e.kind === 'ask') lines.push(`  [AUTO fell back to manual approval for: ${e.command}]`);
    calls.forEach((c, i) => {
      lines.push(`  step ${i + 1}: ${c.verdict.padEnd(22)} $ ${c.command}`);
      if (c.verdict !== 'EXECUTED') lines.push('           -> ' + String(c.result || '').replace(/\s+/g, ' ').slice(0, 200));
    });
    lines.push('  git before:', before.trimEnd().replace(/^/gm, '    '), '  git after:', after.trimEnd().replace(/^/gm, '    '));
    fs.writeFileSync(path.join(root, 'report.txt'), lines.join('\n') + '\n');
    console.log(lines.join('\n'));
  });
});
