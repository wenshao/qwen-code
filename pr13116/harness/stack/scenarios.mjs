// VERIFICATION RIG ONLY: real-stack scenarios for PR 13116.
// usage: DB=<db> JAR=<label> node scenarios.mjs <warm|cold|transient> <tag>
//   Spring (main jar or a single-site mutant of it, MySQL 8.4.7) + packaged
//   Hosted Harness + embedded Broker + recording tap + scripted model.
import fs from 'node:fs';
import {
  R, DB, TENANT, sql, one, register, create, waitTurn, waitFor, sleep,
  turnRow, tapEntries, springLines, terminalEvents, thrown,
  setRules, clearRules, out,
} from './lib.mjs';

const name = process.argv[2];
const TAG = process.argv[3] ?? 'x';
const JAR = process.env.JAR ?? '?';
const res = { scenario: name, jar: JAR, tag: TAG, startedAt: new Date().toISOString() };
const say = (k, v) => {
  res[k] = v;
  console.log(`${k}: ${JSON.stringify(v)}`);
};

const tapFor = (session, sinceMs = 0) =>
  tapEntries()
    .filter((e) => Date.parse(e.t) >= sinceMs && (e.path?.includes(session) || e.sid === session))
    .filter((e) => !e.path.endsWith('/heartbeat'))
    .map((e) => `${e.t.slice(11, 23)} ${e.method} ${e.path.replace(session, ':id').replace(/\?.*/, '')} -> ${e.fault ? `[${e.fault}] ` : ''}${e.status ?? 'no reply'}${e.code ? ` ${e.code}` : ''}`);
const retryLines = (session) =>
  springLines()
    .filter((l) => l.includes(session) && /will retry|exhausted retries/.test(l))
    .map((l) => l.replace(/^.*?(Managed Turn coordination)/, '$1').replace(/tenant=\S+ session=\S+ turn=\S+ /, ''));
const summarize = (events) =>
  events.map((e) => ({ at: e.t.slice(11, 23), cls: e.cls, message: e.message, frames: e.frames.slice(0, 8) }));
const setState = (ws, state) =>
  sql(`UPDATE managed_workspace_registry SET state='${state}' WHERE tenant_id='${TENANT}' AND workspace_id='${ws}'`);
const state = (ws) => one(`SELECT state FROM managed_workspace_registry WHERE tenant_id='${TENANT}' AND workspace_id='${ws}'`);
const exists = (st, file) => fs.existsSync(`${R}/roots/${st}/child/${file}`);
const row = (session) => {
  const r = turnRow(session);
  return r && { status: r[1], error_code: r[2], retry_count: Number(r[3]), submission_attempted: r[4] === '1', admitted: r[5] !== '-' };
};
async function timeline(session, ms, stopWhen) {
  const t0 = Date.now();
  const seen = [];
  let last = '';
  while (Date.now() - t0 < ms) {
    const r = row(session);
    const key = `${r.status}/${r.error_code}/${r.retry_count}`;
    if (key !== last) {
      seen.push({ tSec: +((Date.now() - t0) / 1000).toFixed(1), ...r });
      last = key;
    }
    if (stopWhen?.(r)) break;
    await sleep(200);
  }
  return seen;
}

