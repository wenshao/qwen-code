// VERIFICATION RIG ONLY: real-stack scenarios for PR 13099.
// usage: node scenarios.mjs <r1|r2|r3|r4|r5|r6a|r6b|r6c|r6d|r6e> [suffix]
//   Spring (merge jar, MySQL 8.4) + packaged Hosted Harness + Broker + tap.
import fs from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
import {
  R, SP, DB, TENANT, api, sql, one, register, create, waitTurn, waitFor, sleep,
  turnRow, tapEntries, springLines, harnessLines, terminalEvents, thrown,
  setRules, clearRules, out,
} from './lib.mjs';

const name = process.argv[2];
const SUF = process.argv[3] ?? '';
const res = { scenario: name, startedAt: new Date().toISOString() };
const say = (k, v) => {
  res[k] = v;
  console.log(`${k}: ${JSON.stringify(v)}`);
};

const head = (rows, n = 12) => rows.slice(0, n);
const tapFor = (session, sinceMs = 0) =>
  tapEntries()
    .filter((e) => Date.parse(e.t) >= sinceMs && (e.path?.includes(session) || e.sid === session))
    .map((e) => `${e.method} ${e.path.replace(session, ':id').replace(/\?.*/, '')} -> ${e.fault ? `[${e.fault}] ` : ''}${e.status ?? 'no reply'}${e.code ? ` ${e.code}` : ''}`);
const retryLines = (session) =>
  springLines()
    .filter((l) => l.includes(session) && /will retry|exhausted retries/.test(l))
    .map((l) => l.replace(/^.*?(Managed Turn coordination)/, '$1').replace(/tenant=\S+ session=\S+ turn=\S+ /, ''));
const summarize = (events) =>
  events.map((e) => ({ at: e.t.slice(11, 23), cls: e.cls, message: e.message, thread: e.thread, frames: head(e.frames, 10) }));
const drain = (ws) => sql(`UPDATE managed_workspace_registry SET state='DRAINING' WHERE tenant_id='${TENANT}' AND workspace_id='${ws}'`);
const activate = (ws) => sql(`UPDATE managed_workspace_registry SET state='ACTIVE' WHERE tenant_id='${TENANT}' AND workspace_id='${ws}'`);
const exists = (st, file) => fs.existsSync(`${R}/roots/${st}/child/${file}`);
const row = (session) => {
  const r = turnRow(session);
  return r && { status: r[1], error_code: r[2], retry_count: Number(r[3]), submission_attempted: r[4] === '1', admitted: r[5] !== '-' };
};

async function r1() {
  // Authorization is refused on the very first dispatch (retry 0): the
  // Workspace is drained in the same statement that commits the Turn row.
  const ws = `ws-r1${SUF}`;
  register(ws, 'st-a');
  sql(`DROP TRIGGER IF EXISTS rig_r1_drain`);
  sql(
    `CREATE TRIGGER rig_r1_drain AFTER INSERT ON managed_agent_turn FOR EACH ROW BEGIN IF (SELECT workspace_id FROM managed_agent_session WHERE tenant_id = NEW.tenant_id AND session_id = NEW.session_id) = '${ws}' THEN UPDATE managed_workspace_registry SET state = 'DRAINING' WHERE tenant_id = NEW.tenant_id AND workspace_id = '${ws}'; END IF; END`,
    DB,
    '//',
  );
  const t0 = Date.now();
  const c = await create(ws, 'G0_FILES name=r1.txt', `r1${SUF}`);
  say('create', { status: c.status, code: c.json.error?.code });
  const session = c.json.id;
  const w = await waitTurn(session, { timeoutMs: 90_000 });
  sql(`DROP TRIGGER IF EXISTS rig_r1_drain`);
  say('turn', { ...row(session), settledMs: w.ms, timeout: !!w.timeout });
  say('registryState', one(`SELECT state FROM managed_workspace_registry WHERE workspace_id='${ws}'`));
  say('harnessCalls', tapFor(session, t0));
  say('retryLog', retryLines(session));
  say('terminal', await terminalEvents(session));
  say('fileWritten', exists('a', 'r1.txt'));
  say('thrown', summarize(await thrown(['RuntimeBrokerException', 'DaemonHttpException'], { sinceMs: t0 })));
}

