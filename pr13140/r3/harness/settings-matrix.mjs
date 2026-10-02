// Settings fail-closed matrix: drives the built CLI (dist/cli.js) of one arm
// against isolated operator-settings fixtures and records observable behavior.
// usage: node settings-matrix.mjs <arm-name> <dist/cli.js> <out.jsonl>
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const [arm, cli, out] = process.argv.slice(2);
const root = fs.mkdtempSync(path.join(os.tmpdir(), `smx-${arm}-`));
const MALFORMED = '{"tools": {"executionSandbox": {"backend": "bwrap",\n';
const VALID = JSON.stringify({ tools: { executionSandbox: { backend: 'bwrap', filesystem: 'workspace-write', network: 'closed' } } });

const entries = {
  headless: { args: ['-p', 'hi'], stdin: 'ignore' },
  interactive: { tty: true, args: [] },
  mcp: { args: ['mcp', 'list'], stdin: 'ignore' },
  serve: { args: ['serve', '--port', '0'], stdin: 'ignore' },
  acp: { args: ['--acp'], stdin: 'pipe' },
  sandbox: { args: ['sandbox'], stdin: 'ignore' },
};
const scopes = ['User', 'System', 'SystemDefaults'];
const faults = ['malformed', 'unreadable'];

const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

function run(entry, env, cwd) {
  return new Promise((resolve) => {
    const started = Date.now();
    const cmd = entry.tty ? '/usr/bin/script' : process.execPath;
    const args = entry.tty
      ? ['-q', '/dev/null', process.execPath, cli, ...entry.args]
      : [cli, ...entry.args];
    const child = spawn(cmd, args, {
      cwd,
      env,
      stdio: [entry.tty ? 'pipe' : entry.stdin, 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, 15000);
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, timedOut, stdout, stderr, ms: Date.now() - started });
    });
  });
}

const lines = [];
for (const scope of scopes) {
  for (const fault of faults) {
    for (const [name, entry] of Object.entries(entries)) {
      const dir = fs.mkdtempSync(path.join(root, `${scope}-${fault}-${name}-`));
      const home = path.join(dir, 'home');
      const ws = path.join(dir, 'ws');
      fs.mkdirSync(path.join(home, '.qwen'), { recursive: true });
      fs.mkdirSync(ws, { recursive: true });
      const target = {
        User: path.join(home, '.qwen', 'settings.json'),
        System: path.join(dir, 'system-settings.json'),
        SystemDefaults: path.join(dir, 'system-defaults.json'),
      }[scope];
      fs.writeFileSync(target, fault === 'malformed' ? MALFORMED : VALID);
      if (fault === 'unreadable') fs.chmodSync(target, 0o000);
      const before = { mode: fs.statSync(target).mode & 0o777 };
      if (fault !== 'unreadable') before.sha = sha(target);
      const env = {
        PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
        HOME: home,
        TERM: 'xterm-256color',
        QWEN_CODE_SYSTEM_SETTINGS_PATH: path.join(dir, 'system-settings.json'),
        QWEN_CODE_SYSTEM_DEFAULTS_PATH: path.join(dir, 'system-defaults.json'),
        NO_COLOR: '1',
      };
      const r = await run(entry, env, ws);
      const after = { mode: fs.statSync(target).mode & 0o777 };
      if (fault === 'unreadable') fs.chmodSync(target, before.mode | 0o600);
      if (fault !== 'unreadable') after.sha = sha(target);
      const siblings = fs.readdirSync(path.dirname(target)).filter((f) => f.includes('corrupt'));
      const combined = `${r.stdout}\n${r.stderr}`.replace(/\r/g, '');
      const row = {
        arm, scope, fault, entry: name,
        exit: r.code, signal: r.signal, timedOut: r.timedOut, ms: r.ms,
        unchanged: before.sha === after.sha && before.mode === after.mode,
        corruptedCopies: siblings,
        stackFrames: (combined.match(/^\s+at .+\(.+:\d+:\d+\)$/gm) || []).length,
        namesFile: combined.includes(target),
        repairHint: /Repair the JSON object|Restore read access/.test(combined),
        mentionsCount: combined.split(target).length - 1,
        firstLine: combined.split('\n').map((l) => l.trim()).filter(Boolean)[0]?.slice(0, 220) ?? '',
        tail: combined.trim().slice(-600),
      };
      lines.push(row);
      fs.appendFileSync(out, JSON.stringify(row) + '\n');
      console.log(`${arm} ${scope}/${fault}/${name}: exit=${r.code}${r.timedOut ? ' TIMEOUT' : ''} unchanged=${row.unchanged} stack=${row.stackFrames} names=${row.namesFile} hint=${row.repairHint} :: ${row.firstLine.slice(0, 120)}`);
    }
  }
}
fs.rmSync(root, { recursive: true, force: true });
