// PR #12868 round 6: what commit 5c0c9bf323 changes, on the real chain
// (built TS provider -> Spring Broker on MySQL -> bundled worker).
//   X1 where the cut lands now: field by field, at the worker and at the caller
//   X2 Session ids: the allow-list at the Broker's door and at the worker's
//   X4 a repeated cancellation after the worker was lost under a live Broker
//   X5 prepare with a content modification
//   X6 confirmation details of a large write in a Session that is not preapproved
// The Broker restart is s19-restart.mjs.
// usage: ARM=<h7|h6> ... node s18-r6.mjs <groups> <storage letters>
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  ROOTS, BROKER_URL, BROKER_TOKEN, ARM, attempt, brief, broker, check, clearHooks, createSession, executions,
  holders, inject, ledger, ledgerMark, loadProvider, openLog, prepareRequest, runtimeSession, say, seedRegistry,
  sleep, sql, summary, workerPortOf,
} from './lib.mjs';

const groups = (process.argv[2] ?? 'X1,X2').split(',');
const letters = (process.argv[3] ?? 'a,b,c,d,e,f,g,h').split(',');
let letterIndex = 0;
openLog(`s18-r6-${ARM}-${groups.join('')}${process.env.MODES ? `-${process.env.MODES.replace(',', '')}` : ''}`);
const REF_KEYS = ['sessionId', 'promptId', 'callId', 'capabilityDigest', 'policyRevision', 'invocationId', 'argsDigest'];
const ref = (prepared) => Object.fromEntries(REF_KEYS.map((k) => [k, prepared[k]]));
const providers = [];
const answer = (r) => `${r.status}${r.code ? ` ${r.code}` : ''}`;
const PROVIDER = 'provider/v1/control';
const envelope = (session, operation) => ({ session, operation, protocolVersion: 1, providerProtocol: 'managed-runtime-provider/1' });
const kib = (n) => `${(n / 1024).toFixed(0)} KiB`;
const held = (id) => holders().some(([, h]) => h === id);
const short = (a) => brief(a).replace(/BrokerResponseError: Managed Runtime Broker returned HTTP \d+\. ?/, '');
const LIMIT = 1024 * 1024;

async function place(mode) {
  if (mode === 'v1') return { harness: await createSession(), cwd: fs.realpathSync(path.join(ROOTS, 'plain')) };
  const letter = letters[letterIndex++ % letters.length];
  const ws = `ws-${letter}-${Date.now()}`;
  seedRegistry(ws, `st-${letter}`);
  return { workspace: ws, harness: await createSession(ws), cwd: fs.realpathSync(path.join(ROOTS, letter, 'child')) };
}
async function open(mode, where, runtimeSessionId = randomUUID()) {
  const { BrokerManagedRuntimeProvider } = await loadProvider();
  where ??= await place(mode);
  const provider = new BrokerManagedRuntimeProvider({ baseUrl: BROKER_URL, token: BROKER_TOKEN });
  providers.push(provider);
  const request = prepareRequest(runtimeSessionId, 'bootstrap', where.cwd);
  const client = await provider.getToolV2Client(request, { harnessSessionId: where.harness });
  const s = { ...where, mode, provider, runtimeSessionId, request, client };
  await client.fileHistory.bind({ ownerSessionId: s.harness, ownerRuntimeSessionId: runtimeSessionId, executionCwd: s.cwd, snapshots: [] });
  s.manifest = await client.manifest();
  s.identity = (callId, promptId = 'p1') => ({ sessionId: runtimeSessionId, promptId, callId, capabilityDigest: s.manifest.capabilityDigest, policyRevision: s.manifest.policyRevision });
  await client.beginTurn(s.identity('turn'));
  s.base = { protocolVersion: 1, harnessSessionId: s.harness, runtimeSessionId };
  s.wire = { runtimeSessionId, turnKind: 'bootstrap', harnessSessionId: s.harness };
  s.port = workerPortOf(runtimeSessionId);
  s.ready = async (callId, toolName, input, promptId = 'p1') => {
    const prepared = await client.prepare(s.identity(callId, promptId), toolName, input);
    const reference = ref(prepared);
    const reserved = await client.prepareExecution(reference);
    if (mode === 'v1') await client.confirm(reference, 'proceed_once');
    await client.preflight(reference);
    return { reference, reserved };
  };
  s.release = () => attempt(() => provider.release(runtimeSessionId, request, { terminal: true }));
  return s;
}
const post = (s, route, extra = {}) => broker('POST', route, { ...s.base, requestId: randomUUID(), ...extra });
const getExecution = (s, id) => broker('GET', `executions/${id}?requestId=${randomUUID()}&harnessSessionId=${s.harness}&runtimeSessionId=${s.runtimeSessionId}`);
const loneSurrogates = (text) => (text.match(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g) ?? []).length;
const jsonBytes = (text) => Buffer.byteLength(JSON.stringify(text), 'utf8') - 2;
const points = (text) => [...text].length;
const count = (text, unit) => text.split(unit).length - 1;
const bindingOf = (runtimeSessionId) => {
  const row = sql(`SELECT b.binding_state, b.runtime_generation FROM qwen_runtime_binding b JOIN qwen_runtime_session s ON s.binding_id=b.binding_id WHERE s.runtime_session_id='${runtimeSessionId}'`)[0];
  return row ? `${row[0]}/gen${row[1]}` : 'none';
};

