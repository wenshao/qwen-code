// Where does a launching agent's pid come from: worker.json or the registry?
import fs from 'node:fs';
import path from 'node:path';
import { freshDir, out, ROOT } from './lib.mjs';
import { writeModelHome, binAsync, killFor, jobIds, readJson, processesFor } from './e2e-lib.mjs';
const arm = 'head';
const dir = freshDir('pid-source', arm);
const home = path.join(dir, 'home');
const ws = path.join(dir, 'ws');
fs.mkdirSync(ws, { recursive: true });
writeModelHome(home);
const samples = [];
try {
  const t0 = Date.now();
  const launch = binAsync(arm, home, ws, ['--bg', 'Summarize the README in one line.']);
  let done = false;
  launch.done.then(() => (done = true));
  while (!done) {
    const id = jobIds(home)[0];
    const w = id ? readJson(path.join(home, 'jobs', id, 'worker.json')) : undefined;
    let reg = [];
    try { reg = fs.readdirSync(path.join(home, 'sessions')).filter((n) => n.endsWith('.json')); } catch {}
    const regRecs = reg.map((n) => readJson(path.join(home, 'sessions', n))).filter(Boolean).filter((r) => r.sessionId === id);
    samples.push({ t: Date.now() - t0, worker: w ? `host=${w.hostPid ?? '-'} worker=${w.workerPid ?? '-'}` : 'no file', registry: regRecs.length ? regRecs.map((r) => `pid=${r.pid} kind=${r.kind}`).join(',') : 'none' });
    await new Promise((r) => setTimeout(r, 20));
  }
  const spans = [];
  for (const s of samples) {
    const last = spans.at(-1);
    if (last && last.worker === s.worker && last.registry === s.registry) last.to = s.t;
    else spans.push({ from: s.t, to: s.t, worker: s.worker, registry: s.registry });
  }
  out(`${ROOT}/run/pid-source/head.json`, spans);
  for (const s of spans) console.log(`${String(s.from).padStart(6)}–${String(s.to).padEnd(6)} ms  worker.json: ${s.worker.padEnd(26)} registry: ${s.registry}`);
  console.log('procs:', processesFor(home).map((p) => `${p.pid} ${p.cmd.slice(1, 2).join(' ')}`).join(' | '));
} finally {
  killFor(home);
}
