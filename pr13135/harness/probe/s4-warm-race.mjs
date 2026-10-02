// VERIFICATION RIG ONLY (PR #13135): text-only Turn on a bound Session, then close immediately — the background warm may still
// be creating the worker. Close must fence it: no worker may survive and no binding may stay live after completion.
// usage: DB=<db> BASE=... RUNDIR=... node s4-warm-race.mjs <workspace> <storage-letter> <iterations> [delayMs]
import { Report, createSession, closeSession, opIdOf, waitTurn, waitOp, sessStatus, ensureWorkspace, j, sleep, sql, handleOf, registration, procState, workersInContainer, fenceRows } from './lib.mjs';

const [WS = 'ws-e', ST = 'e', N = '8', DELAY = '0'] = process.argv.slice(2);
const rep = new Report(`s4-warm-race-${process.env.ARM ?? 'head'}-${WS}-d${DELAY}`);
ensureWorkspace(WS, `st-${ST}`);
const bindings = (s) => sql(`SELECT binding_id, binding_state, runtime_generation, COALESCE(LENGTH(drain_receipt_json),0) FROM qwen_runtime_binding WHERE isolation_key='${s}' ORDER BY runtime_generation`);
const workers0 = workersInContainer().length;
let ok = 0;
for (let i = 0; i < Number(N); i++) {
  const c = await createSession('public', WS, `PLAIN text-only ${i}`);
  const t = await waitTurn(c.session, { timeoutMs: 30_000 });
  await sleep(Number(DELAY));
  const atClose = bindings(c.session);
  const r = await closeSession('public', c.session, { key: `close-${i}` });
  const w = await waitOp(c.session, opIdOf('public', r), { timeoutMs: 60_000 });
  await sleep(3000);
  const after = bindings(c.session);
  const pids = after.map((b) => { const h = handleOf(b[0]); const reg = h ? registration(h.resourceId) : null; return { pid: reg?.pid ?? 0, state: reg?.state ?? 'none', proc: procState(reg?.pid ?? 0) }; });
  const clean = w.json.status === 'completed' && sessStatus(c.session) === 'CLOSED' && after.every((b) => b[1] === 'RELEASED') && pids.every((p) => p.proc === 'gone' || p.proc === 'no-pid') && after.length <= Math.max(1, atClose.length);
  if (clean) ok++;
  rep.check(`#${i}: text Turn ${t.status} -> close ${w.json.status} in ${w.ms}ms; no live binding/worker afterwards`, clean,
    `bindingsAtClose=${j(atClose.map((b) => b[1]))} after=${j(after.map((b) => b.slice(1)))} workers=${j(pids)} fence=${fenceRows(c.session)} code=${w.json.error?.code ?? ''}`);
}
const workers1 = workersInContainer().length;
rep.check('no worker process leaked across iterations', workers1 <= workers0, `workers before=${workers0} after=${workers1} ${workersInContainer().join(' ')}`);
rep.done({ ok });