// X1 -------------------------------------------------------------------------
const STUB = '[Managed Runtime provider omitted this tool result to fit the wire limit.]';
const NOTICE = /\n\[Managed Runtime provider omitted (\d+) characters here to fit the (\d+)-byte wire limit\.\]\n/;
const CUTS = [
  { name: 'CJK x 250,000', unit: '中', total: 250000, command: `perl -CS -e 'print chr(0x4E2D) x 250000'` },
  { name: 'emoji x 150,000', unit: '\u{1F600}', total: 150000, command: `perl -CS -e 'print chr(0x1F600) x 150000'` },
  { name: 'one letter, then emoji x 150,000', unit: '\u{1F600}', total: 150000, command: `perl -CS -e 'print "a"; print chr(0x1F600) x 150000'` },
  { name: 'ascii x 600,000', unit: 'x', total: 600000, command: `perl -e 'print "x" x 600000'` },
  { name: 'quote and backslash x 136,534', unit: '"\\', total: 273068, command: `perl -e 'print q("\\\\) x 136534'` },
  { name: 'two-byte letters x 300,000', unit: 'é', total: 300000, command: `perl -CS -e 'print chr(0xE9) x 300000'` },
];
function fields(result) {
  const r = result?.result ?? {};
  const d = r.returnDisplay;
  const out = { llmContent: typeof r.llmContent === 'string' ? r.llmContent : JSON.stringify(r.llmContent ?? '') };
  if (typeof d === 'string') out.returnDisplay = d;
  else if (d && typeof d === 'object' && d.type === 'shell_result') {
    out['display.output'] = d.output;
    out['display.text'] = d.text;
  } else if (d && typeof d === 'object') out[`returnDisplay{${Object.keys(d).sort().join(',')}}`] = JSON.stringify(d);
  return out;
}
function describe(text, c) {
  if (typeof text !== 'string') return { line: 'absent' };
  const m = NOTICE.exec(text);
  if (text === STUB) return { line: `the stub (${text.length} chars)`, stub: true };
  if (!m) return { line: `${points(text)} characters, ${kib(jsonBytes(text))} on the wire, not cut` };
  // Payload next to the notice: the wrapper around the output is not counted.
  const units = new Set([...c.unit]);
  const before = [...text.slice(0, m.index)];
  const after = [...text.slice(m.index + m[0].length)];
  let kept = 0;
  for (let i = before.length - 1; i >= 0 && units.has(before[i]); i--) kept++;
  for (let i = 0; i < after.length && units.has(after[i]); i++) kept++;
  const exact = kept + Number(m[1]) === c.total;
  return {
    line: `${points(text)} characters, ${kib(jsonBytes(text))} on the wire | notice: ${m[1]} omitted | payload kept ${kept} + omitted ${m[1]} = ${kept + Number(m[1])} of ${c.total}${exact ? '' : ' (not exact)'} | lone surrogates ${loneSurrogates(text)} | "?" ${count(text, '?')}`,
    cut: true, exact, kept,
  };
}
async function cutAnatomy(mode) {
  const tag = `X1-${mode}`;
  let done = 0;
  let lone = 0;
  let differs = 0;
  const untouched = [];
  let inexact = 0;
  let cuts = 0;
  const used = [];
  for (const [index, c] of CUTS.entries()) {
    const s = await open(mode);
    const prepared = await s.ready(`x1-${index}`, 'run_shell_command', { command: c.command, is_background: false });
    const mark = ledgerMark();
    const result = await attempt(() => s.client.startExecution(prepared.reference, prepared.reserved.executionCallId));
    const wire = ledger(mark).find((e) => e.kind === 'execute');
    const status = await inject(s.port, PROVIDER, envelope(s.wire, { kind: 'status', reference: prepared.reference, afterSequence: 0 }));
    const sent = wire?.response?.bodyFile ? JSON.parse(fs.readFileSync(wire.response.bodyFile, 'utf8')) : undefined;
    const share = wire?.responseBytes ? wire.responseBytes / LIMIT : 0;
    used.push({ name: c.name, share });
    say(tag, `${c.name}: caller ${result.ok ? result.value.executionStatus : short(result).slice(0, 120)} | worker execute -> ${wire?.status} ${kib(wire?.responseBytes ?? 0)} (${(100 * share).toFixed(1)} % of the 1 MiB limit) | worker status (sent by the rig) ${status.status}`);
    // execute as the worker answered it (kept by the proxy), execute as the
    // caller received it, and a later status of the same call.
    const atWorker = fields(sent?.result ?? sent);
    const atCaller = result.ok ? fields(result.value) : {};
    const atStatus = fields(status.json?.result?.result);
    for (const key of Object.keys(atWorker)) {
      const w = describe(atWorker[key], c);
      const k = describe(atCaller[key], c);
      const t = describe(atStatus[key], c);
      const same = atWorker[key] === atCaller[key];
      say(tag, `    ${key.padEnd(15)} execute, as the worker sent it: ${w.line}`);
      say(tag, `    ${''.padEnd(15)} execute, as the caller got it: ${same ? 'the same text, byte for byte' : k.line}`);
      say(tag, `    ${''.padEnd(15)} status, sent by the rig:        ${t.line}`);
      if (!same && w.cut) differs++;
      if (!same && !w.cut) {
        // Not a field the fitter cut: say what the worker sent.
        const sentLone = loneSurrogates(atWorker[key]);
        untouched.push(`${c.name} / ${key}`);
        say(tag, `    ${''.padEnd(15)} OBSERVED: the fitter did not cut this field. The worker sent it with ${sentLone} lone surrogates (core shortened the model content before the fitter saw it); the caller has ${count(atCaller[key] ?? '', '?')} "?" in their place`);
      }
      for (const d of [w, t]) if (d.cut) { cuts++; if (!d.exact) inexact++; }
      lone += typeof atCaller[key] === 'string' ? loneSurrogates(atCaller[key]) : 0;
    }
    const row = executions(s.runtimeSessionId).find((r) => r.id === prepared.reserved.executionCallId);
    const released = await s.release();
    say(tag, `    record ${row?.state}/${row?.status} | release ${released.ok ? 'ok' : short(released).slice(0, 100)}${mode === 'v2' ? ` | storage held=${held(s.runtimeSessionId)}` : ''}`);
    if (result.ok && released.ok && row?.state === 'SETTLED') done++;
    s.provider.dispose();
  }
  // A file tool: the display is an object the cut cannot reach.
  const s = await open(mode);
  const file = path.join(s.cwd, `x1-big-${s.runtimeSessionId.slice(0, 6)}.txt`);
  fs.writeFileSync(file, `HEAD marker-old\n${'y'.repeat(700 * 1024)}\n`);
  const prepared = await s.ready('x1-edit', 'edit', { file_path: file, old_string: 'marker-old', new_string: 'marker-new' });
  const mark = ledgerMark();
  const result = await attempt(() => s.client.startExecution(prepared.reference, prepared.reserved.executionCallId));
  const wire = ledger(mark).find((e) => e.kind === 'execute');
  const r = result.ok ? result.value.result ?? {} : {};
  const llm = typeof r.llmContent === 'string' ? r.llmContent : JSON.stringify(r.llmContent ?? '');
  const display = r.returnDisplay;
  say(tag, `edit of a 700 KiB file: caller ${result.ok ? result.value.executionStatus : short(result).slice(0, 120)} | worker execute -> ${wire?.status} ${kib(wire?.responseBytes ?? 0)} | llmContent ${llm === STUB ? 'the stub' : `${llm.length} characters, kept: ${JSON.stringify(llm.slice(0, 70))}`} | display ${display === STUB ? 'the stub' : typeof display === 'string' ? `text, ${display.length} characters` : `object {${Object.keys(display ?? {}).sort().join(',')}}`} | file now starts with ${JSON.stringify(fs.readFileSync(file, 'utf8').slice(0, 20))}`);
  const released = await s.release();
  const editKept = result.ok && llm !== STUB && llm.length > 0 && display === STUB;
  if (result.ok && released.ok) done++;
  s.provider.dispose();

  const cjk = used.find((u) => u.name.startsWith('CJK'))?.share ?? 0;
  check(`${tag}.1`, `every case settles and releases (${CUTS.length + 1} cases)`, done === CUTS.length + 1, `${done} of ${CUTS.length + 1}`);
  check(`${tag}.2`, 'every field the fitter cut reaches the caller byte for byte, with no lone surrogate', lone === 0 && differs === 0, `lone surrogates ${lone}, cut fields that differ ${differs}, other fields that differ ${untouched.length}${untouched.length ? ` (${untouched.join('; ')})` : ''}`);
  check(`${tag}.3`, 'every notice counts exactly what it replaces', cuts > 0 && inexact === 0, `${cuts - inexact} of ${cuts} cut fields`);
  check(`${tag}.4`, 'text in three-byte characters uses the budget (more than 90 % of 1 MiB)', cjk > 0.9 && cjk <= 1, `${(100 * cjk).toFixed(1)} %`);
  check(`${tag}.5`, 'an edit of a large file keeps its llmContent; only the display becomes the stub', editKept);
}

