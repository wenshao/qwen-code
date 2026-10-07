// PR #13260 S15 (R1-3 at 5120e58a): what every public and WebShell write route actually returns while a REAL `retire` holds the
// storage fence, Spring and a Harness still admitting (the operator mistake the fence exists for). Full envelopes are saved and
// validated on the host against the shipped OpenAPI ErrorEnvelope. st-b (never fenced) gives positive controls for the formats.
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import * as L from './lib.mjs';
import * as W from './w1bc.mjs';
import * as P from './pop.mjs';
import * as M from './w1c.mjs';
const TAG = process.env.TAG ?? 's15';
L.openLog(`s15-${TAG}`);
const { say } = L;
const R = { tag: TAG, server: L.env().JAR, dist: L.env().DIST, calls: [] };
say(L.hostFacts()); say(`   server ${L.env().JAR} dist ${L.env().DIST} | migration jar ${M.MIG_JAR}`);
await P.rollout(['a', 'b']);
L.seedWs('ws-a1', 'a'); L.seedWs('ws-b1', 'b'); fs.mkdirSync('/srv/w1c-src/a/project/sub', { recursive: true }); fs.mkdirSync('/srv/w1c-src/b/project/sub', { recursive: true });
const rig = await L.startRig(`s15-${TAG}`);
const mk = async (name, ws) => { const s = new L.HSession(rig.h, await L.createSession(ws), ws); const c = await s.create(L.FILES); const t = await s.prompt(`WRITE ${name}.txt one`); const t2 = await s.prompt(`WRITE ${name}.txt two`); say(`   ${name} ${s.sessionId.slice(0, 8)} create=${c.status} ${P.term(t)} ${P.term(t2)}`); await s.detach(); return s; };
const A1 = await mk('A1', 'ws-a1'); const C1 = await mk('C1', 'ws-a1'); const R1 = await mk('R1', 'ws-a1'); const B1 = await mk('B1', 'ws-b1');
say(`   C1 ${await P.lifecycle(C1.sessionId, 'close')} | R1 ${await P.lifecycle(R1.sessionId, 'close')} + ${await P.lifecycle(R1.sessionId, 'archive')}`);
await rig.h.stop(); await W.waitLeasesExpired('a');
if (!fs.statSync(W.historyRoot(), { throwIfNoEntry: false })?.isDirectory()) { say('ABORT: no history root directory'); process.exit(3); }
L.sh(`touch -d '+1 second' ${W.historyRoot()}`);  // N1
const req = M.migrationRequest({ revision: L.mountRow('a').revision, storage: 'a', source: '/srv/w1c-src/a', target: '/srv/w1c-dst/a', bundle: `/srv/w1c-bundles/${TAG}-a` });
const rt = await M.mig('retire', M.writeRequest(req, `${TAG}-a`), { label: `${TAG}-retire` });
if (rt.code !== 0 || !M.fenceRow('a')) { say('ABORT: retire did not install the fence'); process.exit(3); }
await rig.restartHarness(`s15-${TAG}-fenced`);  // a Harness is reachable again while the fence is up
const rev = (sid) => Number(L.one(`SELECT context_revision FROM managed_agent_session WHERE session_id='${sid}'`));
const counts = () => ({ sessions: Number(L.one(`SELECT COUNT(*) FROM managed_agent_session WHERE tenant_id='${L.TENANT}' AND workspace_storage_id='st-a'`)),
  operations: Number(L.one(`SELECT COUNT(*) FROM managed_agent_operation o JOIN managed_agent_session s ON s.tenant_id=o.tenant_id AND s.session_id=o.session_id WHERE s.workspace_storage_id='st-a'`)),
  statuses: L.sql(`SELECT status, COUNT(*) FROM managed_agent_session WHERE tenant_id='${L.TENANT}' AND workspace_storage_id='st-a' GROUP BY status ORDER BY status`).map((r) => `${r[0]}×${r[1]}`).join(' ') });
