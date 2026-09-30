// VERIFICATION RIG ONLY: A/B control for the restart finding. A yolo Turn (no approval involved) is in flight, waiting
// on a slow model answer, when the Java server restarts. usage: DB=<db> node s7b-midturn-restart.mjs <jar-label> <workspace> <storage>
import { execSync } from 'node:child_process';
import { api, one, sql, ensureWorkspace, createSession, waitTurn, sessionRow, readWs, executions, tapEntries, setTapRules, Report, sleep, j, RIG, DB } from './lib.mjs';
const [jar = 'base', workspace = 'ws-d', storage = 'd'] = process.argv.slice(2);
const R = new Report(`s7b-midturn-restart-${jar}`);
const sh = (c) => execSync(c, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
ensureWorkspace(workspace, `st-${storage}`);
setTapRules([]);
const f = `mid-${Date.now().toString(36)}.txt`;
const c = await createSession('public', workspace, `D6_WRITE name=${f} content=midturn delay=12000`);
const S = c.session;
await sleep(2500);
R.check('a yolo Turn is in flight (model answer pending, nothing asked)', one(`SELECT status FROM managed_agent_turn WHERE session_id='${S}'`) === 'RUNNING', `turn=${one(`SELECT status FROM managed_agent_turn WHERE session_id='${S}'`)}`);
const t0 = Date.now();
R.say(sh(`${RIG}/stop.sh ${DB} spring TERM`));
R.say(sh(`${RIG}/spring.sh ${jar} ${DB} absent absent`).split('\n').slice(-1)[0]);
R.note('Java server restarted', `${Date.now() - t0} ms; Harness process untouched`);
const t = await waitTurn(S, { timeoutMs: 60_000 });
const hist = j(tapEntries().filter((e) => e.path.includes(S) && e.method === 'POST' && Date.parse(e.t) > t0).map((e) => `${e.path.split(S)[1]} ${e.status ?? e.error}`).reduce((m, k) => ((m[k] = (m[k] ?? 0) + 1), m), {}));
R.note('60 s after the restart', `Java Turn=${t.status}${t.error ? '/' + t.error : ''} retry_count=${one(`SELECT retry_count FROM managed_agent_turn WHERE session_id='${S}'`)} file=${j(readWs(storage, `child/${f}`))} executions=${executions(S)}`);
R.note('Java -> Harness calls for this Session since the restart', hist);
R.check(`[${jar}] the in-flight Turn does not complete in Java: re-attaching answers 409`, t.status === 'RUNNING' && /load 409/.test(hist), `turn=${t.status} calls=${hist}`);
const n = await createSession('public', workspace, `D6_WRITE name=next-${f} content=next`);
const nt = await waitTurn(n.session, { timeoutMs: 30_000 });
R.note(`[${jar}] a new Session on the same Workspace afterwards`, `turn=${nt.status}${nt.error ? '/' + nt.error : ''}`);
R.done({ session: S });
