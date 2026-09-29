// PR #12868 round 7: what commit e94f781523 changes, on the real chain
// (built TS provider -> Spring Broker on MySQL -> bundled worker).
//   Z1 what a released Session still answers: the recent ones in full, older ones as tombstones
//   Z2 a live Session while others are released and retired on the same worker
//   Z3 Sessions in parallel on one worker, and how long a release takes
//   Z4 the id rule at warm
// usage: ARM=<h8|h7> ... node s21-r7.mjs <groups> <storage letters>
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  ROOTS, BROKER_URL, BROKER_TOKEN, ARM, attempt, brief, broker, check, clearHooks, createSession, executions,
  holders, inject, ledger, ledgerMark, loadProvider, openLog, prepareRequest, runtimeSession, say, seedRegistry,
  sleep, summary, workerPids, workerPortOf,
} from './lib.mjs';

const groups = (process.argv[2] ?? 'Z1,Z2,Z3,Z4').split(',');
const letters = (process.argv[3] ?? 'a,b,c,d,e,f,g,h').split(',');
let letterIndex = 0;
openLog(`s21-r7-${ARM}-${groups.join('')}${process.env.MODES ? `-${process.env.MODES.replace(',', '')}` : ''}`);
const REF_KEYS = ['sessionId', 'promptId', 'callId', 'capabilityDigest', 'policyRevision', 'invocationId', 'argsDigest'];
const ref = (prepared) => Object.fromEntries(REF_KEYS.map((k) => [k, prepared[k]]));
const PROVIDER = 'provider/v1/control';
const envelope = (session, operation) => ({ session, operation, protocolVersion: 1, providerProtocol: 'managed-runtime-provider/1' });
const answer = (r) => `${r.status}${r.code ? ` ${r.code}` : ''}`;
const short = (a) => brief(a).replace(/BrokerResponseError: Managed Runtime Broker returned HTTP \d+\. ?/, '');
const held = (id) => holders().some(([, h]) => h === id);
const RETAINED = 8;

async function place(mode) {
  if (mode === 'v1') return { harness: await createSession(), cwd: fs.realpathSync(path.join(ROOTS, 'plain')) };
  const letter = letters[letterIndex++ % letters.length];
  const ws = `ws-${letter}-${Date.now()}`;
  seedRegistry(ws, `st-${letter}`);
  return { workspace: ws, harness: await createSession(ws), cwd: fs.realpathSync(path.join(ROOTS, letter, 'child')) };
}
const { BrokerManagedRuntimeProvider } = await loadProvider();
const provider = new BrokerManagedRuntimeProvider({ baseUrl: BROKER_URL, token: BROKER_TOKEN });

// One Runtime Session of a Harness Session. The first one of a Harness Session
// is its bootstrap turn, the others continue it, as Hosted turns do.
async function session(mode, where, first) {
  const runtimeSessionId = randomUUID();
  const turnKind = first ? 'bootstrap' : 'continuation';
  const request = prepareRequest(runtimeSessionId, turnKind, where.cwd);
  const client = await provider.getToolV2Client(request, { harnessSessionId: where.harness });
  await client.fileHistory.bind({ ownerSessionId: where.harness, ownerRuntimeSessionId: runtimeSessionId, executionCwd: where.cwd, snapshots: [] });
  const manifest = await client.manifest();
  const s = { mode, where, runtimeSessionId, request, client };
  s.identity = (callId, promptId = 'p1') => ({ sessionId: runtimeSessionId, promptId, callId, capabilityDigest: manifest.capabilityDigest, policyRevision: manifest.policyRevision });
  await client.beginTurn(s.identity('turn'));
  s.wire = { runtimeSessionId, turnKind, harnessSessionId: where.harness };
  s.base = { protocolVersion: 1, harnessSessionId: where.harness, runtimeSessionId };
  s.ready = async (callId, toolName, input) => {
    const prepared = await client.prepare(s.identity(callId), toolName, input);
    const reference = ref(prepared);
    const reserved = await client.prepareExecution(reference);
    if (mode === 'v1') await client.confirm(reference, 'proceed_once');
    await client.preflight(reference);
    return { reference, reserved };
  };
  s.run = async (callId, toolName, input) => {
    const c = await s.ready(callId, toolName, input);
    const result = await client.startExecution(c.reference, c.reserved.executionCallId);
    return { ...c, result };
  };
  s.release = () => attempt(() => provider.release(runtimeSessionId, request, { terminal: true }));
  return s;
}
const send = (port, s, operation) => inject(port, PROVIDER, envelope(s.wire, operation));
const stateOf = (r) => (r.status === 200 ? r.json?.result?.state ?? JSON.stringify(r.json?.result).slice(0, 40) : `${r.status} ${r.json?.code} "${String(r.json?.error).slice(0, 60)}"`);