async function r2() {
  // Same refusal with the pre-admission retry budget already spent.
  const ws = `ws-r2${SUF}`;
  register(ws, 'st-b');
  setRules([{ id: 'r2-harness-down', path: '^/session', mode: 'drop', remaining: 999 }]);
  const t0 = Date.now();
  const c = await create(ws, 'G0_FILES name=r2.txt', `r2${SUF}`);
  const session = c.json.id;
  say('create', { status: c.status });
  const at5 = await waitFor(() => row(session)?.retry_count === 5 && Date.now(), { timeoutMs: 90_000, everyMs: 100 });
  say('budgetSpentAfterMs', at5 ? at5 - t0 : null);
  say('turnAtBudget', row(session));
  drain(ws);
  clearRules();
  const tDrain = Date.now();
  const w = await waitTurn(session, { timeoutMs: 120_000 });
  say('turn', { ...row(session), settledMsAfterDrain: Date.now() - tDrain, timeout: !!w.timeout });
  say('retryLog', retryLines(session));
  say('terminal', await terminalEvents(session));
  say('thrown', summarize(await thrown(['RuntimeBrokerException'], { sinceMs: tDrain })));
}

async function r3() {
  // The same refusal on a Turn whose submission is already recorded (and is
  // in fact still running in the Harness): it must never become terminal.
  const ws = `ws-r3${SUF}`;
  const st = SUF ? 'j' : 'c'; // a rerun needs storage no earlier Session still holds
  register(ws, `st-${st}`);
  fs.rmSync(`${R}/roots/${st}/child/r3.txt`, { force: true });
  const c = await create(ws, 'G0_HANG hold=100000 name=r3.txt', `r3${SUF}`);
  const session = c.json.id;
  say('create', { status: c.status });
  const running = await waitFor(() => {
    const r = row(session);
    return r?.submission_attempted && r.admitted && exists(st, 'r3.txt') && r;
  }, { timeoutMs: 90_000 });
  say('beforeRefusal', running ?? row(session));
  await sleep(1500);
  drain(ws);
  const tCut = Date.now();
  const cut = await fetch('http://127.0.0.1:16099/__rig/cut').then((r) => r.text());
  say('streamsCut', Number(cut));
  const timeline = [];
  let last = '';
  // Watch until the Turn is past the pre-admission budget (5) and still alive.
  while (Date.now() - tCut < 80_000) {
    const r = row(session);
    if (r.retry_count >= 6 && timeline.at(-1)?.retry_count >= 6) break;
    const key = `${r.status}/${r.retry_count}`;
    if (key !== last) {
      timeline.push({ tSec: +((Date.now() - tCut) / 1000).toFixed(1), status: r.status, retry_count: r.retry_count });
      last = key;
    }
    await sleep(250);
  }
  say('timelineWhileRefused', timeline);
  say('turnWhileRefused', row(session));
  const events = await thrown(['RuntimeBrokerException'], { sinceMs: tCut });
  say('refusalsThrown', events.length);
  const groups = new Map();
  for (const e of events) {
    const key = e.frames.slice(0, 8).join(' <- ');
    groups.set(key, (groups.get(key) ?? 0) + 1);
  }
  say('thrownByPath', [...groups].map(([k, count]) => ({ count, frames: k.split(' <- ') })));
  say('retryLog', retryLines(session));
  activate(ws);
  const tBack = Date.now();
  const w = await waitTurn(session, { timeoutMs: 200_000 });
  say('turnAfterReactivation', { ...row(session), settledMsAfterReactivation: Date.now() - tBack, timeout: !!w.timeout });
  say('terminal', await terminalEvents(session));
  say('fileContent', exists(st, 'r3.txt') ? fs.readFileSync(`${R}/roots/${st}/child/r3.txt`, 'utf8') : null);
}

