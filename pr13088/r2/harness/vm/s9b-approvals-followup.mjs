// S9b (trial merge bundle): (i) a Session created by the PR-head bundle continues in the merged bundle;
// (ii) what a live pending approval does to another Session of the same Workspace storage (main's D6a behaviour, for context).
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import * as L from './lib.mjs';
L.openLog('s9b-approvals-followup');
const { say } = L;
L.seedWs('ws-b', 'b'); L.seedWs('ws-c', 'c');
L.svc('stop');
for (const s of 'bc') L.sayMaint(`s9b-register-${s}`, L.maint(['register', L.TENANT, `st-${s}`, `/srv/w1a/${s}`, randomUUID(), '--offline-confirmed']));
say('  ', L.svc('start').split(' ===')[0]);
const rig = await L.startRig('s9b-head', { dist: L.env().DIST });
let mark = 0; const since = () => { const s = L.ledgerStr(rig.proxy.ledger, mark); mark = rig.proxy.ledger.length; return s; };
say('== (i) Session created and used by the first-round bundle (04048333, before tool approvals existed), then cold-loaded by the rebased head');
const old = await new L.Harness({ name: 's9b-old', modelUrl: rig.model.baseUrl, brokerUrl: rig.proxy.url, dist: 'dist-old-head' }).start();
const O = new L.HSession(old, await L.createSession('ws-c'), 'ws-c'); await O.create(L.FILES);
let r = await O.prompt('WRITE from-head.txt x'); say('   Turn in the 04048333 Harness:', L.turnStr(r).slice(0, 70)); say('   broker:', since()); await O.detach(); await old.stop();
O.bind(rig.h); let l = await O.load(); say(`   cold load in the 7c54aa78 Harness (no profile): ${l.status} approvalMode=${l.json?.approvalMode ?? '<absent>'}`);
r = await O.prompt('WRITE from-merge.txt x'); say('   next Turn in the 7c54aa78 Harness:', L.turnStr(r).slice(0, 70)); say('   broker:', since());
say(`   files: ${fs.readdirSync('/srv/w1a/c/project').join(' ')}`); await O.detach();

say('== (ii) live pending approval (approvalMode=default) and a second Session on the same Workspace');
const mk = async (mode) => { const s = new L.HSession(rig.h, await L.createSession('ws-b'), 'ws-b');
  const c = await s.h.json('/session', { sessionId: s.sessionId, sessionScope: 'thread', managedSessionStore: s.connection, toolProfile: L.FILES, ...(mode ? { approvalMode: mode, approvalTimeoutMs: 600000 } : {}) });
  s.clientId = c.json.clientId; return s; };
const P = await mk('default'); const Q = await mk();
const holder = () => { const m = L.mountRow('b'); return m?.holder === '-' ? 'none' : `held (${m?.holder.slice(0, 10)}…)`; };
mark = rig.proxy.ledger.length;
const sub = await P.submit('WRITE needs-approval.txt x');
let rid; for (let i = 0; i < 100 && !rid; i++) { rid = L.one(`SELECT resource_id FROM qwen_managed_session_resource WHERE session_id='${P.sessionId}' AND kind='managed-action-options'`); if (!rid) await L.sleep(200); }
const opt = JSON.parse(Buffer.from(L.one(`SELECT HEX(inline_bytes) FROM qwen_managed_session_resource WHERE session_id='${P.sessionId}' AND resource_id='${rid}'`), 'hex').toString('utf8'));
say(`   P is waiting for an answer (expires in ${Math.round((opt.expiresAt - Date.now()) / 1000)} s); Broker calls so far: ${since()}; storage holder: ${holder()}`);
r = await Q.prompt('WRITE other-session.txt x', 30000); say('   Q (another Session, same Workspace) tool Turn while P waits:', L.turnStr(r).slice(0, 60)); say('   broker:', since());
const a = await P.h.json(`/session/${P.sessionId}/actions/${opt.requestId}/resolve`, { optionId: 'allow', inputRevision: opt.inputRevision, policyRevision: opt.policyRevision }, { clientId: P.clientId });
let st; for (let i = 0; i < 200; i++) { st = await P.status(); if (st && !st.hasActivePrompt) break; await L.sleep(100); }
say(`   P answered allow: ${a.status}; P Turn: ${(await P.transcript()).filter((e) => e.promptId === sub.promptId && e.type.startsWith('turn_')).map((e) => e.type).join(',')}; broker: ${since()}; holder: ${holder()}`);
r = await Q.prompt('WRITE other-session-2.txt x', 30000); say('   Q tool Turn after P finished:', L.turnStr(r).slice(0, 60));
await P.detach(); await Q.detach(); await rig.stop(); say('S9B-DONE');