// Z1 -------------------------------------------------------------------------
async function afterRelease(mode) {
  const tag = `Z1-${mode}`;
  const where = await place(mode);
  const COUNT = 12;
  const done = [];
  for (let i = 1; i <= COUNT; i++) {
    const s = await session(mode, where, i === 1);
    const file = path.join(where.cwd, `z1-${i}.txt`);
    const ran = await s.run(`z1-${i}`, 'write_file', { file_path: file, content: `turn ${i}\n` });
    const released = await s.release();
    done.push({ i, s, reference: ran.reference, ok: ran.result.executionStatus === 'success' && released.ok });
  }
  const port = workerPortOf(done[0].s.runtimeSessionId);
  say(tag, `one worker, ${COUNT} Runtime Sessions one after another, each ran one write_file and was released: ${done.filter((d) => d.ok).length} of ${COUNT} ok`);
  const rows = [];
  for (const d of done) {
    const status = await send(port, d.s, { kind: 'status', reference: d.reference, afterSequence: 0 });
    const cancel = await send(port, d.s, { kind: 'cancel', reference: d.reference });
    const history = await send(port, d.s, { kind: 'history' });
    const prepare = await send(port, d.s, { kind: 'prepare', identity: d.s.identity(`z1-late-${d.i}`), toolName: 'write_file', input: { file_path: path.join(where.cwd, 'z1-late.txt'), content: 'late\n' } });
    rows.push({ i: d.i, status: stateOf(status), cancel: stateOf(cancel), history: history.status === 200 ? '200' : `${history.status} ${history.json?.code}`, prepare: prepare.status === 200 ? '200' : `${prepare.status} ${prepare.json?.code}` });
    say(tag, `released Session ${String(d.i).padStart(2)} (${COUNT - d.i} released after it) | status (sent by the rig) ${stateOf(status)} | cancel ${stateOf(cancel)} | history ${rows.at(-1).history} | prepare of new work ${rows.at(-1).prepare}`);
  }
  // The Broker's own view does not depend on what the worker kept.
  const oldest = done[0];
  const row = executions(oldest.s.runtimeSessionId)[0];
  const got = await broker('GET', `executions/${row.id}?requestId=${randomUUID()}&harnessSessionId=${where.harness}&runtimeSessionId=${oldest.s.runtimeSessionId}`);
  const again = await broker('POST', `tool-sessions/${oldest.s.runtimeSessionId}:release`, { protocolVersion: 1, requestId: randomUUID(), harnessSessionId: where.harness });
  say(tag, `through the Broker, for the oldest Session: GET of its execution ${answer(got)} ${got.json?.status?.state ?? ''}/${got.json?.status?.result?.executionStatus ?? ''} | release repeated ${answer(again)} | Session ${runtimeSession(oldest.s.runtimeSessionId)?.state}`);
  const next = await session(mode, where, false);
  const ran = await attempt(() => next.run('z1-next', 'write_file', { file_path: path.join(where.cwd, 'z1-next.txt'), content: 'next\n' }));
  const released = await next.release();
  say(tag, `a new Session on the same worker afterwards: ${ran.ok ? ran.value.result.executionStatus : short(ran).slice(0, 120)} | release ${released.ok ? 'ok' : short(released).slice(0, 100)}`);
  const recent = rows.filter((r) => COUNT - r.i < RETAINED);
  const old = rows.filter((r) => COUNT - r.i >= RETAINED);
  say(tag, `OBSERVED: Sessions that still answer in full: ${rows.filter((r) => r.status === 'settled').length} of ${COUNT}; tombstones: ${rows.filter((r) => r.status === 'unknown').length}`);
  check(`${tag}.1`, `the ${RETAINED} Sessions released last still answer their status in full`, recent.length === RETAINED && recent.every((r) => r.status === 'settled'), JSON.stringify(recent.map((r) => r.status)));
  check(`${tag}.2`, `the ${COUNT - RETAINED} older ones are tombstones: status and cancel answer unknown`, old.length === COUNT - RETAINED && old.every((r) => r.status === 'unknown' && r.cancel === 'unknown'), JSON.stringify(old.map((r) => `${r.status}/${r.cancel}`)));
  check(`${tag}.3`, 'no released Session, kept or retired, admits new work', rows.every((r) => r.prepare !== '200'), JSON.stringify([...new Set(rows.map((r) => r.prepare))]));
  check(`${tag}.4`, 'the Broker still reads the receipt of a retired Session, and the worker serves the next Session', got.status === 200 && ran.ok && ran.value.result.executionStatus === 'success' && released.ok);
}

