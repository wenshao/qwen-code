// VERIFICATION RIG ONLY: a Hosted Harness that does not report approvalMode (a build from before D6a, or a rollback).
// Arm "strip": the tap deletes approvalMode from the real Harness's create/load answers.
// Arm "pre":   the Harness and Runtime worker run the bundle built from the commit before D6a (no tap rule).
// usage: DB=<db> node s11-skew.mjs <arm> <expected-mode> <workspace> <storage>
import { api, one, sql, ensureWorkspace, createSession, listActions, waitTurn, sessionRow, readWs, executions, setTapRules, tapEntries, modelCalls, Report, sleep, j } from './lib.mjs';
const [arm = 'strip', mode = 'default', workspace = 'ws-e', storage = 'e'] = process.argv.slice(2);
const JAR = process.env.JAR ?? 'head';
const R = new Report(`s11-skew-${JAR}-${arm}-${mode}`);
ensureWorkspace(workspace, `st-${storage}`);
setTapRules(arm === 'strip' ? [{ match: 'POST /session(/[^/]+/load)?$', action: 'strip', field: 'approvalMode' }] : []);
const f = `skew-${Date.now().toString(36)}.txt`;
const before = modelCalls();
const t0 = Date.now();
const c = await createSession('public', workspace, `D6_WRITE name=${f} content=skew`);
const S = c.session;
const t = await waitTurn(S, { timeoutMs: 120_000 });
const calls = j(tapEntries().filter((e) => Date.parse(e.t) >= t0 - 50 && e.method === 'POST' && (e.path === '/session' || e.path.includes(S))).map((e) => `${e.path.replace(S, ':id')} ${e.status ?? e.error}`).reduce((m, k) => ((m[k] = (m[k] ?? 0) + 1), m), {}));
R.note(`[${arm}/${mode}] Session row`, `approval_mode=${sessionRow(S)[1]} create HTTP ${c.status}`);
R.note(`[${arm}/${mode}] Turn`, `${t.status}${t.error ? '/' + t.error : ''} after ${(t.ms / 1000).toFixed(1)} s, retry_count=${one(`SELECT retry_count FROM managed_agent_turn WHERE session_id='${S}'`)}`);
R.note(`[${arm}/${mode}] Java -> Harness calls`, calls);
if (process.env.EXPECT === 'run') R.check(`[${arm}/${mode}] the yolo Session runs on the Harness that reports no mode`, t.status === 'COMPLETED' && readWs(storage, `child/${f}`) === 'skew' && executions(S) === 1, `turn=${t.status}/${t.error} after ${(t.ms / 1000).toFixed(1)} s executions=${executions(S)} file=${j(readWs(storage, `child/${f}`))}`);
else R.check(`[${arm}/${mode}] Java refuses to use the Session: no model call, no tool run, no Action`, t.status === 'FAILED' && modelCalls() - before === 0 && executions(S) === 0 && readWs(storage, `child/${f}`) === null && one(`SELECT COUNT(*) FROM managed_agent_action WHERE session_id='${S}'`) === '0', `turn=${t.status}/${t.error} modelCalls=${modelCalls() - before} executions=${executions(S)} file=${readWs(storage, `child/${f}`)}`);
const pub = await api('GET', `/v1/agents/sessions/${S}`);
R.note(`[${arm}/${mode}] what the client reads`, `session=${pub.json.status} capabilities.actions=${pub.json.capabilities?.actions}`);
setTapRules([]);
R.done();
