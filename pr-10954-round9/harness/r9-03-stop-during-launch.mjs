// Fix #1 (R13-1): `sessions stop` / `sessions peek` issued while a launch
// holds the per-session host-setup lock. Under N1 every launch holds it for
// the full 15 s ready budget, so this needs no fake supervisor.
//   node r9-03-stop-during-launch.mjs prefix head
import fs from 'node:fs';
import path from 'node:path';
import { freshDir, out, ROOT } from './lib.mjs';
import { writeModelHome, bin, binAsync, killFor, jobIds, readJson, waitFor } from './e2e-lib.mjs';

const results = [];
for (const arm of process.argv.slice(2)) {
  for (const op of ['stop', 'peek']) {
    const dir = freshDir('stop-during-launch', arm, op);
    const home = path.join(dir, 'home');
    const ws = path.join(dir, 'ws');
    fs.mkdirSync(ws, { recursive: true });
    writeModelHome(home);
    try {
      const launch = binAsync(arm, home, ws, ['--bg', 'Summarize the README in one line.']);
      const id = await waitFor(() => jobIds(home)[0], 20_000, 50);
      const t = Date.now();
      await new Promise((r) => setTimeout(r, 1000));
      const cmd = bin(arm, home, ws, ['sessions', op, id], 90_000);
      const launched = await launch.done;
      // Give a server-side stop that outlived its client a moment to land.
      await new Promise((r) => setTimeout(r, 2000));
      const state = readJson(path.join(home, 'jobs', id, 'state.json'));
      const row = {
        arm,
        op,
        cmd: { code: cmd.code, ms: cmd.ms, stdout: cmd.stdout.trim().slice(0, 200), stderr: cmd.stderr.slice(0, 200) },
        issuedAfterLaunchMs: Date.now() - t - cmd.ms,
        launch: { code: launched.code, ms: launched.ms, stderr: launched.stderr.slice(0, 160) },
        finalState: { sessionState: state?.sessionState, processState: state?.processState, lastError: state?.lastError?.code },
      };
      results.push(row);
      console.log(JSON.stringify(row));
    } finally {
      killFor(home);
    }
  }
}
out(`${ROOT}/run/stop-during-launch/results.json`, results);
