// s6: reads after the Hosted Harness and every Runtime worker are gone.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import * as L from './lib.mjs';
L.openLog('s6-gone');
const s1 = JSON.parse(fs.readFileSync(`${L.R}/out/s1a.json`, 'utf8'));
const s4 = JSON.parse(fs.readFileSync(`${L.R}/out/s4.json`, 'utf8'));
const spring = Number(fs.readFileSync(`${L.R}/run/spring.pid`, 'utf8'));
const harness = Number(fs.readFileSync(`${L.R}/run/harness.pid`, 'utf8'));
const children = (pid) => execFileSync('/bin/bash', ['-c', `pgrep -P ${pid} || true`], { encoding: 'utf8' }).trim().split('\n').filter(Boolean).map(Number);
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const workers = children(spring);
L.say('before', { harnessAlive: alive(harness), workersUnderSpring: workers.length });
for (const p of [...children(harness), harness, ...workers]) { try { process.kill(p, 'SIGKILL'); } catch {} }
await L.sleep(1500);
L.say('killed', { harnessAlive: alive(harness), workersUnderSpring: children(spring).length, harnessPort: await fetch('http://127.0.0.1:17037/capabilities').then((r) => r.status).catch((e) => 'connection refused') });
const tap0 = L.tapEntries().length, model0 = L.modelRequests().length;
const launches0 = fs.readFileSync(`${L.R}/run/launches-${L.DB}.log`, 'utf8').split('\n').length;
const rows = [];
for (const [name, session] of [['ok', s1.find((r) => r.case === 'ok').session], ['multi 40 MiB', s1.find((r) => r.case === 'multi').session], ['log100 99 MiB', s4.find((r) => r.case === 'log100').session]]) {
  const head0 = L.sql(`SELECT journal_revision, writer_generation FROM qwen_managed_session_journal_head WHERE session_id='${session}'`)[0];
  const item = L.one(`SELECT item_id FROM managed_agent_tool_result WHERE session_id='${session}'`);
  const res = await L.api('POST', '/api/agent/web-shell/v1/tool-results/get', { sessionId: session, itemId: item });
  const out = { name, result: res.status, exec: res.json.result?.execution_status, arts: [] };
  for (const a of res.json.result?.artifacts ?? []) {
    const full = await L.content(session, a.id, { revision: a.revision, ifMatch: `"${a.sha256}"` });
    out.arts.push(`${a.stream_role} ${full.status} ${full.body.length}B exact=${L.sha256(full.body) === a.sha256}`);
  }
  const head1 = L.sql(`SELECT journal_revision, writer_generation FROM qwen_managed_session_journal_head WHERE session_id='${session}'`)[0];
  out.journalRevision = `${head0[0]} -> ${head1[0]}`;
  out.writerGeneration = `${head0[1]} -> ${head1[1]}`;
  rows.push(out);
  L.say('read', out);
}
L.say('side effects of the reads', { harnessRequestsViaTap: L.tapEntries().length - tap0, modelRequests: L.modelRequests().length - model0, workerLaunches: fs.readFileSync(`${L.R}/run/launches-${L.DB}.log`, 'utf8').split('\n').length - launches0, workersUnderSpring: children(spring).length });
const lease = L.sql(`SELECT state, writer_lease_until < NOW(6) FROM qwen_managed_session_journal_head WHERE session_id='${s1.find((r) => r.case === 'ok').session}'`)[0];
L.say('writer of session "ok"', { state: lease[0], leaseExpired: lease[1] === '1' });
