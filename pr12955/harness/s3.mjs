// S3: the persisted binding stops being authorized after admission but before
// dispatch (Workspace DRAINING / creator's create grant revoked).
import fs from 'node:fs';
import { execSync, spawn } from 'node:child_process';
import { R, SP, api, sql, one, register, waitTurn, g0Rest, out, sleep, modelCalls } from './lib.mjs';

const ARM = process.env.ARM ?? 'pr';
const DB = process.env.DB;
const res = { arm: ARM };
const SUF = process.env.SUF ?? '';
const ST = (process.env.STS ?? 'i j k').split(' ');
register('ws-drain2' + SUF, 'st-' + ST[0]);
register('ws-revoke' + SUF, 'st-' + ST[1]);
register('ws-ctl' + SUF, 'st-' + ST[2]);

execSync(`${R}/stop.sh harness${process.env.STOP_TAP ? ' tap' : ''}`);
const t0 = Date.now();
const m0 = modelCalls();
const ids = {};
for (const [name, ws] of [['drain', 'ws-drain2' + SUF], ['revoke', 'ws-revoke' + SUF], ['control', 'ws-ctl' + SUF]]) {
  const c = await api('POST', '/v1/agents/sessions', g0Rest(ws, `G0_FILES name=${name}.txt`), { key: `s3-${name}${SUF}` });
  ids[name] = c.json.id;
}
// wait until each Turn has been retried at least once (Harness unreachable)
for (;;) {
  const r = Object.values(ids).map((id) => Number(one(`SELECT retry_count FROM managed_agent_turn WHERE session_id='${id}'`)));
  if (r.every((x) => x >= 1)) break;
  if (Date.now() - t0 > 60_000) break;
  await sleep(250);
}
sql(`UPDATE managed_workspace_registry SET state='DRAINING' WHERE tenant_id='t-g0' AND workspace_id='ws-drain2${SUF}'`);
sql(`UPDATE managed_workspace_access SET can_create=FALSE WHERE tenant_id='t-g0' AND workspace_id='ws-revoke${SUF}'`);
res.changedAtMs = Date.now() - t0;
const h = spawn(`${R}/harness.sh`, [], { detached: true, stdio: ['ignore', fs.openSync(`${SP}/logs/harness-${ARM}-${DB}-s3.log`, 'a'), fs.openSync(`${SP}/logs/harness-${ARM}-${DB}-s3.log`, 'a')], env: { ...process.env, CLI_ARM: process.env.CLI_ARM ?? 'pr' } });
fs.writeFileSync(`${R}/run/harness.pid`, String(h.pid));
h.unref();
if (process.env.STOP_TAP) {
  const tap = spawn(process.execPath, [`${R}/tap.mjs`, '16955', '17955', `${R}/run/tap.jsonl`], { detached: true, stdio: 'ignore' });
  fs.writeFileSync(`${R}/run/tap.pid`, String(tap.pid));
  tap.unref();
}
res.turns = {};
for (const [name, id] of Object.entries(ids)) {
  const w = await waitTurn(id, { timeoutMs: 180_000 });
  const ev = await api('GET', `/v1/agents/sessions/${id}/events`);
  res.turns[name] = {
    row: w.rows[0]?.slice(1),
    settledAfterMs: Date.now() - t0,
    publicTerminal: (ev.json.data ?? []).filter((e) => e.terminal).map((e) => ({ type: e.type, data: e.data })),
    file: fs.existsSync(`${R}/roots/${{ drain: ST[0], revoke: ST[1], control: ST[2] }[name]}/child/${name}.txt`),
  };
}
res.modelCalls = modelCalls() - m0;
res.retryLog = execSync(`grep -c "will retry" ${SP}/logs/spring-${ARM}-${DB}.log || true`, { encoding: 'utf8' }).trim();
res.retryFailures = execSync(`grep "will retry" ${SP}/logs/spring-${ARM}-${DB}.log | grep -o "failure=[A-Za-z]*" | sort | uniq -c || true`, { encoding: 'utf8' }).trim();
console.log(JSON.stringify(res, null, 1));
out(`s3-${ARM}.json`, res);