// Warm attachment cache: the Turn is admitted and running (the connector has
// cached its Harness attachment); the Workspace is then drained and the event
// stream cut, so the coordinator re-dispatches through createOrLoad on the
// warm cache. Pristine: the recheck refuses before any Harness call.
// C1 (catch-and-ignore RuntimeBrokerException) reuses the cached attachment.
async function warm() {
  const ws = `ws-warm-${TAG}`;
  const st = process.env.ST ?? 'a';
  register(ws, `st-${st}`);
  fs.rmSync(`${R}/roots/${st}/child/warm.txt`, { force: true });
  const c = await create(ws, 'G0_HANG hold=45000 name=warm.txt', `warm-${TAG}`);
  const session = c.json.id;
  say('create', { status: c.status, session, code: c.json.error?.code });
  const running = await waitFor(() => {
    const r = row(session);
    return r?.submission_attempted && r.admitted && exists(st, 'warm.txt') && r;
  }, { timeoutMs: 90_000 });
  say('beforeDrain', running ?? row(session));
  await sleep(1000);
  setState(ws, 'DRAINING');
  const tDrain = Date.now();
  const cut = await fetch('http://127.0.0.1:16116/__rig/cut').then((r) => r.text());
  say('drainedAndStreamsCut', { streams: Number(cut), registryState: state(ws) });
  say('timelineWhileDrained', await timeline(session, 70_000, (r) => ['COMPLETED', 'FAILED', 'CANCELLED'].includes(r.status)));
  say('registryStateAtEnd', state(ws));
  say('harnessCallsAfterDrain', tapFor(session, tDrain));
  say('retryLogAfterDrain', retryLines(session).slice(-8));
  say('terminal', await terminalEvents(session));
  say('thrownAfterDrain', summarize(await thrown(['RuntimeBrokerException'], { sinceMs: tDrain })).slice(0, 4));
  if (!['COMPLETED', 'FAILED', 'CANCELLED'].includes(row(session).status)) {
    setState(ws, 'ACTIVE');
    const tAct = Date.now();
    const w = await waitTurn(session, { timeoutMs: 120_000 });
    say('afterReactivation', { ...row(session), settledSecAfterReactivation: +((Date.now() - tAct) / 1000).toFixed(1), timeout: !!w.timeout });
  }
  out(`warm-${JAR}-${TAG}.json`, res);
}

// Cold attachment cache: the Workspace is drained by a trigger in the same
// statement that commits the Turn row, so the very first createOrLoad of a
// fresh Session must refuse. Pristine: no Harness call at all. C5 (recheck
// moved after the attachment is cached) creates the Harness Session first.
async function cold() {
  const ws = `ws-cold-${TAG}`;
  const st = process.env.ST ?? 'b';
  register(ws, `st-${st}`);
  sql(`DROP TRIGGER IF EXISTS rig_cold_drain`);
  sql(
    `CREATE TRIGGER rig_cold_drain AFTER INSERT ON managed_agent_turn FOR EACH ROW BEGIN IF (SELECT workspace_id FROM managed_agent_session WHERE tenant_id = NEW.tenant_id AND session_id = NEW.session_id) = '${ws}' THEN UPDATE managed_workspace_registry SET state = 'DRAINING' WHERE tenant_id = NEW.tenant_id AND workspace_id = '${ws}'; END IF; END`,
    DB,
    '//',
  );
  const t0 = Date.now();
  const c = await create(ws, 'G0_FILES name=cold.txt', `cold-${TAG}`);
  const session = c.json.id;
  say('create', { status: c.status, session, code: c.json.error?.code });
  const w = await waitTurn(session, { timeoutMs: 90_000 });
  sql(`DROP TRIGGER IF EXISTS rig_cold_drain`);
  say('turn', { ...row(session), settledMs: w.ms, timeout: !!w.timeout });
  say('registryState', state(ws));
  say('harnessCalls', tapFor(session, t0));
  say('capabilitiesCallsDuringTurn', tapEntries()
    .filter((e) => e.path === '/capabilities' && Date.parse(e.t) >= t0 && Date.parse(e.t) <= t0 + w.ms + 500)
    .map((e) => `${e.t.slice(11, 23)} GET /capabilities -> ${e.status ?? 'no reply'}`));
  say('fileWritten', exists(st, 'cold.txt'));
  say('terminal', await terminalEvents(session));
  say('thrown', summarize(await thrown(['RuntimeBrokerException'], { sinceMs: t0 })).slice(0, 4));
  out(`cold-${JAR}-${TAG}.json`, res);
}

