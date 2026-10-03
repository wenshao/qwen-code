// R16-2 on real processes: `qwen sessions stop` reports a definite failure
// for a stop the supervisor still carries out.
//
// The supervisor is frozen (SIGSTOP) at the instant the client writes its
// `stop` request — after the reachability probe has passed — and thawed
// only after the client has given up at its 30 s budget. This stands in
// for any supervisor that is slower than the client's budget; nothing in
// the code under test is modified.
//   node r10-04-stop-ambiguous.mjs head
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { freshDir, out, ROOT, ARMS } from './lib.mjs';
import { writeModelHome, bin, killFor, processesFor, jobIds, readJson, waitFor, stripNoise } from './e2e-lib.mjs';

const arm = process.argv[2] ?? 'head';
const dir = freshDir('stop-ambiguous', arm);
const home = path.join(dir, 'home');
const ws = path.join(dir, 'ws');
fs.mkdirSync(ws, { recursive: true });
writeModelHome(home);
const preload = path.join(dir, 'freeze-on-stop.cjs');
fs.writeFileSync(
  preload,
  `
const net = require('node:net');
const fs = require('node:fs');
const orig = net.Socket.prototype.write;
net.Socket.prototype.write = function (chunk, ...rest) {
  if (typeof chunk === 'string' && chunk.includes('"op":"stop"') && process.env.R10_SUP_PID) {
    process.kill(Number(process.env.R10_SUP_PID), 'SIGSTOP');
    fs.appendFileSync(process.env.R10_MARK, 'froze ' + Date.now() + '\\n');
  }
  return orig.call(this, chunk, ...rest);
};
`,
);
const mark = path.join(dir, 'marks.txt');
const rows = [];
const stateOf = (id) => readJson(path.join(home, 'jobs', id, 'state.json'));
let supPid;
try {
  const launch = bin(arm, home, ws, ['--bg', 'Reply with exactly the word PONG and nothing else.'], 90_000);
  const id = jobIds(home)[0];
  rows.push({ step: 'launch (N1 timeout leaves a real session)', code: launch.code, ms: launch.ms });
  supPid = processesFor(home).find((p) => p.cmd.includes('--internal-agent-view-supervisor'))?.pid;
  rows.push({ step: 'before stop', sessionState: stateOf(id)?.sessionState, supervisor: supPid });

  const t0 = Date.now();
  const r = spawnSync(process.execPath, [`${ARMS[arm]}/scripts/cli-entry.js`, 'sessions', 'stop', id.slice(0, 8)], {
    cwd: ws,
    env: {
      ...process.env,
      QWEN_HOME: home,
      NO_COLOR: '1',
      NODE_OPTIONS: `--require ${preload}`,
      R10_SUP_PID: String(supPid),
      R10_MARK: mark,
    },
    encoding: 'utf8',
    timeout: 90_000,
  });
  const clientMs = Date.now() - t0;
  const atClientExit = stateOf(id)?.sessionState;
  rows.push({
    step: 'qwen sessions stop <id> (supervisor frozen when the request is written)',
    code: r.status,
    ms: clientMs,
    stdout: r.stdout.trim(),
    stderr: stripNoise(r.stderr),
    froze: fs.existsSync(mark) ? fs.readFileSync(mark, 'utf8').trim() : 'NOT FROZEN',
    sessionStateAtClientExit: atClientExit,
  });
  process.kill(supPid, 'SIGCONT');
  const thawedAt = Date.now();
  const final = await waitFor(() => {
    const s = stateOf(id);
    return s?.sessionState === 'stopped' ? s : undefined;
  }, 20_000, 50);
  rows.push({
    step: 'after SIGCONT',
    msToStopped: final ? Date.now() - thawedAt : null,
    sessionState: stateOf(id)?.sessionState,
    stoppedBy: final ? 'the supervisor, after the client reported failure' : 'not stopped',
  });
  const ps = bin(arm, home, ws, ['sessions', 'ps', '--json']);
  rows.push({ step: 'qwen sessions ps --json', line: ps.stdout.trim().split('\n').find((l) => l.includes(id))?.replace(id, '<id>') });
} finally {
  try {
    if (supPid) process.kill(supPid, 'SIGCONT');
  } catch {}
  rows.push({ step: 'cleanup', killed: killFor(home) });
  for (const row of rows) console.log(JSON.stringify(row));
  out(`${ROOT}/run/stop-ambiguous/${arm}.json`, rows);
}
