// PR #12868 round 5: the behaviours commits ecacbfe488 and 803761aabd change,
// on the real chain (built TS provider -> Spring Broker on MySQL -> bundled worker).
//   W1 large tool results are fitted, not refused           (provider path, through the Broker)
//   W2 observation of large results and of heavy progress   (at the worker)
//   W3 Session ids that are not lowercase UUIDs             (provider path and raw path)
//   W4 terminal cancellation receipts without a READY Session (RELEASING; Broker restart is W5)
// usage: ARM=<pr|r4> ... node s16-r5.mjs <groups W1,W2,W3,W4> <storage letters>
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  ROOTS, BROKER_URL, BROKER_TOKEN, ARM, attempt, brief, broker, check, clearHooks, createSession, executions,
  holders, hook, inject, ledger, ledgerMark, loadProvider, openLog, prepareRequest, runtimeSession, say, seedRegistry,
  sleep, sql, summary, workerPortOf,
} from './lib.mjs';

const groups = (process.argv[2] ?? 'W1,W2,W3,W4').split(',');
const letters = (process.argv[3] ?? 'a,b,c,d,e,f,g,h').split(',');
let letterIndex = 0;
openLog(`s16-r5-${ARM}-${groups.join('')}`);
const REF_KEYS = ['sessionId', 'promptId', 'callId', 'capabilityDigest', 'policyRevision', 'invocationId', 'argsDigest'];
const ref = (prepared) => Object.fromEntries(REF_KEYS.map((k) => [k, prepared[k]]));
const providers = [];
const answer = (r) => `${r.status}${r.code ? ` ${r.code}` : ''}`;
const shown = (r) => `${r.status} ${r.status === 200 ? JSON.stringify(r.json?.result ?? r.json).slice(0, 120) : `${r.json?.code} "${r.json?.error}"`}`;
const PROVIDER = 'provider/v1/control';
const envelope = (session, operation) => ({ session, operation, protocolVersion: 1, providerProtocol: 'managed-runtime-provider/1' });
const kib = (n) => `${(n / 1024).toFixed(0)} KiB`;
const held = (id) => holders().some(([, h]) => h === id);

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
const storedBytes = (id) => Number(sql(`SELECT IFNULL(OCTET_LENGTH(result_json),0) FROM qwen_tool_execution WHERE execution_call_id='${id}'`)[0]?.[0] ?? 0);
const loneSurrogates = (text) => (text.match(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g) ?? []).length;
const texts = (result) => {
  const r = result?.result ?? {};
  const llm = typeof r.llmContent === 'string' ? r.llmContent : Array.isArray(r.llmContent) ? r.llmContent.map((p) => p?.text ?? '').join('') : '';
  const d = r.returnDisplay;
  const display = typeof d === 'string' ? d : d && typeof d === 'object' ? [d.output, d.text, d.error, d.fileDiff, d.newContent, d.originalContent].filter((x) => typeof x === 'string').join('') : '';
  return { llm, display, truncated: d && typeof d === 'object' ? d.truncated : undefined, displayType: d === undefined ? 'none' : typeof d === 'string' ? 'string' : Object.keys(d).sort().join(',') };
};

