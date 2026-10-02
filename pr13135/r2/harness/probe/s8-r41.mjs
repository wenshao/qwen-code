// VERIFICATION RIG ONLY (PR #13135 round 2): bot R4-1 — a bound Session whose binding never persisted a resource handle.
// The Broker state directory is made non-private (0750) while Spring runs, so registration creation fails and the warm/Turn
// leave a binding with no handle. The directory is then restored (0700) and the Session is closed.
// usage: DB=.. BASE=.. RUNDIR=.. node s8-r41.mjs <workspace> <storage-letter> <label>
import { Report, createSession, closeSession, opIdOf, waitTurn, getOp, sessStatus, ensureWorkspace, j, sleep, sql, one, LX, LXRUN, STATE_DIR, fenceRows, lxWs } from './lib.mjs';

const [WS, ST, LABEL] = process.argv.slice(2);
const rep = new Report(`s8-r41-${LABEL}`);
ensureWorkspace(WS, `st-${ST}`);
const dir = `${LXRUN}/${STATE_DIR}`;
const files = () => LX(`ls ${dir} | wc -l`);
const before = files();
LX(`chmod 0750 ${dir}`);
rep.note('state directory made non-private', LX(`stat -c '%a %U' ${dir}`));
const c = await createSession('public', WS, `G_FILES name=proof.txt tag=${ST}`);
const S = c.session;
const t = await waitTurn(S, { timeoutMs: 60_000 });
rep.note('Turn while the state directory is unusable', `${t.status} ${t.error} ${t.ms}ms`);
await sleep(3000);
LX(`chmod 0700 ${dir}`);
rep.note('state directory restored', LX(`stat -c '%a %U' ${dir}`));
const bind = () => sql(`SELECT binding_id, binding_state, COALESCE(resource_handle_json,'<null>'), COALESCE(runtime_lease_id,'<null>'), attestation_generation, COALESCE(LENGTH(drain_receipt_json),0) FROM qwen_runtime_binding WHERE isolation_key='${S}'`);
const b0 = bind();
rep.check('binding exists with no resource handle (R4-1 shape)', b0.length === 1 && b0[0][2] === '<null>' && b0[0][3] === '<null>', j(b0));
rep.note('registration files in state directory', `before=${before} after=${files()}`);
const r = await closeSession('public', S, { key: 'close-r41' });
const op = opIdOf('public', r);
rep.check('close admitted', r.status === 202, `status=${r.status} code=${r.json.error?.code ?? r.json.status}`);
const start = Date.now();
let o;
for (;;) {
  o = await getOp('public', S, op);
  if (['completed', 'failed'].includes(o.json.status) || Date.now() - start > 120_000) break;
  await sleep(1000);
}
const dbOp = sql(`SELECT state, COALESCE(error_code,''), attempt_count FROM managed_agent_operation WHERE operation_id='${op}'`)[0];
const b1 = bind();
rep.check('close completes; Session CLOSED', o.json.status === 'completed' && sessStatus(S) === 'CLOSED', `api=${o.json.status} code=${o.json.failure_code ?? o.json.error?.code ?? ''} db=${j(dbOp)} session=${sessStatus(S)} waited=${Date.now() - start}ms`);
rep.check('binding RELEASED with a drain receipt', b1[0]?.[1] === 'RELEASED' && Number(b1[0]?.[5]) > 0, j(b1.map((x) => [x[1], x[2] === '<null>' ? 'handle=null' : 'handle', x[5]])));
const receipt = one(`SELECT COALESCE(drain_receipt_json,'') FROM qwen_runtime_binding WHERE isolation_key='${S}'`);
rep.note('drain receipt', receipt || '<none>');
const regs = LX(`for f in ${dir}/*.json; do [ -f "$f" ] && grep -o '"state":"[A-Z]*"\\|"pid":[0-9]*' "$f" | tr '\\n' ' '; echo; done 2>/dev/null | sort | uniq -c`);
rep.note('registration states in state directory', regs.replace(/\n/g, ' | '));
rep.note('worker launches for this binding', LX(`ps -eo args | grep -c '[m]anaged-runtime-worker' || true`));
const n = await createSession('public', WS, `G_FILES name=after.txt tag=${ST}n`);
const nt = await waitTurn(n.session, { timeoutMs: 90_000 });
rep.check('new Session on the same storage completes a file Turn', nt.status === 'COMPLETED', `${nt.status} ${nt.error} ${nt.ms}ms file=${lxWs(ST, 'child/after.txt')}`);
rep.done({ session: S, op, fence: fenceRows(S) });
