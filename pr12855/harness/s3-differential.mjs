// S3: TS-vs-Java verdict differential on the real stack.
// For every candidate revision, the TypeScript rules (isMonitorRunStart /
// isMonitorRunSuccessor on the parsed body) give one verdict. The same
// revision is then committed with the authority's own chain check disabled
// ("bypass writer"), so only the Java Session store decides. Accepted
// revisions must give the same task view on both sides; refused ones must
// leave the journal, the resources and the record table untouched.
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import {
  FIXTURES, RefMapper, commitMonitor, javaRows, journalCounts, openLog,
  openSession, projection, say, tsViewAsRow,
} from './lib.mjs';

openLog('s3-differential');
const BODY = projection.MANAGED_EXTENSION_RECORD_BODIES.monitor_run;
let seed = 12855;
const rand = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pickN = (arr, n) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, n);
};

// Observed values per field, from every fixture that holds a run or a monitor.
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

function mutate(body, field, value) {
  const copy = structuredClone(body);
  if (field.startsWith('run.')) copy.run[field.slice(4)] = structuredClone(value);
  else copy[field.slice(4)] = structuredClone(value);
  return copy;
}
function mutations(body, perField) {
  const out = [];
  for (const [field, map] of Object.entries(vals)) {
    const current = JSON.stringify(
      field.startsWith('run.') ? body.run[field.slice(4)] : body[field.slice(4)],
    );
    const alts = [...map.entries()].filter(([k]) => k !== current).map(([, v]) => v);
    for (const v of pickN(alts, perField)) out.push([`${field}=${JSON.stringify(v).slice(0, 40)}`, mutate(body, field, v)]);
  }
  return out;
}

const cases = [];
// A: the 8 fixture chains both sides must refuse
for (const c of FIXTURES.monitorChainRejectCases) cases.push({ label: `reject:${c.id}`, prefix: c.accepted, next: c.next });
// B: the 31 Monitor start cases as first revisions
for (const c of FIXTURES.monitorRunStartCases) cases.push({ label: `start:${c.id}`, prefix: [], next: c.monitorRun, fixtureValid: c.valid });
// C: every accepted transition, and single-field mutations of it
for (const chain of FIXTURES.monitorChainCases) {
  const revs = chain.revisions.map((r) => r.monitorRun);
  for (let i = 0; i < revs.length; i++) {
    const prefix = revs.slice(0, i);
    cases.push({ label: `chain:${chain.id}#${i + 1}`, prefix, next: revs[i] });
    for (const [what, next] of mutations(revs[i], chain.id === 'refused-on-quota' ? 3 : 2))
      cases.push({ label: `mut:${chain.id}#${i + 1}:${what}`, prefix, next });
  }
}
// D: cross pairs — each reachable prefix of the long chain against other bodies
const distinct = [...new Map(monitors.map((m) => [JSON.stringify(m), m])).values()];
const longChain = FIXTURES.monitorChainCases[0].revisions.map((r) => r.monitorRun);
for (let i = 1; i <= longChain.length; i++)
  for (const next of pickN(distinct, 18)) cases.push({ label: `cross:#${i}`, prefix: longChain.slice(0, i), next });

say('cases', { total: cases.length, byKind: Object.fromEntries(['reject', 'start', 'chain', 'mut', 'cross'].map((k) => [k, cases.filter((c) => c.label.startsWith(k + ':')).length])) });

function tsVerdict(prefix, next) {
  let parsed;
  try {
    parsed = BODY.parse(next);
  } catch {
    return { parse: false, accept: false };
  }
  const prev = [...prefix].reverse().find((p) => p.monitorId === parsed.recordId);
  return { parse: true, accept: prev === undefined ? BODY.isStart(next) : BODY.isSuccessor(prev, next) };
}