// A non-refusal failure inside the recheck: the Harness is unreachable so the
// Turn sits in pre-admission retries; then the table the recheck joins is
// renamed away, so authorize() throws a DataAccessException (not a refusal).
// Pristine: generic catch -> retried; restored -> COMPLETED. C3 (any failure
// remapped to unavailable()) turns it into a terminal workspace_unavailable.
async function transient() {
  const ws = `ws-transient-${TAG}`;
  const st = process.env.ST ?? 'c';
  register(ws, `st-${st}`);
  fs.rmSync(`${R}/roots/${st}/child/transient.txt`, { force: true });
  setRules([{ id: 'harness-down', path: '^/session', mode: 'drop', remaining: 999 }]);
  const c = await create(ws, 'G0_FILES name=transient.txt', `transient-${TAG}`);
  const session = c.json.id;
  say('create', { status: c.status, session, code: c.json.error?.code });
  const r1 = await waitFor(() => row(session)?.retry_count >= 1 && row(session), { timeoutMs: 60_000 });
  say('harnessDownRetry', r1);
  sql('RENAME TABLE managed_workspace_create_command TO rig_hidden_create_command');
  const tHide = Date.now();
  say('recheckTableHidden', true);
  const seen = await timeline(session, 20_000, (r) => r.status === 'FAILED' || r.retry_count >= r1.retry_count + 2);
  sql('RENAME TABLE rig_hidden_create_command TO managed_workspace_create_command');
  clearRules();
  say('timelineWhileHidden', seen);
  say('thrownWhileHidden', summarize(await thrown(['RuntimeBrokerException', 'BadSqlGrammarException'], { sinceMs: tHide })).slice(0, 3));
  say('retryLogWhileHidden', retryLines(session).slice(-4));
  const w = await waitTurn(session, { timeoutMs: 120_000 });
  say('final', { ...row(session), timeout: !!w.timeout });
  say('fileWritten', exists(st, 'transient.txt'));
  say('terminal', await terminalEvents(session));
  out(`transient-${JAR}-${TAG}.json`, res);
}

// Warm attachment + non-refusal failure: the Turn is admitted and running, then
// the table the recheck joins is renamed away and the event stream cut, so each
// re-dispatch hits a DataAccessException on the warm cache. Pristine: retried,
// no Harness call while hidden. C13 (swallow while a cached attachment exists)
// keeps serving the cached attachment.
async function warmtransient() {
  const ws = `ws-wt-${TAG}`;
  const st = process.env.ST ?? 'd';
  register(ws, `st-${st}`);
  fs.rmSync(`${R}/roots/${st}/child/wt.txt`, { force: true });
  const c = await create(ws, 'G0_HANG hold=30000 name=wt.txt', `wt-${TAG}`);
  const session = c.json.id;
  say('create', { status: c.status, session, code: c.json.error?.code });
  const running = await waitFor(() => {
    const r = row(session);
    return r?.submission_attempted && r.admitted && exists(st, 'wt.txt') && r;
  }, { timeoutMs: 90_000 });
  say('beforeHide', running ?? row(session));
  await sleep(1000);
  sql('RENAME TABLE managed_workspace_create_command TO rig_hidden_create_command');
  const tHide = Date.now();
  const cut = await fetch('http://127.0.0.1:16116/__rig/cut').then((r) => r.text());
  say('hiddenAndStreamsCut', { streams: Number(cut) });
  const seen = await timeline(session, 45_000, (r) => ['COMPLETED', 'FAILED', 'CANCELLED'].includes(r.status));
  const callsWhileHidden = tapFor(session, tHide);
  sql('RENAME TABLE rig_hidden_create_command TO managed_workspace_create_command');
  say('timelineWhileHidden', seen);
  say('harnessCallsWhileHidden', callsWhileHidden);
  say('retryLogWhileHidden', retryLines(session).slice(-6));
  say('thrownWhileHidden', summarize(await thrown(['BadSqlGrammarException'], { sinceMs: tHide }))
    .filter((e) => e.frames.some((f) => f.startsWith('QwenHostedHarnessConnector.createOrLoad'))).slice(0, 2));
  if (!['COMPLETED', 'FAILED', 'CANCELLED'].includes(row(session).status)) {
    const tRestore = Date.now();
    const w = await waitTurn(session, { timeoutMs: 150_000 });
    say('afterRestore', { ...row(session), settledSecAfterRestore: +((Date.now() - tRestore) / 1000).toFixed(1), timeout: !!w.timeout });
  }
  say('terminal', await terminalEvents(session));
  out(`warmtransient-${JAR}-${TAG}.json`, res);
}

const fns = { warm, cold, transient, warmtransient };
if (!fns[name]) {
  console.error(`unknown scenario ${name}`);
  process.exit(2);
}
try {
  await fns[name]();
} finally {
  clearRules();
}
