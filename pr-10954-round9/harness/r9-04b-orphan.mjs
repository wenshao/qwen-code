// After the supervisor is SIGKILLed mid-dispatch: what is left running, and
// does following the new message's advice (`qwen sessions ps`, then stop) clean it up?
import fs from 'node:fs';
import path from 'node:path';
import { freshDir, out, ROOT } from './lib.mjs';
import { writeModelHome, bin, binAsync, killFor, processesFor, jobIds, readJson, waitFor } from './e2e-lib.mjs';
const arm = process.argv[2] ?? 'head';
const dir = freshDir('entry', arm, 'orphan');
const home = path.join(dir, 'home');
const ws = path.join(dir, 'ws');
fs.mkdirSync(ws, { recursive: true });
writeModelHome(home);
const log = {};
try {
  const launch = binAsync(arm, home, ws, ['--bg', 'Summarize the README in one line.']);
  const id = await waitFor(() => jobIds(home)[0], 20_000, 50);
  const sup = await waitFor(() => processesFor(home).find((p) => p.cmd.includes('--internal-agent-view-supervisor')), 20_000, 50);
  await new Promise((r) => setTimeout(r, 1500));
  process.kill(sup.pid, 'SIGKILL');
  log.launch = await launch.done;
  const show = () => processesFor(home).map((p) => `${p.pid} ${p.cmd.slice(1).join(' ').slice(0, 90)}`);
  log.afterKill = show();
  await new Promise((r) => setTimeout(r, 30_000));
  log.after30s = show();
  log.ps30s = bin(arm, home, ws, ['sessions', 'ps']).stdout.trim();
  log.state30s = readJson(path.join(home, 'jobs', id, 'state.json'))?.sessionState;
  log.stop = bin(arm, home, ws, ['sessions', 'stop', id], 90_000);
  await new Promise((r) => setTimeout(r, 3000));
  log.afterStop = show();
  log.psAfterStop = bin(arm, home, ws, ['sessions', 'ps']).stdout.trim();
} finally {
  log.killed = killFor(home);
  out(`${ROOT}/run/entry/orphan-${arm}.json`, log);
  console.log(JSON.stringify(log, null, 2));
}