// W1 -------------------------------------------------------------------------
const CASES = [
  ['ascii 512 KiB', (s) => ['run_shell_command', { command: `perl -e 'print "x" x 524288'`, is_background: false }]],
  ['ascii 2 MiB', (s) => ['run_shell_command', { command: `perl -e 'print "x" x 2097152'`, is_background: false }]],
  ['60,000 lines', (s) => ['run_shell_command', { command: `perl -e 'print "line $_ of the output\\n" for 1..60000'`, is_background: false }]],
  ['CJK 750 KiB', (s) => ['run_shell_command', { command: `perl -CS -e 'print chr(0x4E2D) x 250000'`, is_background: false }]],
  ['emoji 800 KiB', (s) => ['run_shell_command', { command: `perl -CS -e 'print chr(0x1F600) x 200001'`, is_background: false }]],
  ['quotes and backslashes 400 KiB', (s) => ['run_shell_command', { command: `perl -e 'print q("\\\\) x 136534'`, is_background: false }]],
  ['edit of a 700 KiB file', (s) => {
    const file = path.join(s.cwd, `w1-big-${s.runtimeSessionId.slice(0, 6)}.txt`);
    fs.writeFileSync(file, `HEAD marker-old\n${'y'.repeat(700 * 1024)}\n`);
    s.bigFile = file;
    return ['edit', { file_path: file, old_string: 'marker-old', new_string: 'marker-new' }];
  }],
];
async function largeResults(mode) {
  const tag = `W1-${mode}`;
  let ok = 0;
  for (const [name, build] of CASES) {
    const s = await open(mode);
    const [toolName, input] = build(s);
    const callId = `w1-${createHash('sha256').update(name).digest('hex').slice(0, 6)}`;
    const outcome = await attempt(async () => {
      const { reference, reserved } = await s.ready(callId, toolName, input);
      const mark = ledgerMark();
      const result = await attempt(() => s.client.startExecution(reference, reserved.executionCallId));
      const wire = ledger(mark).find((e) => e.kind === 'execute');
      return { reference, reserved, result, wire };
    });
    if (!outcome.ok) {
      say(tag, `${name.padEnd(30)} could not be prepared: ${brief(outcome).slice(0, 200)}`);
      await s.release();
      continue;
    }
    const { reserved, result, wire } = outcome.value;
    const row = executions(s.runtimeSessionId).find((r) => r.id === reserved.executionCallId);
    const got = await getExecution(s, reserved.executionCallId);
    const t = result.ok ? texts(result.value) : { llm: '', display: '' };
    const noticed = /Managed Runtime provider omitted/.test(t.llm + t.display);
    const lone = loneSurrogates(t.llm + t.display);
    const released = await s.release();
    const effect = s.bigFile ? ` | file now starts with ${JSON.stringify(fs.readFileSync(s.bigFile, 'utf8').slice(0, 20))}` : '';
    say(tag, `${name.padEnd(30)} worker execute -> ${wire?.status} ${wire?.status === 200 ? kib(wire.responseBytes) : `${wire?.response?.code} "${wire?.response?.error}"`} | caller: ${result.ok ? `${result.value.executionStatus}, llmContent ${t.llm.length} chars, display ${t.display.length} chars [${t.displayType}]${t.truncated === undefined ? '' : ` truncated=${t.truncated}`}, notice=${noticed}, lone surrogates=${lone}` : brief(result).slice(0, 160)}`);
    say(tag, `${''.padEnd(30)} record ${row?.state}/${row?.status} stored ${kib(storedBytes(reserved.executionCallId))} | GET ${answer(got)} | release ${released.ok ? 'ok' : brief(released).slice(0, 90)} | storage held=${held(s.runtimeSessionId)}${effect}`);
    const good = wire?.status === 200 && result.ok && row?.state === 'SETTLED' && got.status === 200 && released.ok && !held(s.runtimeSessionId) && lone === 0;
    if (good) ok++;
    s.provider.dispose();
  }
  check(`${tag}.1`, `every large result settles, stays readable and lets the Session release (${CASES.length} cases)`, ok === CASES.length, `${ok} of ${CASES.length}`);
}

