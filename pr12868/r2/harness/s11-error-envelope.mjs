// PR #12868 round 2: the provider error envelope across three hops
// (worker -> Broker -> built TypeScript provider), on either arm.
// Nothing is asserted in groups P/R/S: the table is the evidence, and the
// same script runs on the previous head (ARM=r1) and the new head (ARM=pr).
// usage: ARM=<r1|pr> DB=.. ports.. node s11-error-envelope.mjs <groups P,Q,R,S,T> <storage letter>
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  ROOTS, BROKER_URL, BROKER_TOKEN, ARM, attempt, broker, check, clearHooks, createSession, executions, hook,
  ledger, ledgerMark, loadProvider, openLog, prepareRequest, readLines, runtimeSession, say, seedRegistry,
  sleep, summary,
} from './lib.mjs';

const groups = (process.argv[2] ?? 'P,Q,R,S,T').split(',');
const letter = process.argv[3] ?? 'k';
openLog(`s11-error-envelope-${ARM}-${groups.join('')}`);
const { BrokerManagedRuntimeProvider } = await loadProvider();
const REF_KEYS = ['sessionId', 'promptId', 'callId', 'capabilityDigest', 'policyRevision', 'invocationId', 'argsDigest'];
const ref = (prepared) => Object.fromEntries(REF_KEYS.map((k) => [k, prepared[k]]));
const providers = [];
let workspace;
async function open(mode, { begin = true, bind = true } = {}) {
  let harness;
  let cwd;
  if (mode === 'v1') {
    harness = await createSession();
    cwd = fs.realpathSync(path.join(ROOTS, 'plain'));
  } else {
    if (!workspace) {
      const ws = `ws-${letter}-${Date.now()}`;
      seedRegistry(ws, `st-${letter}`);
      workspace = { harness: await createSession(ws), cwd: fs.realpathSync(path.join(ROOTS, letter, 'child')) };
    }
    ({ harness, cwd } = workspace);
  }
  const provider = new BrokerManagedRuntimeProvider({ baseUrl: BROKER_URL, token: BROKER_TOKEN });
  providers.push(provider);
  const runtimeSessionId = randomUUID();
  const request = prepareRequest(runtimeSessionId, 'bootstrap', cwd);
  const client = await provider.getToolV2Client(request, { harnessSessionId: harness });
  const s = { mode, provider, harness, cwd, runtimeSessionId, request, client };
  if (bind) await client.fileHistory.bind({ ownerSessionId: harness, ownerRuntimeSessionId: runtimeSessionId, executionCwd: cwd, snapshots: [] });
  s.manifest = await client.manifest();
  s.identity = (callId) => ({ sessionId: runtimeSessionId, promptId: 'p1', callId, capabilityDigest: s.manifest.capabilityDigest, policyRevision: s.manifest.policyRevision });
  if (begin) await client.beginTurn(s.identity('turn'));
  s.control = (operation) => broker('POST', `tool-sessions/${runtimeSessionId}/control`, { protocolVersion: 1, requestId: randomUUID(), harnessSessionId: harness, operation });
  s.release = () => attempt(() => provider.release(runtimeSessionId, request, { terminal: true }));
  return s;
}
const visible = (text) => JSON.stringify(String(text)).slice(1, -1);
// Shows the text with control characters escaped; the length is that of the real text.
const shown = (text, n = 96) => { const v = visible(text); return `${v.length > n ? `${v.slice(0, n - 1)}…` : v}${text.length > 80 ? ` [${text.length} chars]` : ''}`; };