async function r4() {
  // Broker lease contention: two Sessions, one Workspace storage.
  const ws = `ws-r4${SUF}`;
  register(ws, 'st-d');
  for (const f of ['a.txt', 'b.txt', 'c.txt']) fs.rmSync(`${R}/roots/d/child/${f}`, { force: true });
  const a = await create(ws, 'G0_HANG hold=40000 name=a.txt', `r4a${SUF}`);
  const A = a.json.id;
  await waitFor(() => exists('d', 'a.txt'), { timeoutMs: 90_000 });
  say('holder', { ...row(A), fileA: exists('d', 'a.txt'), leaseHeld: one(`SELECT COUNT(*) FROM managed_workspace_execution_lease WHERE holder_key IS NOT NULL`) });
  const t0 = Date.now();
  const b = await create(ws, 'G0_FILES name=b.txt', `r4b${SUF}`);
  const B = b.json.id;
  say('contenderCreate', { status: b.status });
  const w = await waitTurn(B, { timeoutMs: 120_000 });
  say('contender', { ...row(B), settledMs: w.ms, timeout: !!w.timeout, fileB: exists('d', 'b.txt') });
  say('contenderHarnessCalls', tapFor(B, t0));
  say('contenderRetryLog', retryLines(B));
  say('contenderTerminal', await terminalEvents(B));
  say('harnessStderr', harnessLines().filter((l) => /workspace_busy|turn .* failed/.test(l)).slice(-3).map((l) => l.slice(0, 260)));
  const events = await thrown(['RuntimeBrokerException', 'DaemonHttpException'], { sinceMs: t0 });
  say('thrownSinceContention', summarize(events));
  const wa = await waitTurn(A, { timeoutMs: 120_000 });
  say('holderFinal', { ...row(A), timeout: !!wa.timeout });
  const c = await create(ws, 'G0_FILES name=c.txt', `r4c${SUF}`);
  const wc = await waitTurn(c.json.id, { timeoutMs: 120_000 });
  say('controlAfterRelease', { ...row(c.json.id), settledMs: wc.ms, fileC: exists('d', 'c.txt') ? fs.readFileSync(`${R}/roots/d/child/c.txt`, 'utf8') : null });
}

async function r5() {
  // Spring is SIGKILLed while the Harness still has the Session attached.
  const ws = `ws-r5${SUF}`;
  register(ws, 'st-e');
  fs.rmSync(`${R}/roots/e/child/r5.txt`, { force: true });
  const c = await create(ws, 'G0_HANG hold=100000 name=r5.txt', `r5${SUF}`);
  const session = c.json.id;
  const running = await waitFor(() => {
    const r = row(session);
    return r?.submission_attempted && r.admitted && exists('e', 'r5.txt') && r;
  }, { timeoutMs: 90_000 });
  say('beforeKill', running ?? row(session));
  const started = () => springLines().filter((l) => l.includes('Started ManagedAgentServerApplication')).length;
  const n0 = started();
  execFileSync(`${R}/stop.sh`, ['spring-kill9']);
  const tKill = Date.now();
  await sleep(1000);
  const child = spawn(`${R}/spring.sh`, [DB], { detached: true, stdio: ['ignore', fs.openSync(`${SP}/logs/spring-${DB}.log`, 'a'), fs.openSync(`${SP}/logs/spring-${DB}.log`, 'a')] });
  fs.writeFileSync(`${R}/run/spring.pid`, String(child.pid));
  child.unref();
  const up = await waitFor(() => started() > n0, { timeoutMs: 240_000, everyMs: 500 });
  say('springRestartedMs', up ? Date.now() - tKill : null);
  const tUp = Date.now();
  const timeline = [];
  let last = '';
  let final;
  while (Date.now() - tUp < 330_000) {
    const r = row(session);
    const key = `${r.status}/${r.retry_count}`;
    if (key !== last) {
      timeline.push({ tSec: +((Date.now() - tUp) / 1000).toFixed(1), status: r.status, retry_count: r.retry_count });
      last = key;
    }
    if (['COMPLETED', 'FAILED', 'CANCELLED'].includes(r.status)) {
      final = r;
      break;
    }
    await sleep(250);
  }
  say('timelineAfterRestart', timeline);
  say('turn', final ?? { ...row(session), timeout: true });
  say('harnessCallsAfterRestart', tapFor(session, tKill).filter((l) => !l.includes('/heartbeat')));
  say('retryLog', retryLines(session));
  say('terminal', await terminalEvents(session));
  say('observedSecAfterRestart', Math.round((Date.now() - tUp) / 1000));
  const groups = new Map();
  for (const e of await thrown(['DaemonHttpException'], { sinceMs: tKill })) {
    const key = `${e.message}|${e.frames.slice(0, 9).join(' <- ')}`;
    groups.set(key, (groups.get(key) ?? 0) + 1);
  }
  say('thrownByPath', [...groups].map(([k, count]) => ({ count, message: k.split('|')[0], frames: k.split('|')[1].split(' <- ') })));
}