let n = 0;
const results = [];
async function runCase(c) {
  const id = ++n;
  const sessionId = randomUUID();
  const { session, sessionKey } = await openSession({ sessionId, writerId: `w${id}`, create: true });
  try {
    const refs = new RefMapper(session.resources);
    const prefix = [];
    for (const b of c.prefix) prefix.push(await refs.remap(b));
    const next = await refs.remap(c.next);
    for (let i = 0; i < prefix.length; i++) await commitMonitor(session, sessionKey, `p${i}`, prefix[i]);
    const ts = tsVerdict(prefix, next);
    const before = journalCounts(sessionId);
    // bypass writer: the TS chain check is off, so Java alone decides
    session.authority.assertExtensionRevision = () => {};
    let submit = next;
    if (!ts.parse) {
      // TS cannot even parse it: send a parseable stand-in and swap the
      // published body bytes so the Java store sees the raw candidate.
      submit = prefix.at(-1) ?? (await refs.remap(FIXTURES.monitorChainCases[0].revisions[0].monitorRun));
      const orig = session.resources.publish.bind(session.resources);
      session.resources.publish = (kind, bytes) =>
        orig(kind, kind === 'managed-monitor_run' ? Buffer.from(JSON.stringify(next), 'utf8') : bytes);
    }
    let java;
    try {
      await commitMonitor(session, sessionKey, 'candidate', submit);
      java = { accept: true };
    } catch (e) {
      java = { accept: false, code: `${e.status ?? ''}:${e.remoteCode ?? e.code ?? e.name}`, message: String(e.message).slice(0, 160) };
    }
    const after = journalCounts(sessionId);
    const r = { label: c.label, ts, java, fixtureValid: c.fixtureValid };
    if (java.accept) {
      const recordId = next.monitorId;
      const tsRow = tsViewAsRow(session.authority.extensionRecord('monitor_run', recordId));
      const jRow = javaRows(sessionId).find((row) => row[0] === recordId)?.slice(0, 10);
      r.viewEqual = JSON.stringify(tsRow) === JSON.stringify(jRow);
      if (!r.viewEqual) r.views = { tsRow, jRow };
    } else {
      r.rolledBack = JSON.stringify(before) === JSON.stringify(after);
      if (!r.rolledBack) r.counts = { before, after };
    }
    results.push(r);
  } finally {
    await session.close().catch(() => {});
  }
}

const queue = [...cases];
const started = Date.now();
await Promise.all(
  Array.from({ length: 4 }, async () => {
    while (queue.length) {
      const c = queue.shift();
      try {
        await runCase(c);
      } catch (e) {
        results.push({ label: c.label, harnessError: String(e.message).slice(0, 200) });
      }
    }
  }),
);
const secs = ((Date.now() - started) / 1000).toFixed(1);
fs.writeFileSync(`${process.env.RIG_OUT ?? '.'}/s3-results.json`, JSON.stringify(results, null, 1));

const agree = results.filter((r) => r.ts && r.ts.accept === r.java.accept);
const disagree = results.filter((r) => r.ts && r.ts.accept !== r.java.accept);
const harness = results.filter((r) => r.harnessError);
const accepted = results.filter((r) => r.java?.accept);
const refused = results.filter((r) => r.java && !r.java.accept);
const codes = {};
for (const r of refused) codes[r.java.code] = (codes[r.java.code] ?? 0) + 1;
const fixtureMismatch = results.filter((r) => r.fixtureValid !== undefined && r.fixtureValid !== r.java.accept);
say('summary', {
  seconds: secs,
  cases: results.length,
  agree: agree.length,
  disagree: disagree.length,
  harnessErrors: harness.length,
  tsParseFailures: results.filter((r) => r.ts && !r.ts.parse).length,
  accepted: accepted.length,
  acceptedViewEqual: accepted.filter((r) => r.viewEqual).length,
  refused: refused.length,
  refusedRolledBack: refused.filter((r) => r.rolledBack).length,
  refusalCodes: codes,
  startCasesVsFixtureLabel: `${results.filter((r) => r.fixtureValid !== undefined).length - fixtureMismatch.length}/${results.filter((r) => r.fixtureValid !== undefined).length}`,
});
for (const r of disagree.slice(0, 20)) say('DISAGREE', r);
for (const r of harness.slice(0, 10)) say('HARNESS', r);
for (const r of accepted.filter((x) => !x.viewEqual).slice(0, 10)) say('VIEW-MISMATCH', r);
for (const r of refused.filter((x) => !x.rolledBack).slice(0, 10)) say('NOT-ROLLED-BACK', r);
for (const r of results.filter((x) => x.label.startsWith('reject:'))) say('reject-case', { label: r.label, ts: r.ts.accept, java: r.java.accept, code: r.java.code, rolledBack: r.rolledBack });