// One refused operation, three hops. `viaProvider` is the same operation through the built client.
async function hops(tag, title, s, operation, viaProvider) {
  const mark = ledgerMark();
  const atBroker = await s.control(operation);
  const entry = ledger(mark).find((e) => e.kind === operation.kind);
  const worker = entry ? { status: entry.status, code: entry.response?.code, error: entry.response?.error ?? '' } : null;
  const atProvider = viaProvider ? await attempt(viaProvider) : null;
  const reason = worker?.error ?? '';
  const brokerKeeps = atBroker.json?.error === reason && reason.length > 0;
  const providerKeeps = atProvider && !atProvider.ok && reason.length > 0 && atProvider.message.endsWith(reason);
  say(tag, `${title}`);
  say(tag, `   worker   -> ${worker ? `${worker.status} ${worker.code} :: ${shown(worker.error)}` : '<no request reached the worker>'}`);
  say(tag, `   Broker   -> ${atBroker.status} ${atBroker.code} :: ${shown(atBroker.json?.error ?? '')}`);
  if (atProvider) say(tag, `   provider -> ${atProvider.ok ? 'ok' : `${atProvider.status ?? '-'} ${atProvider.code} :: ${shown(atProvider.message)}`}`);
  say(tag, `   code kept=${worker ? worker.code === atBroker.code && worker.status === atBroker.status : 'n/a'} reason kept at Broker=${brokerKeeps} at provider=${atProvider ? providerKeeps : 'n/a'}`);
  return { worker, atBroker, atProvider, brokerKeeps, providerKeeps };
}

async function groupP(mode) {
  const tag = `P-${mode}`;
  const s = await open(mode);
  const abs = (n) => path.join(s.cwd, `p-${s.runtimeSessionId.slice(0, 6)}-${n}.txt`);
  const prep = (callId, toolName, input) => [{ kind: 'prepare', identity: s.identity(callId), toolName, input }, () => s.client.prepare(s.identity(`${callId}-p`), toolName, input)];
  const run = async (n, title, [operation, viaProvider]) => hops(tag, `P${n} ${title}`, s, operation, viaProvider);
  await run(1, 'write_file with a relative path', prep('p1', 'write_file', { file_path: 'relative/path.txt', content: 'x' }));
  await run(2, 'unknown tool name', prep('p2', 'no_such_tool', {}));
  await run(3, 'write_file without content', prep('p3', 'write_file', { file_path: abs(3) }));
  await run(4, 'write_file with an array as content', prep('p4', 'write_file', { file_path: abs(4), content: ['x'] }));
  await run(5, 'shell command the sleep guard blocks', prep('p5', 'run_shell_command', { command: 'sleep 20; echo late', is_background: false }));
  await run(6, 'argument of 256 KiB (core bound)', prep('p6', 'write_file', { file_path: abs(6), content: 'x'.repeat(256 * 1024) }));
  await run(7, 'background shell', prep('p7', 'run_shell_command', { command: 'echo bg', is_background: true }));
  await run(8, 'media context on a tool that is not read_file', [
    { kind: 'prepare', identity: s.identity('p8'), toolName: 'write_file', input: { file_path: abs(8), content: 'x' }, mediaContext: { inputModalities: { image: true } } },
    () => s.client.prepare(s.identity('p8-p'), 'write_file', { file_path: abs(8), content: 'x' }, undefined, { inputModalities: { image: true } }),
  ]);
  const good = await s.client.prepare(s.identity('p9'), 'write_file', { file_path: abs(9), content: 'x' });
  const tampered = { ...ref(good), argsDigest: 'f'.repeat(64) };
  await run(9, 'preflight with a tampered argsDigest', [{ kind: 'preflight', reference: tampered }, () => s.client.preflight(tampered)]);
  await run(10, 'bind-history naming another execution directory', [
    { kind: 'bind-history', binding: { ownerSessionId: s.harness, ownerRuntimeSessionId: s.runtimeSessionId, executionCwd: path.dirname(s.cwd), snapshots: [] } },
    null,
  ]);
  say(tag, `written files: ${fs.readdirSync(s.cwd).filter((f) => f.startsWith(`p-${s.runtimeSessionId.slice(0, 6)}`)).length} rows: ${executions(s.runtimeSessionId).length} release: ${(await s.release()).ok}`);
}

