// S7: admission on the current arm (base / opt-out) + unbound Session across a Harness restart.
import fs from 'node:fs';
import { execSync, spawn } from 'node:child_process';
import { R, SP, api, register, waitTurn, g0Rest, g0WebShell, out, sleep, modelCalls } from './lib.mjs';

const ARM = process.env.ARM;
const DB = process.env.DB;
const res = { arm: ARM };
try { register('ws-a', 'st-a'); } catch {}
const s = (r) => `${r.status} ${r.json.error?.code ?? r.json.code ?? ''}`.trim();
const rest = await api('POST', '/v1/agents/sessions', g0Rest('ws-a', 'G0_FILES'), { key: `s7-rest-${ARM}` });
const web = await api('POST', '/api/agent/web-shell/v1/sessions/create', g0WebShell('ws-a', `s7-web-${ARM}`, 'G0_FILES'), { key: `s7-web-${ARM}` });
const empty = await api('POST', '/v1/agents/sessions', { agent_id: 'qwen-code', workspace: { workspace_id: 'ws-a', cwd_relative: 'child' } }, { key: `s7-empty-${ARM}` });
res.admission = { restWithInput: s(rest), webShellWithInput: s(web), emptyBound: s(empty) };
if (process.env.REPLAY_KEY) {
  const replay = await api('POST', '/v1/agents/sessions', g0Rest('ws-a', 'G0_FILES'), { key: process.env.REPLAY_KEY });
  res.replayOfCompletedG0 = s(replay);
  const get = await api('GET', `/v1/agents/sessions/${process.env.REPLAY_SESSION}`);
  const ev = await api('GET', `/v1/agents/sessions/${process.env.REPLAY_SESSION}/events`);
  res.readCompletedG0 = { get: get.status, status: get.json.status, events: ev.status, hasDone: JSON.stringify(ev.json).includes('G0_DONE') };
}
const legacy = async (tag) => {
  const c = await api('POST', '/v1/agents/sessions', { agent_id: 'qwen-code', input: [{ type: 'input_text', text: `legacy ${tag}` }] }, { key: `s7-legacy-${ARM}-${tag}`, actor: null });
  const w = await waitTurn(c.json.id, { timeoutMs: 60_000 });
  return { status: c.status, turn: w.rows[0]?.slice(1, 3), ms: w.ms };
};
res.legacyBefore = await legacy('before');
if (process.env.RESTART_HARNESS) {
  execSync(`${R}/stop.sh harness`);
  const h = spawn(`${R}/harness.sh`, [], { detached: true, stdio: ['ignore', fs.openSync(`${SP}/logs/harness-${ARM}-${DB}-s7.log`, 'a'), fs.openSync(`${SP}/logs/harness-${ARM}-${DB}-s7.log`, 'a')], env: { ...process.env } });
  fs.writeFileSync(`${R}/run/harness.pid`, String(h.pid));
  h.unref();
  for (let i = 0; i < 90; i++) {
    const r = await fetch('http://127.0.0.1:16955/capabilities', { headers: { Authorization: 'Bearer rig-g0-token' } }).catch(() => null);
    if (r?.status === 200) break;
    await sleep(1000);
  }
  res.legacyAfterRestart1 = await legacy('after1');
  await sleep(5000);
  res.legacyAfterRestart2 = await legacy('after2');
}
console.log(JSON.stringify(res, null, 1));
out(`s7-${ARM}-${DB}.json`, res);
