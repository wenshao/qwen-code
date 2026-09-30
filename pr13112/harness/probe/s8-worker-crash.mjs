// VERIFICATION RIG ONLY (PR #13112): the Session's Runtime worker dies while Spring and the Harness keep running.
// usage: DB=<db> node s8-worker-crash.mjs <session> <label>   (the worker is found by the binding's endpoint port)
import { spawnSync } from 'node:child_process';
import { api, sql, waitTurn, Report, sleep, j } from './lib.mjs';
const [S, LABEL] = [process.argv[2], process.argv[3] ?? 'crash'];
const r = new Report(`s8-worker-crash-${LABEL}`);
const k = (s) => `${s}-${Date.now()}`;
const endpoint = sql(`SELECT DISTINCT b.runtime_endpoint FROM qwen_runtime_session s JOIN qwen_runtime_binding b ON b.binding_id=s.binding_id WHERE s.harness_session_id='${S}'`).flat();
const port = new URL(endpoint[0]).port;
const pid = spawnSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], { encoding: 'utf8' }).stdout.trim();
const cmd = spawnSync('ps', ['-o', 'command=', '-p', pid], { encoding: 'utf8' }).stdout.trim();
r.note('worker of the Session', `endpoint=${endpoint} pid=${pid} cmd=${cmd.slice(0, 120)}`);
if (!/managed-runtime-worker/.test(cmd) || !/pr13112-rig/.test(cmd)) { r.check('found this rig\'s worker', false, cmd); r.done(); process.exit(1); }
process.kill(Number(pid), 'SIGKILL');
await sleep(2000);
for (const n of [1, 2, 3]) {
  const x = await api('POST', `/v1/agents/sessions/${S}/events`, { type: 'agent.session.input.message', input: [{ type: 'input_text', text: `G_FILES name=crash.txt tag=${LABEL}-${n}` }] }, { actor: 'alice', key: k(`${LABEL}-${n}`) });
  const t = await waitTurn(S, { timeoutMs: 120_000 });
  r.note(`later Turn #${n} after the worker died`, `${x.status} ${j(t)}`);
  r.note(`binding after #${n}`, j(sql(`SELECT DISTINCT b.binding_state, b.runtime_generation, b.runtime_endpoint FROM qwen_runtime_session s JOIN qwen_runtime_binding b ON b.binding_id=s.binding_id WHERE s.harness_session_id='${S}'`)));
}
r.done();