async function groupQ(mode) {
  const tag = `Q-${mode}`;
  const s = await open(mode);
  const file = path.join(s.cwd, `q-${s.runtimeSessionId.slice(0, 6)}.txt`);
  const identity = s.identity('q1');
  const bad = await attempt(() => s.client.prepare(identity, 'write_file', { file_path: path.basename(file), content: 'fixed\n' }));
  const unknown = await attempt(() => s.client.prepare(identity, 'no_such_tool', {}));
  const mark = ledgerMark();
  const prepared = await attempt(() => s.client.prepare(identity, 'write_file', { file_path: file, content: 'fixed\n' }));
  check(`${tag}.1`, 'after two refused preparations, corrected arguments under the SAME call identity prepare', !bad.ok && !unknown.ok && prepared.ok,
    `bad=${bad.code} unknown=${unknown.code} corrected=${prepared.ok ? 'ok' : prepared.code}`);
  if (!prepared.ok) return;
  const reference = ref(prepared.value);
  const reserved = await s.client.prepareExecution(reference);
  if (mode === 'v1') await s.client.confirm(reference, 'proceed_once');
  await s.client.preflight(reference);
  const result = await s.client.startExecution(reference, reserved.executionCallId);
  const rows = executions(s.runtimeSessionId);
  check(`${tag}.2`, 'the corrected invocation executes once and the refusals left no record',
    result.executionStatus === 'success' && fs.readFileSync(file, 'utf8') === 'fixed\n' && rows.length === 1 && rows[0].state === 'SETTLED' &&
    ledger(mark).filter((e) => e.kind === 'execute').length === 1, `rows=${rows.length} state=${rows[0]?.state}`);
  const released = await s.release();
  check(`${tag}.3`, 'the Session releases normally afterwards', released.ok && released.value === true && runtimeSession(s.runtimeSessionId)?.state === 'RELEASED');
}

async function groupR() {
  const tag = 'R-v1';
  const s = await open('v1');
  const cases = [
    ['reason of 4,028 characters (path of 4,000)', 'a'.repeat(4000)],
    ['reason of 4,096 characters (path of 4,068)', 'b'.repeat(4068)],
    ['reason of 4,097 characters (path of 4,069)', 'c'.repeat(4069)],
    ['reason of 8,028 characters (path of 8,000)', 'd'.repeat(8000)],
    ['path with newline, ESC colour codes and markup', 'rel\n\u001b[31mred\u001b[0m<b>x</b>'],
    ['path with a NUL character', 'rel\u0000nul'],
    ['path with a lone surrogate', 'rel\ud800half'],
    ['CJK path', '相对/路径.txt'],
    ['4,000 CJK characters (12 KB of UTF-8)', '路'.repeat(4000)],
  ];
  let n = 0;
  for (const [title, file] of cases) {
    n++;
    await hops(tag, `R${n} ${title}`, s, { kind: 'prepare', identity: s.identity(`r${n}`), toolName: 'write_file', input: { file_path: file, content: 'x' } },
      () => s.client.prepare(s.identity(`r${n}-p`), 'write_file', { file_path: file, content: 'x' }));
  }
  // Realistic long inputs: a model-written script in one shell call, and a long edit target.
  const script = ['sleep 30', 'cat > deploy.sh <<\'EOF\'', ...Array.from({ length: 90 }, (_, i) => `echo "step ${i}: rsync -a build/ host${i}:/srv/app/releases/current/"`), 'EOF', 'sh deploy.sh'].join('\n');
  const realistic = [
    [`shell script of ${script.length} characters that the sleep guard blocks`, 'run_shell_command', { command: script, is_background: false }],
    ['shell script of 400 characters that the sleep guard blocks', 'run_shell_command', { command: script.slice(0, 400), is_background: false }],
  ];
  for (const [title, toolName, input] of realistic) {
    n++;
    await hops(tag, `R${n} ${title}`, s, { kind: 'prepare', identity: s.identity(`r${n}`), toolName, input },
      () => s.client.prepare(s.identity(`r${n}-p`), toolName, input));
  }
  say(tag, `release: ${(await s.release()).ok}`);
}

