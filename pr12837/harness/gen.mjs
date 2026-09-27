// Structured generator for managed-extension-record/1 differential runs.
// Emits JSONL lines {"k":<kind>,"a":<record>[,"b":<record>]} as raw text, so
// number spellings such as 1.0, -0 and 1e400 reach each parser unchanged.
// Usage: node gen.mjs <core-dist> <fixtures.json> <count> <seed> > cases.jsonl
import * as fs from 'node:fs';
import * as path from 'node:path';

const [distRoot, fixturesPath, countArg, seedArg] = process.argv.slice(2);
const mod = await import(
  path.resolve(distRoot, 'src/managed-runtime/managed-extension-record.js')
);
const fx = JSON.parse(fs.readFileSync(fixturesPath, 'utf8'));
const N = Number(countArg);

// Deterministic PRNG (mulberry32).
let s = Number(seedArg) >>> 0;
const rnd = () => {
  s = (s + 0x6d2b79f5) >>> 0;
  let t = s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = (a) => a[Math.floor(rnd() * a.length)];
const chance = (p) => rnd() < p;

class Raw {
  constructor(text) {
    this.text = text;
  }
}
const raw = (t) => new Raw(t);
function ser(v) {
  if (v instanceof Raw) return v.text;
  if (typeof v === 'number' && !Number.isFinite(v)) return v > 0 ? '1e400' : '-1e400';
  if (typeof v === 'string') return JSON.stringify(v).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(ser).join(',')}]`;
  return `{${Object.keys(v)
    .map((k) => `${JSON.stringify(k)}:${ser(v[k])}`)
    .join(',')}}`;
}
const clone = (v) =>
  v instanceof Raw
    ? v
    : v === null || typeof v !== 'object'
      ? v
      : Array.isArray(v)
        ? v.map(clone)
        : Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clone(x)]));
const valid = (fn, ...args) => {
  try {
    const r = fn(...args.map((a) => JSON.parse(ser(a))));
    return r !== false;
  } catch {
    return false;
  }
};

// ---- value pools -------------------------------------------------------
const GOOD_IDS = [
  'call-1', 'call-2', 'effect-1', 'dispatch-1', 'delivery-1', 'delivery-2',
  'binding-1', 'binding-2', 'é', 'x'.repeat(512), '日'.repeat(170),
  '\u{1D49C}', '__proto__', 'constructor', 'a b', ' ', ' ',
  '\u{105C9}', // assigned in Unicode 16, not in JDK 21's Unicode 15
];
const BAD_IDS = [
  '', 'é', '\ud800', '\udc00', 'a\ud800b', 'a\u0000', '\u001f', '\u007f',
  '\u0080', '\u009f', 'x'.repeat(513), '日'.repeat(171), 'x'.repeat(511) + 'é',
  '\u{105D2}̇', // composes to U+105C9 under Unicode 16 only
  1, true, [], {}, null,
];
const idv = (bad = 0.08) => (chance(bad) ? pick(BAD_IDS) : pick(GOOD_IDS));
const optId = (pNull = 0.5, bad = 0.05) => (chance(pNull) ? null : idv(bad));
const RAW_INTS = [
  '1.0', '1e0', '0.1e1', '10e-1', '-0', '-0.0', '1e400', '-1e400', '1e-400',
  '9007199254740990', '9007199254740991', '9007199254740992',
  '9007199254740990.4', '1.5', '-1', '"1"', 'null', 'true', '[]', '{}',
  '8640000000000000', '8640000000000000.4', '8640000000000001',
  '100000000000000000000', '1E3',
];
const num = (good, pRaw = 0.1) => (chance(pRaw) ? raw(pick(RAW_INTS)) : pick(good));
const GENS = [
  '1', '2', '9', '10', '11', '99', '100', '9223372036854775807',
  '9223372036854775806',
];
const BAD_GENS = [
  '0', '01', '9223372036854775808', '1\n', ' 1', '+1', '1.0', '-1', '', '٣',
  '１', 1, null, '99999999999999999999',
];
const gen = (bad = 0.06) => (chance(bad) ? pick(BAD_GENS) : pick(GENS));
const DIGESTS = ['a'.repeat(64), 'b'.repeat(64), fx.definitionPin.definitionDigest];
const BAD_DIGESTS = ['A'.repeat(64), 'a'.repeat(63), 'a'.repeat(65), 'g'.repeat(64), 'a'.repeat(64) + '\n', null, 1];
const digest = (bad = 0.05) => (chance(bad) ? pick(BAD_DIGESTS) : pick(DIGESTS));
const GARBAGE_ENUM = ['', 'RUNNING', 'toString', '__proto__', 'hasOwnProperty', 'constructor', 1, null, []];
const RUN = fx.stateLines.run.states;
const EXE = fx.stateLines.execution.states;
const DEL = fx.stateLines.delivery.states;
const REC = fx.reasons.recovery;
const QUO = fx.reasons.quota;
const STOPS = Object.values(fx.monitorStopReasons).flat();
const en = (a, bad = 0.03) => (chance(bad) ? pick(GARBAGE_ENUM) : pick(a));

function ref(kind, bad = 0.04) {
  const r = {
    resourceId: chance(0.5) ? 'res-1' : 'res-2',
    kind,
    schemaVersion: 1,
    byteLength: num([0, 1, 96, 4096], 0.03),
    digest: digest(0.02),
  };
  if (chance(bad)) mutateObject(r);
  return r;
}
function mutateObject(o) {
  if (o === null || typeof o !== 'object' || o instanceof Raw || Array.isArray(o)) return;
  const keys = Object.keys(o);
  if (keys.length === 0) return;
  const r = rnd();
  if (r < 0.25) delete o[pick(keys)];
  else if (r < 0.45) o[pick(['extra', '__proto__', 'epoch'])] = 1;
  else if (r < 0.7) o[pick(keys)] = pick([null, 1, 'x', [], {}, raw('1e400')]);
  else o[pick(keys)] = raw(pick(RAW_INTS));
}
function pin(bad = 0.05) {
  const p = {
    definitionId: chance(0.7) ? 'def-1' : pick(['def-2', idv(0.1)]),
    definitionRevision: num([1, 2, 4, 9007199254740990], 0.08),
    definitionDigest: digest(0.05),
  };
  if (chance(bad)) mutateObject(p);
  return p;
}
function run(opts = {}) {
  const r = {
    state: en(RUN),
    reason: chance(0.45) ? null : en([...REC, ...QUO]),
    definition: chance(opts.noDef ? 0.97 : 0.6) ? null : pin(0.03),
    executionCallId: chance(opts.callId ?? 0.5) ? idv(0.03) : null,
    effectId: chance(opts.effect ?? 0.35) ? idv(0.03) : null,
    dispatchId: chance(opts.dispatch ?? 0.3) ? idv(0.03) : null,
    deliveryId: chance(opts.deliveryId ?? 0.3) ? idv(0.03) : null,
    execution: chance(0.25) ? null : en(EXE),
    runtime: chance(0.4)
      ? null
      : { runtimeBindingId: chance(0.5) ? 'binding-1' : idv(0.05), generation: gen() },
    delivery: chance(opts.delivery ?? 0.5)
      ? null
      : { target: en(['channel', 'session'], 0.02), state: en(DEL) },
  };
  if (chance(0.03)) mutateObject(r);
  if (r.runtime && chance(0.03)) mutateObject(r.runtime);
  if (r.delivery && chance(0.03)) mutateObject(r.delivery);
  return r;
}
function monitorRunRecord() {
  const maxEvents = num([1, 3, 10000], 0.05);
  const me = typeof maxEvents === 'number' ? maxEvents : 3;
  const seq = pick([0, 0, 1, 2, me, me]);
  const m = {
    monitorId: chance(0.9) ? 'monitor-1' : idv(0.2),
    ownerScopeId: chance(0.9) ? 'scope-main' : idv(0.2),
    commandRef: ref('managed-tool-args', 0.03),
    maxEvents,
    idleTimeoutMs: num([1, 30000, 600000, 0, 600001], 0.05),
    debounceMs: num([0, 500, 600000, 600001], 0.05),
    startReceiptRef: chance(0.4) ? null : ref(chance(0.5) ? 'receipt-a' : 'receipt-b', 0.02),
    observationSequence: chance(0.05) ? raw(pick(RAW_INTS)) : seq,
    lastObservationRef: (seq === 0 ? chance(0.85) : chance(0.1)) ? null : ref('obs', 0.02),
    notifiedThrough: pick([0, 0, 1, 2, seq, seq + 1]),
    stopReason: chance(0.5) ? null : en(STOPS),
    outputRef: chance(0.6)
      ? null
      : ref(chance(0.9) ? 'managed-tool-result-manifest' : 'managed-tool-args', 0.02),
    run: run({ callId: 0.95, effect: 0.03, dispatch: 0.03, deliveryId: 0.03, delivery: 0.97, noDef: true }),
  };
  if (chance(0.03)) mutateObject(m);
  return m;
}
function grant() {
  const domain = chance(0.97) ? pick(fx.domains) : pick(['monitor', 'MONITOR_RUN', '__proto__', 1]);
  const g = {
    sessionKey: { ...fx.grant.sessionKey },
    operationId: chance(0.9) ? 'op-1' : idv(0.3),
    domain,
    operationRevision: num([1, 2, 3, 9007199254740990], 0.08),
    ownerId: chance(0.7) ? 'owner-1' : pick(['owner-2', idv(0.2)]),
    workspaceGeneration: gen(0.08),
    resourceScope: {
      recordRef: ref(chance(0.9) ? `managed-${typeof domain === 'string' ? domain : 'x'}` : `managed-${pick(fx.domains)}`, 0.03),
      phases: chance(0.9)
        ? pick([['send_segment'], ['a', 'b'], ['b', 'a'], ['p' + 'x'.repeat(63)], Array.from({ length: 16 }, (_, i) => `p${i}`)])
        : pick([[], ['a', 'a'], ['A'], ['a-b'], ['_a'], ['p' + 'x'.repeat(64)], Array.from({ length: 17 }, (_, i) => `p${i}`), 'send_segment', [1], ['a\n'], ['é']]),
    },
    leaseDurationMs: num([1000, 30000, 300000, 999, 300001], 0.08),
    expiresAt: num([0, 1000, 2000, 8640000000000000, 8640000000000001], 0.08),
  };
  if (chance(0.1)) g.resourceScope.recordRef.schemaVersion = pick([2, 0, raw('1.0')]);
  if (chance(0.03)) mutateObject(g);
  if (chance(0.03)) mutateObject(g.sessionKey);
  if (chance(0.02)) mutateObject(g.resourceScope);
  return g;
}

// ---- successor mutations ---------------------------------------------------
function nearRun(a) {
  const b = clone(a);
  const steps = 1 + Math.floor(rnd() * 3);
  for (let i = 0; i < steps; i++) {
    const f = pick(['state', 'state', 'execution', 'execution', 'delivery', 'runtime', 'reason', 'reason', 'ids', 'definition']);
    if (f === 'state') b.state = pick(RUN);
    else if (f === 'execution') b.execution = chance(0.1) ? null : pick(EXE);
    else if (f === 'reason') b.reason = chance(0.4) ? null : pick([...REC, ...QUO]);
    else if (f === 'delivery') {
      if (b.delivery === null || chance(0.15)) b.delivery = chance(0.2) ? null : { target: pick(['channel', 'session']), state: pick(DEL) };
      else b.delivery = { ...b.delivery, state: pick(DEL) };
      if (b.delivery?.target === 'channel' && b.deliveryId === null) b.deliveryId = pick(['delivery-1', 'delivery-2']);
    } else if (f === 'runtime') {
      b.runtime = chance(0.15) ? null : { runtimeBindingId: pick(['binding-1', 'binding-2']), generation: pick(GENS) };
    } else if (f === 'ids') {
      const k = pick(['executionCallId', 'effectId', 'dispatchId', 'deliveryId']);
      b[k] = chance(0.3) ? null : pick(['call-1', 'call-2', 'effect-1', 'dispatch-1', 'delivery-1', 'delivery-2']);
    } else b.definition = chance(0.3) ? null : pin(0);
  }
  return b;
}
function nearMonitor(a) {
  const b = clone(a);
  const steps = 1 + Math.floor(rnd() * 3);
  for (let i = 0; i < steps; i++) {
    const f = pick(['run', 'run', 'run', 'obs', 'obs', 'notified', 'receipt', 'output', 'stop', 'fixed']);
    if (f === 'run') b.run = nearRun(b.run);
    else if (f === 'obs') {
      const me = typeof b.maxEvents === 'number' ? b.maxEvents : 3;
      b.observationSequence = pick([0, 1, 2, me]);
      b.lastObservationRef = b.observationSequence === 0 ? null : ref(chance(0.5) ? 'obs' : 'obs-2', 0);
    } else if (f === 'notified') b.notifiedThrough = pick([0, 1, 2, b.observationSequence]);
    else if (f === 'receipt') b.startReceiptRef = chance(0.2) ? null : ref(pick(['receipt-a', 'receipt-b', 'receipt-c']), 0);
    else if (f === 'output') b.outputRef = chance(0.2) ? null : ref('managed-tool-result-manifest', 0);
    else if (f === 'stop') b.stopReason = chance(0.4) ? null : pick(STOPS);
    else {
      const k = pick(['monitorId', 'ownerScopeId', 'commandRef', 'maxEvents', 'idleTimeoutMs', 'debounceMs']);
      b[k] = k === 'commandRef' ? ref('managed-tool-args', 0) : k.endsWith('Id') ? 'other' : pick([raw('1000.0'), 5, 1000, 30000]);
    }
  }
  return b;
}
function nearGrant(a) {
  const b = clone(a);
  const steps = 1 + Math.floor(rnd() * 2);
  for (let i = 0; i < steps; i++) {
    const f = pick(['exp', 'exp', 'rev', 'rev', 'gen', 'gen', 'owner', 'phases', 'lease', 'ref', 'key', 'domain']);
    const n = (v) => (typeof v === 'number' ? v : 1);
    if (f === 'exp') b.expiresAt = pick([n(a.expiresAt) + 1, n(a.expiresAt), Math.max(0, n(a.expiresAt) - 1), raw(`${n(a.expiresAt) + 1}.0`)]);
    else if (f === 'rev') b.operationRevision = pick([n(a.operationRevision) + 1, Math.max(1, n(a.operationRevision) - 1), raw(`${n(a.operationRevision)}.0`)]);
    else if (f === 'gen') b.workspaceGeneration = pick(GENS);
    else if (f === 'owner') b.ownerId = pick(['owner-1', 'owner-2']);
    else if (f === 'phases') b.resourceScope = { ...b.resourceScope, phases: pick([['a', 'b'], ['b', 'a'], ['send_segment'], ['a']]) };
    else if (f === 'lease') b.leaseDurationMs = pick([1000, 30000, 300000]);
    else if (f === 'ref') b.resourceScope = { ...b.resourceScope, recordRef: { ...b.resourceScope.recordRef, resourceId: pick(['res-1', 'res-2']) } };
    else if (f === 'key') b.sessionKey = { ...b.sessionKey, sessionId: pick([b.sessionKey.sessionId, 'other']) };
    else b.domain = pick(fx.domains);
  }
  return b;
}

// ---- emit ---------------------------------------------------------------
let out = [];
let emitted = 0;
const flush = () => { if (out.length) { fs.writeSync(1, out.join('\n') + '\n'); emitted += out.length; out = []; } };
const emit = (k, a, b) => (out.length >= 5000 && flush(), out.push(b === undefined ? `{"k":"${k}","a":${ser(a)}}` : `{"k":"${k}","a":${ser(a)},"b":${ser(b)}}`));

// Every fixture case first, re-serialized from the parsed file.
for (const c of fx.grantCases) emit('grant', c.grant);
for (const c of fx.grantSuccessorCases) emit('grantSucc', c.previous, c.next);
for (const c of fx.pinCases) emit('pin', c.pin);
for (const c of fx.pinConsistencyCases) emit('pinPair', c.first, c.second);
for (const c of fx.runCases) emit('run', c.run);
for (const c of fx.runSuccessorCases) emit('runSucc', c.previous, c.next);
for (const c of fx.monitorRunCases) emit('monitor', c.monitorRun);
for (const c of fx.monitorRunSuccessorCases) emit('monitorSucc', c.previous, c.next);

const pools = { run: [], monitor: [], grant: [] };
for (const c of fx.runCases) if (c.valid) pools.run.push(c.run);
for (const c of fx.monitorRunCases) if (c.valid) pools.monitor.push(c.monitorRun);
for (const c of fx.grantCases) if (c.valid) pools.grant.push(c.grant);

const per = Math.floor(N / 8);
for (let i = 0; i < per; i++) {
  const r = run();
  emit('run', r);
  if (valid(mod.parseExtensionRun, r) && pools.run.length < 20000) pools.run.push(r);
  const m = monitorRunRecord();
  emit('monitor', m);
  if (valid(mod.parseMonitorRun, m) && pools.monitor.length < 20000) pools.monitor.push(m);
  const g = grant();
  emit('grant', g);
  if (valid(mod.parseOperationGrant, g) && pools.grant.length < 20000) pools.grant.push(g);
  emit('pin', pin(0.3));
  emit('pinPair', pin(0.1), chance(0.5) ? pin(0.05) : { ...pin(0), definitionId: 'def-1' });
}
for (let i = 0; i < per; i++) {
  const a = pick(pools.run);
  emit('runSucc', a, chance(0.9) ? nearRun(a) : pick(pools.run));
  const m = pick(pools.monitor);
  emit('monitorSucc', m, chance(0.9) ? nearMonitor(m) : pick(pools.monitor));
  const g = pick(pools.grant);
  emit('grantSucc', g, chance(0.9) ? nearGrant(g) : pick(pools.grant));
}
flush();
process.stderr.write(
  `emitted ${emitted} lines; valid pools run=${pools.run.length} monitor=${pools.monitor.length} grant=${pools.grant.length}\n`,
);