// Z2 -------------------------------------------------------------------------
async function liveAmongRetired(mode) {
  const tag = `Z2-${mode}`;
  const where = await place(mode);
  const live = await session(mode, where, true);
  const liveFile = path.join(where.cwd, 'z2-live.txt');
  const prepared = await live.ready('z2-live', 'write_file', { file_path: liveFile, content: 'written after twelve retirements\n' });
  const before = workerPids().length;
  // A command that runs while the others come and go.
  const slow = await session(mode, where, false);
  const running = attempt(() => slow.run('z2-slow', 'run_shell_command', { command: `perl -e '$|=1; for (1..40) { print "tick $_\\n"; select(undef,undef,undef,0.1) } print "done\\n"'`, is_background: false }));
  let others = 0;
  for (let i = 1; i <= 12; i++) {
    const s = await session(mode, where, false);
    const ran = await attempt(() => s.run(`z2-${i}`, 'write_file', { file_path: path.join(where.cwd, `z2-${i}.txt`), content: `other ${i}\n` }));
    const released = await s.release();
    if (ran.ok && ran.value.result.executionStatus === 'success' && released.ok) others++;
  }
  const slowDone = await running;
  const slowText = slowDone.ok ? String(slowDone.value.result.result?.llmContent ?? '') : '';
  say(tag, `twelve other Sessions ran and were released on the same worker: ${others} of 12 ok | the command that ran meanwhile: ${slowDone.ok ? `${slowDone.value.result.executionStatus}, ${(slowText.match(/tick/g) ?? []).length} ticks, done=${/done/.test(slowText)}` : short(slowDone).slice(0, 140)}`);
  const started = await attempt(() => live.client.startExecution(prepared.reference, prepared.reserved.executionCallId));
  const more = await attempt(() => live.run('z2-live-2', 'run_shell_command', { command: 'echo still-here', is_background: false }));
  const moreText = more.ok ? String(more.value.result.result?.llmContent ?? '') : '';
  const history = await attempt(() => live.client.fileHistory.checkpoint?.({ promptId: 'p1' }));
  const releasedSlow = await slow.release();
  const releasedLive = await live.release();
  say(tag, `the Session acquired first, its call prepared before the others: start ${started.ok ? started.value.executionStatus : short(started).slice(0, 140)} | file holds ${JSON.stringify(fs.existsSync(liveFile) ? fs.readFileSync(liveFile, 'utf8') : null)} | a second call in it: ${more.ok ? `${more.value.result.executionStatus}, output has "still-here"=${/still-here/.test(moreText)}` : short(more).slice(0, 140)}`);
  say(tag, `release of both: ${releasedSlow.ok ? 'ok' : short(releasedSlow).slice(0, 80)}, ${releasedLive.ok ? 'ok' : short(releasedLive).slice(0, 80)} | workers started meanwhile: ${workerPids().length - before}${mode === 'v2' ? ` | storage held=${held(live.runtimeSessionId)}` : ''}`);
  check(`${tag}.1`, 'twelve Sessions run and release beside a live one', others === 12, `${others} of 12`);
  check(`${tag}.2`, 'a command that runs while others are retired finishes', slowDone.ok && slowDone.value.result.executionStatus === 'success' && /done/.test(slowText));
  check(`${tag}.3`, 'the live Session runs the call it had prepared, and another one', started.ok && started.value.executionStatus === 'success' && more.ok && more.value.result.executionStatus === 'success' && /still-here/.test(moreText));
  check(`${tag}.4`, 'both release', releasedSlow.ok && releasedLive.ok);
  void history;
}

