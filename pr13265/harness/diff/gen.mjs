// Candidate generator for the child_run TS/Java differential (PR #13265).
// Writes one JSON object per line: {id, type:"record", body} or
// {id, type:"succ", before, after}. Bodies are raw JSON text so that number
// spellings JS cannot produce (1.0, 1e2, -0) reach Java as written.
import fs from 'node:fs';
const WT = process.env.WT;
const N = Number(process.env.N ?? 200000);
const F = JSON.parse(fs.readFileSync(`${WT}/packages/core/src/managed-runtime/contracts/managed-child-run-record-v1.fixtures.json`, 'utf8'));
const R = JSON.parse(fs.readFileSync(`${WT}/packages/core/src/managed-runtime/contracts/managed-extension-record-v1.fixtures.json`, 'utf8'));
let seed = 13265;
const rand = () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const pick = (a) => a[Math.floor(rand() * a.length)];
const merge = (base, patch) => { const v = structuredClone(base ?? {}); for (const [k, r] of Object.entries(patch)) v[k] = r !== null && typeof r === 'object' && !Array.isArray(r) ? merge(v[k], r) : r; return v; };
const T = F.templates.child_run;
const RAW = (s) => `@@RAW:${s}@@`;
const LS = new RegExp(String.fromCharCode(0x2028), "g"); const PS = new RegExp(String.fromCharCode(0x2029), "g");
const ser = (v) => JSON.stringify(v).replace(/"@@RAW:([^@]*)@@"/g, "$1").replace(LS, "\\u2028").replace(PS, "\\u2029");
const fixtureRecords = F.cases.map((c) => merge(T, c.patch));
const fixtureSucc = F.successors.map((c) => [merge(T, c.before), merge(T, c.after)]);
const ref = (id, kind, extra = {}) => ({ resourceId: id, kind, schemaVersion: 1, byteLength: 2, digest: 'b'.repeat(64), ...extra });
const pool = {};
const add = (k, v) => (pool[k] ??= new Map()).set(ser(v), v);
for (const r of [...fixtureRecords, ...fixtureSucc.flat()]) for (const [k, v] of Object.entries(r)) add(k, v);
for (const c of R.runCases) add('run', c.run);
for (const c of R.runSuccessorCases) { add('run', c.previous); add('run', c.next); }
for (const v of [0, 1, 127, 128, 255, 256, -1, 1.5, RAW('1.0'), RAW('1e2'), RAW('-0'), RAW('2.55e2'), RAW('255.0000000000000001'), '0', true, null]) add('exitCode', v);
for (const v of ['TERM', 'KILL', 'SIGTERM', 'HUP', 'RTMIN1', 'A'.repeat(16), 'A'.repeat(17), '', 'term', '1TERM', 'TERM\n', 'TÉRM', 9, 0, true, false, {}, [], null]) add('exitSignal', v);
for (const v of ['shell', 'Shell', 'child_agent', 'workflow', '', 1, null, true]) add('kind', v);
for (const v of ['exited', 'start_failed', 'process_failed', 'quota_exceeded', 'stop_requested', 'max_events', 'idle_timeout', 'watch_failed', '', 1, null]) add('stopReason', v);
for (const v of ['shell-1', 'shell-2', '', 'a\u0000b', 'x'.repeat(128), 'x'.repeat(129), '\u{105D2}̇', 'é', 'é', 1, null]) { add('shellId', v); add('ownerScopeId', v); }
const manifest = (extra = {}) => ref('manifest-1', 'managed-tool-result-manifest', extra);
for (const v of [manifest(), manifest({ resourceId: 'manifest-2' }), manifest({ schemaVersion: 2 }), manifest({ schemaVersion: RAW('1.0') }), ref('m', 'managed-tool-result'), ref('m', 'receipt-data'), null, 'manifest-1', {}]) add('outputRef', v);
for (const v of [ref('receipt-1', 'receipt-data'), ref('receipt-2', 'receipt-data'), ref('receipt-1', 'managed-runtime-receipt'), { ...ref('r', 'receipt-data'), extra: 1 }, ref('r', 'receipt-data', { digest: 'B'.repeat(64) }), null, 'receipt-1']) add('startReceiptRef', v);
for (const v of [ref('args-1', 'args-data'), ref('args-2', 'args-data'), null, { resourceId: 'args-1' }]) add('commandRef', v);
for (const k of Object.keys(pool)) pool[k] = [...pool[k].values()];
const keys = Object.keys(T);
const out = fs.createWriteStream(process.env.OUT);
let n = 0;
const emit = (o) => { out.write(o.type === 'record' ? `{"id":${n},"type":"record","body":${ser(o.body)}}\n` : `{"id":${n},"type":"succ","before":${ser(o.before)},"after":${ser(o.after)}}\n`); n++; };
const mutateOne = (b) => { const c = structuredClone(b); const k = pick(keys); c[k] = structuredClone(pick(pool[k])); return c; };
const mutateRun = (b) => { const c = structuredClone(b); const rk = pick(Object.keys(T.run)); const donor = pick(pool.run); if (donor && typeof donor === 'object') c.run = { ...c.run, [rk]: structuredClone(donor[rk]) }; return c; };
// 1. every fixture record and successor
for (const b of fixtureRecords) emit({ type: 'record', body: b });
for (const [a, b] of fixtureSucc) emit({ type: 'succ', before: a, after: b });
// 2. exhaustive single-field substitutions of every fixture record
for (const b of fixtureRecords) for (const k of keys) for (const v of pool[k]) { const c = structuredClone(b); c[k] = structuredClone(v); emit({ type: 'record', body: c }); }
const valid = [...fixtureRecords];
// 3. random walks: 1-4 mutations (top-level or inside run) from a fixture record
while (n < N * 0.6) { let c = structuredClone(pick(valid)); const steps = 1 + Math.floor(rand() * 4); for (let i = 0; i < steps; i++) c = rand() < 0.5 ? mutateOne(c) : mutateRun(c); emit({ type: 'record', body: c }); }
// 4. successor pairs: fixture pairs with one side mutated, and random pairs of fixture-derived records
while (n < N) {
  const r = rand();
  if (r < 0.4) { const [a, b] = pick(fixtureSucc); emit({ type: 'succ', before: a, after: rand() < 0.5 ? mutateOne(b) : mutateRun(b) }); }
  else if (r < 0.7) { const [a, b] = pick(fixtureSucc); emit({ type: 'succ', before: rand() < 0.5 ? mutateOne(a) : mutateRun(a), after: b }); }
  else { const a = pick(valid); const b = pick(valid); emit({ type: 'succ', before: a, after: rand() < 0.3 ? mutateRun(b) : b }); }
}
out.end(() => console.log(`wrote ${n} candidates`));
