// PR #12868: the raw four-field reserve/start path (#12831) on both arms,
// through the Broker's private HTTP face only (no provider involved).
// usage: ARM=<base|pr> ... node s5-raw.mjs <storage letter> <storage letter 2>
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  ROOTS, ARM, broker, createSession, executions, holders, ledger, ledgerMark, openLog, runtimeSession, say,
  seedRegistry, sleep, wire,
} from './lib.mjs';

openLog(`s5-raw-${ARM}`);
async function session(letter) {
  const ws = `ws-${letter}-${Date.now()}`;
  seedRegistry(ws, `st-${letter}`);
  const harness = await createSession(ws);
  const cwd = fs.realpathSync(path.join(ROOTS, letter, 'child'));
  const runtimeSessionId = randomUUID();
  const base = { protocolVersion: 1, harnessSessionId: harness, runtimeSessionId };
  const acquire = await broker('POST', 'tool-sessions:acquire', { ...base, requestId: randomUUID(), turnKind: 'bootstrap' });
  say('raw', `acquire ${acquire.status} ${acquire.code ?? ''}`);
  return { harness, cwd, runtimeSessionId, base };
}
async function call(s, callId, toolName, input) {
  const payloadJson = JSON.stringify({ toolName, input });
  const digest = `sha256:${createHash('sha256').update(payloadJson).digest('hex')}`;
  const reference = { sessionId: s.runtimeSessionId, promptId: 'p1', callId, argsDigest: digest };
  const reserve = await broker('POST', 'executions:prepare', {
    ...s.base, requestId: randomUUID(), idempotencyKey: randomUUID(), turnId: 'p1', toolCallId: callId, requestDigest: digest, reference });
  const mark = ledgerMark();
  const start = await broker('POST', `executions/${reserve.json.executionCallId}:start`, { ...s.base, requestId: randomUUID(), payloadJson });
  let row;
  for (let i = 0; i < 100; i++) {
    row = executions(s.runtimeSessionId).find((r) => r.id === reserve.json.executionCallId);
    if (row.state === 'SETTLED' || row.state === 'UNKNOWN') break;
    await sleep(100);
  }
  const answer = ledger(mark).find((e) => e.path.endsWith('/execute'));
  say('raw', `${callId}: reserve=${reserve.status} start=${start.status} ${start.code ?? ''} | worker ${answer?.path.replace('/internal/managed-runtime', '')} -> HTTP ${answer?.status} ${answer?.status === 200 ? '' : JSON.stringify(answer?.response)} | row=${row.state}/${row.status} referenceKeys=${Object.keys(row.reference).join(',')}`);
  return row;
}
async function release(s) {
  const mark = ledgerMark();
  const r = await broker('POST', `tool-sessions/${s.runtimeSessionId}:release`, { protocolVersion: 1, requestId: randomUUID(), harnessSessionId: s.harness });
  say('raw', `release ${r.status} ${r.code ?? ''} session=${runtimeSession(s.runtimeSessionId)?.state} storageHeld=${holders().some(([, h]) => h === s.runtimeSessionId)} wire=${wire(ledger(mark)).join(', ')}`);
}

say('case', 'R1 valid raw write_file, then release');
let s = await session(process.argv[2]);
const file = path.join(s.cwd, `raw-${ARM}-${s.runtimeSessionId.slice(0, 8)}.txt`);
await call(s, 'r1', 'write_file', { file_path: file, content: 'raw\n' });
say('raw', `file=${fs.existsSync(file) ? JSON.stringify(fs.readFileSync(file, 'utf8')) : '<missing>'}`);
await release(s);

say('case', 'R2 raw call the worker refuses definitively (tool not admitted), then release');
s = await session(process.argv[3]);
await call(s, 'r2', 'no_such_tool', {});
await release(s);