// X2 -------------------------------------------------------------------------
async function rawCall(base, runtimeSessionId, callId, toolName, input) {
  const payloadJson = JSON.stringify({ toolName, input });
  const digest = `sha256:${createHash('sha256').update(payloadJson).digest('hex')}`;
  const reference = { sessionId: runtimeSessionId, promptId: 'p1', callId, argsDigest: digest };
  const reserve = await broker('POST', 'executions:prepare', { ...base, requestId: randomUUID(), idempotencyKey: randomUUID(), turnId: 'p1', toolCallId: callId, requestDigest: digest, reference });
  if (reserve.status !== 200) return { reserve };
  const mark = ledgerMark();
  const start = await broker('POST', `executions/${reserve.json.executionCallId}:start`, { ...base, requestId: randomUUID(), payloadJson });
  let row;
  for (let i = 0; i < 100; i++) {
    row = executions(runtimeSessionId).find((r) => r.id === reserve.json.executionCallId);
    if (row && (row.state === 'SETTLED' || row.state === 'UNKNOWN')) break;
    await sleep(100);
  }
  return { reserve, start, row, worker: ledger(mark).find((e) => e.path.endsWith('/execute')) };
}
const v7 = () => { const u = randomUUID().split(''); u[14] = '7'; return u.join(''); };
const stamp = () => `${Date.now()}${Math.floor(Math.random() * 1000)}`;
const ADMITTED = [
  ['lowercase UUID v4', () => randomUUID()],
  ['uppercase UUID v4', () => randomUUID().toUpperCase()],
  ['UUID version 7', () => v7()],
  ['not a UUID', () => `rig-session-${stamp()}`],
  ['dot, underscore, hyphen', () => `rig.a_b-c.${stamp()}`],
  ['leading dot', () => `.rig-${stamp()}`],
  ['trailing dot', () => `rig-${stamp()}.`],
  ['512 characters', () => `rig-${stamp()}-`.padEnd(512, 'a')],
];
const REFUSED = [
  ['with a space', () => `rig session ${stamp()}`],
  ['not ASCII', () => `会话-${stamp()}`],
  ['with a slash', () => `rig/session-${stamp()}`],
  ['with a backslash', () => `rig\\session-${stamp()}`],
  ['with two dots', () => `rig..session-${stamp()}`],
  ['with a control character', () => `rig\u0001session-${stamp()}`],
  ['with an emoji', () => `rig-\u{1F600}-${stamp()}`],
  ['a single dot', () => '.'],
  ['two dots alone', () => '..'],
  ['513 characters', () => `rig-${stamp()}-`.padEnd(513, 'a')],
  ['with a colon', () => `rig:${stamp()}`],
  ['with a percent escape', () => `rig%2e%2e${stamp()}`],
  ['ending in a line feed', () => `rig-${stamp()}\n`],
  ['with a NUL', () => `rig\u0000${stamp()}`],
  ['fullwidth letter', () => `rigＡ-${stamp()}`],
  ['Kelvin sign', () => `rigK-${stamp()}`],
];
const printable = (id) => { const t = JSON.stringify(id).slice(1, -1); return t.length > 40 ? `${t.slice(0, 28)}… (${id.length})` : t; };
async function sessionIds(mode) {
  const tag = `X2-${mode}`;
  const rows = [];
  for (const [expected, list] of [['admitted', ADMITTED], ['refused', REFUSED]]) {
    for (const [name, make] of list) {
      const where = await place(mode);
      const id = make();
      const base = { protocolVersion: 1, harnessSessionId: where.harness, runtimeSessionId: id };
      const mark = ledgerMark();
      const a = await broker('POST', 'tool-sessions:acquire', { ...base, requestId: randomUUID(), turnKind: 'bootstrap' });
      let work = '';
      if (a.status === 200) {
        const file = path.join(where.cwd, `x2-${Date.now()}.txt`);
        const raw = await rawCall(base, id, 'x2-raw', 'write_file', { file_path: file, content: 'id\n' });
        work = raw.reserve.status !== 200 ? ` | raw work: reserve ${answer(raw.reserve)}` : ` | raw work: ${raw.row?.state}/${raw.row?.status}`;
      }
      const row = runtimeSession(id);
      let release = { status: '-' };
      if (row) release = await broker('POST', `tool-sessions/${encodeURIComponent(id)}:release`, { protocolVersion: 1, requestId: randomUUID(), harnessSessionId: where.harness });
      const refusals = ledger(mark).filter((e) => e.path.endsWith('/control') && e.status !== 200).map((e) => `${e.kind} -> ${e.status} ${e.response?.code}`);
      const reached = ledger(mark).length;
      const after = runtimeSession(id);
      const stuck = Boolean(after) && after.state !== 'RELEASED';
      rows.push({ name, expected, acquire: a.status, code: a.json?.code, release: release.status, stuck, row: Boolean(row), reached, held: mode === 'v2' && held(id) });
      say(tag, `${name.padEnd(26)} ${printable(id).padEnd(44)} acquire ${answer(a)}${a.status === 200 ? '' : ` "${String(a.json?.error).slice(0, 60)}"`}${work} | ${row ? `release ${release.status}${release.status === 200 ? '' : ` ${release.json?.code}`} | Session now ${after?.state}` : `no Session row, requests that reached a worker: ${reached}`}${mode === 'v2' ? ` | storage held=${held(id)}` : ''}${refusals.length ? ` | worker refusals: ${[...new Set(refusals)].join('; ')}` : ''}`);
    }
  }
  const admitted = rows.filter((r) => r.expected === 'admitted');
  const refused = rows.filter((r) => r.expected === 'refused');
  check(`${tag}.1`, `every id of the allow-list is acquired, works and releases (${admitted.length} spellings)`, admitted.every((r) => r.acquire === 200 && r.release === 200 && !r.stuck && !r.held), JSON.stringify(admitted.filter((r) => r.acquire !== 200 || r.release !== 200 || r.stuck).map((r) => r.name)));
  check(`${tag}.2`, `every other id is refused at acquire, before a Session row or a worker request exists (${refused.length} spellings)`, refused.every((r) => r.acquire === 400 && r.code === 'runtime_broker_invalid_request' && !r.row && r.reached === 0 && !r.held), JSON.stringify(refused.filter((r) => r.acquire !== 400 || r.row || r.reached !== 0).map((r) => `${r.name}: ${r.acquire}`)));
  check(`${tag}.3`, 'no Session is left that cannot be released', rows.every((r) => !r.stuck && !r.held), JSON.stringify(rows.filter((r) => r.stuck || r.held).map((r) => r.name)));
}
// Every ASCII character, one at a time, in the middle of an id: the Broker
// decides at acquire, the worker at release.
async function asciiSweep(mode) {
  const tag = `X2s-${mode}`;
  const where = await place(mode);
  const allowed = (c) => /^[A-Za-z0-9._-]$/.test(String.fromCharCode(c));
  const wrong = [];
  const stuck = [];
  let admitted = 0;
  let refused = 0;
  for (let c = 0; c < 128; c++) {
    const id = `rig${String.fromCharCode(c)}x-${stamp()}`;
    const base = { protocolVersion: 1, harnessSessionId: where.harness, runtimeSessionId: id };
    const a = await broker('POST', 'tool-sessions:acquire', { ...base, requestId: randomUUID(), turnKind: 'bootstrap' });
    let release;
    if (a.status === 200) {
      admitted++;
      release = await broker('POST', `tool-sessions/${encodeURIComponent(id)}:release`, { protocolVersion: 1, requestId: randomUUID(), harnessSessionId: where.harness });
      const after = runtimeSession(id);
      if (release.status !== 200 || after?.state !== 'RELEASED') stuck.push(`0x${c.toString(16).padStart(2, '0')}: release ${answer(release)}, Session ${after?.state}`);
    } else refused++;
    if ((a.status === 200) !== allowed(c)) wrong.push(`0x${c.toString(16).padStart(2, '0')} ${JSON.stringify(String.fromCharCode(c))}: acquire ${answer(a)}`);
    if (a.status !== 200 && a.status !== 400) wrong.push(`0x${c.toString(16).padStart(2, '0')}: acquire ${answer(a)}`);
  }
  say(tag, `128 ASCII characters, each in the middle of an id: admitted ${admitted}, refused ${refused} | against the documented list (A-Z a-z 0-9 . _ -): ${wrong.length} differ${wrong.length ? ` ${JSON.stringify(wrong.slice(0, 6))}` : ''} | admitted ids the worker then refused to release: ${stuck.length}${stuck.length ? ` ${JSON.stringify(stuck.slice(0, 6))}` : ''}`);
  const harness = await broker('POST', 'tool-sessions:acquire', { protocolVersion: 1, harnessSessionId: `bad harness ${stamp()}`, runtimeSessionId: randomUUID(), requestId: randomUUID(), turnKind: 'bootstrap' });
  say(tag, `a Harness Session id with a space: acquire ${answer(harness)} "${String(harness.json?.error).slice(0, 60)}"`);
  check(`${tag}.1`, 'the Broker admits exactly the 65 documented characters', admitted === 65 && wrong.length === 0, `admitted ${admitted}, differ ${wrong.length}`);
  check(`${tag}.2`, 'the worker releases every id the Broker admitted', stuck.length === 0, `${stuck.length}`);
  check(`${tag}.3`, 'a Harness Session id outside the list is refused as well', harness.status === 400, answer(harness));
}

