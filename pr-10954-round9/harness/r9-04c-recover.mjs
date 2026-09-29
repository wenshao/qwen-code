// Follow the recovery advice after a supervisor crash: start a new supervisor
// with `qwen --bg`, then stop the orphaned session.
import fs from 'node:fs';
import path from 'node:path';
import { freshDir, out, ROOT } from './lib.mjs';
import { writeModelHome, bin, binAsync, killFor, processesFor, jobIds, readJson, waitFor } from './e2e-lib.mjs';
const arm = 'head';
const dir = freshDir('entry', arm, 'recover');
const home = path.join(dir, 'home');
const ws = path.join(dir, 'ws');
fs.mkdirSync(ws, { recursive: true });
writeModelHome(home);
const log = {};
const show = () => processesFor(home).map((p) => `${p.pid} ${p.cmd.slice(1).join(' ').slice(0, 70)}`);
try {
  const launch = binAsync(arm, home, ws, ['--bg', 'Summarize the README in one line.']);
  const id = await waitFor(() => jobIds(home)[0], 20_000, 50);
  const sup = await waitFor(() => processesFor(home).find((p) => p.cmd.includes('--internal-agent-view-supervisor')), 20_000, 50);
  await new Promise((r) => setTimeout(r, 1500));
  process.kill(sup.pid, 'SIGKILL');
  await launch.done;
  log.orphans = show();
  log.relaunch = bin(arm, home, ws, ['--bg', 'second prompt'], 90_000);
  log.afterRelaunch = show();
  log.psAfterRelaunch = bin(arm, home, ws, ['sessions', 'ps']).stdout.trim();
  log.orphanStateAfterRelaunch = readJson(path.join(home, 'jobs', id, 'state.json'))?.sessionState;
  log.stop = bin(arm, home, ws, ['sessions', 'stop', id], 90_000);
  await new Promise((r) => setTimeout(r, 3000));
  log.afterStop = show();
  await new Promise((r) => setTimeout(r, 12000));
  log.afterStop15s = show();
  await new Promise((r) => setTimeout(r, 20000));
  log.afterStop35s = show();
  log.workerJson = readJson(path.join(home, 'jobs', id, 'worker.json'));
  log.stateAfterStop = readJson(path.join(home, 'jobs', id, 'state.json'));
  log.psAfterStop = bin(arm, home, ws, ['sessions', 'ps']).stdout.trim();
} finally {
  log.killed = killFor(home);
  out(`${ROOT}/run/entry/recover-head.json`, log);
  console.log(JSON.stringify(log, null, 2));
}
