// Seeded generator of channel_route / channel_delivery inputs for the
// TS-vs-Java differential. Emits JSONL: {"id","domain","op","a","b"?} where
// a/b are raw JSON texts (numbers re-spelled, keys shuffled) so both
// languages parse the very same bytes with their own production parser.
// usage: node gen.mjs <fixtures.json> <count> <seed> > cases.jsonl
import { readFileSync, writeSync } from 'node:fs';

const [fixturesPath, countArg, seedArg] = process.argv.slice(2);
const fx = JSON.parse(readFileSync(fixturesPath, 'utf8'));
let s = Number(seedArg ?? 1) >>> 0;
const rnd = () => ((s = (s + 0x6d2b79f5) >>> 0), (((s ^ (s >>> 15)) * (s | 1)) >>> 0) / 2 ** 32);
const pick = (a) => a[Math.floor(rnd() * a.length)];
const chance = (p) => rnd() < p;
const clone = (v) => JSON.parse(JSON.stringify(v));

function merge(base, patch) {
  const value = clone(base ?? {});
  for (const [k, r] of Object.entries(patch)) {
    value[k] = r !== null && typeof r === 'object' && !Array.isArray(r) ? merge(value[k], r) : r;
  }
  return value;
}

const RUN_STATES = ['reserved', 'admitted', 'running', 'waiting', 'settled', 'failed', 'cancelled', 'recovery_blocked'];
const REASONS = [null, null, null, 'outcome_unknown', 'execution_corrupt', 'runtime_lost', 'dispatch_unknown', 'handler_unavailable', 'count_limit', 'rate_limit', 'byte_limit', 'budget_exhausted'];
const CH_LINES = ['planned', 'sending', 'partial', 'delivered', 'unknown', 'rejected', 'cancelled'];
const ALL_LINES = [...CH_LINES, 'accepting', 'accepted', 'consumed', 'bogus'];
const SCOPES = ['user', 'chat_thread', 'thread', 'single'];
const IDS = ['a', 'id-1', 'x'.repeat(128), 'x'.repeat(129), 'é', 'é', ' a', 'a ', 'a\u0000b', '\ud800', 'route-1', 'delivery-1', 'other', 'seg-1', 'seg-2', '日本', 'a/b', 'a:b'];
const NUMS = [0, -0, 1, 2, 3, 4, 7, 8, -1, 1.5, 2 ** 53 - 2, 2 ** 53 - 1, 2 ** 53, 8.64e15, 8.64e15 + 1, 1e300];
const POOL = () => pick([null, true, false, pick(NUMS), pick(IDS), '', [], {}, clone(fx.templates.channel_route.policyRef), pick(SCOPES), pick(ALL_LINES), pick(RUN_STATES)]);

const T = fx.templates;
const ref = (id, ch = 'e') => ({ resourceId: id, kind: 'channel-delivery-segment', schemaVersion: 1, byteLength: 2, digest: ch.repeat(64) });
const receipt = (i) => ({ providerMessageId: `m-${i}`, acceptedAt: pick([0, 1, 1760000000000, 8.64e15, 1760000000000]), proofRef: chance(0.3) ? ref(`proof-${i}`, 'f') : null });

function semanticDelivery() {
  const n = chance(0.03) ? pick([64, 65]) : 1 + Math.floor(rnd() * 4);
  const d = clone(T.channel_delivery);
  d.segments = Array.from({ length: n }, (_, i) => ({ segmentId: `seg-${i + 1}`, ordinal: i, contentRef: ref(`seg-${i + 1}-data`), receipt: chance(0.45) ? receipt(i + 1) : null }));
  d.cancelRequested = chance(0.3);
  d.run.state = pick(RUN_STATES);
  d.run.reason = pick(REASONS);
  d.run.delivery = { target: chance(0.95) ? 'channel' : 'session', state: chance(0.92) ? pick(CH_LINES) : pick(ALL_LINES) };
  if (chance(0.05)) d.run.deliveryId = null;
  return d;
}

function semanticRoute() {
  const r = clone(T.channel_route);
  r.scope = { kind: pick(SCOPES), senderId: chance(0.5) ? 'sender-1' : null, chatId: chance(0.5) ? 'chat-1' : null, threadId: chance(0.5) ? 'thread-1' : null };
  r.run.state = pick(RUN_STATES);
  r.run.reason = pick(REASONS);
  r.accountGeneration = pick([1, 6, 7, 8]);
  r.routeRevision = pick([1, 2, 3, 4]);
  return r;
}

