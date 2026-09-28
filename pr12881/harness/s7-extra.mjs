// S7: Workspace-bound Sessions, SSE subscribers across close/delete, and a
// capture of every lifecycle response shape for contract validation.
// usage: node s7-extra.mjs <engine>
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  SP, RIG, OUT, CLI, TENANT, openLog, say, freshDb, startModel, startProxy, startHarness, startSpring, api, short, sql,
  createSession, awaitTurn, awaitOperation, sleep, stopAll,
} from './lib.mjs';

const ENGINE = process.argv[2] ?? 'mysql';
const DB = `s7_${ENGINE}`;
openLog(`s7-extra-${ENGINE}`);
freshDb(ENGINE, DB);
const roots = path.join(RIG, 'run', 's7-roots');
fs.mkdirSync(path.join(roots, 'a', 'child'), { recursive: true });
const broker = [
  '--qwen.managed-agent.runtime-broker.enabled=true',
  '--qwen.managed-agent.runtime-broker.port=18861',
  '--qwen.managed-agent.runtime-broker.token=rig-broker-token-12881',
  `--qwen.managed-agent.runtime-broker.workspace-cwd=${roots}`,
  `--qwen.managed-agent.runtime-broker.state-directory=${path.join(RIG, 'run', 's7-broker-state')}`,
  '--qwen.managed-agent.runtime-broker.credential-key-id=rig',
  '--qwen.managed-agent.runtime-broker.credential-key=/P0zXrDxRumkCOH9wFer9IQp/LnRpDDt7h7KzqlUWfQ=',
  `--qwen.managed-agent.runtime-broker.node-executable=${process.execPath}`,
  `--qwen.managed-agent.runtime-broker.worker-entry=${CLI}`,
  `--qwen.managed-agent.runtime-broker.cli-entry=${CLI}`,
  `--qwen.managed-agent.runtime-broker.workspace-mounts[0].tenant-id=${TENANT}`,
  '--qwen.managed-agent.runtime-broker.workspace-mounts[0].storage-id=st-a',
  `--qwen.managed-agent.runtime-broker.workspace-mounts[0].root=${path.join(roots, 'a')}`,
];
await startModel(18800);
await startHarness('h', 18811, 18800);
await startProxy('jh', 18821, 18811, 18831);
await startProxy('store', 18841, 18801, 18851);
await startSpring('a', { jar: path.join(SP, 'jars', 'pr-server.jar'), engine: ENGINE, db: DB, port: 18801, harnessPort: 18821, storePort: 18841, extra: broker });
const S = 18801;
const captured = [];
const cap = (schema, r, label) => {
  captured.push({ schema, status: r.status, label, body: r.json });
  return r;
};

// 1. Workspace-bound Session
sql(ENGINE, DB, `INSERT INTO managed_workspace_registry (tenant_id, workspace_id, workspace_generation, storage_id, display_name, config_ref, policy_ref, state) VALUES ('${TENANT}','ws-1',1,'st-a','ws-1','managed-runtime-tools/1','preapproved-workspace-tools/1','ACTIVE')`);
sql(ENGINE, DB, `INSERT INTO managed_workspace_access (tenant_id, workspace_id, actor_id, can_read, can_create) VALUES ('${TENANT}','ws-1',CAST('alice' AS BINARY),TRUE,TRUE)`);
let r = await api(S, 'POST', '/v1/agents/sessions', { actor: 'alice', idem: randomUUID(), body: { agent_id: 'qwen-code', workspace: { workspace_id: 'ws-1', cwd_relative: 'child' } } });
say('1 create bound Session (alice)', `${r.status} ${r.json.id ?? JSON.stringify(r.json)}`);
const bound = r.json.id;
if (bound) {
  r = await api(S, 'GET', `/v1/agents/sessions/${bound}`, { actor: 'alice' });
  say('1 capabilities', JSON.stringify(r.json.capabilities));
  for (const [m, p, kind] of [['POST', 'close', 'close'], ['POST', 'archive', 'archive'], ['DELETE', '', 'delete']]) {
    r = cap('Error', await api(S, m, `/v1/agents/sessions/${bound}${p ? '/' + p : ''}`, { actor: 'alice', idem: randomUUID() }), `bound ${kind}`);
    say(`1 ${kind} as alice`, short(r));
  }
  r = await api(S, 'POST', `/v1/agents/sessions/${bound}/close`, { actor: 'bob', idem: randomUUID() });
  say('1 close as bob (no grant)', short(r));
  r = await api(S, 'POST', `/v1/agents/sessions/${bound}/close`, { idem: randomUUID() });
  say('1 close without an actor', short(r));
  r = await api(S, 'POST', '/api/agent/web-shell/v1/sessions/delete', { actor: 'alice', body: { sessionId: bound, idempotencyKey: randomUUID() } });
  say('1 webshell delete as alice', short(r));
}