// W1d ------------------------------------------------------------------------
// Where the cut lands: field by field, at the worker (status sent by the rig)
// and at the caller (start through the Broker).
const CUTS = [
  ['emoji x 150,000', `perl -CS -e 'print chr(0x1F600) x 150000'`],
  ['one letter, then emoji x 150,000', `perl -CS -e 'print "a"; print chr(0x1F600) x 150000'`],
  ['CJK x 250,000', `perl -CS -e 'print chr(0x4E2D) x 250000'`],
  ['ascii x 600,000', `perl -e 'print "x" x 600000'`],
];
const NOTICE = /\n\[Managed Runtime provider omitted (\d+) characters here to fit the (\d+)-byte wire limit\.\]\n/;
const hex = (text) => [...Array(text.length).keys()].map((i) => text.charCodeAt(i).toString(16)).join(' ');
function fields(result) {
  const r = result?.result ?? {};
  const d = r.returnDisplay && typeof r.returnDisplay === 'object' ? r.returnDisplay : {};
  return { llmContent: typeof r.llmContent === 'string' ? r.llmContent : JSON.stringify(r.llmContent ?? ''), 'display.output': d.output, 'display.text': d.text };
}
function describe(text) {
  if (typeof text !== 'string') return 'absent';
  const m = NOTICE.exec(text);
  const bytes = Buffer.byteLength(text);
  if (!m) return `${text.length} chars, ${kib(bytes)}, not cut`;
  const before = text.slice(Math.max(0, m.index - 2), m.index);
  const after = text.slice(m.index + m[0].length, m.index + m[0].length + 2);
  return `${text.length} chars, ${kib(bytes)}, cut: ${m[1]} characters omitted, kept ${text.length - m[0].length} | before the notice [${hex(before)}] after it [${hex(after)}] | lone surrogates ${loneSurrogates(text)} | U+FFFD ${(text.match(/\uFFFD/g) ?? []).length} | "?" ${(text.match(/\?/g) ?? []).length}`;
}
async function cutAnatomy(mode) {
  const tag = `W1d-${mode}`;
  let lone = 0;
  let done = 0;
  for (const [name, command] of CUTS) {
    const s = await open(mode);
    const c = await s.ready(`w1d-${done}`, 'run_shell_command', { command, is_background: false });
    const result = await attempt(() => s.client.startExecution(c.reference, c.reserved.executionCallId));
    const status = await inject(s.port, PROVIDER, envelope(s.wire, { kind: 'status', reference: c.reference, afterSequence: 0 }));
    say(tag, `${name}: caller ${result.ok ? result.value.executionStatus : brief(result).slice(0, 120)} | worker status (sent by the rig) ${status.status}`);
    const atWorker = fields(status.json?.result?.result);
    const atCaller = result.ok ? fields(result.value) : {};
    for (const key of Object.keys(atWorker)) {
      say(tag, `    ${key.padEnd(15)} at the worker: ${describe(atWorker[key])}`);
      say(tag, `    ${''.padEnd(15)} at the caller: ${describe(atCaller[key])}`);
      lone += typeof atCaller[key] === 'string' ? loneSurrogates(atCaller[key]) : 0;
    }
    const released = await s.release();
    if (result.ok && released.ok) done++;
    s.provider.dispose();
  }
  check(`${tag}.1`, 'every case settles and releases', done === CUTS.length, `${done} of ${CUTS.length}`);
  check(`${tag}.2`, 'no text the caller receives holds a lone surrogate', lone === 0, `${lone}`);
}

// W2 -------------------------------------------------------------------------
async function largeObservation(mode) {
  const tag = `W2-${mode}`;
  const s = await open(mode);
  // A settled large result, still retained by the worker (same prompt).
  const big = await s.ready('w2-big', 'run_shell_command', { command: `perl -e 'print "x" x 700000'`, is_background: false });
  const ran = await attempt(() => s.client.startExecution(big.reference, big.reserved.executionCallId));
  const send = (operation) => inject(s.port, PROVIDER, envelope(s.wire, operation));
  const status = await send({ kind: 'status', reference: big.reference, afterSequence: 0 });
  const cancel = await send({ kind: 'cancel', reference: big.reference });
  const size = (r) => Buffer.byteLength(JSON.stringify(r.json ?? ''));
  say(tag, `700,000 characters of output: start ${ran.ok ? ran.value.executionStatus : brief(ran).slice(0, 120)} | status (sent by the rig) ${status.status}${status.status === 200 ? ` state=${status.json.result.state} ${kib(size(status))}` : ` ${status.json?.code} "${status.json?.error}"`} | cancel (sent by the rig) ${cancel.status}${cancel.status === 200 ? ` state=${cancel.json.result.state} ${kib(size(cancel))}` : ` ${cancel.json?.code} "${cancel.json?.error}"`}`);

  // Heavy progress while a command runs: 3 MiB in 300 chunks over about 3 s.
  let progressLine = 'skipped: the first call left the Session unusable';
  let progressOk = false;
  const next = await attempt(() => s.ready('w2-progress', 'run_shell_command', { command: `perl -e '$|=1; for (1..300) { print "y" x 10240; print "\\n"; select(undef,undef,undef,0.01) }'`, is_background: false }));
  if (next.ok) {
    const running = attempt(() => s.client.startExecution(next.value.reference, next.value.reserved.executionCallId));
    await sleep(2500);
    const during = await send({ kind: 'status', reference: next.value.reference, afterSequence: 0 });
    const done = await running;
    const after = await send({ kind: 'status', reference: next.value.reference, afterSequence: 0 });
    const d = during.json?.result ?? {};
    const a = after.json?.result ?? {};
    progressLine = `while running: status ${during.status}${during.status === 200 ? ` state=${d.state} lastSeq=${d.lastSeq} firstAvailableSeq=${d.firstAvailableSeq} progressGap=${d.progressGap} events=${d.progress?.length} ${kib(size(during))}` : ` ${during.json?.code} "${during.json?.error}"`} | command ${done.ok ? done.value.executionStatus : brief(done).slice(0, 100)} | once settled: status ${after.status}${after.status === 200 ? ` state=${a.state} lastSeq=${a.lastSeq} firstAvailableSeq=${a.firstAvailableSeq} progressGap=${a.progressGap} events=${a.progress?.length} ${kib(size(after))}` : ` ${after.json?.code} "${after.json?.error}"`}`;
    progressOk = during.status === 200 && after.status === 200 && done.ok && size(after) <= 1024 * 1024 && size(during) <= 1024 * 1024 &&
      (a.progress ?? []).every((p) => p.seq >= a.firstAvailableSeq);
  } else progressLine = `second call could not be prepared: ${brief(next).slice(0, 160)}`;
  say(tag, `3 MiB of progress (sent by the rig): ${progressLine}`);
  const released = await s.release();
  say(tag, `release ${released.ok ? 'ok' : brief(released).slice(0, 120)} | records=${JSON.stringify(executions(s.runtimeSessionId).map((r) => `${r.state}/${r.status}`))}`);
  check(`${tag}.1`, 'status and cancel of a settled large result answer within the 1 MiB budget', status.status === 200 && cancel.status === 200 && size(status) <= 1024 * 1024 && size(cancel) <= 1024 * 1024, `${status.status} | ${cancel.status}`);
  check(`${tag}.2`, 'heavy progress is evicted oldest first and announced through firstAvailableSeq and progressGap', progressOk);
  check(`${tag}.3`, 'release succeeds', released.ok, released.ok ? '' : brief(released));
}

