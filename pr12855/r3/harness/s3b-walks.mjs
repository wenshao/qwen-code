// S3b: random walks over accepted revisions. Each Session runs three Monitor
// chains interleaved; each step picks a random single- or double-field
// mutation of the chain's latest body that the TypeScript rules accept, and
// commits it through the normal (checked) authority. After every step the
// Java row must equal the authority's view; at the end the public list, the
// WebShell list and the outbox must equal the authority's.
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import {
  FIXTURES, RefMapper, allEvents, outboxOf, api, commitMonitor, createPublicSession, javaRows,
  openLog, openSession, projection, say, tsViewAsRow,
} from './lib.mjs';

openLog(`${process.env.WT ? 'new-' : ''}s3b-walks-seed${process.env.SEED ?? 4242}`);
const BODY = projection.MANAGED_EXTENSION_RECORD_BODIES.monitor_run;
let seed = Number(process.env.SEED ?? 4242);
const rand = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = (a) => a[Math.floor(rand() * a.length)];

const vals = {};
const add = (k, v) => (vals[k] ??= new Map()).set(JSON.stringify(v), v);
const runs = [
  ...FIXTURES.runStartCases.map((c) => c.run),
  ...FIXTURES.viewCases.map((c) => c.run),
  ...FIXTURES.historyCases.flatMap((c) => c.revisions.map((r) => r.run)),
].filter((r) => r && typeof r === 'object');
for (const r of runs) for (const [k, v] of Object.entries(r)) add(`run.${k}`, v);
const monitors = [
  ...FIXTURES.monitorRunStartCases.map((c) => c.monitorRun),
  ...FIXTURES.monitorChainCases.flatMap((c) => c.revisions.map((r) => r.monitorRun)),
  ...FIXTURES.monitorChainRejectCases.flatMap((c) => [...c.accepted, c.next]),
].filter((m) => m && typeof m === 'object');
for (const m of monitors)
  for (const [k, v] of Object.entries(m)) if (k !== 'run' && k !== 'monitorId') add(`mon.${k}`, v);
// counters must be able to keep moving forward
for (const k of ['mon.observationSequence', 'mon.notifiedThrough']) for (let i = 0; i <= 12; i++) add(k, i);
const FIELDS = Object.keys(vals);

function mutate(body) {
  const copy = structuredClone(body);
  if (rand() < 0.35) {
    // terminal template: the fields a run must change together to end
    copy.run.state = pick(['settled', 'failed', 'cancelled']);
    copy.stopReason = pick([...vals['mon.stopReason'].values()].filter((v) => v !== null));
    copy.run.execution = pick(['settled', 'not_started_proven', 'outcome_unknown', null, copy.run.execution]);
    if (rand() < 0.5) copy.run.reason = pick([...vals['run.reason'].values()]);
    if (copy.stopReason === 'max_events') copy.observationSequence = copy.maxEvents;
    return copy;
  }
  const n = 1 + Math.floor(rand() * 4);
  for (let i = 0; i < n; i++) {
    const field = pick(FIELDS);
    const v = structuredClone(pick([...vals[field].values()]));
    if (field.startsWith('run.')) copy.run[field.slice(4)] = v;
    else copy[field.slice(4)] = v;
  }
  return copy;
}
const accepts = (prev, next) => {
  try {
    BODY.parse(next);
  } catch {
    return false;
  }
  return prev === null ? BODY.isStart(next) : BODY.isSuccessor(prev, next);
};