// X4 -------------------------------------------------------------------------
// One scenario per fresh Broker and database: a lost placement refuses later
// placements of the tenant.
async function workerLost(mode) {
  const tag = `X4-${mode}`;
  const s = await open(mode);
  const file = path.join(s.cwd, `x4-${s.runtimeSessionId.slice(0, 6)}.txt`);
  const prepared = await s.client.prepare(s.identity('x4'), 'write_file', { file_path: file, content: 'never\n' });
  const reference = ref(prepared);
  const reserved = await s.client.prepareExecution(reference);
  const cancel = () => post(s, `executions/${reserved.executionCallId}:cancel`);
  const first = await cancel();
  const pid = Number(execFileSync('/usr/sbin/lsof', ['-nP', `-iTCP:${s.port}`, '-sTCP:LISTEN', '-t'], { encoding: 'utf8' }).trim().split('\n')[0]);
  say(tag, `prepared call reserved | cancel #1 ${answer(first)} ${first.json?.status?.result?.executionStatus ?? ''} | Session ${runtimeSession(s.runtimeSessionId)?.state} | binding ${bindingOf(s.runtimeSessionId)} | worker pid ${pid > 0 ? 'found' : 'not found'} on port ${s.port}`);
  process.kill(pid, 'SIGKILL');
  await sleep(1500);
  const mark = ledgerMark();
  const answers = [];
  for (let i = 0; i < 5; i++) {
    const r = await cancel();
    answers.push(r);
    say(tag, `worker killed | cancel #${i + 2} ${answer(r)}${r.status === 200 ? ` ${r.json?.status?.result?.executionStatus}` : ` retryable=${r.json?.retryable} "${String(r.json?.error).slice(0, 90)}"`} | Session ${runtimeSession(s.runtimeSessionId)?.state} | binding ${bindingOf(s.runtimeSessionId)}`);
    await sleep(i < 2 ? 1000 : 3000);
  }
  const got = await getExecution(s, reserved.executionCallId);
  const late = await post(s, `executions/${reserved.executionCallId}:start`);
  const release = await broker('POST', `tool-sessions/${s.runtimeSessionId}:release`, { protocolVersion: 1, requestId: randomUUID(), harnessSessionId: s.harness });
  await sleep(500);
  say(tag, `GET ${answer(got)} ${got.json?.status?.state ?? ''}/${got.json?.status?.result?.executionStatus ?? ''} | start of the cancelled call ${answer(late)} | file written=${fs.existsSync(file)} | release ${answer(release)}${release.status === 200 ? '' : ` "${String(release.json?.error).slice(0, 80)}"`} | Session ${runtimeSession(s.runtimeSessionId)?.state}${mode === 'v2' ? ` | storage held=${held(s.runtimeSessionId)}` : ''} | requests sent towards the dead worker: ${ledger(mark).length}`);
  const last = answers[answers.length - 1];
  check(`${tag}.1`, 'once the worker is lost, the repeated cancellation is answered from the receipt', last.status === 200 && last.json?.status?.result?.executionStatus === 'cancelled', answers.map(answer).join(' | '));
  check(`${tag}.2`, 'the receipt is readable and the cancelled call never executes', got.status === 200 && !fs.existsSync(file));
}