// W3 -------------------------------------------------------------------------
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
const SAFE = [
  ['lowercase UUID v4', () => randomUUID()],
  ['uppercase UUID v4', () => randomUUID().toUpperCase()],
  ['UUID version 7', () => v7()],
  ['not a UUID', () => `rig-session-${stamp()}`],
  ['with a space', () => `rig session ${stamp()}`],
  ['not ASCII', () => `会话-${stamp()}`],
];
const UNSAFE = [
  ['with a slash', () => `rig/session-${stamp()}`],
  ['with a backslash', () => `rig\\session-${stamp()}`],
  ['with two dots', () => `rig..session-${stamp()}`],
  ['with a control character', () => `rig\u0001session-${stamp()}`],
];
// Not part of the default list: the rule has no `u` flag, so a character
// outside the BMP (a well-formed surrogate pair) is refused as well.
const EXTRA = [
  ['with an emoji', () => `rig-\u{1F600}-${stamp()}`],
];
const IDS = (process.env.IDS ?? 'safe,unsafe').split(',').flatMap((k) => (k === 'safe' ? SAFE : k === 'extra' ? EXTRA : UNSAFE));
const printable = (id) => JSON.stringify(id).slice(1, -1);
async function sessionIds(mode) {
  const tag = `W3-${mode}`;
  const results = [];
  for (const [name, make] of IDS) {
    for (const route of ['provider', 'raw']) {
      const where = await place(mode);
      const id = make();
      const base = { protocolVersion: 1, harnessSessionId: where.harness, runtimeSessionId: id };
      const mark = ledgerMark();
      let acquired;
      let work;
      if (route === 'provider') {
        const s = await attempt(() => open(mode, where, id));
        acquired = s.ok ? 'acquired' : brief(s).replace(/BrokerResponseError: Managed Runtime Broker returned HTTP \d+\. ?/, '').slice(0, 130);
        if (s.ok) {
          const file = path.join(where.cwd, `w3-${Date.now()}.txt`);
          const ran = await attempt(async () => {
            const c = await s.value.ready('w3', 'write_file', { file_path: file, content: 'id\n' });
            return s.value.client.startExecution(c.reference, c.reserved.executionCallId);
          });
          work = ran.ok ? ran.value.executionStatus : brief(ran).slice(0, 110);
        }
      } else {
        const a = await broker('POST', 'tool-sessions:acquire', { ...base, requestId: randomUUID(), turnKind: 'bootstrap' });
        acquired = a.status === 200 ? 'acquired' : `${answer(a)} "${a.json?.error}"`;
        if (a.status === 200) {
          const file = path.join(where.cwd, `w3-${Date.now()}.txt`);
          const raw = await rawCall(base, id, 'w3-raw', 'write_file', { file_path: file, content: 'id\n' });
          work = raw.reserve.status !== 200 ? `reserve ${answer(raw.reserve)} "${raw.reserve.json?.error}"` : `worker ${raw.worker?.status ?? 'no request'}${raw.worker && raw.worker.status !== 200 ? ` ${raw.worker.response?.code}` : ''}, record ${raw.row?.state}/${raw.row?.status}`;
        }
      }
      const row = runtimeSession(id);
      const release = await broker('POST', `tool-sessions/${encodeURIComponent(id)}:release`, { protocolVersion: 1, requestId: randomUUID(), harnessSessionId: where.harness });
      const wire = ledger(mark).filter((e) => e.path.endsWith('/control')).map((e) => `${e.kind} ${e.status}`);
      const refusals = ledger(mark).filter((e) => e.path.endsWith('/control') && e.status !== 200).map((e) => `${e.kind} -> ${e.status} ${e.response?.code} "${e.response?.error}"`);
      const after = runtimeSession(id);
      const stuck = after && after.state !== 'RELEASED';
      results.push({ name, route, stuck, acquired, release: release.status, unsafe: [...UNSAFE, ...EXTRA].some(([n]) => n === name) });
      say(tag, `${name.padEnd(24)} ${route.padEnd(8)} Broker Session ${row ? row.state : 'none'} | ${acquired}${work ? ` | work: ${work}` : ''} | release ${answer(release)}${release.status === 200 ? '' : ` "${release.json?.error}"`} | Session now ${after ? after.state : 'none'}${mode === 'v2' ? ` | storage held=${held(id)}` : ''}`);
      if (refusals.length) say(tag, `${''.padEnd(33)} worker refusals: ${[...new Set(refusals)].join(' ; ')}`);
      for (const p of providers.splice(0)) p.dispose();
    }
  }
  const plain = results.filter((r) => r.name === 'lowercase UUID v4');
  const others = results.filter((r) => r.name !== 'lowercase UUID v4');
  const safe = results.filter((r) => !r.unsafe);
  const unsafe = results.filter((r) => r.unsafe);
  say(tag, `OBSERVED: Sessions left unreleased: ${JSON.stringify(results.filter((r) => r.stuck).map((r) => `${r.name} / ${r.route}`))}`);
  check(`${tag}.1`, 'a lowercase UUID works on both routes and releases', plain.every((r) => r.acquired === 'acquired' && r.release === 200 && !r.stuck));
  check(`${tag}.2`, 'every printable, path-safe id can be released on both routes', safe.every((r) => !r.stuck && r.release === 200), JSON.stringify(safe.filter((r) => r.stuck).map((r) => `${r.name} / ${r.route}`)));
  if (unsafe.length) check(`${tag}.3`, 'no id the worker refuses leaves a Session behind that cannot be released', unsafe.every((r) => !r.stuck), JSON.stringify(unsafe.filter((r) => r.stuck).map((r) => `${r.name} / ${r.route}`)));
}

