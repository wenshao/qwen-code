// VERIFICATION RIG ONLY (PR #13247) S1: happy path on both surfaces, normalized replay, live SSE, DB truth.
import { api, Report, ensureWorkspace, createSession, waitTurn, sleep, j, RUN, WS, ST } from './lib.mjs';
import { pubChange, webChange, opId, pubOp, webOp, waitCwdOp, binding, cwdOpRow, ctxEvents, mkdirWs, subscribe, typeOf } from './cwd.mjs';
import fs from 'node:fs';

const R = new Report('s1-basic');
ensureWorkspace(WS, `st-${ST}`);
mkdirWs(ST, 'child2');
mkdirWs(ST, 'child3/deep');

const c = await createSession('public', WS, 'G_WRITE name=first.txt content=one');
R.check('create bound Session 202/201', [200, 201, 202].includes(c.status), `status=${c.status} id=${c.session}`);
const s = c.session;
const t = await waitTurn(s);
R.check('initial G0 Turn completes in child/', t.status === 'COMPLETED' && fs.existsSync(`${RUN}/ws/${ST}/child/first.txt`), j(t));
R.check('binding before = (child, rev 1)', j(binding(s)).includes('"cwd":"child","rev":1'), j(binding(s)));

const read0 = await api('GET', `/v1/agents/sessions/${s}`);
R.note('public Session read before (workspace field)', j(read0.json.workspace ?? read0.json.workspace_context ?? read0.json).slice(0, 400));

const pubSse = subscribe('public', s);
const webSse = subscribe('web', s);
await sleep(500);

// 1. public change with a non-normal spelling
const k1 = `s1-pub-${Date.now()}`;
const a1 = await pubChange(s, 'child2//', 1, { key: k1 });
R.check('public POST /cwd → 202 pending, normalized target', a1.status === 202 && a1.json.status === 'pending' && a1.json.target_cwd_relative === 'child2' && a1.json.type === 'cwd_change' && a1.json.replayed === false, `${a1.status} ${j(a1.json)}`);
const op1 = opId(a1);
const w1 = await waitCwdOp(s, op1);
R.check('operation completes with result_context_revision=2', w1.json.status === 'completed' && w1.json.result_context_revision === 2 && !('failure_code' in w1.json), `${w1.ms} ms ${j(w1.json)}`);
R.check('DB binding after = (child2, rev 2)', j(binding(s)).includes('"cwd":"child2","rev":2'), j(binding(s)));
R.check('DB op row COMPLETED/CONFIRMED with receipt', (() => { const r = cwdOpRow(op1); return r.state === 'COMPLETED' && r.delivery === 'CONFIRMED' && r.result === '2' && r.receipt.startsWith('rcpt_'); })(), j(cwdOpRow(op1)));

// 2. replays
const r2 = await pubChange(s, 'child2/./', 1, { key: k1 });
R.check('replay, other spelling child2/./ → 202 same id, replayed=true, completed', r2.status === 202 && opId(r2) === op1 && r2.json.replayed === true && r2.json.status === 'completed', `${r2.status} ${j(r2.json)}`);
const r3 = await pubChange(s, './child2', 1, { key: k1 });
R.check('replay ./child2 → same op', r3.status === 202 && opId(r3) === op1 && r3.json.replayed === true, `${r3.status} ${opId(r3)}`);
const r4 = await pubChange(s, 'child3', 1, { key: k1 });
R.check('same key, different target → 409 idempotency_conflict', r4.status === 409 && j(r4.json).includes('idempotency_conflict'), `${r4.status} ${j(r4.json)}`);
const r5 = await pubChange(s, 'child2', 2, { key: k1 });
R.check('same key, different expected revision → 409 idempotency_conflict', r5.status === 409 && j(r5.json).includes('idempotency_conflict'), `${r5.status} ${j(r5.json)}`);
const r6 = await pubChange(s, 'child3', 1, { key: `s1-stale-${Date.now()}` });
R.check('fresh key, stale expected revision 1 → 409 context_revision_conflict', r6.status === 409 && j(r6.json).includes('context_revision_conflict'), `${r6.status} ${j(r6.json)}`);