const WALKS = Number(process.env.WALKS ?? 20);
const STEPS = Number(process.env.STEPS ?? 25);
const starts = FIXTURES.monitorRunStartCases.filter((c) => c.valid).map((c) => c.monitorRun);
const seen = new Map();
let steps = 0, stepMismatch = 0, stuck = 0;
const endChecks = [];
for (let w = 0; w < WALKS; w++) {
  const pub = await createPublicSession({ actor: 'alice' });
  const sessionId = pub.id;
  const { session, sessionKey } = await openSession({ sessionId, writerId: `walk-${w}`, create: true });
  const refs = new RefMapper(session.resources);
  const chains = [0, 1, 2].map((k) => ({ id: `m${w}-${k}`, latest: null }));
  for (let s = 0; s < STEPS * chains.length; s++) {
    const chain = pick(chains);
    // Novelty search: among accepted, changed candidates prefer one whose
    // projected (state, runtime, delivery) this run has not reached yet.
    let next = null;
    const pool = [];
    for (let attempt = 0; attempt < 1500 && pool.length < 60; attempt++) {
      const base = chain.latest ?? { ...pick(starts), monitorId: chain.id };
      const cand = chain.latest === null && attempt === 0 ? base : mutate(base);
      cand.monitorId = chain.id;
      const mapped = await refs.remap(cand);
      if (chain.latest !== null && JSON.stringify(mapped) === JSON.stringify(chain.latest)) continue;
      if (accepts(chain.latest, mapped)) pool.push(mapped);
    }
    const combo = (b) => {
      const v = projection.projectManagedTask(null, BODY.parse(b).run, 0);
      return `${v.state}|${v.runtimeState ?? 'null'}|${b.run.delivery?.state ?? 'null'}`;
    };
    const novel = pool.filter((b) => !seen.has(combo(b)));
    if (pool.length) next = rand() < 0.8 && novel.length ? pick(novel) : pick(pool);
    if (next === null) {
      stuck++;
      continue;
    }
    await commitMonitor(session, sessionKey, `${chain.id}:${s}`, next);
    chain.latest = next;
    steps++;
    const ts = tsViewAsRow(session.authority.extensionRecord('monitor_run', chain.id));
    const java = javaRows(sessionId).find((r) => r[0] === chain.id).slice(0, 10);
    if (JSON.stringify(ts) !== JSON.stringify(java)) {
      stepMismatch++;
      say('STEP-MISMATCH', { ts, java });
    }
    const key = `${ts[2]}|${ts[3]}|${ts[9]}`;
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  const tsViews = session.authority.taskViews();
  const list = await api('GET', `/v1/agents/sessions/${sessionId}/tasks?limit=100`, { actor: 'alice' });
  const wsList = await api('POST', '/api/agent/web-shell/v1/tasks/query', { actor: 'alice', body: { sessionId, limit: 100 } });
  const outboxTs = outboxOf(session.authority, chains.map((c) => c.id));
  const pending = new Set(projection.MANAGED_EXTENSION_RECORD_BODIES && ['planned', 'sending', 'partial', 'accepting', 'unknown']);
  const outboxJava = javaRows(sessionId).filter((r) => pending.has(r[9])).map((r) => r[0]).sort();
  const taskEvents = (await allEvents(sessionId)).filter((e) => e.type === 'task.updated').length;
  endChecks.push({
    walk: w,
    publicOrderEqual: JSON.stringify(list.json.data.map((t) => t.id)) === JSON.stringify(tsViews.map((v) => v.taskId)),
    webShellEqual: JSON.stringify(wsList.json.data.map((t) => [t.taskId, t.state, t.runtimeState ?? null, t.createdAt, t.startedAt ?? null, t.settledAt ?? null])) ===
      JSON.stringify(tsViews.map((v) => [v.taskId, v.state, v.runtimeState, v.createdAt, v.startedAt, v.settledAt])),
    outboxEqual: JSON.stringify(outboxTs) === JSON.stringify(outboxJava),
    outbox: outboxTs.length,
    taskEvents,
  });
  await session.close();
  // cold reopen by another writer rebuilds the same list and outbox
  const b = await openSession({ sessionId, writerId: `walk-${w}-b` });
  endChecks.at(-1).reopenEqual =
    JSON.stringify(b.session.authority.taskViews()) === JSON.stringify(tsViews) &&
    JSON.stringify(outboxOf(b.session.authority, chains.map((c) => c.id))) === JSON.stringify(outboxTs);
  await b.session.close();
}
const combos = [...seen.entries()].sort((a, b) => b[1] - a[1]);
fs.writeFileSync(`${process.env.RIG_OUT ?? '.'}/s3b-combos.json`, JSON.stringify(combos));
say('summary', {
  walks: WALKS, steps, stuck, stepMismatch,
  distinctStateRuntimeDelivery: combos.length,
  taskStates: [...new Set(combos.map(([k]) => k.split('|')[0]))],
  runtimeStates: [...new Set(combos.map(([k]) => k.split('|')[1]))],
  deliveryStates: [...new Set(combos.map(([k]) => k.split('|')[2]))],
  endChecksAllTrue: endChecks.every((c) => c.publicOrderEqual && c.webShellEqual && c.outboxEqual && c.reopenEqual),
  walksWithOutbox: endChecks.filter((c) => c.outbox > 0).length,
  taskEvents: endChecks.reduce((a, c) => a + c.taskEvents, 0),
});
for (const c of endChecks.filter((c) => !(c.publicOrderEqual && c.webShellEqual && c.outboxEqual && c.reopenEqual))) say('END-MISMATCH', c);
