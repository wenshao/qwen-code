// VERIFICATION RIG ONLY (PR #13135): durable local-process close on real Linux (container), real Spring + MySQL + Harness + workers.
// usage: DB=<db> BASE=http://127.0.0.1:18136 node s1-close.mjs <surface: public|web> <workspace> <storage-letter>
import {
  Report, api, createSession, closeSession, opIdOf, waitTurn, waitOp, getSession, sessStatus, ensureWorkspace, j, sleep,
  bindingOf, runtimeSessions, holders, handleOf, registration, procState, lxWs, fenceRows, resourcesOf, workersInContainer, one,
} from './lib.mjs';

const [SURF = 'public', WS = 'ws-a', ST = 'a'] = process.argv.slice(2);
const ARM = process.env.ARM ?? 'head';
const rep = new Report(`s1-close-${ARM}-${SURF}-${WS}`);
ensureWorkspace(WS, `st-${ST}`);

// 1. bound Session with a real file Turn
const c = await createSession(SURF, WS, `G_FILES name=proof.txt tag=${ST}`);
rep.check('bound files/1 Session admitted', c.status === 202, `status=${c.status} session=${c.session}`);
const S = c.session;
const t = await waitTurn(S);
rep.check('file Turn completes (write/edit/read on the real Workspace)', t.status === 'COMPLETED', `${t.status} ${t.error} ${t.ms}ms file=${lxWs(ST, 'child/proof.txt')}`);
const caps = (await getSession(S)).json.capabilities ?? {};
rep.check('capabilities: session_close=true, session_lifecycle=false', caps.session_close === true && caps.session_lifecycle === false, j(caps));

const [binding] = bindingOf(S);
const handle = binding ? handleOf(binding[0]) : null;
const resourceId = handle?.resourceId ?? handle?.value?.resourceId;
const reg0 = resourceId ? registration(resourceId) : null;
const pid = reg0?.pid ?? 0;
rep.note('binding / registration before close', `binding=${j(binding)} resource=${resourceId} reg.state=${reg0?.state} pid=${pid} proc=${procState(pid)}`);
rep.check('original worker process is alive before close', pid > 0 && !['gone', 'Z'].includes(procState(pid)), `pid=${pid} state=${procState(pid)}`);
const retained = resourcesOf(S);
const execs = Number(one(`SELECT COUNT(*) FROM qwen_tool_execution WHERE harness_session_id='${S}'`));
rep.note('retained history before close', `resources=${retained.length} tool_executions=${execs}`);

// 2. refusals must not fence or change state
const bob = await closeSession(SURF, S, { key: 'close-bob', actor: 'bob' });
rep.check('readable non-creator (bob) is refused 403', bob.status === 403, `status=${bob.status} code=${bob.json.error?.code}`);
const mallory = await closeSession(SURF, S, { key: 'close-mallory', actor: 'mallory' });
rep.check('actor without read access (mallory) gets 404', mallory.status === 404, `status=${mallory.status} code=${mallory.json.error?.code}`);
rep.check('refusals left Session ACTIVE, no drain fence, worker untouched', sessStatus(S) === 'ACTIVE' && fenceRows(S) === 0 && procState(pid) !== 'gone', `status=${sessStatus(S)} fence=${fenceRows(S)} worker=${procState(pid)}`);

// 3. creator close
const t0 = Date.now();
const r = await closeSession(SURF, S, { key: 'close-1' });
const op = opIdOf(SURF, r);
rep.check('creator close admitted 202', r.status === 202 && !!op, `status=${r.status} op=${op} body.status=${r.json.status}`);
const midStatus = sessStatus(S);
rep.note('Session status right after admission', midStatus);
const w = await waitOp(S, op, { timeoutMs: 60_000, surface: SURF });
rep.check('close operation completes', w.json.status === 'completed', `op=${w.json.status} code=${w.json.error?.code ?? w.json.errorCode ?? ''} ${Date.now() - t0}ms`);
rep.check('Session CLOSED', sessStatus(S) === 'CLOSED', sessStatus(S));
const reg1 = resourceId ? registration(resourceId) : null;
rep.check('original worker PID is gone', procState(pid) === 'gone', `pid=${pid} state=${procState(pid)}`);
rep.check('durable registration RETIRED', reg1?.state === 'RETIRED', `state=${reg1?.state}`);
const [b1] = bindingOf(S);
rep.check('binding RELEASED with a persisted drain receipt', b1?.[1] === 'RELEASED' && Number(b1?.[3]) > 0, j(b1));
const receipt = one(`SELECT drain_receipt_json FROM qwen_runtime_binding WHERE binding_id='${b1?.[0]}'`);
rep.note('drain receipt', receipt);
const rs = runtimeSessions(b1?.[0] ?? '');
rep.check('every Runtime Session RELEASED/FAILED', rs.every(([s]) => ['RELEASED', 'FAILED'].includes(s)), j(rs));
rep.check('no execution-lease holder left for the binding', holders(b1?.[0] ?? '') === 0, `holders=${holders(b1?.[0] ?? '')}`);
rep.check('durable close fence persisted', fenceRows(S) === 1, `fence=${fenceRows(S)}`);
const after = resourcesOf(S);
rep.check('history resources retained byte-identically', retained.every((x) => after.includes(x)) && after.length >= retained.length, `before=${retained.length} after=${after.length}`);
const ev = await api('GET', `/v1/agents/sessions/${S}/events?limit=200`);
rep.check('events still readable and contain the Turn result', ev.status === 200 && JSON.stringify(ev.json).includes('G_DONE'), `status=${ev.status}`);
rep.check('Workspace file retained', lxWs(ST, 'child/proof.txt') === `after-${ST}`, `file=${lxWs(ST, 'child/proof.txt')}`);

// 4. idempotency across surfaces
const rp = await closeSession(SURF, S, { key: 'close-1' });
rep.check('same-surface replay returns the original operation', rp.status === 202 && opIdOf(SURF, rp) === op, `status=${rp.status} op=${opIdOf(SURF, rp)}`);
const other = SURF === 'web' ? 'public' : 'web';
const rx = await closeSession(other, S, { key: 'close-1' });
rep.check(`cross-surface (${other}) replay with the same key returns the original operation`, rx.status === 202 && opIdOf(other, rx) === op, `status=${rx.status} op=${opIdOf(other, rx)} body=${j(rx.json).slice(0, 200)}`);
const fresh = await closeSession(SURF, S, { key: 'close-2' });
rep.note('fresh key on a CLOSED Session', `status=${fresh.status} code=${fresh.json.error?.code ?? fresh.json.status}`);
const msg = await api('POST', `/v1/agents/sessions/${S}/events`, { type: 'agent.session.input.message', input: [{ type: 'input_text', text: 'PLAIN after close' }] }, { key: 'after-close' });
rep.check('new input on the CLOSED Session refused', msg.status === 409, `status=${msg.status} code=${msg.json.error?.code}`);

// 5. the Workspace is not pinned: a new Session on the same storage runs a file Turn
const n = await createSession(SURF, WS, `G_FILES name=next.txt tag=${ST}2`);
const nt = await waitTurn(n.session);
rep.check('new Session on the same Workspace completes a file Turn after close', nt.status === 'COMPLETED', `${nt.status} ${nt.error} ${nt.ms}ms file=${lxWs(ST, 'child/next.txt')}`);
rep.note('workers in container now', workersInContainer().join(' '));
rep.done({ session: S, op, pid, resourceId, next: n.session });
