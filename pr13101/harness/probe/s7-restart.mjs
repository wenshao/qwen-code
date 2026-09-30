// VERIFICATION RIG ONLY: a pending approval across a Java server restart (the PR lists restart recovery as not validated).
// The Hosted Harness process is never touched. Needs `default` mode.
// usage: DB=<db> RUN=<tag> TMO=<approval timeout> node s7-restart.mjs <workspace> <storage> <extraDownMs> <controlWorkspace> <controlStorage>
import { execSync } from 'node:child_process';
import { api, one, sql, ensureWorkspace, createSession, listActions, respond, getOp, waitPending, waitOp, waitTurn, opRow, actionRow, sessionRow, readWs, executions, setTapRules, tapEntries, Report, sleep, j, RIG, DB, RUN } from './lib.mjs';

const [workspace = 'ws-a', storage = 'a', downMs = '0', ctlWs = 'ws-h', ctlSt = 'h'] = process.argv.slice(2);
const TMO = process.env.TMO ?? '60s';
const R = new Report(`s7-java-restart-${process.env.RUN ?? 'run'}`);
const idOf = (a) => a.actionId ?? a.id;
const opId = (o) => o.operationId ?? o.id;
ensureWorkspace(workspace, `st-${storage}`);
ensureWorkspace(ctlWs, `st-${ctlSt}`);
const tag = Date.now().toString(36);
const sh = (c) => execSync(c, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const harnessLog = () => execSync(`cat $(ls -t ${RUN}/harness-*.log | head -1)`, { encoding: 'utf8' });
setTapRules([]);

const f = `restart-${tag}.txt`;
const c = await createSession('public', workspace, `D6_FILES name=${f}`);
const S = c.session;
const p = await waitPending(S);
const A = idOf(p.action);
R.check('pending approval before the restart', !p.timeout && sessionRow(S)[1] === 'default', `action=${A} timeout=${(p.action.expires_at - p.action.created_at) / 1000}s`);
const logMark = harnessLog().length;

const t0 = Date.now();
R.say(sh(`${RIG}/stop.sh ${DB} spring TERM`));
if (Number(downMs)) await sleep(Number(downMs));
R.say(sh(`${RIG}/spring.sh ${process.env.JAR ?? "head"} ${DB} default ${TMO}`).split('\n').slice(-1)[0]);
const down = Date.now() - t0;
R.note('Java server restarted (Harness process untouched)', `unavailable for ${(down / 1000).toFixed(1)} s`);

const l = await listActions('public', S);
R.check('the approval is still listed as pending on both surfaces', l.json.data?.length === 1 && l.json.data[0].id === A && (await listActions('web', S)).json.data?.[0]?.actionId === A, `pending=${j(l.json.data?.map((a) => a.id))}`);
const r = await respond('public', S, p.action, 'allow', { key: `restart-${tag}` });
const left = p.action.expires_at - Date.now();
R.check("the owner's allow is accepted (202) before the expiry", r.status === 202 && left > 0, `HTTP ${r.status} status=${r.json.status}, ${(left / 1000).toFixed(1)} s before the expiry`);
const OP = opId(r.json);
const d = await waitOp(S, OP, { timeoutMs: 12_000 });
const hist = () => j(tapEntries().filter((e) => e.path.includes(S) && e.method === 'POST' && Date.parse(e.t) > t0).map((e) => `${e.path.split(S)[1]} ${e.status ?? e.error}`).reduce((m, k) => ((m[k] = (m[k] ?? 0) + 1), m), {}));
R.check('EXPECTED: the answer reaches the Harness and the operation completes', d.json.status === 'completed', `after 12 s: op=${d.json.status}/${d.json.delivery_state} attempts=${opRow(OP)[3]}; Java -> Harness calls: ${hist()}`);

// control: the same Harness process still serves a brand-new Session end to end
const ctl = await createSession('public', ctlWs, `D6_WRITE name=ctl-${tag}.txt content=control`);
const cp = await waitPending(ctl.session);
const cr = await respond('public', ctl.session, cp.action, 'allow', { key: `ctl-${tag}` });
const cd = await waitOp(ctl.session, opId(cr.json));
const ct = await waitTurn(ctl.session);
R.check('control: a new Session on another Workspace is asked, answered and completes on the same Harness', cd.json.status === 'completed' && ct.status === 'COMPLETED' && readWs(ctlSt, `child/ctl-${tag}.txt`) === 'control', `op=${cd.json.status} turn=${ct.status}`);

const wait = p.action.expires_at - Date.now();
R.say(`.. waiting ${Math.max(0, Math.round(wait / 1000))} s for the approval's expiry, then up to 75 s for the operation's next attempt`);
await sleep(Math.max(0, wait));
const fin = (await waitOp(S, OP, { timeoutMs: 75_000 })).json;
const late = Math.round((Date.now() - p.action.expires_at) / 1000);
const blocked = /recovery blocked: ManagedSessionRecordError: session log writes stopped/.test(harnessLog().slice(logMark));
const outcome = fin.status === 'failed' && fin.failure_code === 'action_expired' ? 'A' : fin.status === 'running' && actionRow(A)[0] === 'requested' ? 'B' : '?';
R.note(
  `outcome ${outcome}`,
  outcome === 'A'
    ? `the Harness expired the Action; operation failed/action_expired ${late} s after the expiry (it is re-examined only at its next retry)`
    : `${late} s after the expiry: Action still ${actionRow(A)[0]}, operation still ${fin.status} (attempts=${opRow(OP)[3]}); Harness log reports "session log writes stopped" since the restart: ${blocked}`,
);
R.check('fail closed either way: the allowed call never ran', readWs(storage, `child/${f}`) === null && executions(S) === 0, `file=${readWs(storage, `child/${f}`)} executions=${executions(S)} action=${actionRow(A)[0]} op=${fin.status}${fin.failure_code ? '/' + fin.failure_code : ''}`);
R.note('Java -> Harness calls for this Session since the restart', hist());
await sleep(3000);
const pubT = await api('GET', `/v1/agents/sessions/${S}`);
R.note('Turn as the client sees it', `active_turn=${pubT.json.active_turn?.status}; db=${j(sql(`SELECT status, COALESCE(error_code,''), retry_count FROM managed_agent_turn WHERE session_id='${S}'`)[0])}`);
const n = await createSession('public', workspace, `D6_WRITE name=next-${tag}.txt content=next`);
const nt = await waitTurn(n.session, { timeoutMs: 30_000 });
R.note("a new Session on the stranded Turn's Workspace", `turn=${nt.status}${nt.error ? '/' + nt.error : ''}`);
R.done({ session: S, down, outcome });
