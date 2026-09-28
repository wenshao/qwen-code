import fs from 'node:fs';
import path from 'node:path';
import { SP, Daemon, prepareHome, modeOf, findJsonl, approvalRecords, sleep } from './lib.mjs';
const arm = process.argv[2]; const fakePort = 18918;
const root = path.join(SP, 'runs', `probe2-${arm}`);
fs.rmSync(root, { recursive: true, force: true });
const ws = path.join(root, 'ws');
const { home, qwenHome } = prepareHome({ root, ws, fakePort });
const d = new Daemon({ wt: path.join(SP, `wt-${arm}`), home, qwenHome, ws, fakePort, logFile: path.join(root, 'daemon.log') });
const R = {};
const out = (k, v) => { R[k] = v; console.log(`[${arm}] ${k} = ${JSON.stringify(v)}`); };
await d.start();
try {
  // (a) Web Shell path: approvalMode in create request, then first prompt
  const s = await d.createSession({ approvalMode: 'yolo' });
  const sub = d.subscribe(s.sessionId, s.clientId); await sub.ready;
  const p = await d.prompt(s.sessionId, 'first prompt', s.clientId);
  await sub.waitFor((e) => e.type === 'turn_complete' && e.promptId === p.json.promptId, 30000);
  await sleep(200);
  out('a.records', approvalRecords(findJsonl(qwenHome, s.sessionId)));
  sub.close();
  await d.detach(s.sessionId, s.clientId); await d.waitClosed(s.sessionId);
  const l = await d.load(s.sessionId);
  out('a.createWithYolo.coldLoad', modeOf(l.json));
  await d.detach(s.sessionId, l.json.clientId);
  // (b) create with approvalMode but never prompt
  const s2 = await d.createSession({ approvalMode: 'yolo' });
  await sleep(300);
  out('b.createWithYoloNoPrompt.jsonl', findJsonl(qwenHome, s2.sessionId) ?? null);
  await d.detach(s2.sessionId, s2.clientId); await d.waitClosed(s2.sessionId);
  // (c) degraded event on write failure
  const w = await d.createSession();
  const wsub = d.subscribe(w.sessionId, w.clientId); await wsub.ready;
  const wp = await d.prompt(w.sessionId, 'w first', w.clientId);
  await wsub.waitFor((e) => e.type === 'turn_complete' && e.promptId === wp.json.promptId, 30000);
  const wf = findJsonl(qwenHome, w.sessionId);
  fs.chmodSync(wf, 0o444);
  const before = wsub.events.length;
  const m = await d.setMode(w.sessionId, 'yolo', {}, w.clientId);
  await sleep(1000);
  fs.chmodSync(wf, 0o644);
  out('c.setMode', { status: m.status, persisted: m.json?.persisted });
  out('c.eventsAfterModeChange', wsub.events.slice(before).map((e) => e.type));
  const st = await d.status(w.sessionId);
  out('c.status.recordingDegraded', st.json?.recordingDegraded ?? null);
  const logs = fs.readFileSync(path.join(root, 'daemon.log'), 'utf8').split('\n').filter((x) => /degrad|record_failed|EACCES|session_approval_mode/i.test(x)).slice(0, 6);
  out('c.daemonLog', logs);
  wsub.close();
} finally { await d.stop(); fs.writeFileSync(path.join(root, 'results.json'), JSON.stringify(R, null, 2)); }