// W4 -------------------------------------------------------------------------
async function receiptWhileReleasing(mode) {
  const tag = `W4-${mode}`;
  const s = await open(mode);
  const file = path.join(s.cwd, `w4-${s.runtimeSessionId.slice(0, 6)}.txt`);
  const { reserved } = await s.ready('w4', 'write_file', { file_path: file, content: 'never\n' });
  const first = await post(s, `executions/${reserved.executionCallId}:cancel`);
  await hook({ kind: 'release', action: 'drop-reply', count: 1 });
  const lost = await s.release();
  const state = runtimeSession(s.runtimeSessionId)?.state;
  const mark = ledgerMark();
  const again = await post(s, `executions/${reserved.executionCallId}:cancel`);
  const got = await getExecution(s, reserved.executionCallId);
  const seen = ledger(mark).map((e) => e.kind ?? e.path);
  const released = await s.release();
  const after = await post(s, `executions/${reserved.executionCallId}:cancel`);
  say(tag, `cancel #1 ${answer(first)} ${first.json?.status?.result?.executionStatus ?? ''} | release with its acknowledgement lost: ${lost.ok ? 'ok' : brief(lost).replace(/BrokerResponseError: Managed Runtime Broker returned HTTP \d+\. ?/, '').slice(0, 100)} | Session ${state} | storage held=${held(s.runtimeSessionId)}`);
  say(tag, `cancel #2 while ${state}: ${answer(again)}${again.status === 200 ? ` ${again.json?.status?.result?.executionStatus}` : ` "${again.json?.error}"`} | worker saw [${seen}] | GET ${answer(got)}`);
  say(tag, `second release ${released.ok ? 'ok' : brief(released).slice(0, 100)} | Session ${runtimeSession(s.runtimeSessionId)?.state} | cancel #3 ${answer(after)} | file written=${fs.existsSync(file)}`);
  check(`${tag}.1`, 'a Session whose release acknowledgement was lost is RELEASING', state === 'RELEASING', String(state));
  check(`${tag}.2`, 'the repeated cancellation is answered from the stored receipt, with no worker request', again.status === 200 && again.json?.status?.result?.executionStatus === 'cancelled' && seen.length === 0, `${answer(again)} worker saw [${seen}]`);
  check(`${tag}.3`, 'the second release completes and nothing executed', released.ok && !fs.existsSync(file) && !held(s.runtimeSessionId));
}

