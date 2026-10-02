// s1: Reviewer Test Plan items on the PR head, real stack.
//  A. close + archive keep the original bytes and ranges (public close is 409 for Workspace Sessions -> seam)
//  B. completed deletion: public 404s, new writer + private restore refused, retirement row, no physical delete
import * as L from './lib.mjs';
L.openLog(process.env.LABEL ?? 's1-lifecycle');
const so = 5 * 1024 * 1024 + 11, se = 200 * 1024 + 3;
const want = (tag, a) => L.genSha(tag, a.stream_role, a.stream_role === 'stdout' ? so : se);
// ---- A
const A = await L.makeOutput('close-archive', 'ws-s1a', 'st-s02', L.genCmd('s1a', so, se, 0));
L.say('A.made', { session: A.session, turn: A.turn.status, results: A.results, arts: A.arts.map((a) => `${a.stream_role}:${a.byte_length}`) });
for (const a of A.arts) L.say('A.before', `${a.stream_role} ${await L.downloadCheck(A.session, a, want('s1a', a))}`);
const pubClose = await L.api('POST', `/v1/agents/sessions/${A.session}/close`, {}, { key: `close-${A.session}` });
L.say('A.public-close', `${pubClose.status} ${pubClose.json?.error?.code ?? JSON.stringify(pubClose.json).slice(0, 120)}`);
L.say('A.seam-close', L.opSeam(A.session, 'CLOSE'));
L.say('A.closed-head', L.headRow(A.session));
L.say('A.closed-pubs', L.pubRows(A.session).map((p) => `${p.id.slice(0, 8)} ${p.retention} held=${p.held}`));
const listClosed = await L.artifacts(A.session);
L.say('A.closed-list', `${listClosed.status} n=${listClosed.list.length} availability=${listClosed.list.map((a) => a.availability).join(',')}`);
for (const a of A.arts) L.say('A.closed', `${a.stream_role} ${await L.downloadCheck(A.session, a, want('s1a', a))}`);
L.say('A.seam-archive', L.opSeam(A.session, 'ARCHIVE'));
for (const a of A.arts) L.say('A.archived', `${a.stream_role} ${await L.downloadCheck(A.session, a, want('s1a', a))}`);
L.say('A.retirement', L.retirement(A.session) ?? 'none');
// ---- B
const B = await L.makeOutput('delete', 'ws-s1b', 'st-s03', L.genCmd('s1b', so, se, 0));
L.say('B.made', { session: B.session, turn: B.turn.status, results: B.results });
const keys = L.objectKeys(B.session);
const ws = L.sessionWs(B.session);
for (const a of B.arts) L.say('B.before', `${a.stream_role} ${await L.downloadCheck(B.session, a, want('s1b', a))}`);
const resId = L.one(`SELECT resource_id FROM qwen_managed_session_resource WHERE session_id='${B.session}' LIMIT 1`);
const pubDel = await L.api('DELETE', `/v1/agents/sessions/${B.session}`, undefined, { key: `del-${B.session}` });
L.say('B.public-delete', `${pubDel.status} ${pubDel.json?.error?.code ?? ''}`);
const ledger0 = Date.now();
L.say('B.seam-delete', L.opSeam(B.session, 'DELETE'));
L.say('B.head', L.headRow(B.session));
L.say('B.retirement', L.retirement(B.session));
L.say('B.pubs', L.pubRows(B.session).map((p) => `${p.id.slice(0, 8)} ${p.retention} held=${p.held} writeEvidence=${p.writeEvidence} accepted=${p.acceptedComplete}`));
L.say('B.tool-results', L.sql(`SELECT work_state, IFNULL(failure_code,'') FROM managed_agent_tool_result WHERE session_id='${B.session}'`).map((r) => r.join('/')));
const s = await L.api('GET', `/v1/agents/sessions/${B.session}`);
const l = await L.artifacts(B.session);
L.say('B.public-after', `session=${s.status}/${s.json?.error?.code} artifacts=${l.status}/${l.json?.error?.code}`);
for (const a of B.arts) {
  const c = await L.content(B.session, a.id, { revision: a.revision });
  const rg = await L.content(B.session, a.id, { revision: a.revision, range: 'bytes=0-99' });
  L.say('B.content-after', `${a.stream_role} full=${c.status}/${c.code} range=${rg.status}/${rg.code}`);
}
const ws2 = await L.api('GET', `/api/agent/web-shell/v1/sessions/${B.session}/artifacts`);
L.say('B.webshell-after', `${ws2.status} ${ws2.json?.error?.code ?? JSON.stringify(ws2.json).slice(0, 80)}`);
const w = await L.acquire(B.session, ws);
L.say('B.new-writer', `${w.status} ${w.code} ${JSON.stringify(w.json).slice(0, 160)}`);
const rs = await L.storeCall('GET', B.session, 'restore', { token: w.token, query: `?workspaceId=${ws}` });
L.say('B.restore', `${rs.status} ${rs.code}`);
const rr = await L.storeCall('GET', B.session, `resources/${resId}`, { token: w.token, query: `?workspaceId=${ws}` });
L.say('B.resource', `${rr.status} ${rr.code}`);
const led = (await L.ossLedger()).filter((e) => e.t >= ledger0);
L.say('B.oss', `objects=${keys.length} still_present=${keys.filter(L.ossHas).length} deletes_since_delete=${led.filter((e) => e.method === 'DELETE').length}`);
L.out('s1.json', { A: A.session, B: B.session });