async function injected(tag, storage, rule, prompt) {
  const ws = `ws-${tag}${SUF}`;
  register(ws, `st-${storage}`);
  fs.rmSync(`${R}/roots/${storage}/child/${tag}.txt`, { force: true });
  setRules([rule]);
  const t0 = Date.now();
  const c = await create(ws, prompt ?? `G0_FILES name=${tag}.txt`, `${tag}${SUF}`);
  const session = c.json.id;
  say('create', { status: c.status });
  const w = await waitTurn(session, { timeoutMs: 150_000 });
  clearRules();
  say('turn', { ...row(session), settledMs: w.ms, timeout: !!w.timeout });
  say('harnessCalls', tapFor(session, t0));
  say('retryLog', retryLines(session));
  say('terminal', await terminalEvents(session));
  say('file', exists(storage, `${tag}.txt`) ? fs.readFileSync(`${R}/roots/${storage}/child/${tag}.txt`, 'utf8') : null);
  say('thrown', summarize(await thrown(['DaemonHttpException', 'RuntimeBrokerException', 'PromptAdmissionUnknownException', 'MutationOutcomeUnknownException', 'SessionCreationOutcomeUnknownException'], { sinceMs: t0 })));
}

const run = {
  r1, r2, r3, r4, r5,
  // The Harness answers the submit with a permanent 4xx (request never admitted).
  r6a: () => injected('r6a', 'f', { id: 'prompt-400', method: 'POST', path: '/prompt$', mode: 'reply', status: 400, code: 'rig_injected_400', remaining: 1 }),
  // The event stream opens with a 503 once.
  r6b: () => injected('r6b', 'g', { id: 'events-503', method: 'GET', path: '/events', mode: 'reply', status: 503, code: 'rig_injected_503', remaining: 1 }),
  // The Harness answers the submit with a 409 once.
  r6c: () => injected('r6c', 'h', { id: 'prompt-409', method: 'POST', path: '/prompt$', mode: 'reply', status: 409, code: 'hosted_turn_active', remaining: 1 }),
  // The Harness answers the submit with a 503 once (a mutation, not the stream).
  r6e: () => injected('r6e', 'k', { id: 'prompt-503', method: 'POST', path: '/prompt$', mode: 'reply', status: 503, code: 'rig_injected_503', remaining: 1 }),
  // The reply to a successful create is lost on the wire (no status rewritten).
  r6d: () => injected('r6d', 'i', { id: 'create-reply-lost', method: 'POST', path: '^/session$', mode: 'lose', remaining: 1 }),
};

if (!run[name]) throw new Error(`unknown scenario ${name}`);
await run[name]();
res.finishedAt = new Date().toISOString();
out(`${name}${SUF}.json`, res);
console.log(`RESULT ${name}${SUF} written`);
