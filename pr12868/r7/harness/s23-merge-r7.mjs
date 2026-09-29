// PR #12868 round 7, head 174f974e3e: the merge with main 12793013c4.
// main #12975 refuses a tool name or a tool input that holds an unpaired
// surrogate, because the Broker's writer would send it to the worker as '?'.
// The merge wrote that check by hand into the branch this PR had made of the
// deferred start. This PR adds a second way for a tool input to reach a
// worker, the provider's `prepare`, which #12975 never saw.
//   Y1 raw path, deferred payload: an unpaired surrogate in a string of the
//      input, in a key of the input, in the tool name
//   Y2 provider path: the same three through `prepare`, by the TypeScript
//      client and by a request the rig sends to the Broker
//   Y3 a surrogate pair passes both paths unchanged
// Commit 50fb28301e also keeps two other rules of main on the provider path:
//   Y4 a Shell call whose directory lies outside the Session's workspace
//      (main #12927: core's shell tool asks there; a preapproved Session never asks)
//   Y5 a status cursor the worker writes in a number form that is not an
//      exact integer (main #12972 reads the others exactly)
// Commit 9cb9dc86e8:
//   Y6 the answer to execute is lost on the provider path; start, read and
//      cancel over Broker HTTP ask the worker what became of the call
//   Y7 the directory of a Shell call is a link that is moved out of the
//      workspace after the call was prepared
//   Y8 a start the worker refuses (the call was never permitted to run):
//      what the caller gets, and what the Broker keeps asking the worker
// usage: ARM=.. DB=.. ports.. node s23-merge-r7.mjs <groups> <storage letters>
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  ROOTS, BROKER_URL, BROKER_TOKEN, ARM, attempt, brief, broker, check, createSession, executions, holders,
  hook, clearHooks, ledger, ledgerMark, loadProvider, openLog, prepareRequest, runtimeSession, say, seedRegistry, sleep, summary,
} from './lib.mjs';

