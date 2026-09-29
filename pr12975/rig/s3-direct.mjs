// PR #12975 probe S3: the Broker HTTP API of the Spring-embedded Broker,
// driven directly (no TS client), for the refusal codes and for "refused
// before admission". Same script for ARM=main and ARM=merge.
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import * as L from './lib.mjs';

const ARM = process.env.ARM ?? 'merge';
const DB = process.env.DB ?? `s2_${ARM}`;
const HTTP = Number(process.env.HTTP ?? 18976);
const BPORT = Number(process.env.BPORT ?? 19976);
const ST = process.env.ST ?? 'e';
const ROOTS = path.resolve(L.RIG, process.env.ROOTS ?? `roots-${ARM}`);
const dir = path.join(ROOTS, ST, 'child');
const ws = `ws-${ST}`;
L.openLog(`s3-direct-${ARM}`);

async function broker(route, body) {
  const r = await fetch(`http://127.0.0.1:${BPORT}/internal/runtime-broker/v1${route}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${L.BROKER_TOKEN}`, 'Content-Type': 'application/json' },
    body,
  });
  const text = await r.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: r.status, json };
}
const rows = () => Number(L.sql(DB, 'SELECT COUNT(*) FROM qwen_tool_execution')[0][0]);

if (L.sql(DB, `SELECT COUNT(*) FROM managed_workspace_registry WHERE workspace_id='${ws}'`)[0][0] === '0') L.seedRegistry(DB, ws, `st-${ST}`);
const harness = await L.createWorkspaceSession(HTTP, ws);
const runtimeSessionId = randomUUID();
const envelope = (extra) => JSON.stringify({ protocolVersion: 1, requestId: randomUUID(), harnessSessionId: harness, runtimeSessionId, ...extra });
L.say('warm', (await broker('/runtimes:warm', envelope({}))).status);
const acq = await broker('/tool-sessions:acquire', envelope({ turnKind: 'bootstrap' }));
L.say('acquire', `${acq.status} ${JSON.stringify(acq.json).slice(0, 160)}`);

const cases = [];
async function direct(name, toolName, input, setup) {
  setup?.();
  const callId = `call-${name}`;
  const reference = { sessionId: runtimeSessionId, promptId: runtimeSessionId, callId, argsDigest: `sha256:${'0'.repeat(64)}`, toolName, input };
  const before = rows();
  // JSON.stringify writes a lone surrogate as a \udXXX escape, as a client would.
  const r = await broker('/executions', envelope({ idempotencyKey: `${runtimeSessionId}:${callId}`, turnId: runtimeSessionId, toolCallId: callId, requestDigest: reference.argsDigest, reference }));
  let settled = r.json?.status?.state;
  const id = r.json?.executionCallId;
  for (let i = 0; id && settled !== 'settled' && i < 100; i++) {
    await L.sleep(100);
    const g = await fetch(`http://127.0.0.1:${BPORT}/internal/runtime-broker/v1/executions/${id}?protocolVersion=1&requestId=${randomUUID()}&harnessSessionId=${harness}&runtimeSessionId=${runtimeSessionId}`, { headers: { Authorization: `Bearer ${L.BROKER_TOKEN}` } });
    const j = await g.json();
    settled = j?.status?.state;
    if (settled === 'settled') r.result = j.status.result;
  }
  const out = { name, path: '/executions', status: r.status, code: r.json?.code, state: settled ?? null, result: r.result ? JSON.stringify(r.result).slice(0, 160) : null, newRows: rows() - before };
  cases.push(out);
  L.say(name, out);
}
async function deferred(name, payloadText, rawPayload) {
  const callId = `call-${name}`;
  const digest = `sha256:${createHash('sha256').update(Buffer.from(payloadText, 'utf8')).digest('hex')}`;
  const reference = { sessionId: runtimeSessionId, promptId: runtimeSessionId, callId, argsDigest: digest };
  const prep = await broker('/executions:prepare', envelope({ idempotencyKey: `${runtimeSessionId}:${callId}`, turnId: runtimeSessionId, toolCallId: callId, requestDigest: digest, reference }));
  const id = prep.json?.executionCallId;
  // rawPayload: the body carries the payload text with a single-escaped
  // surrogate, so the Broker's payloadJson string holds a raw lone surrogate.
  const body = rawPayload
    ? envelope({ payloadJson: '__P__' }).replace('"__P__"', JSON.stringify(payloadText).replace(/\\\\u(d[89ab][0-9a-f]{2})/gi, '\\u$1'))
    : envelope({ payloadJson: payloadText });
  const start = await broker(`/executions/${id}:start`, body);
  const state = L.sql(DB, `SELECT execution_state, IFNULL(execution_status,'-') FROM qwen_tool_execution WHERE execution_call_id='${id}'`)[0]?.join('/');
  const out = { name, path: 'prepare+start', prepare: prep.status, start: start.status, code: start.json?.code, message: start.json?.message ?? start.json?.error, rowAfterStart: state };
  cases.push(out);
  L.say(name, out);
}

fs.writeFileSync(path.join(dir, 'note.txt'), 'status: a?b\n');
await direct('D1-control-emoji-cjk-null', 'write_file', { file_path: 'ok.txt', content: '服务 🚀 ok\n' });
await direct('D2-input-lone-high', 'edit', { file_path: 'note.txt', old_string: 'a\ud800b', new_string: 'EDITED' });
await direct('D3-input-key-lone-low', 'write_file', { file_path: 'k.txt', content: 'x', ['k\udc00']: 1 });
await direct('D4-toolName-lone', 'read_file\ud83d', { file_path: 'note.txt' });
const escaped = JSON.stringify({ toolName: 'write_file', input: { file_path: 'esc.txt', content: 'esc \ud83d end' } });
await deferred('P1-deferred-escaped', escaped, false);
await deferred('P2-deferred-raw', escaped, true);
await deferred('P3-deferred-control', JSON.stringify({ toolName: 'write_file', input: { file_path: 'ok2.txt', content: '🚀' } }), false);
const files = Object.fromEntries(['note.txt', 'ok.txt', 'k.txt', 'esc.txt', 'ok2.txt'].map((f) => [f, fs.existsSync(path.join(dir, f)) ? fs.readFileSync(path.join(dir, f), 'utf8') : null]));
L.say('files', files);
fs.writeFileSync(path.join(L.RIG, 'out', `s3-direct-${ARM}.json`), JSON.stringify({ arm: ARM, cases, files }, null, 2));
process.exit(0);
