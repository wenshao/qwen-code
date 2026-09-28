// S4: Hosted Harness crash (SIGKILL) during a G0 Turn after its first tool ran.
// phase=crash: create HANG session, wait for the tool, SIGKILL + restart Harness, observe.
// phase=observe: observe an existing session (after a Spring restart), try cancel, reuse Workspace.
import fs from 'node:fs';
import { execSync, spawn } from 'node:child_process';
import { R, SP, api, sql, one, register, waitTurn, g0Rest, out, sleep, modelCalls, tapEntries } from './lib.mjs';

const phase = process.argv[2];
const DB = process.env.DB;
const res = { phase };
const snap = (id) => {
  const r = sql(`SELECT status, COALESCE(error_code,''), retry_count, submission_attempted FROM managed_agent_turn WHERE session_id='${id}'`)[0];
  return { status: r?.[0], code: r?.[1], retries: Number(r?.[2]), submitted: r?.[3] };
};
const startHarness = async () => {
  const h = spawn(`${R}/harness.sh`, [], { detached: true, stdio: ['ignore', fs.openSync(`${SP}/logs/harness-s4-${DB}.log`, 'a'), fs.openSync(`${SP}/logs/harness-s4-${DB}.log`, 'a')], env: { ...process.env } });
  fs.writeFileSync(`${R}/run/harness.pid`, String(h.pid));
  h.unref();
  for (let i = 0; i < 90; i++) {
    const r = await fetch('http://127.0.0.1:16955/capabilities', { headers: { Authorization: 'Bearer rig-g0-token' } }).catch(() => null);
    if (r?.status === 200) return;
    await sleep(1000);
  }
};
const observe = async (id, seconds) => {
  const series = [];
  for (let t = 0; t <= seconds; t += 10) {
    series.push({ t, ...snap(id) });
    if (['COMPLETED', 'FAILED', 'CANCELLED'].includes(series.at(-1).status)) break;
    await sleep(10_000);
  }
  return series;
};

if (phase === 'crash') {
  register('ws-crash', 'st-a');
  register('ws-other', 'st-b');
  const m0 = modelCalls();
  const c = await api('POST', '/v1/agents/sessions', g0Rest('ws-crash', 'G0_HANG name=hang.txt'), { key: 's4-hang' });
  const id = c.json.id;
  fs.writeFileSync(`${R}/run/s4-session`, id);
  for (let i = 0; i < 120; i++) {
    if (Number(one(`SELECT COUNT(*) FROM qwen_tool_execution WHERE harness_session_id='${id}'`)) >= 1 && modelCalls() - m0 >= 2) break;
    await sleep(250);
  }
  await sleep(1000);
  res.beforeCrash = { session: id, ...snap(id), toolExecutions: one(`SELECT COUNT(*) FROM qwen_tool_execution WHERE harness_session_id='${id}'`), file: fs.existsSync(`${R}/roots/a/child/hang.txt`), lease: sql(`SELECT COALESCE(holder_key,'<null>') FROM managed_workspace_execution_lease`).flat() };
  const pid = fs.readFileSync(`${R}/run/harness.pid`, 'utf8').trim();
  execSync(`kill -9 ${pid}`);
  fs.rmSync(`${R}/run/harness.pid`);
  await sleep(2000);
  await startHarness();
  res.afterHarnessRestart = await observe(id, Number(process.env.OBSERVE ?? 120));
} else {
  const id = fs.readFileSync(`${R}/run/s4-session`, 'utf8').trim();
  res.session = id;
  res.series = await observe(id, Number(process.env.OBSERVE ?? 180));
  const t = one(`SELECT turn_id FROM managed_agent_turn WHERE session_id='${id}'`);
  const cancel = await api('POST', `/v1/agents/sessions/${id}/events`, { type: 'agent.session.cancel', turn_id: t }, { key: `s4-cancel-${Date.now()}` });
  const pub = await api('GET', `/v1/agents/sessions/${id}`);
  const turn = await api('GET', `/v1/agents/sessions/${id}/turns/${t}`);
  res.public = { cancel: `${cancel.status} ${cancel.json.error?.code ?? ''}`, sessionStatus: pub.json.status, turnStatus: turn.json.status };
  res.lease = sql(`SELECT COALESCE(holder_key,'<null>') FROM managed_workspace_execution_lease`).flat();
  const same = await api('POST', '/v1/agents/sessions', g0Rest('ws-crash', 'G0_FILES name=after-crash.txt'), { key: `s4-same-${Date.now()}` });
  const other = await api('POST', '/v1/agents/sessions', g0Rest('ws-other', 'G0_FILES name=other.txt'), { key: `s4-other-${Date.now()}` });
  const [ws, wo] = await Promise.all([waitTurn(same.json.id, { timeoutMs: 90_000 }), waitTurn(other.json.id, { timeoutMs: 90_000 })]);
  res.sameWorkspaceAfter = ws.rows[0]?.slice(1, 3);
  res.otherWorkspaceAfter = wo.rows[0]?.slice(1, 3);
  res.harnessLoads = tapEntries().filter((e) => e.path?.includes(`/session/${id}/load`)).map((e) => e.status);
}
console.log(JSON.stringify(res, null, 1));
out(`s4-${phase}-${DB}.json`, res);
