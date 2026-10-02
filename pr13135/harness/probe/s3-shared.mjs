// VERIFICATION RIG ONLY (PR #13135): close Session A while Session B of the same Workspace (same storage) is mid-Turn.
// A's drain must not release B's holder or stop B's worker; B's Turn must finish and write its file.
// usage: DB=<db> BASE=... RUNDIR=... node s3-shared.mjs <workspace> <storage-letter>
import {
  Report, createSession, closeSession, opIdOf, waitTurn, waitOp, sessStatus, ensureWorkspace, j, sleep, turnRow, sql,
  bindingOf, handleOf, registration, procState, lxWs, holders,
} from './lib.mjs';

const [WS = 'ws-d', ST = 'd'] = process.argv.slice(2);
const rep = new Report(`s3-shared-${process.env.ARM ?? 'head'}-${WS}`);
ensureWorkspace(WS, `st-${ST}`);
const leaseRows = () => sql(`SELECT binding_id, COALESCE(holder_key,'-') FROM managed_workspace_execution_lease`).map((r) => r.join('='));

const a = await createSession('public', WS, `G_FILES name=a.txt tag=${ST}a`);
const ta = await waitTurn(a.session);
rep.check('Session A file Turn completes', ta.status === 'COMPLETED', `${ta.status} file=${lxWs(ST, 'child/a.txt')}`);
const [ba] = bindingOf(a.session);
const pa = registration(handleOf(ba[0]).resourceId)?.pid ?? 0;

const b = await createSession('public', WS, `G_SLOW name=b.txt hold=9000 tag=${ST}b`);
let rb;
for (let i = 0; i < 100; i++) { rb = turnRow(b.session).at(-1); if (rb?.[1] === 'RUNNING') break; await sleep(150); }
await sleep(2500);
const [bb] = bindingOf(b.session);
const pb = bb ? registration(handleOf(bb[0]).resourceId)?.pid ?? 0 : 0;
rep.note('B is mid-Turn (model holds 9 s before write_file)', `turn=${rb?.[1]} bindingB=${j(bb)} pidB=${pb} proc=${procState(pb)} leases=${j(leaseRows())}`);

const t0 = Date.now();
const r = await closeSession('public', a.session, { key: 'close-a' });
rep.check('close A admitted while B runs', r.status === 202, `status=${r.status} code=${r.json.error?.code}`);
const w = await waitOp(a.session, opIdOf('public', r), { timeoutMs: 60_000 });
rep.check('close A completes; A CLOSED', w.json.status === 'completed' && sessStatus(a.session) === 'CLOSED', `op=${w.json.status} ${Date.now() - t0}ms A=${sessStatus(a.session)}`);
rep.check("A's worker stopped", procState(pa) === 'gone', `pidA=${pa} proc=${procState(pa)}`);
rep.note('B state right after A closed', `turn=${turnRow(b.session).at(-1)[1]} pidB=${pb} proc=${procState(pb)} leases=${j(leaseRows())}`);
rep.check("B's worker untouched by A's close", pb === 0 || procState(pb) !== 'gone', `pidB=${pb} proc=${procState(pb)}`);
const tb = await waitTurn(b.session, { timeoutMs: 60_000 });
rep.check("B's Turn completes and writes its file", tb.status === 'COMPLETED' && lxWs(ST, 'child/b.txt') === 'written-after-cancel', `${tb.status} ${tb.error} file=${lxWs(ST, 'child/b.txt')}`);
rep.check('B stays ACTIVE', sessStatus(b.session) === 'ACTIVE', sessStatus(b.session));
rep.check("A's file still present", lxWs(ST, 'child/a.txt') === `after-${ST}a`, `a.txt=${lxWs(ST, 'child/a.txt')}`);
// B can still be closed afterwards
const rb2 = await closeSession('web', b.session, { key: 'close-b' });
const wb = await waitOp(b.session, opIdOf('web', rb2), { timeoutMs: 60_000, surface: 'web' });
rep.check('B closes afterwards via WebShell', wb.json.status === 'completed' && sessStatus(b.session) === 'CLOSED' && procState(pb) === 'gone', `op=${wb.json.status} B=${sessStatus(b.session)} pidB=${procState(pb)}`);
rep.done({ a: a.session, b: b.session });
