// Control for s3-retention: the same number of Runtime Sessions, tool calls
// and releases on one worker, but through the raw four-field path.
// usage: node s3b-retention-raw.mjs <count>
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { ROOTS, ARM, broker, createSession, executions, openLog, say, sleep, sql, workerPids } from './lib.mjs';

const count = Number(process.argv[2] ?? 200);
openLog(`s3b-retention-raw-${ARM}-${count}`);
const before = new Set(workerPids().map((w) => w.pid));
const harness = await createSession();
const cwd = fs.realpathSync(path.join(ROOTS, 'plain'));
const file = path.join(cwd, `retention-raw-${Date.now()}.txt`);
let worker;
const samples = [];
const t0 = Date.now();
const must = (r, what) => {
  if (r.status !== 200) throw new Error(`${what}: ${r.status} ${JSON.stringify(r.json).slice(0, 200)}`);
  return r.json;
};
for (let i = 1; i <= count; i++) {
  const runtimeSessionId = randomUUID();
  const base = { protocolVersion: 1, harnessSessionId: harness, runtimeSessionId };
  must(await broker('POST', 'tool-sessions:acquire', { ...base, requestId: randomUUID(), turnKind: i === 1 ? 'bootstrap' : 'continuation' }), 'acquire');
  const payloadJson = JSON.stringify({ toolName: 'write_file', input: { file_path: file, content: `turn ${i}\n${'x'.repeat(4096)}\n` } });
  const digest = `sha256:${createHash('sha256').update(payloadJson).digest('hex')}`;
  const reference = { sessionId: runtimeSessionId, promptId: `p-${i}`, callId: `c-${i}`, argsDigest: digest };
  const reserved = must(await broker('POST', 'executions:prepare', {
    ...base, requestId: randomUUID(), idempotencyKey: randomUUID(), turnId: reference.promptId, toolCallId: reference.callId, requestDigest: digest, reference }), 'reserve');
  let status = must(await broker('POST', `executions/${reserved.executionCallId}:start`, { ...base, requestId: randomUUID(), payloadJson }), 'start').status;
  while (status.state !== 'settled') {
    await sleep(20);
    status = must(await broker('GET', `executions/${reserved.executionCallId}?requestId=${randomUUID()}&harnessSessionId=${harness}&runtimeSessionId=${runtimeSessionId}`), 'get').status;
  }
  if (status.result.executionStatus !== 'success') throw new Error(`turn ${i}: ${JSON.stringify(status).slice(0, 200)}`);
  must(await broker('POST', `tool-sessions/${runtimeSessionId}:release`, { protocolVersion: 1, requestId: randomUUID(), harnessSessionId: harness }), 'release');
  if (i === 1) {
    worker = workerPids().filter((w) => !before.has(w.pid));
    if (worker.length !== 1) throw new Error(`expected one new worker, saw ${JSON.stringify(worker)}`);
  }
  if (i === 1 || i % Math.max(1, Math.floor(count / 10)) === 0) {
    const now = workerPids().find((w) => w.pid === worker[0].pid);
    samples.push({ turn: i, rssMb: Math.round(now.rssKb / 1024) });
    say('sample', `released Sessions=${i} worker pid=${now.pid} RSS=${Math.round(now.rssKb / 1024)} MiB elapsed=${Math.round((Date.now() - t0) / 1000)}s`);
  }
}
await sleep(15_000);
const idle = workerPids().find((w) => w.pid === worker[0].pid);
const first = samples[0].rssMb;
const last = Math.round(idle.rssKb / 1024);
say('idle', `15 s after the last release: RSS=${last} MiB`);
say('result', `raw path released=${count} RSS ${first} -> ${last} MiB (${last - first >= 0 ? '+' : ''}${last - first} MiB, ${(((last - first) * 1024) / (count - 1)).toFixed(1)} KiB per released Session)`);
say('result', `Runtime Session rows for this Harness Session: ${JSON.stringify(sql(`SELECT session_state, COUNT(*) FROM qwen_runtime_session WHERE harness_session_id='${harness}' GROUP BY 1`))}`);
