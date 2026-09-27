// Direct probes of the new deferred prepare/start Broker routes on the real
// stack (embedded Broker + MySQL + local-process worker).
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import * as L from './lib.mjs';

const DB = 'rig1';
const BROKER = 'http://127.0.0.1:19831/internal/runtime-broker/v1';
const ST = process.argv[2] ?? 'o';
const WS = `ws-${ST}`;
L.openLog(`s4-broker-api-${ST}`);
if (L.sql(DB, `SELECT COUNT(*) FROM managed_workspace_registry WHERE workspace_id='${WS}'`)[0][0] === '0') L.seedRegistry(DB, WS, `st-${ST}`);
const sid = await L.createWorkspaceSession(18831, WS);
const rt = randomUUID();
const dir = `${L.RIG}/roots/${ST}/child`;

async function call(method, path, body) {
  const r = await fetch(`${BROKER}${path}`, {
    method,
    headers: { Authorization: `Bearer ${L.BROKER_TOKEN}`, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify({ protocolVersion: 1, requestId: randomUUID(), harnessSessionId: sid, runtimeSessionId: rt, ...body }) } : {}),
  });
  const text = await r.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: r.status, json };
}
const brief = (r) => `${r.status} ${r.json?.code ?? r.json?.status?.state ?? ''}${r.json?.status?.result?.executionStatus ? '/' + r.json.status.result.executionStatus : ''}`;
const digest = (s) => `sha256:${createHash('sha256').update(s).digest('hex')}`;
async function prepare(payload) {
  const callId = randomUUID();
  const d = digest(payload);
  return call('POST', '/executions:prepare', {
    idempotencyKey: `${rt}:${callId}`, turnId: rt, toolCallId: callId, requestDigest: d,
    reference: { sessionId: rt, promptId: rt, callId, argsDigest: d },
  });
}
async function settle(id) {
  for (let i = 0; i < 200; i++) {
    const q = new URLSearchParams({ protocolVersion: '1', requestId: randomUUID(), harnessSessionId: sid, runtimeSessionId: rt });
    const r = await fetch(`${BROKER}/executions/${id}?${q}`, { headers: { Authorization: `Bearer ${L.BROKER_TOKEN}` } }).then((x) => x.json());
    if (r.status?.state === 'settled') return r;
    await L.sleep(50);
  }
  throw new Error('not settled');
}
const read = (n) => (fs.existsSync(`${dir}/${n}`) ? JSON.stringify(fs.readFileSync(`${dir}/${n}`, 'utf8')) : '<absent>');

L.say('warm', brief(await call('POST', '/runtimes:warm', {})));
L.say('acquire', brief(await call('POST', '/tool-sessions:acquire', { turnKind: 'bootstrap' })));

const p1 = JSON.stringify({ toolName: 'write_file', input: { file_path: 'v.txt', content: 'v1' } });
const p1b = JSON.stringify({ toolName: 'write_file', input: { content: 'v1', file_path: 'v.txt' } }); // same object, different bytes
const prep = await prepare(p1);
const id = prep.json.executionCallId;
L.say('prepare', `${brief(prep)} id=${id.slice(0, 8)}; file=${read('v.txt')}`);
const row = L.sql(DB, `SELECT execution_state, reference_json FROM qwen_tool_execution WHERE execution_call_id='${id}'`)[0];
L.say('stored', `state=${row[0]} reference_json=${row[1]}`);
L.say('start(reordered keys)', `${brief(await call('POST', `/executions/${id}:start`, { payloadJson: p1b }))}; file=${read('v.txt')}`);
L.say('start(original bytes)', `${brief(await call('POST', `/executions/${id}:start`, { payloadJson: p1 }))}`);
L.say('settled', `${brief({ status: 200, json: await settle(id) })}; file=${read('v.txt')}`);
fs.writeFileSync(`${dir}/v.txt`, 'tampered-after-settle');
L.say('replay start(original)', `${brief(await call('POST', `/executions/${id}:start`, { payloadJson: p1 }))}; file=${read('v.txt')} (no second effect if still tampered)`);
L.say('replay start(other bytes)', brief(await call('POST', `/executions/${id}:start`, { payloadJson: p1b })));

const imm = await call('POST', '/executions', {
  idempotencyKey: `${rt}:imm-bypass`, turnId: rt, toolCallId: 'imm-bypass', requestDigest: digest(p1),
  reference: { sessionId: rt, promptId: rt, callId: 'imm-bypass', argsDigest: digest(p1), dispatchMode: 'deferred' },
});
L.say('immediate + dispatchMode', brief(imm));

const payloadW = JSON.stringify({ toolName: 'write_file', input: { file_path: 'w.txt', content: 'w' } });
const immOk = await call('POST', '/executions', {
  idempotencyKey: `${rt}:imm-ok`, turnId: rt, toolCallId: 'imm-ok', requestDigest: digest(payloadW),
  reference: { sessionId: rt, promptId: rt, callId: 'imm-ok', argsDigest: digest(payloadW), toolName: 'write_file', input: { file_path: 'w.txt', content: 'w' } },
});
L.say('immediate (legacy)', `${brief(immOk)}`);
if (immOk.json?.executionCallId) {
  await settle(immOk.json.executionCallId);
  L.say(':start on immediate', brief(await call('POST', `/executions/${immOk.json.executionCallId}:start`, { payloadJson: payloadW })));
}

const p3 = JSON.stringify({ toolName: 'write_file', input: { file_path: 'c.txt', content: 'never' } });
const prep3 = await prepare(p3);
const id3 = prep3.json.executionCallId;
L.say('prepare#2', brief(prep3));
L.say('cancel prepared', brief(await call('POST', `/executions/${id3}:cancel`, {})));
L.say('settled#2', brief({ status: 200, json: await settle(id3) }));
L.say('start after cancel', `${brief(await call('POST', `/executions/${id3}:start`, { payloadJson: p3 }))}; c.txt=${read('c.txt')}`);

const p4 = JSON.stringify({ toolName: 'write_file', input: { file_path: 'x.txt', content: 'x' }, extra: 1 });
const prep4 = await prepare(p4);
L.say('start extra key', `${brief(await call('POST', `/executions/${prep4.json.executionCallId}:start`, { payloadJson: p4 }))}; x.txt=${read('x.txt')}`);
await call('POST', `/executions/${prep4.json.executionCallId}:cancel`, {});
await settle(prep4.json.executionCallId);

L.say('release', brief(await call('POST', `/tool-sessions/${rt}:release`, {})));
L.say('holders', L.holders(DB).filter((r) => r[1] !== '<none>').length + ' held (pre-existing from earlier probes)');