async function groupS() {
  const tag = 'S-v1';
  const s = await open('v1');
  const bad = (callId) => ({ kind: 'prepare', identity: s.identity(callId), toolName: 'write_file', input: { file_path: 'relative/path.txt', content: 'x' } });
  const reason = 'File path must be absolute: relative/path.txt';
  const cases = [
    ['untouched worker answer (control)', null],
    ['unknown code', { body: { code: 'managed_runtime_made_up', error: reason } }],
    ['known code with another status (tool_invalid + 409)', { status: 409 }],
    ['extra field in the body', { body: { code: 'managed_runtime_tool_invalid', error: reason, hint: 'x' } }],
    ['Cache-Control header removed', { dropHeaders: ['cache-control'] }],
    ['Content-Encoding header added', { setHeaders: { 'content-encoding': 'identity' } }],
    ['Content-Type text/plain', { setHeaders: { 'content-type': 'text/plain' } }],
    ['empty reason', { body: { code: 'managed_runtime_tool_invalid', error: '' } }],
    ['body is not JSON', { body: 'File path must be absolute' }],
    ['501 managed_runtime_provider_unsupported', { status: 501, body: { code: 'managed_runtime_provider_unsupported', error: 'Managed Runtime provider configuration is unsupported.' } }],
    ['413 managed_runtime_provider_too_large', { status: 413, body: { code: 'managed_runtime_provider_too_large', error: 'Managed Runtime provider response exceeds its body size limit.' } }],
    ['500 with a known code', { status: 500 }],
  ];
  let n = 0;
  for (const [title, rewrite] of cases) {
    n++;
    if (rewrite) await hook({ kind: 'prepare', action: 'rewrite', count: 1, ...rewrite });
    const atBroker = await s.control(bad(`s${n}`));
    await clearHooks();
    say(tag, `S${n} ${title.padEnd(52)} Broker -> ${atBroker.status} ${atBroker.code} :: ${shown(atBroker.json?.error ?? '', 70)}`);
  }
  // A lying answer on execute: the tool ran, the answer is rewritten into a well-formed refusal.
  const counter = path.join(s.cwd, `s-${s.runtimeSessionId.slice(0, 6)}.txt`);
  const prepared = await s.client.prepare(s.identity('s-exec'), 'run_shell_command', { command: `echo once >> ${counter}`, is_background: false });
  const reference = ref(prepared);
  const reserved = await s.client.prepareExecution(reference);
  await s.client.confirm(reference, 'proceed_once');
  await s.client.preflight(reference);
  await hook({ kind: 'execute', action: 'rewrite', count: 1, status: 400, body: { code: 'managed_runtime_tool_invalid', error: 'Managed Runtime tool is unavailable.' } });
  const mark = ledgerMark();
  const started = await attempt(() => s.client.startExecution(reference, reserved.executionCallId));
  await clearHooks();
  await sleep(500);
  const again = await attempt(() => s.client.startExecution(reference, reserved.executionCallId));
  const row = executions(s.runtimeSessionId).find((r) => r.id === reserved.executionCallId);
  check(`${tag}.exec`, 'a well-formed refusal on execute is NOT taken as proof: record UNKNOWN, one dispatch, one effect, no replay',
    !started.ok && started.code === 'runtime_broker_execution_unknown' && row.state === 'UNKNOWN' && readLines(counter).length === 1 &&
    ledger(mark).filter((e) => e.kind === 'execute').length === 1 && !again.ok,
    `start=${started.code} row=${row.state} lines=${readLines(counter).length} executes=${ledger(mark).filter((e) => e.kind === 'execute').length}`);
  say(tag, `what the caller is told about the execute: ${visible(started.message)}`);
}

const modes = process.env.MODES ? process.env.MODES.split(',') : ['v1', 'v2'];
for (const group of groups) {
  for (const mode of ['R', 'S'].includes(group) ? ['v1'] : modes) {
    say('GROUP', `${group} ${mode} arm=${ARM}`);
    try {
      if (group === 'P') await groupP(mode);
      if (group === 'Q') await groupQ(mode);
      if (group === 'R') await groupR();
      if (group === 'S') await groupS();
    } catch (error) {
      check(`${group}-${mode}.x`, 'group completed', false, `${error?.name}: ${error?.message} code=${error?.code} status=${error?.status}\n${error?.stack?.split('\n').slice(1, 4).join('\n')}`);
    } finally {
      await clearHooks();
    }
  }
}
const ok = summary();
for (const p of providers) p.dispose();
process.exit(ok ? 0 : 1);
