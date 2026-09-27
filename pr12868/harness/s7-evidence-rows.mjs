// PR #12868: what is actually stored and what actually crosses the wire for
// one provider invocation (boot v2), next to one raw invocation.
import { randomUUID, createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  ROOTS, BROKER_URL, BROKER_TOKEN, ARM, broker, createSession, ledger, ledgerMark, loadProvider, openLog,
  prepareRequest, say, seedRegistry, sql, sleep,
} from './lib.mjs';

const letter = process.argv[2] ?? 'o';
openLog(`s7-evidence-rows-${ARM}`);
const short = (text) => text.replaceAll(fs.realpathSync(ROOTS), '<roots>');
const { BrokerManagedRuntimeProvider } = await loadProvider();
const provider = new BrokerManagedRuntimeProvider({ baseUrl: BROKER_URL, token: BROKER_TOKEN });
const ws = `ws-${letter}-${Date.now()}`;
seedRegistry(ws, `st-${letter}`);
const harness = await createSession(ws);
const cwd = fs.realpathSync(path.join(ROOTS, letter, 'child'));
const runtimeSessionId = randomUUID();
const request = prepareRequest(runtimeSessionId, 'bootstrap', cwd);
const mark = ledgerMark();
const client = await provider.getToolV2Client(request, { harnessSessionId: harness });
await client.fileHistory.bind({ ownerSessionId: harness, ownerRuntimeSessionId: runtimeSessionId, executionCwd: cwd, snapshots: [] });
const manifest = await client.manifest();
const identity = { sessionId: runtimeSessionId, promptId: 'prompt-1', callId: 'call-1', capabilityDigest: manifest.capabilityDigest, policyRevision: manifest.policyRevision };
await client.beginTurn({ ...identity, callId: 'turn' });
const secret = 'SECRET-ARGUMENT-7f3a';
const file = path.join(cwd, 'evidence.txt');
const prepared = await client.prepare(identity, 'write_file', { file_path: file, content: `${secret}\n` });
const reference = Object.fromEntries(['sessionId', 'promptId', 'callId', 'capabilityDigest', 'policyRevision', 'invocationId', 'argsDigest'].map((k) => [k, prepared[k]]));
const reserved = await client.prepareExecution(reference);
const row = () => sql(`SELECT execution_state, IFNULL(execution_status,'-'), dispatch_generation, request_digest, reference_json, IFNULL(result_json,'-') FROM qwen_tool_execution WHERE execution_call_id='${reserved.executionCallId}'`)[0];
let r = row();
say('stored', `after reserve: state=${r[0]} dispatch_generation=${r[2]} file exists=${fs.existsSync(file)}`);
say('stored', `reference_json = ${JSON.stringify(JSON.parse(r[4]), null, 2)}`);
say('stored', `row contains the argument text "${secret}": ${r.join('\t').includes(secret)}; contains "write_file": ${r.join('\t').includes('write_file')}`);
await client.preflight(reference);
await client.startExecution(reference, reserved.executionCallId);
r = row();
say('stored', `after start: state=${r[0]} status=${r[1]} dispatch_generation=${r[2]} file=${JSON.stringify(fs.readFileSync(file, 'utf8'))}`);
await provider.release(runtimeSessionId, request, { terminal: true });
const entries = ledger(mark);
const execute = entries.find((e) => e.kind === 'execute');
say('wire', `execute request body = ${short(JSON.stringify(execute.request, null, 2))}`);
say('wire', `execute request bytes=${execute.requestBytes}; contains "${secret}": ${JSON.stringify(execute.request).includes(secret)}`);
const prepare = entries.find((e) => e.kind === 'prepare');
say('wire', `prepare request carries the arguments to the worker once: contains "${secret}": ${JSON.stringify(prepare.request).includes(secret)} (bytes=${prepare.requestBytes})`);
say('wire', `sequence = ${entries.map((e) => `${e.path.replace('/internal/managed-runtime', '')}${e.kind ? `[${e.kind}]` : ''}`).join(' > ')}`);
say('wire', `headers on every provider request = ${JSON.stringify(Object.keys(execute.headers).sort())}`);
// Raw row for comparison, in a new Runtime Session of the same Harness Session.
const rawSession = randomUUID();
const base = { protocolVersion: 1, harnessSessionId: harness, runtimeSessionId: rawSession };
await broker('POST', 'tool-sessions:acquire', { ...base, requestId: randomUUID(), turnKind: 'continuation' });
const payloadJson = JSON.stringify({ toolName: 'write_file', input: { file_path: path.join(cwd, 'raw.txt'), content: 'raw\n' } });
const digest = `sha256:${createHash('sha256').update(payloadJson).digest('hex')}`;
const rawReserve = await broker('POST', 'executions:prepare', { ...base, requestId: randomUUID(), idempotencyKey: randomUUID(), turnId: 'prompt-2', toolCallId: 'call-raw', requestDigest: digest,
  reference: { sessionId: rawSession, promptId: 'prompt-2', callId: 'call-raw', argsDigest: digest } });
await broker('POST', `executions/${rawReserve.json.executionCallId}:start`, { ...base, requestId: randomUUID(), payloadJson });
await sleep(1500);
const raw = sql(`SELECT execution_state, IFNULL(execution_status,'-'), reference_json FROM qwen_tool_execution WHERE execution_call_id='${rawReserve.json.executionCallId}'`)[0];
say('raw', `state=${raw[0]} status=${raw[1]} reference_json = ${JSON.stringify(JSON.parse(raw[2]), null, 2)}`);
await broker('POST', `tool-sessions/${rawSession}:release`, { protocolVersion: 1, requestId: randomUUID(), harnessSessionId: harness });
provider.dispose();
