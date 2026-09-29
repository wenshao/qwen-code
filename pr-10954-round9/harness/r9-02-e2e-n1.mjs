// N1 on Linux, through the shipped bin, real daemon, real model settings.
// Follows the PR's own Reviewer Test Plan steps 1–4.
//   node r9-02-e2e-n1.mjs head
import fs from 'node:fs';
import path from 'node:path';
import { freshDir, startDaemon, getAgents, out, ROOT } from './lib.mjs';
import { writeModelHome, bin, killFor, processesFor, jobIds, readJson } from './e2e-lib.mjs';

const arm = process.argv[2] ?? 'head';
const dir = freshDir('e2e-n1', arm);
const home = path.join(dir, 'home');
const ws = path.join(dir, 'ws');
fs.mkdirSync(ws, { recursive: true });
writeModelHome(home);
const log = [];
const note = (k, v) => {
  log.push({ k, v });
  console.log(`## ${k}\n${typeof v === 'string' ? v : JSON.stringify(v, null, 2)}`);
};

let daemon;
try {
  // Positive control: the same home answers a real model prompt.
  const ctl = bin(arm, home, ws, ['-p', 'Reply with exactly the word PONG and nothing else.'], 180_000);
  note('control: qwen -p (qwen3.8-max)', { code: ctl.code, ms: ctl.ms, stdout: ctl.stdout.trim(), stderr: ctl.stderr.slice(0, 400) });

  // Step 1: qwen serve in one terminal (through the bin).
  daemon = await startDaemon(arm, home, ws);
  note('step1: serve', daemon.base);

  // Step 1b: qwen --bg in another.
  const bg = bin(arm, home, ws, ['--bg', 'Reply with exactly the word PONG and nothing else.'], 120_000);
  note('step1b: qwen --bg', { code: bg.code, ms: bg.ms, stdout: bg.stdout.trim(), stderr: bg.stderr });

  const ids = jobIds(home);
  const id = ids[0];
  note('store: jobs/', ids);
  if (id) {
    const state = readJson(path.join(home, 'jobs', id, 'state.json'));
    const launch = readJson(path.join(home, 'jobs', id, 'launch.json'));
    const worker = readJson(path.join(home, 'jobs', id, 'worker.json'));
    note('store: state.json', { sessionState: state?.sessionState, processState: state?.processState, lastError: state?.lastError });
    note('store: launch.json worker argv / initialPrompt', { argv: launch?.argv, initialPrompt: launch?.initialPrompt });
    note('store: worker.json pids', { hostPid: worker?.hostPid, workerPid: worker?.workerPid });
  }

  // Step 2/3: the route.
  const route = await getAgents(daemon);
  note('step2: GET /background-agents', route);

  const psT = bin(arm, home, ws, ['sessions', 'ps']);
  note('qwen sessions ps', { code: psT.code, stdout: psT.stdout.trimEnd(), stderr: psT.stderr });
  const psJ = bin(arm, home, ws, ['sessions', 'ps', '--json']);
  note('qwen sessions ps --json', { code: psJ.code, stdout: psJ.stdout.trimEnd() });

  // Step 4: stop, then the route again.
  if (id) {
    const stop = bin(arm, home, ws, ['sessions', 'stop', id]);
    note('step4: qwen sessions stop', { code: stop.code, ms: stop.ms, stdout: stop.stdout.trim(), stderr: stop.stderr });
    note('step4: route after stop', await getAgents(daemon));
  }
  note('processes left for this QWEN_HOME', processesFor(home).map((p) => `${p.pid} ${p.cmd.slice(1, 3).join(' ')}`));
} finally {
  daemon?.stop();
  note('killed', killFor(home));
  out(`${ROOT}/run/e2e-n1/${arm}.json`, log);
}
