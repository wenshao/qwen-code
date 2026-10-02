// VERIFICATION RIG ONLY (PR #13135): close while a Turn is running is refused without side effects; after cancel the close succeeds.
// usage: DB=<db> BASE=... node s2-active.mjs <workspace> <storage-letter>
import {
  Report, api, createSession, closeSession, opIdOf, waitTurn, waitOp, sessStatus, ensureWorkspace, j, sleep, turnRow,
  bindingOf, handleOf, registration, procState, fenceRows, modelEntries,
} from './lib.mjs';

const [WS = 'ws-c', ST = 'c'] = process.argv.slice(2);
const rep = new Report(`s2v2-active-${process.env.ARM ?? 'head'}-${WS}`);
ensureWorkspace(WS, `st-${ST}`);

const c = await createSession('public', WS, `G_HOLD tag=${ST}`);
const S = c.session;
rep.check('bound Session admitted with a Turn the model never answers', c.status === 202, `session=${S}`);
let row;
for (let i = 0; i < 100; i++) { row = turnRow(S).at(-1); if (row?.[1] === 'RUNNING') break; await sleep(200); }
rep.check('Turn is RUNNING', row?.[1] === 'RUNNING', j(row));
await sleep(1500);
for (const surface of ['public', 'web']) {
  const r = await closeSession(surface, S, { key: `close-active-${surface}` });
  rep.check(`${surface}: close during the running Turn refused 409 turn_active`, r.status === 409 && r.json.error?.code === 'turn_active', `status=${r.status} code=${r.json.error?.code}`);
}
rep.check('refusal left Session ACTIVE, no fence, Turn still RUNNING', sessStatus(S) === 'ACTIVE' && fenceRows(S) === 0 && turnRow(S).at(-1)[1] === 'RUNNING', `status=${sessStatus(S)} fence=${fenceRows(S)} turn=${turnRow(S).at(-1)[1]}`);

// This base cannot cancel a bound first Turn (409 workspace_unavailable, pre-existing); the model gives up after HOLD_MS instead.
const cancel = await api('POST', `/v1/agents/sessions/${S}/events`, { type: 'agent.session.cancel', turn_id: row[0] }, { key: 'cancel-1' });
rep.note('cancel of the bound Turn (pre-existing limitation)', `${cancel.status} ${cancel.json.status ?? cancel.json.error?.code}`);
const t = await waitTurn(S, { timeoutMs: 120_000 });
rep.check('Turn ends once the model answers', t.status === 'COMPLETED', `${t.status} ${t.error} ${t.ms}ms`);

// the earlier refused key is not bound to anything: a retry with that key after the Turn ends is a fresh admission
const [binding] = bindingOf(S);
const handle = binding ? handleOf(binding[0]) : null;
const pid = handle ? registration(handle.resourceId)?.pid ?? 0 : 0;
rep.note('binding before close', `${j(binding)} pid=${pid} proc=${procState(pid)}`);
const r2 = await closeSession('public', S, { key: 'close-active-public' });
rep.check('same key after the Turn ended is admitted (refusal stored nothing)', r2.status === 202, `status=${r2.status} code=${r2.json.error?.code ?? r2.json.status}`);
const w = await waitOp(S, opIdOf('public', r2), { timeoutMs: 60_000 });
rep.check('close completes after cancel; Session CLOSED', w.json.status === 'completed' && sessStatus(S) === 'CLOSED', `op=${w.json.status} ${w.ms}ms session=${sessStatus(S)}`);
const [b1] = bindingOf(S);
rep.check('binding RELEASED with receipt; worker gone', (!binding || (b1?.[1] === 'RELEASED' && Number(b1?.[3]) > 0)) && (pid === 0 || procState(pid) === 'gone'), `${j(b1)} pid=${pid} proc=${procState(pid)}`);
rep.done({ session: S });
