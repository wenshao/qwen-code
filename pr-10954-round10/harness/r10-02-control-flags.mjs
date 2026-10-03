// R7-2 / R14-4 / R10-1 on a REAL recorded session, through the shipped bin.
// A `--bg` launch (which times out under N1 but leaves a real session, a
// real supervisor and a real store behind) gives the id; then every
// control spelling runs and the store is read before/after each one.
//   node r10-02-control-flags.mjs head
import fs from 'node:fs';
import path from 'node:path';
import { freshDir, out, ROOT } from './lib.mjs';
import { writeModelHome, bin, killFor, processesFor, jobIds, readJson } from './e2e-lib.mjs';

const arm = process.argv[2] ?? 'head';
const dir = freshDir('control-flags', arm);
const home = path.join(dir, 'home');
const ws = path.join(dir, 'ws');
fs.mkdirSync(ws, { recursive: true });
writeModelHome(home);
const rows = [];

const stateOf = (id) => readJson(path.join(home, 'jobs', id, 'state.json'))?.sessionState;
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

try {
  const launch = bin(arm, home, ws, ['--bg', 'Reply with exactly the word PONG and nothing else.'], 90_000);
  const id = jobIds(home)[0];
  rows.push({ step: 'launch', argv: `qwen --bg "…"`, code: launch.code, ms: launch.ms, stderr: launch.stderr.replace(id ?? '§', '<id>') });
  const short = id.slice(0, 8);
  const worker = readJson(path.join(home, 'jobs', id, 'worker.json'));
  const sup = processesFor(home).find((p) => p.cmd.includes('--internal-agent-view-supervisor'));
  rows.push({ step: 'after-launch', state: stateOf(id), hostAlive: worker?.hostPid ? alive(worker.hostPid) : null, workerAlive: worker?.workerPid ? alive(worker.workerPid) : null, supervisor: sup?.pid ?? null });

  const cases = [
    ['peek', short, '-v'],
    ['peek', short],
    ['answer', short, '-v'],
    ['answer', short, '--yolo'],
    ['answer', short, 'check the -v flag'],
    ['stop', short, '-v'],
    ['stop', short, '--version'],
    ['stop', short, '-h'],
    ['stop', '-v', short],
    ['stop', short],
  ];
  for (const c of cases) {
    const before = stateOf(id);
    const r = bin(arm, home, ws, ['sessions', ...c], 60_000);
    const after = stateOf(id);
    const shown = ['sessions', ...c].map((t) => (t.includes(' ') ? `"${t}"` : t)).join(' ');
    rows.push({
      step: 'control',
      argv: `qwen ${shown.replace(short, '<id>')}`,
      code: r.code,
      ms: r.ms,
      stdout: r.stdout.trim().split('\n').slice(0, 3).join(' ⏎ ').slice(0, 160),
      stderr: r.stderr.trim().split('\n').slice(0, 2).join(' ⏎ ').replace(id, '<id>').slice(0, 200),
      stateBefore: before,
      stateAfter: after,
    });
    console.log(JSON.stringify(rows.at(-1)));
  }
} finally {
  rows.push({ step: 'cleanup', killed: killFor(home) });
  out(`${ROOT}/run/control-flags/${arm}.json`, rows);
}