const WS = '/api/agent/web-shell/v1';
const text = (t) => [{ type: 'input_text', text: t }];
async function call(storage, route, method, path, body, { key = true } = {}) {
  const before = counts();
  const r = await L.api(method, path, body, key ? { key: randomUUID() } : {});
  const after = counts();
  const e = { storage, route, method, path: path.replace(/[0-9a-f-]{36}/g, '{id}'), status: r.status, body: r.json, sideEffects: JSON.stringify(before) === JSON.stringify(after) ? 'none' : `${JSON.stringify(before)} → ${JSON.stringify(after)}` };
  R.calls.push(e);
  say(`   ${storage} ${route.padEnd(26)} ${r.status} ${r.json?.error ? `${r.json.error.code} retryable=${r.json.error.retryable}` : JSON.stringify(r.json).slice(0, 70)} | st-a side effects: ${e.sideEffects}`);
  return r;
}
say('== st-a fenced: public routes');
await call('st-a', 'public create', 'POST', '/v1/agents/sessions', { agent_id: 'qwen-code', workspace: { workspace_id: 'ws-a1', cwd_relative: 'project' } });
await call('st-a', 'public cwd', 'POST', `/v1/agents/sessions/${A1.sessionId}/cwd`, { cwd_relative: 'project/sub', expected_context_revision: rev(A1.sessionId) });
await call('st-a', 'public events (turn)', 'POST', `/v1/agents/sessions/${A1.sessionId}/events`, { type: 'agent.session.input.message', input: text('WRITE fenced.txt public') });
await call('st-a', 'public patch title', 'PATCH', `/v1/agents/sessions/${A1.sessionId}`, { title: 'fenced title' });
await call('st-a', 'public close', 'POST', `/v1/agents/sessions/${A1.sessionId}/close`);
await call('st-a', 'public archive', 'POST', `/v1/agents/sessions/${C1.sessionId}/archive`);
await call('st-a', 'public unarchive', 'POST', `/v1/agents/sessions/${R1.sessionId}/unarchive`);
await call('st-a', 'public delete', 'DELETE', `/v1/agents/sessions/${C1.sessionId}`);
say('== st-a fenced: WebShell routes');
await call('st-a', 'webshell create', 'POST', `${WS}/sessions/create`, { agentId: 'qwen-code', idempotencyKey: randomUUID(), input: [], workspace: { workspaceId: 'ws-a1' } }, { key: false });
await call('st-a', 'webshell turns/submit', 'POST', `${WS}/turns/submit`, { idempotencyKey: randomUUID(), sessionId: A1.sessionId, input: text('WRITE fenced.txt webshell') }, { key: false });
await call('st-a', 'webshell cwd/change', 'POST', `${WS}/sessions/cwd/change`, { sessionId: A1.sessionId, idempotencyKey: randomUUID(), cwdRelative: 'project/sub', expectedContextRevision: rev(A1.sessionId) }, { key: false });
await call('st-a', 'webshell close', 'POST', `${WS}/sessions/close`, { sessionId: A1.sessionId, idempotencyKey: randomUUID() }, { key: false });
await call('st-a', 'webshell archive', 'POST', `${WS}/sessions/archive`, { sessionId: C1.sessionId, idempotencyKey: randomUUID() }, { key: false });
await call('st-a', 'webshell unarchive', 'POST', `${WS}/sessions/unarchive`, { sessionId: R1.sessionId, idempotencyKey: randomUUID() }, { key: false });
await call('st-a', 'webshell delete', 'POST', `${WS}/sessions/delete`, { sessionId: C1.sessionId, idempotencyKey: randomUUID() }, { key: false });
say('== st-b (no fence): positive controls for the same request formats');
await call('st-b', 'public create', 'POST', '/v1/agents/sessions', { agent_id: 'qwen-code', workspace: { workspace_id: 'ws-b1', cwd_relative: 'project' } });
await call('st-b', 'public cwd', 'POST', `/v1/agents/sessions/${B1.sessionId}/cwd`, { cwd_relative: 'project/sub', expected_context_revision: rev(B1.sessionId) });
await call('st-b', 'public patch title', 'PATCH', `/v1/agents/sessions/${B1.sessionId}`, { title: 'control title' });
await call('st-b', 'webshell create', 'POST', `${WS}/sessions/create`, { agentId: 'qwen-code', idempotencyKey: randomUUID(), input: [], workspace: { workspaceId: 'ws-b1' } }, { key: false });
await L.sleep(3000);
say(`   st-a final: ${JSON.stringify(counts())} fence=${M.fenceRow('a') ? 'installed' : 'none'} A1 cwd=${L.one(`SELECT cwd_relative FROM managed_agent_session WHERE session_id='${A1.sessionId}'`)} title=${L.one(`SELECT IFNULL(title,'-') FROM managed_agent_session WHERE session_id='${A1.sessionId}'`)}`);
await rig.stop(); L.svc('stop');
fs.writeFileSync(`${L.OUT}/s15-${TAG}.json`, JSON.stringify(R, null, 1));
say('S15-DONE');