// Z3 -------------------------------------------------------------------------
async function parallel(mode) {
  const tag = `Z3-${mode}`;
  const where = await place(mode);
  const first = await session(mode, where, true);
  await first.run('z3-first', 'write_file', { file_path: path.join(where.cwd, 'z3-first.txt'), content: 'first\n' });
  const mark = ledgerMark();
  const TOTAL = 32;
  const WIDTH = 6;
  let next = 0;
  let ok = 0;
  const failures = [];
  const started = Date.now();
  await Promise.all(Array.from({ length: WIDTH }, async () => {
    while (next < TOTAL) {
      const i = ++next;
      const r = await attempt(async () => {
        const s = await session(mode, where, false);
        const ran = await s.run(`z3-${i}`, 'write_file', { file_path: path.join(where.cwd, `z3-${i}.txt`), content: `${'z'.repeat(50 * 1024)}\n` });
        const released = await s.release();
        if (ran.result.executionStatus !== 'success') throw new Error(`execute ${ran.result.executionStatus}`);
        if (!released.ok) throw new Error(`release ${short(released)}`);
      });
      if (r.ok) ok++;
      else failures.push(`${i}: ${short(r).slice(0, 120)}`);
    }
  }));
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  const releases = ledger(mark).filter((e) => e.kind === 'release').map((e) => e.ms).sort((a, b) => a - b);
  const pick = (q) => releases[Math.min(releases.length - 1, Math.floor(q * releases.length))];
  const refused = ledger(mark).filter((e) => e.path.endsWith('/control') && e.status !== 200);
  say(tag, `${TOTAL} Sessions, ${WIDTH} at a time, on one worker, each writes 50 KiB and releases: ${ok} of ${TOTAL} ok in ${seconds} s${failures.length ? ` | failures ${JSON.stringify(failures.slice(0, 3))}` : ''}`);
  say(tag, `release at the worker: ${releases.length} requests, median ${pick(0.5)} ms, 95th percentile ${pick(0.95)} ms, slowest ${releases.at(-1)} ms | worker answers that were not 200: ${refused.length}${refused.length ? ` ${JSON.stringify([...new Set(refused.map((e) => `${e.kind} ${e.status} ${e.response?.code}`))])}` : ''}`);
  const after = await attempt(() => first.run('z3-after', 'write_file', { file_path: path.join(where.cwd, 'z3-after.txt'), content: 'after\n' }));
  const released = await first.release();
  say(tag, `the Session acquired before them: another call ${after.ok ? after.value.result.executionStatus : short(after).slice(0, 120)} | release ${released.ok ? 'ok' : short(released).slice(0, 100)}`);
  check(`${tag}.1`, `${TOTAL} Sessions in parallel all run and release`, ok === TOTAL && refused.length === 0, `${ok} of ${TOTAL}, refusals ${refused.length}`);
  check(`${tag}.2`, 'no release at the worker takes longer than 5 s', releases.length >= TOTAL && releases.at(-1) < 5000, `slowest ${releases.at(-1)} ms`);
  check(`${tag}.3`, 'the Session that was there first still works and releases', after.ok && after.value.result.executionStatus === 'success' && released.ok);
}

// Z4 -------------------------------------------------------------------------
async function warm(mode) {
  const tag = `Z4-${mode}`;
  const where = await place(mode);
  const before = workerPids().length;
  const good = await broker('POST', 'runtimes:warm', { protocolVersion: 1, requestId: randomUUID(), harnessSessionId: where.harness });
  const afterGood = workerPids().length;
  const rows = [];
  for (const [name, id] of [['with a space', `bad harness ${Date.now()}`], ['not ASCII', `会话-${Date.now()}`], ['with two dots', `a..b-${Date.now()}`], ['with a slash', `a/b-${Date.now()}`]]) {
    const mark = ledgerMark();
    const r = await broker('POST', 'runtimes:warm', { protocolVersion: 1, requestId: randomUUID(), harnessSessionId: id });
    rows.push({ name, status: r.status, code: r.json?.code, reached: ledger(mark).length });
    say(tag, `warm, Harness Session id ${name}: ${answer(r)} "${String(r.json?.error).slice(0, 70)}" | requests that reached a worker: ${ledger(mark).length}`);
  }
  say(tag, `warm, the id of an existing Harness Session: ${answer(good)} | workers started by it: ${afterGood - before} | workers started by the refused ones: ${workerPids().length - afterGood}`);
  check(`${tag}.1`, 'warm refuses a Harness Session id outside the allow-list as a bad request, before anything is started', rows.every((r) => r.status === 400 && r.code === 'runtime_broker_invalid_request' && r.reached === 0) && workerPids().length === afterGood, JSON.stringify(rows.map((r) => `${r.name}: ${r.status} ${r.code}`)));
  check(`${tag}.2`, 'warm of an existing Harness Session works', good.status === 200, answer(good));
}

const modes = process.env.MODES ? process.env.MODES.split(',') : ['v1', 'v2'];
for (const group of groups) {
  for (const mode of modes) {
    say('GROUP', `${group} ${mode} arm=${ARM}`);
    try {
      if (group === 'Z1') await afterRelease(mode);
      if (group === 'Z2') await liveAmongRetired(mode);
      if (group === 'Z3') await parallel(mode);
      if (group === 'Z4') await warm(mode);
    } catch (error) {
      check(`${group}-${mode}.x`, 'group completed', false, `${error?.name}: ${error?.message} code=${error?.code} status=${error?.status}\n${error?.stack?.split('\n').slice(1, 4).join('\n')}`);
    } finally {
      await clearHooks();
    }
  }
}
const ok = summary();
provider.dispose();
process.exit(ok ? 0 : 1);