// W6 -------------------------------------------------------------------------
// Refusals at the Broker's own HTTP face that this head re-labels.
async function brokerRefusals(mode) {
  const tag = `W6-${mode}`;
  const s = await open(mode);
  const line = (r) => `${r.status} ${r.json?.code} retryable=${r.json?.retryable} "${String(r.json?.error).slice(0, 90)}"`;
  // An operation larger than the 1 MiB control bound, sent to the Broker directly.
  const mark = ledgerMark();
  const big = await post(s, `tool-sessions/${s.runtimeSessionId}/control`, { operation: { kind: 'prepare', identity: s.identity('w6-big'), toolName: 'write_file', input: { file_path: path.join(s.cwd, 'w6.txt'), content: 'z'.repeat(1100 * 1024) } } });
  const reached = ledger(mark).filter((e) => e.kind === 'prepare').length;
  say(tag, `control[prepare] with a 1,100 KiB operation: ${line(big)} | requests that reached the worker: ${reached}`);
  // A reservation with a field the envelope does not know.
  const c = await s.client.prepare(s.identity('w6-extra'), 'write_file', { file_path: path.join(s.cwd, 'w6b.txt'), content: 'never\n' });
  const reference = ref(c);
  const body = { ...s.base, requestId: randomUUID(), idempotencyKey: randomUUID(), turnId: reference.promptId, toolCallId: reference.callId, requestDigest: reference.argsDigest, reference };
  const extra = await broker('POST', 'executions:prepare', { ...body, payloadJson: '{}' });
  say(tag, `reservation with an extra field: ${line(extra)} | rows written: ${executions(s.runtimeSessionId).length}`);
  // A raw deferred reservation whose reference holds a null.
  const nul = await broker('POST', 'executions:prepare', { ...s.base, requestId: randomUUID(), idempotencyKey: randomUUID(), turnId: 'p1', toolCallId: 'w6-null', requestDigest: `sha256:${'0'.repeat(64)}`, reference: { sessionId: s.runtimeSessionId, promptId: 'p1', callId: 'w6-null', argsDigest: `sha256:${'0'.repeat(64)}`, note: null } });
  say(tag, `raw reservation whose reference holds a null: ${line(nul)} | rows written: ${executions(s.runtimeSessionId).length}`);
  const released = await s.release();
  say(tag, `release ${released.ok ? 'ok' : brief(released).slice(0, 100)}`);
  check(`${tag}.1`, 'an operation the Broker cannot encode is refused for good (413, not retryable) before anything is sent', big.status === 413 && big.json?.retryable === false && reached === 0, line(big));
  check(`${tag}.2`, 'a malformed reservation envelope is a request error, a null in a reference is a 400; neither writes a row', extra.status === 400 && extra.json?.code === 'runtime_broker_invalid_request' && nul.status === 400 && executions(s.runtimeSessionId).length === 0, `${line(extra)} | ${line(nul)}`);
  check(`${tag}.3`, 'release succeeds', released.ok);
}

const modes = process.env.MODES ? process.env.MODES.split(',') : ['v1', 'v2'];
for (const group of groups) {
  for (const mode of modes) {
    say('GROUP', `${group} ${mode} arm=${ARM}`);
    try {
      if (group === 'W1') await largeResults(mode);
      if (group === 'W1d') await cutAnatomy(mode);
      if (group === 'W2') await largeObservation(mode);
      if (group === 'W3') await sessionIds(mode);
      if (group === 'W4') await receiptWhileReleasing(mode);
      if (group === 'W6') await brokerRefusals(mode);
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