// X5 -------------------------------------------------------------------------
async function modification(mode) {
  const tag = `X5-${mode}`;
  const s = await open(mode);
  const file = path.join(s.cwd, `x5-${s.runtimeSessionId.slice(0, 6)}.txt`);
  const source = ref(await s.client.prepare(s.identity('x5-source'), 'write_file', { file_path: file, content: 'first\n' }));
  const rowsBefore = executions(s.runtimeSessionId).length;
  const mark = ledgerMark();
  const changed = await attempt(() => s.client.prepare(s.identity('x5-changed'), 'write_file', { file_path: file, content: 'first\n' }, { source, newContent: 'changed\n' }));
  const wire = ledger(mark).find((e) => e.kind === 'prepare');
  say(tag, `prepare with a content modification: caller ${changed.ok ? `accepted ${JSON.stringify(changed.value).slice(0, 80)}` : short(changed).slice(0, 170)} | worker prepare -> ${wire?.status ?? 'no request'}${wire && wire.status !== 200 ? ` ${wire.response?.code} "${wire.response?.error}"` : ''} | rows written ${executions(s.runtimeSessionId).length - rowsBefore}`);
  const next = await attempt(async () => {
    const c = await s.ready('x5-after', 'write_file', { file_path: file, content: 'after\n' });
    return s.client.startExecution(c.reference, c.reserved.executionCallId);
  });
  const released = await s.release();
  say(tag, `the next call in the same Session: ${next.ok ? next.value.executionStatus : short(next).slice(0, 120)} | file holds ${JSON.stringify(fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null)} | release ${released.ok ? 'ok' : short(released).slice(0, 100)}`);
  check(`${tag}.1`, 'a content modification is refused by name (400 managed_runtime_tool_invalid) and changes nothing', !changed.ok && wire?.status === 400 && wire?.response?.code === 'managed_runtime_tool_invalid' && /content modification/.test(String(wire?.response?.error)), `${wire?.status} ${wire?.response?.code} "${wire?.response?.error}"`);
  check(`${tag}.2`, 'the Session goes on working and releases', next.ok && next.value.executionStatus === 'success' && released.ok && fs.readFileSync(file, 'utf8') === 'after\n');
}

