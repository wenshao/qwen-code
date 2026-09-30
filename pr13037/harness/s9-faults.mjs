// s9: object-store faults and a server crash during projection.
// usage: DB=o3b node s9-faults.mjs
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import * as L from './lib.mjs';
L.openLog('s9-faults');
const shell = (n, label, cmd) => { L.register(`ws-s9-${n}`, `st-s${n}`); return L.createShellSession(`ws-s9-${n}`, L.shellPrompt(label, cmd)); };
const row = (s) => L.resultRows(s)[0];
const resultEvents = async (s) => (await L.events(s)).filter((e) => e.type === 'item.tool_result.updated').length;
const itemsOf = async (s) => ((await L.api('GET', `/v1/agents/sessions/${s}/items`)).json.data ?? []).map((i) => `${i.type}/${i.role}`);
async function armAfterReceipt(session, fault) {
  for (let i = 0; i < 3000; i++) {
    if (L.one(`SELECT COUNT(*) FROM qwen_tool_publication WHERE session_id='${session}' AND producer_phase='REFERENCED'`) === '1') break;
  }
  await L.oss('/fault', fault);
}
async function until(fn, timeoutMs, stepMs = 200) { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return { v, ms: Date.now() - t0 }; if (Date.now() - t0 > timeoutMs) return { v: null, ms: Date.now() - t0, timeout: true }; await L.sleep(stepMs); } }

L.register('ws-s9-plainb', 'st-s46');
async function plainTurn(tag) {
  const t0 = Date.now();
  const s = await L.createShellSession('ws-s9-plainb', `hello ${tag}, no tools please`);
  const turn = await L.waitTurn(s);
  const items = await until(async () => (await itemsOf(s)).includes('message/assistant'), 60000);
  return { turn: turn.status, turnMs: turn.ms, assistantItemVisibleMs: Date.now() - t0, itemsTimeout: items.timeout ?? false };
}
L.say('baseline plain Turn', await plainTurn('baseline'));

// --- 1. object store returns 500 while the projector reads
L.say('step', '1. object GETs fail (500) during projection');
const a = await shell(51, 'Fault A', 'echo fault-a-out; echo fault-a-err >&2');
await armAfterReceipt(a, { op: 'get', mode: '500', count: 200 });
const ta = await L.waitTurn(a);
const seen = [];
for (let i = 0; i < 12; i++) { await L.sleep(1500); const r = row(a); seen.push(`${r.state}${r.failure ? '/' + r.failure : ''}#${r.attempts}`); }
L.say('while failing', { turn: ta.status, states: [...new Set(seen)], resultEvents: await resultEvents(a) });
await L.oss('/clear-faults', {});
const ra = await until(() => (row(a).state === 'READY' ? row(a) : null), 120000, 500);
L.say('after the store recovers', { state: ra.v?.state, attempts: ra.v?.attempts, waitedMs: ra.ms, resultEvents: await resultEvents(a), artifacts: +L.one(`SELECT COUNT(*) FROM managed_agent_artifact a JOIN managed_agent_tool_result r ON r.result_id=a.result_id WHERE r.session_id='${a}'`) });

// --- 2. one object GET stalls for 25 s inside the projector
L.say('step', '2. one object GET stalls 25 s inside the projector; other Sessions meanwhile');
const b = await shell(48, 'Fault B (stalled projection)', 'echo fault-b');
await armAfterReceipt(b, { op: 'get', mode: 'delay', ms: 25000, count: 1 });
await L.waitTurn(b);
await until(() => row(b)?.state === 'LEASED', 10000, 100);
const tStall = Date.now();
const other = await plainTurn('during-stall');
const c0 = Date.now();
const c = await shell(49, 'Fault C (another Session)', 'echo fault-c');
await L.waitTurn(c);
const rc = await until(() => (row(c)?.state === 'READY' ? true : null), 90000, 200);
const cReadyMs = Date.now() - c0;
const rb = await until(() => (row(b)?.state === 'READY' ? true : null), 90000, 200);
L.say('plain Turn in another Session during the stall', other);
L.say('another Shell result (Session C) created during the stall', { readyMsAfterCreate: cReadyMs });
L.say('stalled result (Session B)', { readyMsAfterStallBegan: Date.now() - tStall, faultsLeft: (await L.oss('/state')).faults.filter((f) => f.count > 0).length });
await L.oss('/clear-faults', {});

// --- 3. SIGKILL the server while a projection is inside an object read
L.say('step', '3. server killed while a claimed projection waits on the object store');
const d = await shell(50, 'Fault D (crash during projection)', 'echo fault-d-out; echo fault-d-err >&2');
await armAfterReceipt(d, { op: 'get', mode: 'delay', ms: 60000, count: 1 });
await L.waitTurn(d);
await until(() => row(d)?.state === 'LEASED', 10000, 100);
const before = row(d);
const pid = Number(fs.readFileSync(`${L.R}/run/spring.pid`, 'utf8'));
process.kill(pid, 'SIGKILL');
const tKill = Date.now();
L.say('killed', { state: before.state, generation: before.generation, claimUntilInMs: +L.one(`SELECT claim_until - UNIX_TIMESTAMP(NOW(3))*1000 FROM managed_agent_tool_result WHERE session_id='${d}'`) });
await L.oss('/clear-faults', {});
execFileSync(`${L.R}/restart.sh`, ['pr', L.DB], { env: { ...process.env, ARTIFACTS: 'true', PUB_ORIGINAL: 'true', PUB_PREVIEW: 'true' }, stdio: 'ignore' });
const tUp = Date.now();
L.say('restarted', { msAfterKill: tUp - tKill, rowNow: `${row(d).state}#${row(d).attempts}` });
const rd = await until(() => (row(d).state === 'READY' ? row(d) : null), 120000, 500);
L.say('after restart', { state: rd.v?.state, attempts: rd.v?.attempts, generation: rd.v?.generation, readyMsAfterKill: Date.now() - tKill, resultEvents: await resultEvents(d), artifacts: +L.one(`SELECT COUNT(*) FROM managed_agent_artifact a JOIN managed_agent_tool_result r ON r.result_id=a.result_id WHERE r.session_id='${d}'`) });
const art = (await L.api('GET', `/v1/agents/sessions/${d}/artifacts`)).json.data.map((e) => e.artifact);
for (const x of art) { const f = await L.content(d, x.id, { revision: x.revision }); L.say('bytes', `${x.stream_role} ${f.status} ${JSON.stringify(f.body.toString())}`); }