// 2. An SSE subscriber across close and delete
const id = await createSession(S, { input: 'SSE' });
await awaitTurn(S, id);
const ctl = new AbortController();
const seen = [];
let ended = null;
const t0 = Date.now();
const res = await fetch(`http://127.0.0.1:${S}/v1/agents/sessions/${id}/events?stream=true`, { headers: { 'X-Qwen-Tenant-Id': TENANT, accept: 'text/event-stream' }, signal: ctl.signal });
(async () => {
  const dec = new TextDecoder();
  let buf = '';
  try {
    for await (const chunk of res.body) {
      buf += dec.decode(chunk, { stream: true });
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const ev = /^event: (.*)$/m.exec(block)?.[1];
        const data = /^data: (.*)$/m.exec(block)?.[1];
        let type = ev;
        try { type = JSON.parse(data).type ?? ev; } catch {}
        if (type) seen.push(`${((Date.now() - t0) / 1000).toFixed(1)}s ${type}`);
      }
    }
    ended = `ended after ${((Date.now() - t0) / 1000).toFixed(1)}s`;
  } catch (e) {
    ended = ended ?? `error ${e.name}`;
  }
})();
await sleep(1500);
const kClose = randomUUID();
r = cap('PublicCommandOperation', await api(S, 'POST', `/v1/agents/sessions/${id}/close`, { idem: kClose }), 'close 202');
const closeOp = r.json.id;
cap('PublicOperation', await awaitOperation(S, id, closeOp), 'operation completed');
cap('PublicCommandOperation', await api(S, 'POST', `/v1/agents/sessions/${id}/close`, { idem: kClose }), 'close replay');
cap('Error', await api(S, 'POST', `/v1/agents/sessions/${id}/close`, { idem: randomUUID() }), 'close conflict');
cap('PublicCommandOperation', await api(S, 'POST', `/v1/agents/sessions/${id}/archive`, { idem: randomUUID() }), 'archive 202');
cap('PublicSession', await api(S, 'POST', `/v1/agents/sessions/${id}/unarchive`, { idem: randomUUID() }), 'unarchive 200');
await sleep(1500);
say('2 stream after close', `${ended ?? 'still open'} | ${seen.join(', ')}`);
r = cap('PublicCommandOperation', await api(S, 'DELETE', `/v1/agents/sessions/${id}`, { idem: randomUUID() }), 'delete 202');
cap('PublicOperation', await awaitOperation(S, id, r.json.id), 'delete completed');
await sleep(4000);
say('2 stream after delete', `${ended ?? 'still open'} | ${seen.join(', ')}`);
ctl.abort();
cap('Error', await api(S, 'GET', `/v1/agents/sessions/${id}`), 'tombstone read');
cap('Error', await api(S, 'GET', `/v1/agents/sessions/${id}/operations/${'x'.repeat(65)}`), 'overlong id');
cap('Error', await api(S, 'GET', `/v1/agents/sessions/${id}/operations/op_missing`), 'unknown op');
cap('Error', await api(S, 'POST', `/v1/agents/sessions/${randomUUID()}/close`, { idem: randomUUID() }), 'unknown session');
cap('Error', await api(S, 'POST', `/v1/agents/sessions/${id}/close`, { idem: 'bad key with spaces' }), 'bad key');
r = await api(S, 'POST', `/v1/agents/sessions/${id}/close`, {});
cap('Error', r, 'missing key');
say('3 missing Idempotency-Key', short(r));
// WebShell shapes
const w = await createSession(S, { input: 'WS' });
await awaitTurn(S, w);
r = cap('WebShellCommandOperation', await api(S, 'POST', '/api/agent/web-shell/v1/sessions/close', { body: { sessionId: w, idempotencyKey: randomUUID() } }), 'ws close');
await awaitOperation(S, w, r.json.operationId);
cap('WebShellOperation', await api(S, 'POST', '/api/agent/web-shell/v1/operations/query', { body: { sessionId: w, operationId: r.json.operationId } }), 'ws query');
cap('Error', await api(S, 'POST', '/api/agent/web-shell/v1/operations/query', { body: { sessionId: w, operationId: 'x'.repeat(65) } }), 'ws overlong');
fs.writeFileSync(path.join(OUT, `s7-responses-${ENGINE}.json`), JSON.stringify(captured, null, 2));
say('done', `${captured.length} responses captured`);
stopAll();
process.exit(0);
