// usage: node diff-fuzz.mjs <r2-root> <r3-root> [iterations] [seed]
// Behavioural diff of the two BUILT artifacts: feed both the same mutated
// records and bucket every input on which their verdicts differ.
import { loadArm, event, header, commit, PAYLOADS, verdict } from './fixtures.mjs';

const [r2root, r3root, iterArg, seedArg] = process.argv.slice(2);
const A = await loadArm(r2root);
const B = await loadArm(r3root);
const N = Number(iterArg ?? 300000);

let seed = Number(seedArg ?? 12302);
const rnd = () => {
  // mulberry32
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = (xs) => xs[Math.floor(rnd() * xs.length)];

const KINDS = Object.keys(PAYLOADS);
const ENUMISH = [
  ...B.MANAGED_SESSION_LIFECYCLE_STATES,
  ...B.MANAGED_SESSION_ACTION_SOURCES,
  ...B.MANAGED_SESSION_DOMAINS.slice(0, 4),
  'requested', 'decided', 'cancelled', 'expired',
  'installing', 'active', 'released', 'revoked',
  'started', 'output_committed', 'abandoned',
  'managed-session/0', 'managed-session/1', 'managed-session/2', 'managed-session/01',
  'managed-session/1.0', 'managed-session/', 'managed-session/9007199254740993', ' managed-session/1',
];
const POOL = () => [
  null, true, false, 0, -0, 1, 2, -1, 0.5, 255, 256, 257,
  Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER - 1, 8.64e15, 8.64e15 + 2, 1e21,
  Infinity, -Infinity, NaN,
  '', 'x', 'é', 'é', 'a\u009bb', 'a\u0085b', 'a‮b', 'a\u0000b', 'a\u007fb',
  '\ud800', 'ok-\udfff', '\u{1F600}', 'Å', 'Å', 'Å',
  'x'.repeat(512), 'x'.repeat(513), 'é'.repeat(256), 'é'.repeat(257), 'x'.repeat(4096), 'x'.repeat(4097),
  'a'.repeat(64), 'A'.repeat(64), 'a'.repeat(63),
  [], [1], ['id-1'], ['id-1', 'é'], [null], {}, { a: 1 }, [[]],
  Object.create(null), new Date(0), new Map(), undefined,
  pick(ENUMISH), pick(ENUMISH),
];

function paths(value, prefix = []) {
  const acc = [prefix];
  if (value !== null && typeof value === 'object') {
    for (const k of Object.keys(value)) acc.push(...paths(value[k], [...prefix, k]));
  }
  return acc;
}
function setAt(root, path, v, del) {
  if (path.length === 0) return v;
  let cur = root;
  for (let i = 0; i < path.length - 1; i++) cur = cur[path[i]];
  if (del) delete cur[path[path.length - 1]];
  else cur[path[path.length - 1]] = v;
  return root;
}
function mutate(base) {
  let value = base;
  const n = rnd() < 0.7 ? 1 : 2;
  for (let i = 0; i < n; i++) {
    const ps = paths(value).filter((p) => p.length > 0);
    if (ps.length === 0) break;
    const p = pick(ps);
    const op = rnd();
    try {
      if (op < 0.12) value = setAt(value, p, undefined, true);
      else if (op < 0.2) value = setAt(value, [...p.slice(0, -1), pick(['extra', '__proto__x', 'é', '\u001b[31m'])], pick(POOL()));
      else value = setAt(value, p, pick(POOL()));
    } catch {
      /* path vanished under an earlier mutation */
    }
  }
  return value;
}

const clone = (v) => structuredClone(v);
const SUBJECTS = [
  () => {
    // headers are 1/17 of the corpus: steer a share of them at the reader token
    const h = header();
    if (rnd() < 0.3) h.minimumReader = pick(ENUMISH.filter((t) => t.includes('managed-session')));
    return rnd() < 0.5 ? h : mutate(h);
  },
  () => mutate(commit()),
  ...KINDS.map((k) => () => mutate(event(k))),
];
const CALLS = {
  header: (m, v) => m.parseManagedSessionHeader(v),
  commit: (m, v) => m.parseManagedSessionCommitMarker(v),
  event: (m, v) => m.parseManagedSessionEvent(v),
};

const buckets = new Map();
const counts = { same: 0, diff: 0, acceptBoth: 0, rejectBoth: 0 };
function note(which, a, b, sample) {
  const norm = (r) =>
    r.v === 'ACCEPT'
      ? 'ACCEPT'
      : `${r.v}: ${r.message
          .replace(/^(payload|event|header|commit)[A-Za-z0-9_.\[\]]*/, '<field>')
          .replace(/\d{6,}/g, '<n>')
          .slice(0, 90)}`;
  const k = `${norm(a)}  →  ${norm(b)}`;
  if (!buckets.has(k)) buckets.set(k, { n: 0, which, sample });
  buckets.get(k).n++;
}

for (let i = 0; i < N; i++) {
  const idx = Math.floor(rnd() * SUBJECTS.length);
  const which = idx === 0 ? 'header' : idx === 1 ? 'commit' : 'event';
  let input;
  try {
    input = SUBJECTS[idx]();
  } catch {
    continue;
  }
  // the parsers never mutate their input (checked separately), so both arms
  // can share the reference; cloning would erase null-prototype / exotic values
  const ia = input;
  const ib = input;
  const ra = verdict(A, () => CALLS[which](A, ia));
  const rb = verdict(B, () => CALLS[which](B, ib));
  if (ra.v === rb.v) {
    counts.same++;
    if (ra.v === 'ACCEPT') counts.acceptBoth++;
    else counts.rejectBoth++;
  } else {
    counts.diff++;
    let sample;
    try {
      sample = JSON.stringify(input).slice(0, 160);
    } catch {
      sample = '(unserialisable)';
    }
    note(which, ra, rb, sample);
  }
}

// lifecycle predicate + raw parser are small enough to enumerate
const states = [null, ...B.MANAGED_SESSION_LIFECYCLE_STATES, 'bogus'];
const lifecycleDiffs = [];
for (const f of states) for (const t of states) {
  const ra = verdict(A, () => A.isManagedSessionLifecycleTransitionAllowed(f, t));
  const rb = verdict(B, () => B.isManagedSessionLifecycleTransitionAllowed(f, t));
  const sa = ra.v === 'ACCEPT' ? String(ra.value) : ra.v;
  const sb = rb.v === 'ACCEPT' ? String(rb.value) : rb.v;
  if (sa !== sb) lifecycleDiffs.push(`${f} → ${t}: ${sa} ⇒ ${sb}`);
}

// raw parser: random JSON text with adversarial number tokens
const NUMS = ['0', '-0', '1', '1e999', '-1e999', '1e308', '1.8e308', '1e-400', '9007199254740993', '123456789012345678901234567890', '0.1', '1E400', '-1E+999'];
function rawDoc(depth) {
  const r = rnd();
  if (depth > 3 || r < 0.35) return pick([...NUMS, '"s"', 'null', 'true', '"\\u00e9"']);
  if (r < 0.7) return `{${Array.from({ length: 1 + Math.floor(rnd() * 3) }, (_, i) => `"k${i}":${rawDoc(depth + 1)}`).join(',')}}`;
  return `[${Array.from({ length: Math.floor(rnd() * 4) }, () => rawDoc(depth + 1)).join(',')}]`;
}
const rawBuckets = new Map();
let rawSame = 0;
const RAW_N = Math.floor(N / 4);
for (let i = 0; i < RAW_N; i++) {
  const text = rawDoc(0);
  const ra = verdict(A, () => A.parseManagedSessionRecordJson(text, 1 << 20));
  const rb = verdict(B, () => B.parseManagedSessionRecordJson(text, 1 << 20));
  if (ra.v === rb.v) { rawSame++; continue; }
  const k = `${ra.v}  →  ${rb.v}: ${rb.v === 'ACCEPT' ? '' : rb.message.replace(/^record[A-Za-z0-9_.\[\]]*/, '<field>')}`;
  rawBuckets.set(k, (rawBuckets.get(k) ?? 0) + 1);
}

// list validators: random event lists, depth straddling the cap, hostile containers
function nestedTarget(total) {
  let v = 'leaf';
  for (let i = 0; i < total - 2; i++) v = { n: v };
  return v;
}
class NoopForEach extends Array {
  forEach() {}
}
const listBuckets = new Map();
let listSame = 0;
const LIST_N = Math.floor(N / 10);
for (let i = 0; i < LIST_N; i++) {
  const len = 1 + Math.floor(rnd() * 4);
  let seq = 1 + Math.floor(rnd() * 3);
  const depths = [];
  const items = [];
  for (let j = 0; j < len; j++) {
    const depth = pick([3, 10, 62, 63, 64, 64, 65, 66]);
    depths.push(depth);
    const e = event('cancel.requested', { target: nestedTarget(depth) }, { sequence: seq, eventId: `ev-${seq}` });
    if (rnd() < 0.08) e.sessionKey = { ...e.sessionKey, sessionId: 'OTHER' };
    items.push(e);
    seq += rnd() < 0.1 ? 2 : 1;
  }
  const container = rnd() < 0.1 ? NoopForEach.from(items) : items;
  const bytes = pick([0, 1, 4096, 8 * 1024 * 1024, 8 * 1024 * 1024 + 1]);
  for (const [fn, call] of [
    ['transaction', (m) => m.assertManagedSessionTransaction(container, bytes)],
    ['digest', (m) => m.managedSessionEventsDigest(container)],
  ]) {
    const ra = verdict(A, () => call(A));
    const rb = verdict(B, () => call(B));
    const va = ra.v === 'ACCEPT' ? 'ACCEPT' : ra.v;
    const vb = rb.v === 'ACCEPT' ? 'ACCEPT' : rb.v;
    const sameDigest = ra.v !== 'ACCEPT' || rb.v !== 'ACCEPT' || ra.value === rb.value;
    if (va === vb && sameDigest) { listSame++; continue; }
    const maxDepth = Math.max(...depths);
    const k = `${fn}: ${va} → ${vb}${sameDigest ? '' : ' (DIFFERENT DIGEST)'} | deepest event in list = ${maxDepth}`;
    listBuckets.set(k, (listBuckets.get(k) ?? 0) + 1);
  }
}

const out = {
  iterations: N,
  counts,
  buckets: [...buckets.entries()].map(([k, v]) => ({ k, ...v })).sort((x, y) => y.n - x.n),
  lifecycleDiffs,
  raw: { iterations: RAW_N, same: rawSame, buckets: [...rawBuckets.entries()] },
  list: { iterations: LIST_N * 2, same: listSame, buckets: [...listBuckets.entries()].sort() },
};
process.stdout.write(JSON.stringify(out, null, 1));