// X6 -------------------------------------------------------------------------
// Large writes. The author records as a follow-up that confirmation details
// are not fitted; this walks every step of such a call and says where it stops
// and what is left behind.
const WRITES = [
  { name: 'write_file, 900 KB over 900 KB', old: 900 * 1000, tool: 'write_file', input: (file) => ({ file_path: file, content: `${'n'.repeat(900 * 1000)}\n` }) },
  { name: 'write_file, 200 KB over 200 KB', old: 200 * 1000, tool: 'write_file', input: (file) => ({ file_path: file, content: `${'n'.repeat(200 * 1000)}\n` }) },
  { name: 'write_file, one line over 900 KB', old: 900 * 1000, tool: 'write_file', input: (file) => ({ file_path: file, content: 'short\n' }) },
  { name: 'edit of a 900 KB file', old: 900 * 1000, tool: 'edit', input: (file) => ({ file_path: file, old_string: 'marker-old', new_string: 'marker-new' }) },
];
async function largeWrites(mode) {
  const tag = `X6-${mode}`;
  let clean = 0;
  for (const [index, w] of WRITES.entries()) {
    const s = await open(mode);
    const file = path.join(s.cwd, `x6-${index}-${s.runtimeSessionId.slice(0, 6)}.txt`);
    fs.writeFileSync(file, `HEAD marker-old\n${'o'.repeat(w.old)}\n`);
    const before = fs.readFileSync(file, 'utf8').slice(0, 22);
    const steps = [];
    const mark = ledgerMark();
    let reference;
    let reserved;
    const step = async (name, fn) => {
      const m = ledgerMark();
      const r = await attempt(fn);
      const wire = ledger(m).filter((e) => e.path.endsWith('/control')).map((e) => `${e.kind} -> ${e.status}${e.status === 200 ? ` ${kib(e.responseBytes)}` : ` ${e.response?.code} "${e.response?.error}"`}`);
      steps.push(`${name}: ${r.ok ? 'ok' : `${r.status} ${r.code}`} [worker: ${wire.join(', ') || 'no request'}]`);
      return r;
    };
    const prepared = await step('prepare', () => s.client.prepare(s.identity(`x6-${index}`), w.tool, w.input(file)));
    if (prepared.ok) {
      reference = ref(prepared.value);
      const r = await step('reserve', () => s.client.prepareExecution(reference));
      if (r.ok) reserved = r.value;
      await step('confirmation', () => s.client.confirmation(reference));
      if (mode === 'v1') await step('confirm', () => s.client.confirm(reference, 'proceed_once'));
      await step('preflight', () => s.client.preflight(reference));
      if (reserved) {
        const ran = await step('start', () => s.client.startExecution(reference, reserved.executionCallId));
        if (ran.ok) steps.push(`result ${ran.value.executionStatus}`);
      }
    }
    const rows = executions(s.runtimeSessionId).map((r) => `${r.state}/${r.status}`);
    const released = await s.release();
    const after = fs.readFileSync(file, 'utf8').slice(0, 22);
    const session = runtimeSession(s.runtimeSessionId)?.state;
    say(tag, `${w.name}: ${steps.join(' | ')}`);
    say(tag, `    records ${JSON.stringify(rows)} | file ${after === before ? 'unchanged' : `now starts with ${JSON.stringify(after)}`} | release ${released.ok ? 'ok' : short(released).slice(0, 110)} | Session ${session}${mode === 'v2' ? ` | storage held=${held(s.runtimeSessionId)}` : ''}`);
    if (released.ok && session === 'RELEASED' && !(mode === 'v2' && held(s.runtimeSessionId))) clean++;
    s.provider.dispose();
  }
  check(`${tag}.1`, 'wherever a large write stops, the Session releases and nothing stays held', clean === WRITES.length, `${clean} of ${WRITES.length}`);
}

const modes = process.env.MODES ? process.env.MODES.split(',') : ['v1', 'v2'];
for (const group of groups) {
  for (const mode of modes) {
    say('GROUP', `${group} ${mode} arm=${ARM}`);
    try {
      if (group === 'X1') await cutAnatomy(mode);
      if (group === 'X2') await sessionIds(mode);
      if (group === 'X2s') await asciiSweep(mode);
      if (group === 'X4') await workerLost(mode);
      if (group === 'X5') await modification(mode);
      if (group === 'X6') await largeWrites(mode);
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