// One semantic step of a record, as a dispatcher or a buggy writer might.
function step(domain, x) {
  const y = clone(x);
  const edits = 1 + Math.floor(rnd() * 3);
  for (let e = 0; e < edits; e++) try {
    if (domain === 'channel_delivery') {
      const k = Math.floor(rnd() * 11);
      if (k === 0) y.run.delivery = { ...(y.run.delivery ?? { target: 'channel' }), state: pick(CH_LINES) };
      else if (k === 1) y.run.state = pick(RUN_STATES);
      else if (k === 2) y.run.reason = pick(REASONS);
      else if (k === 3 && Array.isArray(y.segments) && y.segments.length) { const sg = pick(y.segments); if (sg && typeof sg === 'object') sg.receipt = receipt(9); }
      else if (k === 4 && Array.isArray(y.segments) && y.segments.length) { const sg = pick(y.segments); if (sg && typeof sg === 'object') sg.receipt = null; }
      else if (k === 5 && Array.isArray(y.segments) && y.segments.length) { const sg = pick(y.segments); if (sg && typeof sg === 'object' && sg.receipt) sg.receipt.acceptedAt = 5; }
      else if (k === 6) y.cancelRequested = !y.cancelRequested;
      else if (k === 7) y.routeRevision = pick([2, 3, 4]);
      else if (k === 8) y.sourceTurnId = pick(['turn-1', 'turn-2']);
      else if (k === 9 && Array.isArray(y.segments)) y.segments = y.segments.slice(0, Math.max(1, y.segments.length - 1));
      else if (k === 10) Object.assign(y, { contentRef: chance(0.5) ? clone(T.channel_delivery.contentRef) : ref('result-2', 'b') });
    } else {
      const k = Math.floor(rnd() * 9);
      if (k === 0) y.run.state = pick(RUN_STATES);
      else if (k === 1) y.run.reason = pick(REASONS);
      else if (k === 2) y.routeRevision = (typeof y.routeRevision === 'number' ? y.routeRevision : 3) + pick([0, 1, 1, 2, -1]);
      else if (k === 3) y.accountGeneration = (typeof y.accountGeneration === 'number' ? y.accountGeneration : 7) + pick([0, 1, -1]);
      else if (k === 4) y.sessionId = pick(['session-1', 'session-2']);
      else if (k === 5) y.rootSessionId = pick(['root-1', 'root-2']);
      else if (k === 6) y.policyRef = chance(0.5) ? clone(T.channel_route.policyRef) : { ...clone(T.channel_route.policyRef), resourceId: 'policy-2' };
      else if (k === 7 && y.scope && typeof y.scope === 'object') y.scope.chatId = pick(['chat-1', 'chat-2', null]);
      else if (k === 8) y.channelInstanceId = pick(['instance-1', 'instance-2']);
    }
  } catch { /* the noised shape cannot take this edit */ }
  return y;
}

// Random structural noise anywhere in the tree.
function noise(x) {
  const y = clone(x);
  const paths = [];
  (function walk(v, path) {
    if (v !== null && typeof v === 'object') {
      paths.push(path);
      for (const k of Object.keys(v)) walk(v[k], [...path, k]);
    } else paths.push(path);
  })(y, []);
  const path = pick(paths.filter((p) => p.length > 0));
  if (!path) return y;
  let parent = y;
  for (const k of path.slice(0, -1)) parent = parent[k];
  const last = path[path.length - 1];
  const op = Math.floor(rnd() * 4);
  if (op === 0 && !Array.isArray(parent)) delete parent[last];
  else if (op === 1 && !Array.isArray(parent)) parent['extra' + Math.floor(rnd() * 3)] = POOL();
  else parent[last] = POOL();
  return y;
}

// Serialization with alternative spellings of the same JSON value.
function spell(v) {
  if (v === null) return 'null';
  if (typeof v === 'boolean') return String(v);
  if (typeof v === 'number') {
    if (Object.is(v, -0)) return pick(['-0', '-0.0', '0', '-0e0']);
    if (Number.isInteger(v) && Math.abs(v) < 1e15 && chance(0.2)) return pick([`${v}.0`, `${v}e0`, `${v}.000`, `${v}E+0`, v === 0 ? '0.0e5' : `${v}0e-1`]);
    if (v >= 1e300) return pick(['1e300', '1e400']);
    return JSON.stringify(v);
  }
  if (typeof v === 'string') {
    const json = JSON.stringify(v);
    return chance(0.05) && v.length > 0 ? json.replace(/^"(.)/, (_, c) => `"\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`) : json;
  }
  if (Array.isArray(v)) return `[${v.map(spell).join(',')}]`;
  const keys = Object.keys(v);
  if (chance(0.3)) keys.sort(() => rnd() - 0.5);
  return `{${keys.map((k) => `${JSON.stringify(k)}:${spell(v[k])}`).join(',')}}`;
}

const seeds = { channel_route: [], channel_delivery: [] };
for (const c of fx.cases) seeds[c.domain].push(merge(T[c.domain], c.patch));
const pairSeeds = fx.successors.map((c) => [c.domain, merge(T[c.domain], c.before), merge(T[c.domain], c.after)]);
for (const [d, b, a] of pairSeeds) seeds[d].push(b, a);

const count = Number(countArg ?? 1000);
let n = 0;
const emit = (o) => writeSync(1, JSON.stringify(o) + '\n');
for (let i = 0; i < count; i++) {
  const domain = chance(0.6) ? 'channel_delivery' : 'channel_route';
  const mode = rnd();
  let a;
  if (mode < 0.45) a = domain === 'channel_delivery' ? semanticDelivery() : semanticRoute();
  else a = clone(pick(seeds[domain]));
  if (chance(0.25)) a = noise(a);
  if (chance(0.1)) a = noise(a);
  if (chance(0.55)) {
    let b;
    const pm = rnd();
    if (pm < 0.12) b = clone(a);
    else if (pm < 0.2 && pairSeeds.length) { const [d2, b0, a0] = pick(pairSeeds.filter((p) => p[0] === domain)); a = b0; b = step(d2, a0); }
    else b = step(domain, a);
    if (chance(0.1)) b = noise(b);
    emit({ id: `s${n++}`, domain, op: 'succ', a: spell(a), b: spell(b) });
  } else {
    emit({ id: `r${n++}`, domain, op: 'one', a: spell(a) });
  }
}
// The shipped corpus itself, verbatim, as a sanity anchor.
for (const c of fx.cases) emit({ id: `case:${c.id}`, domain: c.domain, op: 'one', a: JSON.stringify(merge(T[c.domain], c.patch)) });
for (const c of fx.successors) emit({ id: `succ:${c.id}`, domain: c.domain, op: 'succ', a: JSON.stringify(merge(T[c.domain], c.before)), b: JSON.stringify(merge(T[c.domain], c.after)) });
