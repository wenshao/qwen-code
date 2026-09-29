// Fix #2 (repeated --bg is prompt data) and fix #3 (a dropped supervisor
// connection is reported as ambiguous), through the shipped bin.
//   node r9-04-entry.mjs prefix head
import fs from 'node:fs';
import path from 'node:path';
import { freshDir, out, ROOT } from './lib.mjs';
import {
  writeModelHome,
  bin,
  binAsync,
  killFor,
  processesFor,
  jobIds,
  readJson,
  waitFor,
} from './e2e-lib.mjs';

const results = [];
function rec(row) {
  results.push(row);
  console.log(JSON.stringify(row));
}

for (const arm of process.argv.slice(2)) {
  // --- fix #2: what prompt does `qwen --bg explain what --bg does` dispatch?
  for (const args of [
    ['--bg', 'explain', 'what', '--bg', 'does'],
    ['--bg', 'explain what --bg does'],
  ]) {
    const dir = freshDir('entry', arm, `repeat-${args.length}`);
    const home = path.join(dir, 'home');
    const ws = path.join(dir, 'ws');
    fs.mkdirSync(ws, { recursive: true });
    writeModelHome(home);
    try {
      const launch = binAsync(arm, home, ws, args);
      const id = await waitFor(() => jobIds(home)[0], 20_000, 50);
      const launchFile = await waitFor(
        () => (id ? readJson(path.join(home, 'jobs', id, 'launch.json')) : undefined),
        20_000,
        50,
      );
      rec({ part: 'repeat-bg', arm, argv: args.join(' '), dispatchedPrompt: launchFile?.initialPrompt });
      launch.child.kill('SIGKILL');
    } finally {
      killFor(home);
    }
  }

  // --- fix #3: the supervisor dies while the dispatch is waiting for ready.
  {
    const dir = freshDir('entry', arm, 'supervisor-killed');
    const home = path.join(dir, 'home');
    const ws = path.join(dir, 'ws');
    fs.mkdirSync(ws, { recursive: true });
    writeModelHome(home);
    try {
      const launch = binAsync(arm, home, ws, ['--bg', 'Summarize the README in one line.']);
      const id = await waitFor(() => jobIds(home)[0], 20_000, 50);
      const sup = await waitFor(
        () => processesFor(home).find((p) => p.cmd.includes('--internal-agent-view-supervisor')),
        20_000,
        50,
      );
      await new Promise((r) => setTimeout(r, 1500));
      process.kill(sup.pid, 'SIGKILL');
      const res = await launch.done;
      const psOut = bin(arm, home, ws, ['sessions', 'ps']);
      const state = readJson(path.join(home, 'jobs', id, 'state.json'));
      rec({
        part: 'supervisor-killed',
        arm,
        exit: res.code,
        ms: res.ms,
        stderr: res.stderr,
        storeState: state?.sessionState,
        psRow: psOut.stdout.split('\n').slice(1).join(' | ').replace(/\s+/g, ' ').trim(),
      });
    } finally {
      killFor(home);
    }
  }
}

// --- R14-2 (head only): a dash-leading word in an unquoted prompt.
for (const args of [
  ['--bg', 'tune', 'the', '-O2', 'flag'],
  ['--bg', '--', '-O2 tune the flag'],
]) {
  const dir = freshDir('entry', 'head', `dash-${args.length}`);
  const home = path.join(dir, 'home');
  const ws = path.join(dir, 'ws');
  fs.mkdirSync(ws, { recursive: true });
  writeModelHome(home);
  try {
    const launch = binAsync('head', home, ws, args);
    const id = await waitFor(() => jobIds(home)[0], 4_000, 50);
    let dispatched;
    if (id) {
      dispatched = (await waitFor(() => readJson(path.join(home, 'jobs', id, 'launch.json')), 10_000, 50))?.initialPrompt;
      launch.child.kill('SIGKILL');
    }
    const res = id ? { code: 'killed after dispatch' } : await launch.done;
    rec({ part: 'dash-token', arm: 'head', argv: args.join(' '), exit: res.code, stderr: res.stderr, dispatched });
  } finally {
    killFor(home);
  }
}
out(`${ROOT}/run/entry/results.json`, results);