// 3. WebShell twin
const k2 = `s1-web-${Date.now()}`;
const a2 = await webChange(s, 'child3/deep/', 2, { key: k2, requestId: 'rig-req-s1' });
R.check('WebShell POST /sessions/cwd/change → 202 pending, camelCase', a2.status === 202 && a2.json.status === 'pending' && a2.json.targetCwdRelative === 'child3/deep' && typeof a2.json.operationId === 'string', `${a2.status} ${j(a2.json)}`);
R.check('WebShell echoes client request id header', a2.headers['x-request-id'] === 'rig-req-s1', `x-request-id=${a2.headers['x-request-id']}`);
const op2 = opId(a2);
const w2 = await waitCwdOp(s, op2, { surface: 'web' });
R.check('WebShell operation completes with resultContextRevision=3', w2.json.status === 'completed' && w2.json.resultContextRevision === 3, `${w2.ms} ms ${j(w2.json)}`);
const r7 = await webChange(s, 'child3//deep', 2, { key: k2 });
R.check('WebShell replay (other spelling) → same op, replayed=true', r7.status === 202 && opId(r7) === op2 && r7.json.replayed === true, `${r7.status} ${j(r7.json)}`);
const x1 = await pubOp(s, op2);
const x2 = await webOp(s, op1);
R.check('cross-surface read: public GET of WebShell op returns cwd shape', x1.status === 200 && x1.json.type === 'cwd_change' && x1.json.result_context_revision === 3, j(x1.json));
R.check('cross-surface read: WebShell query of public op returns cwd shape', x2.status === 200 && x2.json.type === 'cwd_change' && x2.json.resultContextRevision === 2, j(x2.json));
R.check('DB binding after = (child3/deep, rev 3)', j(binding(s)).includes('"cwd":"child3/deep","rev":3'), j(binding(s)));

// 4. events
await sleep(1500);
const ev = ctxEvents(s);
R.check('exactly two session.context.changed rows (one per completed change)', ev.length === 2, j(ev));
R.check('event data = {sessionId, operationId, workspaceId, cwdRelative, contextRevision}', ev[0]?.data?.operationId === op1 && ev[0].data.cwdRelative === 'child2' && ev[0].data.contextRevision === 2 && ev[1]?.data?.operationId === op2 && ev[1].data.contextRevision === 3 && ev[0].data.workspaceId === WS, j(ev.map((e) => e.data)));
const pubRead = await api('GET', `/v1/agents/sessions/${s}/events?limit=100`);
const pubCtx = (pubRead.json.data ?? []).filter((e) => (e.type ?? e.event_type) === 'session.context.changed');
R.check('public events read lists both context events', pubCtx.length === 2, j(pubCtx).slice(0, 600));
await sleep(500);
await pubSse.stop();
await webSse.stop();
const livePub = pubSse.events.filter((e) => typeOf(e) === 'session.context.changed' || j(e).includes('session.context.changed'));
const liveWeb = webSse.events.filter((e) => j(e).includes('session.context.changed'));
R.check('live public SSE delivered both context events once each', livePub.length === 2, `status=${pubSse.events.status} total=${pubSse.events.length} ctx=${livePub.length} ${j(livePub).slice(0, 400)}`);
R.check('live WebShell SSE delivered both context events once each', liveWeb.length === 2, `status=${webSse.events.status} total=${webSse.events.length} ctx=${liveWeb.length} ${j(liveWeb).slice(0, 400)}`);
const read1 = await api('GET', `/v1/agents/sessions/${s}`);
R.note('public Session read after (workspace field)', j(read1.json.workspace ?? read1.json).slice(0, 400));
R.done({ session: s, op1, op2, events: ev, livePub, liveWeb, read0: read0.json, read1: read1.json });
