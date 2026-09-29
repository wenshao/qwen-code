// R7-6 at runtime: poll GET /background-agents and `ps --json` while a
// real launch is inside its ready window.
import fs from 'node:fs';
import path from 'node:path';
import { freshDir, startDaemon, getAgents, out, ROOT } from './lib.mjs';
import { writeModelHome, binAsync, killFor, jobIds, readJson } from './e2e-lib.mjs';
const arm = process.argv[2] ?? 'head';
const dir = freshDir('launch-window', arm);
const home = path.join(dir, 'home');
const ws = path.join(dir, 'ws');
fs.mkdirSync(ws, { recursive: true });
writeModelHome(home);
const samples = [];
let daemon;
try {
  daemon = await startDaemon(arm, home, ws);
  for (let i = 0; i < 5; i++) await getAgents(daemon);
  const t0 = Date.now();
  const launch = binAsync(arm, home, ws, ['--bg', 'Summarize the README in one line.']);
  let done = false;
  launch.done.then(() => (done = true));
  while (!done || Date.now() - t0 < 17_000) {
    const r = await getAgents(daemon);
    const a = r.body.agents?.[0];
    const id = jobIds(home)[0];
    const st = id ? readJson(path.join(home, 'jobs', id, 'state.json')) : undefined;
    samples.push({ t: Date.now() - t0, route: a ? `${a.taskState}${a.pid ? '+pid' : ''}` : `${r.status}:none`, store: st ? `${st.sessionState}/${st.processState}` : '-' });
    if (Date.now() - t0 > 20_000) break;
    await new Promise((r2) => setTimeout(r2, Date.now() - t0 < 2000 ? 5 : 200));
  }
  const res = await launch.done;
  // Collapse consecutive identical samples into spans.
  const spans = [];
  for (const s of samples) {
    const last = spans.at(-1);
    if (last && last.route === s.route && last.store === s.store) last.to = s.t;
    else spans.push({ from: s.t, to: s.t, route: s.route, store: s.store });
  }
  out(`${ROOT}/run/launch-window/${arm}.json`, { spans, launch: { code: res.code, ms: res.ms, stderr: res.stderr } });
  for (const s of spans) console.log(`${String(s.from).padStart(6)}–${String(s.to).padEnd(6)} ms  route=${s.route.padEnd(14)} store=${s.store}`);
  console.log('launch:', res.code, res.ms, res.stderr);
} finally {
  daemon?.stop();
  killFor(home);
}