const groups = (process.argv[2] ?? 'Y1,Y2,Y3').split(',');
const letters = (process.argv[3] ?? 'a,b,c,d,e,f').split(',');
let letterIndex = 0;
openLog(`s23-merge-r7-${ARM}-${groups.join('')}`);
const LONE = '\ud800';
const PAIR = '😀';
const REF_KEYS = ['sessionId', 'promptId', 'callId', 'capabilityDigest', 'policyRevision', 'invocationId', 'argsDigest'];
const answer = (r) => `${r.status}${r.code ? ` ${r.code}` : ''}`;
const short = (a) => brief(a).replace(/BrokerResponseError: Managed Runtime Broker returned HTTP \d+\. ?/, '').slice(0, 170);
// Text as it is, with every code unit outside printable ASCII written out.
const shown = (text) => JSON.stringify(String(text).replaceAll(ROOTS, '<roots>').replaceAll(fs.realpathSync(ROOTS), '<roots>')).replace(/[^\x20-\x7e]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
const bytesOf = (file) => (fs.existsSync(file) ? [...fs.readFileSync(file)].map((b) => b.toString(16).padStart(2, '0')).join(' ') : '<no file>');
const held = (id) => holders().some(([, h]) => h === id);

function place() {
  const letter = letters[letterIndex++ % letters.length];
  const ws = `ws-${letter}-${Date.now()}`;
  seedRegistry(ws, `st-${letter}`);
  return { letter, ws };
}

// Y1 -------------------------------------------------------------------------
async function rawSession() {
  const { ws, letter } = place();
  const harness = await createSession(ws);
  const cwd = fs.realpathSync(path.join(ROOTS, letter, 'child'));
  const runtimeSessionId = randomUUID();
  const base = { protocolVersion: 1, harnessSessionId: harness, runtimeSessionId };
  const acquire = await broker('POST', 'tool-sessions:acquire', { ...base, requestId: randomUUID(), turnKind: 'bootstrap' });
  if (acquire.status !== 200) throw new Error(`acquire ${answer(acquire)}`);
  return { harness, cwd, runtimeSessionId, base };
}
async function rawCall(s, callId, toolName, input) {
  const payloadJson = JSON.stringify({ toolName, input });
  const digest = `sha256:${createHash('sha256').update(payloadJson).digest('hex')}`;
  const reference = { sessionId: s.runtimeSessionId, promptId: 'p1', callId, argsDigest: digest };
  const reserve = await broker('POST', 'executions:prepare', {
    ...s.base, requestId: randomUUID(), idempotencyKey: randomUUID(), turnId: 'p1', toolCallId: callId, requestDigest: digest, reference });
  if (reserve.status !== 200) return { reserve, start: undefined, sent: [], row: undefined };
  const mark = ledgerMark();
  const start = await broker('POST', `executions/${reserve.json.executionCallId}:start`, { ...s.base, requestId: randomUUID(), payloadJson });
  let row;
  for (let i = 0; i < 100; i++) {
    row = executions(s.runtimeSessionId).find((r) => r.id === reserve.json.executionCallId);
    if (start.status !== 200 || row.state === 'SETTLED' || row.state === 'UNKNOWN') break;
    await sleep(100);
  }
  const sent = ledger(mark).filter((e) => e.path.endsWith('/execute'));
  return { reserve, start, sent, row };
}
async function rawRelease(s) {
  const r = await broker('POST', `tool-sessions/${s.runtimeSessionId}:release`, { protocolVersion: 1, requestId: randomUUID(), harnessSessionId: s.harness });
  return { r, state: runtimeSession(s.runtimeSessionId)?.state, held: held(s.runtimeSessionId) };
}

async function rawPath() {
  const tag = 'Y1';
  const s = await rawSession();
  const file = (n) => path.join(s.cwd, `y1-${n}.txt`);
  const cases = [
    ['a string of the input', 'write_file', { file_path: file('string'), content: `a${LONE}b\n` }, file('string')],
    ['a key of the input', 'write_file', { file_path: file('key'), content: 'key\n', [`k${LONE}`]: 'v' }, file('key')],
    ['the tool name', `write_file${LONE}`, { file_path: file('name'), content: 'name\n' }, file('name')],
  ];
  const rows = [];
  for (const [what, toolName, input, target] of cases) {
    const got = await rawCall(s, `y1-${rows.length + 1}`, toolName, input);
    const wire = got.sent[0]?.request;
    const row = { what, id: got.reserve.json?.executionCallId, reserve: answer(got.reserve), start: got.start ? answer(got.start) : '-', sent: got.sent.length, record: got.row ? `${got.row.state}/${got.row.status}` : '-', file: bytesOf(target) };
    rows.push(row);
    say(tag, `raw path, an unpaired surrogate in ${what} | reserve ${row.reserve} | start ${row.start}${got.start && got.start.status !== 200 ? ` "${String(got.start.json?.error).slice(0, 60)}"` : ''} | requests to the worker: ${row.sent}${wire ? ` | the worker received toolName=${shown(wire.toolName)} input=${shown(JSON.stringify(wire.input)).slice(0, 200)}` : ''} | record ${row.record} | file bytes: ${row.file}`);
  }
  const early = await rawRelease(s);
  say(tag, `release while the refused reservations stand: ${answer(early.r)} | Session ${early.state} | storage held=${early.held}`);
  const cancels = [];
  for (const r of rows.filter((x) => x.id && x.record.startsWith('PREPARED'))) {
    const c = await broker('POST', `executions/${r.id}:cancel`, { ...s.base, requestId: randomUUID() });
    cancels.push(answer(c));
  }
  say(tag, `the caller cancels the reservations: ${cancels.join(', ') || 'none stands'} | records ${executions(s.runtimeSessionId).map((r) => `${r.state}/${r.status}`).join(', ')}`);
  const released = await rawRelease(s);
  say(tag, `release afterwards ${answer(released.r)}${released.r.status === 200 ? '' : ` "${String(released.r.json?.error).slice(0, 80)}"`} | Session ${released.state} | storage held=${released.held}`);
  const refused = rows.filter((r) => r.start === '400 runtime_payload_invalid' && r.sent === 0 && r.file === '<no file>');
  say(tag, `OBSERVED: refused before anything was sent: ${refused.length} of ${rows.length}`);
  check(`${tag}.1`, 'raw path: a deferred start whose tool name or input holds an unpaired surrogate answers 400 runtime_payload_invalid, and nothing is sent to the worker', refused.length === rows.length, JSON.stringify(rows.map((r) => `${r.start}/${r.sent}`)));
  check(`${tag}.2`, 'once the caller has cancelled the refused reservations the Session is released and its storage is free', released.r.status === 200 && released.state === 'RELEASED' && !released.held, `release ${answer(released.r)}, Session ${released.state}`);
}

// Y2 -------------------------------------------------------------------------
let provider;
async function providerSession(own) {
  if (!provider) {
    const { BrokerManagedRuntimeProvider } = await loadProvider();
    provider = new BrokerManagedRuntimeProvider({ baseUrl: BROKER_URL, token: BROKER_TOKEN });
  }
  const using = own ?? provider;
  const { ws, letter } = place();
  const harness = await createSession(ws);
  const cwd = fs.realpathSync(path.join(ROOTS, letter, 'child'));
  const runtimeSessionId = randomUUID();
  const request = prepareRequest(runtimeSessionId, 'bootstrap', cwd);
  const client = await using.getToolV2Client(request, { harnessSessionId: harness });
  await client.fileHistory.bind({ ownerSessionId: harness, ownerRuntimeSessionId: runtimeSessionId, executionCwd: cwd, snapshots: [] });
  const manifest = await client.manifest();
  const identity = (callId) => ({ sessionId: runtimeSessionId, promptId: 'p1', callId, capabilityDigest: manifest.capabilityDigest, policyRevision: manifest.policyRevision });
  await client.beginTurn(identity('turn'));
  return { harness, cwd, runtimeSessionId, request, client, identity };
}
// One call of the provider path, as a Hosted turn makes it: prepare, reserve,
// preflight, start. Boot v2, so the call needs no confirmation.
async function providerCall(s, callId, toolName, input, byRig) {
  const mark = ledgerMark();
  let prepared;
  if (byRig) {
    const r = await broker('POST', `tool-sessions/${s.runtimeSessionId}/control`, {
      protocolVersion: 1, requestId: randomUUID(), harnessSessionId: s.harness,
      operation: { kind: 'prepare', identity: s.identity(callId), toolName, input } });
    prepared = r.status === 200 ? { ok: true, value: r.json.result } : { ok: false, status: r.status, code: r.code, message: String(r.json?.error) };
  } else {
    prepared = await attempt(() => s.client.prepare(s.identity(callId), toolName, input));
  }
  const sent = ledger(mark).filter((e) => e.kind === 'prepare');
  if (!prepared.ok) return { prepared, sent, ran: undefined };
  const reference = Object.fromEntries(REF_KEYS.map((k) => [k, prepared.value[k]]));
  const ran = await attempt(async () => {
    const reserved = await s.client.prepareExecution(reference);
    await s.client.preflight(reference);
    return s.client.startExecution(reference, reserved.executionCallId);
  });
  return { prepared, sent, ran };
}

async function providerPath() {
  const tag = 'Y2';
  const s = await providerSession();
  for (const n of [1, 2]) fs.writeFileSync(path.join(s.cwd, `data-${n}.txt`), `file ${n}\n`);
  const file = (n) => path.join(s.cwd, `y2-${n}.txt`);
  const listing = file('listing');
  const cases = [
    ['a string of the input (write_file content)', 'write_file', { file_path: file('string'), content: `a${LONE}b\n` }, file('string'), false],
    ['the same, sent to the Broker by the rig', 'write_file', { file_path: file('rig'), content: `a${LONE}b\n` }, file('rig'), true],
    ['a Shell command', 'run_shell_command', { command: `ls data-${LONE}.txt > ${listing} 2>&1`, is_background: false }, listing, false],
    ['a key of the input', 'write_file', { file_path: file('key'), content: 'key\n', [`k${LONE}`]: 'v' }, file('key'), false],
    ['the tool name', `write_file${LONE}`, { file_path: file('name'), content: 'name\n' }, file('name'), false],
  ];
  const rows = [];
  for (const [what, toolName, input, target, byRig] of cases) {
    const got = await providerCall(s, `y2-${rows.length + 1}`, toolName, input, byRig);
    const wire = got.sent[0]?.request?.operation;
    const sentText = wire ? JSON.stringify({ toolName: wire.toolName, input: wire.input }) : '';
    const callerText = JSON.stringify({ toolName, input });
    const row = {
      what, name: toolName.includes(LONE), prepare: got.prepared.ok ? '200' : `${got.prepared.status} ${got.prepared.code}`,
      sent: got.sent.length, same: wire ? sentText === callerText : undefined,
      ran: got.ran === undefined ? '-' : got.ran.ok ? got.ran.value.executionStatus : short(got.ran),
      file: fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : undefined, bytes: bytesOf(target),
    };
    rows.push(row);
    say(tag, `provider path, an unpaired surrogate in ${what} | the caller sent ${shown(callerText).slice(0, 220)}`);
    say(tag, `  prepare ${row.prepare}${got.prepared.ok ? '' : ` "${String(got.prepared.message).slice(0, 80)}"`} | requests to the worker: ${row.sent}${wire ? ` | the worker received ${shown(sentText).slice(0, 220)}` : ''}`);
    if (got.ran !== undefined) say(tag, `  the call ran: ${row.ran} | ${path.basename(target)}: ${row.file === undefined ? '<no file>' : shown(row.file)}${toolName === 'write_file' ? ` | bytes ${row.bytes}` : ''}`);
  }
  const released = await attempt(() => provider.release(s.runtimeSessionId, s.request, { terminal: true }));
  say(tag, `release afterwards: ${released.ok ? 'ok' : short(released)} | Session ${runtimeSession(s.runtimeSessionId)?.state} | storage held=${held(s.runtimeSessionId)}`);
  const name = rows.find((r) => r.name);
  const inputs = rows.filter((r) => !r.name);
  const altered = inputs.filter((r) => r.sent > 0 && r.same === false);
  const ranAltered = altered.filter((r) => r.ran === 'success');
  say(tag, `OBSERVED: of ${inputs.length} inputs holding an unpaired surrogate, the Broker refused ${inputs.filter((r) => r.prepare !== '200' && r.sent === 0).length}, sent ${altered.length} to the worker as other text, and ${ranAltered.length} of those ran`);
  check(`${tag}.1`, 'provider path: a tool name holding an unpaired surrogate is refused with 400, and nothing is sent to the worker', name.prepare.startsWith('400') && name.sent === 0, `${name.prepare}, sent ${name.sent}`);
  check(`${tag}.2`, 'provider path: a tool input holding an unpaired surrogate does not reach the worker as other text', altered.length === 0, `${altered.length} of ${inputs.length} reached the worker altered; ran: ${ranAltered.length}`);
  check(`${tag}.3`, 'the Session is released afterwards', released.ok && runtimeSession(s.runtimeSessionId)?.state === 'RELEASED' && !held(s.runtimeSessionId));
}

// Y3 -------------------------------------------------------------------------
async function pairs() {
  const tag = 'Y3';
  const raw = await rawSession();
  const rawFile = path.join(raw.cwd, 'y3-raw.txt');
  const viaRaw = await rawCall(raw, 'y3-raw', 'write_file', { file_path: rawFile, content: `a${PAIR}b\n` });
  const rawReleased = await rawRelease(raw);
  say(tag, `raw path, a surrogate pair (U+1F600) | start ${viaRaw.start ? answer(viaRaw.start) : '-'} | record ${viaRaw.row?.state}/${viaRaw.row?.status} | file bytes: ${bytesOf(rawFile)} | release ${answer(rawReleased.r)}`);
  const s = await providerSession();
  const file = path.join(s.cwd, 'y3-provider.txt');
  const viaProvider = await providerCall(s, 'y3-provider', 'write_file', { file_path: file, content: `a${PAIR}b\n` }, false);
  const released = await attempt(() => provider.release(s.runtimeSessionId, s.request, { terminal: true }));
  say(tag, `provider path, the same | prepare ${viaProvider.prepared.ok ? '200' : short(viaProvider.prepared)} | the call ran: ${viaProvider.ran?.ok ? viaProvider.ran.value.executionStatus : viaProvider.ran ? short(viaProvider.ran) : '-'} | file bytes: ${bytesOf(file)} | release ${released.ok ? 'ok' : short(released)}`);
  const want = '61 f0 9f 98 80 62 0a';
  check(`${tag}.1`, 'a surrogate pair passes both paths and is written as the four bytes of its code point', bytesOf(rawFile) === want && bytesOf(file) === want && rawReleased.r.status === 200 && released.ok, `raw ${bytesOf(rawFile)}, provider ${bytesOf(file)}`);
}

// Y4 -------------------------------------------------------------------------
async function outsideDirectory() {
  const tag = 'Y4';
  const s = await providerSession();
  const other = letters[letterIndex % letters.length];
  const outside = fs.realpathSync(path.join(ROOTS, other, 'child'));
  const rows = [];
  const link = path.join(s.cwd, 'y4-link');
  fs.rmSync(link, { force: true });
  fs.symlinkSync(outside, link);
  const dotted = `${s.cwd}/../../${other}/child`;
  for (const [what, directory] of [['outside the workspace (the directory of another storage)', outside], ['inside the workspace', s.cwd], ['that leaves the workspace through ..', dotted], ['that is a symbolic link inside the workspace to a directory outside', link]]) {
    const where = path.join(s.cwd, `y4-${rows.length + 1}.txt`);
    const got = await providerCall(s, `y4-${rows.length + 1}`, 'run_shell_command', { command: `pwd > ${where}`, directory, is_background: false }, false);
    const ranIn = fs.existsSync(where) ? fs.readFileSync(where, 'utf8').trim() : undefined;
    rows.push({ what, prepare: got.prepared.ok ? '200' : `${got.prepared.status} ${got.prepared.code}`, ran: got.ran === undefined ? '-' : got.ran.ok ? got.ran.value.executionStatus : short(got.ran), ranIn, directory });
    say(tag, `provider path, run_shell_command with a directory ${what} | prepare ${rows.at(-1).prepare}${got.prepared.ok ? '' : ` "${String(got.prepared.message).replace(/^Managed Runtime Broker returned HTTP \d+\. ?/, '').replaceAll(ROOTS, '<roots>').replaceAll(fs.realpathSync(ROOTS), '<roots>').slice(0, 110)}"`} | the call ran: ${rows.at(-1).ran}${ranIn === undefined ? '' : ` | pwd printed ${shown(ranIn)}`}`);
  }
  const released = await attempt(() => provider.release(s.runtimeSessionId, s.request, { terminal: true }));
  // The raw path, for comparison: the executor holds the same rule.
  const raw = await rawSession();
  const rawWhere = path.join(raw.cwd, 'y4-raw.txt');
  const rawOutside = fs.realpathSync(path.join(ROOTS, letters[(letterIndex) % letters.length], 'child'));
  const viaRaw = await rawCall(raw, 'y4-raw', 'run_shell_command', { command: `pwd > ${rawWhere}`, directory: rawOutside, is_background: false });
  const answerOfWorker = viaRaw.sent[0];
  say(tag, `raw path, the same call | start ${viaRaw.start ? answer(viaRaw.start) : '-'} | worker ${answerOfWorker ? `-> ${answerOfWorker.status}${answerOfWorker.status === 200 ? '' : ` ${answerOfWorker.response?.code} "${String(answerOfWorker.response?.error).replaceAll(fs.realpathSync(ROOTS), '<roots>').slice(0, 110)}"`}` : 'not asked'} | record ${viaRaw.row?.state}/${viaRaw.row?.status} | pwd printed ${fs.existsSync(rawWhere) ? shown(fs.readFileSync(rawWhere, 'utf8').trim()) : 'nothing'}`);
  say(tag, `release of the provider Session: ${released.ok ? 'ok' : short(released)}`);
  const [out, inside, ...indirect] = rows;
  const escaped = indirect.filter((r) => r.ranIn !== undefined && !r.ranIn.startsWith(s.cwd));
  say(tag, `OBSERVED: the call with a directory outside the workspace ${out.ranIn === undefined ? 'did not run' : `ran in ${shown(out.ranIn)}`}`);
  check(`${tag}.1`, 'provider path: a Shell call with a directory outside the workspace is refused with 400 managed_runtime_tool_invalid and does not run', out.prepare === '400 managed_runtime_tool_invalid' && out.ranIn === undefined, `prepare ${out.prepare}, ran in ${out.ranIn ?? 'nothing'}`);
  check(`${tag}.2`, 'the same call with a directory inside the workspace runs there', inside.ran === 'success' && inside.ranIn === s.cwd, `${inside.ran}, in ${inside.ranIn}`);
  check(`${tag}.4`, 'neither a path through .. nor a symbolic link takes a call out of the workspace', escaped.length === 0, JSON.stringify(indirect.map((r) => `${r.prepare}: ${r.ranIn === undefined ? 'did not run' : r.ranIn.replace(fs.realpathSync(ROOTS), '<roots>')}`)));
  check(`${tag}.3`, 'raw path: the same call does not run outside the workspace either', !fs.existsSync(rawWhere), `record ${viaRaw.row?.state}/${viaRaw.row?.status}`);
}

// Y5 -------------------------------------------------------------------------
async function cursorForms() {
  const tag = 'Y5';
  const rows = [];
  for (const form of ['65540S', '260B', '1.0000000000000001D', '4']) {
    const s = await providerSession();
    const prepared = await s.client.prepare(s.identity('y5'), 'write_file', { file_path: path.join(s.cwd, 'y5.txt'), content: 'y5\n' });
    const reference = Object.fromEntries(REF_KEYS.map((k) => [k, prepared[k]]));
    const reserved = await s.client.prepareExecution(reference);
    // The worker's answer to the cancellation, with its cursor in this form.
    const body = `{"protocolVersion":1,"providerProtocol":"managed-runtime-provider/1","session":{"harnessSessionId":"${s.harness}","turnKind":"bootstrap","runtimeSessionId":"${s.runtimeSessionId}"},"result":{"state":"cancel_requested","cancelRequested":true,"lastSeq":${form},"firstAvailableSeq":1,"progressGap":false,"progress":[]}}`;
    await hook({ kind: 'cancel', action: 'rewrite', count: 1, body });
    const base = { protocolVersion: 1, harnessSessionId: s.harness, runtimeSessionId: s.runtimeSessionId };
    const mark = ledgerMark();
    const first = await broker('POST', `executions/${reserved.executionCallId}:cancel`, { ...base, requestId: randomUUID() });
    const seen = ledger(mark).filter((e) => e.kind).map((e) => `${e.kind}${e.fault ? ' (answer rewritten)' : ''}`);
    await clearHooks();
    const record = () => executions(s.runtimeSessionId).map((r) => `${r.state}/${r.status}`).join(',');
    const after = record();
    const again = await broker('POST', `executions/${reserved.executionCallId}:cancel`, { ...base, requestId: randomUUID() });
    const released = await attempt(() => provider.release(s.runtimeSessionId, s.request, { terminal: true }));
    rows.push({ form, first: answer(first), again: answer(again), released: released.ok });
    say(tag, `the worker answers a cancellation with lastSeq written as ${form} | the Broker answers the caller ${answer(first)}${first.status === 200 ? ` ${first.json?.status?.result?.executionStatus ?? first.json?.status?.state ?? ''}` : ` "${String(first.json?.error).slice(0, 70)}"`} | sent to the worker: ${seen.join(', ')} | record ${after} | cancel again, answer untouched: ${answer(again)}${again.status === 200 ? ` ${again.json?.status?.result?.executionStatus ?? ''}` : ''} | release ${released.ok ? 'ok' : short(released).slice(0, 80)}`);
  }
  const odd = rows.filter((r) => r.form !== '4');
  const plain = rows.find((r) => r.form === '4');
  say(tag, `OBSERVED: cursors that are not exact integers and were taken as one: ${odd.filter((r) => r.first.startsWith('200')).length} of ${odd.length}`);
  check(`${tag}.1`, 'a cursor that is not written as an exact integer is refused, not read as another number', odd.every((r) => !r.first.startsWith('200')), JSON.stringify(odd.map((r) => `${r.form}: ${r.first}`)));
  check(`${tag}.2`, 'a plain integer cursor is accepted', plain.first.startsWith('200'), plain.first);
  check(`${tag}.3`, 'after a refused answer the cancellation can be repeated and the Session released', rows.every((r) => r.again.startsWith('200') && r.released), JSON.stringify(rows.map((r) => `${r.again}/${r.released}`)));
}

// Y6 -------------------------------------------------------------------------
async function lostAnswer() {
  const tag = 'Y6';
  const s = await providerSession();
  const marker = path.join(s.cwd, 'y6-marker.txt');
  const prepared = await s.client.prepare(s.identity('y6'), 'run_shell_command', { command: `echo ran >> ${marker}`, is_background: false });
  const reference = Object.fromEntries(REF_KEYS.map((k) => [k, prepared[k]]));
  const reserved = await s.client.prepareExecution(reference);
  await s.client.preflight(reference);
  const base = { protocolVersion: 1, harnessSessionId: s.harness, runtimeSessionId: s.runtimeSessionId };
  const id = reserved.executionCallId;
  const record = () => executions(s.runtimeSessionId).filter((r) => r.id === id).map((r) => `${r.state}/${r.status}`).join(',');
  const lines = () => (fs.existsSync(marker) ? fs.readFileSync(marker, 'utf8').split('\n').filter(Boolean).length : 0);
  const wireOf = (mark) => ledger(mark).filter((e) => e.kind).map((e) => `${e.kind}${e.fault ? ` (${e.fault})` : ''}`);
  const told = (r) => `${answer(r)}${r.status === 200 ? ` ${r.json?.status?.state ?? ''}${r.json?.status?.result?.executionStatus ? `/${r.json.status.result.executionStatus}` : ''}` : ` "${String(r.json?.error).slice(0, 60)}"`}`;
  await hook({ kind: 'execute', action: 'drop-reply', count: 1 });
  let mark = ledgerMark();
  const first = await broker('POST', `executions/${id}:start`, { ...base, requestId: randomUUID() });
  await clearHooks();
  await sleep(1500);
  say(tag, `provider path, the worker's answer to execute is lost | start answers ${told(first)} | sent to the worker: ${wireOf(mark).join(', ')} | record ${record()} | the command ran ${lines()} time(s)`);
  mark = ledgerMark();
  const read = await broker('GET', `executions/${id}?requestId=${randomUUID()}&harnessSessionId=${s.harness}&runtimeSessionId=${s.runtimeSessionId}`);
  say(tag, `read afterwards: ${told(read)} | sent to the worker: ${wireOf(mark).join(', ') || 'nothing'} | record ${record()}`);
  mark = ledgerMark();
  const again = await broker('POST', `executions/${id}:start`, { ...base, requestId: randomUUID() });
  const cancel = await broker('POST', `executions/${id}:cancel`, { ...base, requestId: randomUUID() });
  const sentAgain = wireOf(mark);
  say(tag, `start sent again: ${told(again)} | cancel: ${told(cancel)} | sent to the worker: ${sentAgain.join(', ') || 'nothing'} | record ${record()} | the command ran ${lines()} time(s)`);
  const released = await attempt(() => provider.release(s.runtimeSessionId, s.request, { terminal: true }));
  say(tag, `release: ${released.ok ? 'ok' : short(released)} | Session ${runtimeSession(s.runtimeSessionId)?.state} | storage held=${held(s.runtimeSessionId)}`);
  const executes = ledger().filter((e) => e.kind === 'execute' && JSON.stringify(e.request ?? {}).includes(s.runtimeSessionId)).length;
  say(tag, `OBSERVED: execute requests for this call: ${executes} | the record ends ${record()}`);
  check(`${tag}.1`, 'the command runs once and is never dispatched a second time', lines() === 1 && executes === 1, `ran ${lines()} time(s), execute requests ${executes}`);
  check(`${tag}.2`, 'a read over Broker HTTP settles the record from the result the worker kept', read.status === 200 && read.json?.status?.state === 'settled' && record() === 'SETTLED/success', `read ${told(read)}, record ${record()}`);
  check(`${tag}.3`, 'start sent again answers the settled result, and the Session is released with its storage free', again.status === 200 && released.ok && runtimeSession(s.runtimeSessionId)?.state === 'RELEASED' && !held(s.runtimeSessionId), `start again ${told(again)}, release ${released.ok ? 'ok' : short(released).slice(0, 80)}`);
}

// Y7 -------------------------------------------------------------------------
async function movedLink() {
  const tag = 'Y7';
  const s = await providerSession();
  const other = letters[letterIndex % letters.length];
  const outside = fs.realpathSync(path.join(ROOTS, other, 'child'));
  const inside = path.join(s.cwd, 'y7-inside');
  fs.mkdirSync(inside, { recursive: true });
  const link = path.join(s.cwd, 'y7-link');
  fs.rmSync(link, { force: true });
  fs.symlinkSync(inside, link);
  const where = path.join(s.cwd, 'y7-where.txt');
  const prepared = await attempt(() => s.client.prepare(s.identity('y7'), 'run_shell_command', { command: `pwd -P > ${where}`, directory: link, is_background: false }));
  let ran;
  if (prepared.ok) {
    const reference = Object.fromEntries(REF_KEYS.map((k) => [k, prepared.value[k]]));
    const reserved = await s.client.prepareExecution(reference);
    await s.client.preflight(reference);
    fs.rmSync(link, { force: true });
    fs.symlinkSync(outside, link);
    ran = await attempt(() => s.client.startExecution(reference, reserved.executionCallId));
  }
  const ranIn = fs.existsSync(where) ? fs.readFileSync(where, 'utf8').trim() : undefined;
  const outcome = ran === undefined ? '-' : ran.ok ? ran.value.executionStatus : short(ran);
  const message = ran?.ok ? JSON.stringify(ran.value.result?.error?.message ?? ran.value.result?.llmContent ?? '').replaceAll(fs.realpathSync(ROOTS), '<roots>').slice(0, 130) : '';
  say(tag, `a Shell call is prepared with a directory that is a link to a directory inside the workspace: prepare ${prepared.ok ? '200' : short(prepared)} | the link is then pointed at the directory of another storage | start: ${outcome}${message && outcome !== 'success' ? ` ${message}` : ''} | pwd -P printed ${ranIn === undefined ? 'nothing' : shown(ranIn)} | record ${executions(s.runtimeSessionId).map((r) => `${r.state}/${r.status}`).join(',')}`);
  const released = await attempt(() => provider.release(s.runtimeSessionId, s.request, { terminal: true }));
  say(tag, `release: ${released.ok ? 'ok' : short(released)} | Session ${runtimeSession(s.runtimeSessionId)?.state}`);
  say(tag, `OBSERVED: the call ${ranIn === undefined ? 'did not run' : ranIn.startsWith(outside) ? 'ran outside the workspace' : 'ran inside the workspace'}`);
  check(`${tag}.1`, 'a link moved out of the workspace after prepare does not take the call with it: the call settles as an error and does not run', prepared.ok && outcome === 'error' && ranIn === undefined, `start ${outcome}, pwd ${ranIn ?? 'nothing'}`.replaceAll(fs.realpathSync(ROOTS), '<roots>'));
  check(`${tag}.2`, 'the Session is released afterwards', released.ok && runtimeSession(s.runtimeSessionId)?.state === 'RELEASED');
}

// Y8 -------------------------------------------------------------------------
async function refusedStart() {
  const tag = 'Y8';
  const LIMIT = 20_000;
  // A provider of its own: disposing it ends whatever this start left running.
  const { BrokerManagedRuntimeProvider } = await loadProvider();
  const own = new BrokerManagedRuntimeProvider({ baseUrl: BROKER_URL, token: BROKER_TOKEN });
  const s = await providerSession(own);
  const file = path.join(s.cwd, 'y8.txt');
  const prepared = await s.client.prepare(s.identity('y8'), 'write_file', { file_path: file, content: 'y8\n' });
  const reference = Object.fromEntries(REF_KEYS.map((k) => [k, prepared[k]]));
  const reserved = await s.client.prepareExecution(reference);
  const id = reserved.executionCallId;
  const base = { protocolVersion: 1, harnessSessionId: s.harness, runtimeSessionId: s.runtimeSessionId };
  const record = () => executions(s.runtimeSessionId).filter((r) => r.id === id).map((r) => `${r.state}/${r.status}`).join(',');
  const told = (r) => `${answer(r)}${r.status === 200 ? ` ${r.json?.status?.state ?? ''}${r.json?.status?.result?.executionStatus ? `/${r.json.status.result.executionStatus}` : ''}` : ` "${String(r.json?.error).slice(0, 60)}"`}`;
  const count = (mark, kind) => ledger(mark).filter((e) => e.kind === kind).length;
  // The call was prepared and reserved, but preflight never permitted it to run.
  const mark = ledgerMark();
  const began = Date.now();
  const outcome = await Promise.race([attempt(() => s.client.startExecution(reference, id)), sleep(LIMIT).then(() => 'waiting')]);
  const waited = ((Date.now() - began) / 1000).toFixed(1);
  const refusal = ledger(mark).find((e) => e.kind === 'execute');
  say(tag, `provider path, start of a call preflight never permitted | the worker answers execute with ${refusal?.status} ${refusal?.response?.code} "${refusal?.response?.error}"`);
  say(tag, `the caller's start: ${outcome === 'waiting' ? `no answer after ${waited} s, still waiting` : `${outcome.ok ? outcome.value.executionStatus : short(outcome)} after ${waited} s`} | sent to the worker meanwhile: execute ${count(mark, 'execute')}, status ${count(mark, 'status')} | record ${record()} | file written=${fs.existsSync(file)}`);
  const direct = await broker('POST', `executions/${id}:start`, { ...base, requestId: randomUUID() });
  const read = await broker('GET', `executions/${id}?requestId=${randomUUID()}&harnessSessionId=${s.harness}&runtimeSessionId=${s.runtimeSessionId}`);
  say(tag, `asked of the Broker directly: start ${told(direct)} | read ${told(read)}`);
  const statusWhileWaiting = count(mark, 'status');
  const cancel = await broker('POST', `executions/${id}:cancel`, { ...base, requestId: randomUUID() });
  const afterCancel = record();
  own.dispose();
  await sleep(1000);
  const quiet = ledgerMark();
  await sleep(2000);
  const still = count(quiet, 'status');
  const released = await broker('POST', `tool-sessions/${s.runtimeSessionId}:release`, { protocolVersion: 1, requestId: randomUUID(), harnessSessionId: s.harness });
  say(tag, `the caller cancels: ${told(cancel)} | record ${afterCancel} | the provider is disposed; status requests in the next 2 s: ${still} | release ${answer(released)} | Session ${runtimeSession(s.runtimeSessionId)?.state} | storage held=${held(s.runtimeSessionId)} | file written=${fs.existsSync(file)}`);
  say(tag, `OBSERVED: the caller ${outcome === 'waiting' ? `had no answer within ${LIMIT / 1000} s` : 'was answered'}; status requests to the worker for a call that never ran: ${statusWhileWaiting}`);
  check(`${tag}.1`, `a start the worker refuses is answered to the caller, as a refusal, within ${LIMIT / 1000} s`, outcome !== 'waiting' && !outcome.ok, outcome === 'waiting' ? `no answer after ${waited} s` : short(outcome).slice(0, 120));
  check(`${tag}.2`, 'the worker is not asked again and again about a call it never started', statusWhileWaiting <= 3, `status requests: ${statusWhileWaiting}`);
  // The record of a refused start stays UNKNOWN and holds the Session on every build (F1 of round 1, deferred); it is reported, not checked.
  check(`${tag}.3`, 'the call has no effect', !fs.existsSync(file), `file written=${fs.existsSync(file)}`);
}

for (const g of groups) {
  try {
    if (g === 'Y8') await refusedStart();
    if (g === 'Y6') await lostAnswer();
    if (g === 'Y7') await movedLink();
    if (g === 'Y4') await outsideDirectory();
    if (g === 'Y5') await cursorForms();
    if (g === 'Y1') await rawPath();
    if (g === 'Y2') await providerPath();
    if (g === 'Y3') await pairs();
  } catch (error) {
    say(g, `ERROR ${error?.stack ?? error}`);
    check(`${g}.0`, 'the group ran to its end', false, String(error?.message ?? error).slice(0, 160));
  }
}
const ok = summary();
provider?.dispose();
process.exit(ok ? 0 : 1);
