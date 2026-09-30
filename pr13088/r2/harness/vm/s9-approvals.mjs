// S9: tool approvals (D6a, from main) together with W1a's cold-load validation, on the rebased PR head.
// Does W1a's strict cold-load validation accept a Session whose history contains approval Actions?
import fs from 'node:fs';
import * as L from './lib.mjs';
L.openLog('s9-approvals');
const { say } = L;
say(L.hostFacts()); say(L.svc('status').replace(/\n/g, ' '));
L.seedWs('ws-a', 'a');
const rig = await L.startRig('s9-head', { dist: L.env().DIST });
let mark = 0; const since = () => { const s = L.ledgerStr(rig.proxy.ledger, mark); mark = rig.proxy.ledger.length; return s; };
const kinds = (sid) => L.sql(`SELECT kind, COUNT(*) FROM qwen_managed_session_resource WHERE session_id='${sid}' AND kind LIKE 'managed-action%' GROUP BY kind`).map((r) => `${r[0].replace('managed-', '')}×${r[1]}`).join(' ') || 'none';
const actions = (sid) => L.sql(`SELECT resource_id FROM qwen_managed_session_resource WHERE session_id='${sid}' AND kind='managed-action-options' ORDER BY created_at`).map((r) => r[0]);
const optionsOf = (sid, rid) => JSON.parse(Buffer.from(L.one(`SELECT HEX(inline_bytes) FROM qwen_managed_session_resource WHERE session_id='${sid}' AND resource_id='${rid}'`), 'hex').toString('utf8'));

async function create(mode) {
  const s = new L.HSession(rig.h, await L.createSession('ws-a'), 'ws-a');
  const r = await s.h.json('/session', { sessionId: s.sessionId, sessionScope: 'thread', managedSessionStore: s.connection, toolProfile: L.FILES, ...(mode ? { approvalMode: mode, approvalTimeoutMs: 600000 } : {}) });
  if (r.status === 200) s.clientId = r.json.clientId;
  say(`Session ${s.sessionId.slice(0, 8)} create (approvalMode=${mode ?? 'omitted'}): ${r.status} ${JSON.stringify(r.json).slice(0, 160)}`);
  return s;
}
// Submit a prompt that needs approval, answer it, wait for the Turn.
async function askedTurn(s, text, optionId) {
  const before = actions(s.sessionId).length;
  const sub = await s.submit(text);
  let rid; const t0 = Date.now();
  while (Date.now() - t0 < 30000) { const a = actions(s.sessionId); if (a.length > before) { rid = a.at(-1); break; } await L.sleep(200); }
  if (!rid) { say('   !! no Action was requested'); return null; }
  const opt = optionsOf(s.sessionId, rid);
  let res = '-';
  if (optionId) {
    const r = await s.h.json(`/session/${s.sessionId}/actions/${opt.requestId}/resolve`, { optionId, inputRevision: String(opt.inputRevision), policyRevision: opt.policyRevision }, { clientId: s.clientId });
    res = `${r.status} ${JSON.stringify(r.json).slice(0, 120)}`;
    if (r.status === 400) { const r2 = await s.h.json(`/session/${s.sessionId}/actions/${opt.requestId}/resolve`, { optionId, inputRevision: opt.inputRevision, policyRevision: opt.policyRevision }, { clientId: s.clientId }); res += ` | retry with a numeric inputRevision: ${r2.status} ${JSON.stringify(r2.json).slice(0, 120)}`; }
    let st; while (Date.now() - t0 < 60000) { st = await s.status(); if (st && !st.hasActivePrompt) break; await L.sleep(100); }
  }
  const term = (await s.transcript()).filter((e) => e.promptId === sub.promptId && e.type.startsWith('turn_')).map((e) => e.type).join(',') || '<still waiting>';
  say(`   Action ${opt.requestId.slice(0, 22)}… tool=${opt.toolName} -> resolve(${optionId ?? 'not answered'}): ${res}; Turn: ${term}`);
  return { opt, sub };
}

say('== 1. approvalMode=default: write_file asks, the answer is allow');
const A = await create('default');
await askedTurn(A, 'WRITE allowed.txt x', 'allow'); say('   broker:', since());
say(`   file written: ${fs.existsSync('/srv/w1a/a/project/allowed.txt')}; action resources: ${kinds(A.sessionId)}`);
say('== 2. same Session: the answer is deny');
await askedTurn(A, 'WRITE denied.txt x', 'deny'); say('   broker:', since());
say(`   file written: ${fs.existsSync('/srv/w1a/a/project/denied.txt')}; action resources: ${kinds(A.sessionId)}`);
say(`   detach=${(await A.detach()).status}`);
const m0 = rig.model.state.calls;
let l = await A.load(); say(`3. cold load without a profile (W1a validation over a history with decided Actions): ${l.status} ${JSON.stringify(l.json).slice(0, 200)} ${l.ms} ms; model +${rig.model.state.calls - m0}`);
if (l.status === 200) { await askedTurn(A, 'WRITE after-load.txt x', 'allow'); say(`   next Turn after the cold load: file written=${fs.existsSync('/srv/w1a/a/project/after-load.txt')}`); await A.detach(); }

say('== 4. every action resource unavailable in turn -> cold load must refuse');
for (const [rid, kind] of L.sql(`SELECT resource_id, kind FROM qwen_managed_session_resource WHERE session_id='${A.sessionId}' AND kind LIKE 'managed-action%' ORDER BY created_at`)) {
  L.sql(`UPDATE qwen_managed_session_resource SET resource_id=CONCAT(resource_id,'~gone') WHERE session_id='${A.sessionId}' AND resource_id='${rid}'`);
  const x = await A.load();
  say(`   ${kind.replace('managed-', '').padEnd(16)} ${rid.slice(0, 12)} unavailable -> load ${x.status} ${x.json?.code ?? ''}`);
  if (x.status === 200) await A.detach();
  L.sql(`UPDATE qwen_managed_session_resource SET resource_id='${rid}' WHERE session_id='${A.sessionId}' AND resource_id='${rid}~gone'`);
}
l = await A.load(); say(`   repaired: load ${l.status}`); if (l.status === 200) await A.detach();

say('== 5. an Action left unanswered when the Harness dies: the Session is not settled');
const P = await create('default');
await askedTurn(P, 'WRITE pending.txt x', null);
await rig.h.stop('SIGKILL');
rig.h = await new L.Harness({ name: 's9-head-2', modelUrl: rig.model.baseUrl, brokerUrl: rig.proxy.url, dist: L.env().DIST }).start(); P.bind(rig.h); A.bind(rig.h);
const t0 = Date.now(); let tries = 0;
for (;;) { l = await P.load(); tries += 1; if (l.status !== 503 || Date.now() - t0 > 100000) break; await L.sleep(3000); }
say(`   cold load in a new Harness: ${l.status} ${l.json?.code ?? ''} (after ${Math.round((Date.now() - t0) / 1000)} s, ${tries} attempts); file written: ${fs.existsSync('/srv/w1a/a/project/pending.txt')}`);

await rig.stop(); say('S9-DONE');
