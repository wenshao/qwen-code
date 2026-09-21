// usage: node probe-new.mjs <r2-root> <r3-root>
// Regression hunt inside the bf1a6b1 delta. Both arms are BUILT artifacts.
import { loadArm, event, header, commit, verdict } from './fixtures.mjs';

const [r2root, r3root, fixRoot] = process.argv.slice(2);
const arms = [
  ['98860b5', await loadArm(r2root)],
  ['bf1a6b1', await loadArm(r3root)],
];
const C = {
  r: '\x1b[1;31m',
  g: '\x1b[1;32m',
  y: '\x1b[1;33m',
  c: '\x1b[1;36m',
  d: '\x1b[2m',
  b: '\x1b[1m',
  x: '\x1b[0m',
};
const paint = (v) =>
  ({ ACCEPT: C.y, REJECT: C.g, CRASH: C.r })[v] + v.padEnd(6) + C.x;
const short = (s, n = 86) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const head = (t) => console.log(`\n${C.c}${t}${C.x}`);

// ─────────────────────────────────────────────────────────────────────────────
head('A. JSON depth: an event the typed parser accepts vs. the transaction / digest validators');
console.log(
  `${C.d}cancel.requested.payload.target nested until the event sits exactly at maxJsonDepth; then the SAME parsed event is handed to the two list validators${C.x}`,
);
function nested(levels) {
  let v = 'leaf';
  for (let i = 0; i < levels; i++) v = { n: v };
  return v;
}
const armsA = fixRoot ? [...arms, ['bf1a6b1 + depth 0 for the container', await loadArm(fixRoot)]] : arms;
for (const [name, m] of armsA) {
  let max = 0;
  for (let levels = 1; levels < 80; levels++) {
    const r = verdict(m, () =>
      m.parseManagedSessionEvent(event('cancel.requested', { target: nested(levels) })),
    );
    if (r.v === 'ACCEPT') max = levels;
  }
  const evt = m.parseManagedSessionEvent(
    event('cancel.requested', { target: nested(max) }),
  );
  const tx = verdict(m, () => m.assertManagedSessionTransaction([evt], 4096));
  const dg = verdict(m, () => m.managedSessionEventsDigest([evt]));
  const evtBelow = m.parseManagedSessionEvent(
    event('cancel.requested', { target: nested(max - 1) }),
  );
  const txBelow = verdict(m, () => m.assertManagedSessionTransaction([evtBelow], 4096));
  console.log(
    `  ${name.padEnd(36)} deepest event parseManagedSessionEvent accepts: depth ${C.b}${max + 2}${C.x}` +
      `   parse ${paint('ACCEPT')} transaction ${paint(tx.v)} digest ${paint(dg.v)}   one level shallower: transaction ${paint(txBelow.v)}`,
  );
  if (tx.v !== 'ACCEPT') console.log(`  ${''.padEnd(36)} ${C.d}${short(tx.message, 60)} ${tx.message.slice(-44)}${C.x}`);
}

// ─────────────────────────────────────────────────────────────────────────────
head('B. Does the R1-1 closure hold for the two call sites that still delegate to value.forEach?');
console.log(
  `${C.d}assertField 'ids' / 'refs' still call value.forEach(...); an Array subclass is now refused, a Proxy around a plain array is not${C.x}`,
);
for (const [name, m] of arms) {
  const mk = (arr) =>
    new Proxy(arr, {
      get: (t, p, r) => (p === 'forEach' ? () => {} : Reflect.get(t, p, r)),
    });
  const ids = verdict(m, () =>
    m.parseManagedSessionEvent(
      event('context.compacted', { replacedMessageIds: mk([42, 'bad\u0000id']) }),
    ),
  );
  const refs = verdict(m, () =>
    m.parseManagedSessionEvent(
      event('tool.receipt', { resources: mk([{ not: 'a durable ref' }]) }),
    ),
  );
  const plainIds = verdict(m, () =>
    m.parseManagedSessionEvent(
      event('context.compacted', { replacedMessageIds: [42, 'bad\u0000id'] }),
    ),
  );
  console.log(
    `  ${name}  plain array [42, "bad\\0id"] ${paint(plainIds.v)}  Proxy(ids) ${paint(ids.v)}  Proxy(resources=[{not:"a durable ref"}]) ${paint(refs.v)}`,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
head('C. Direct-call garbage sweep: does any exported validator let a non-ManagedSessionRecordError escape?');
console.log(
  `${C.d}contract per design doc + R2-6 fix: a typed rejection or a boolean, never a raw exception${C.x}`,
);
const GARBAGE = [
  ['null', null],
  ['undefined', undefined],
  ['42', 42],
  ['"str"', 'str'],
  ['{}', {}],
  ['{length:1}', { length: 1 }],
  ['[null]', [null]],
  ['[undefined]', [undefined]],
  ['Symbol()', Symbol('s')],
  ['10n', 10n],
  ['()=>{}', () => {}],
  ['Object.create(null)', Object.create(null)],
  ['new Date(0)', new Date(0)],
];
for (const [name, m] of arms) {
  const crashes = [];
  let calls = 0;
  const goodEvent = m.parseManagedSessionEvent(event('turn.settled'));
  const goodKey = goodEvent.sessionKey;
  // garbage goes only into DATA positions; labels / limits stay well-formed
  const shapes = (g) => ({
    assertManagedSessionStableId: [[g, 'x']],
    assertManagedSessionSequence: [[g, 'x']],
    assertManagedSessionTime: [[g, 'x']],
    assertManagedSessionDigest: [[g, 'x']],
    assertManagedSessionKey: [[g, 'x']],
    assertManagedSessionDurableRef: [[g, 'x']],
    managedSessionKeysEqual: [[g, goodKey], [goodKey, g]],
    parseManagedSessionEvent: [[g]],
    parseManagedSessionHeader: [[g]],
    parseManagedSessionCommitMarker: [[g]],
    parseManagedSessionRecordJson: [[g, 1024], ['{}', g]],
    assertManagedSessionEventActor: [[g, 'harness'], [goodEvent, g]],
    isManagedSessionLifecycleTransitionAllowed: [[g, 'idle'], ['idle', g]],
    managedSessionEventsDigest: [[g], [[g]]],
    assertManagedSessionTransaction: [[g, 64], [[g], 64], [[goodEvent], g]],
  });
  const fns = Object.entries(m).filter(([, f]) => typeof f === 'function' && !/Error$/.test(f.name));
  const uncovered = fns.map(([n]) => n).filter((n) => !(n in shapes(null)));
  if (uncovered.length) throw new Error('sweep does not cover: ' + uncovered.join(', '));
  for (const [gname, g] of GARBAGE) {
    for (const [fname, argLists] of Object.entries(shapes(g))) {
      for (const args of argLists) {
        calls++;
        const r = verdict(m, () => m[fname](...args));
        if (r.v === 'CRASH') {
          const shown = args.map((a) => (a === g ? gname : Array.isArray(a) && a[0] === g ? `[${gname}]` : a === goodEvent ? 'event' : a === goodKey ? 'key' : JSON.stringify(a))).join(', ');
          crashes.push({ fname, args: shown, err: `${r.errorName}: ${r.message}` });
        }
      }
    }
  }
  const byFn = new Map();
  for (const c of crashes) {
    if (!byFn.has(c.fname)) byFn.set(c.fname, { first: c, n: 0 });
    byFn.get(c.fname).n++;
  }
  console.log(
    `  ${name}  ${fns.length} exported functions, ${GARBAGE.length} garbage values in every data position = ${calls} calls → ${crashes.length === 0 ? C.g : C.r}${crashes.length} raw (untyped) exceptions${C.x} across ${byFn.size} functions`,
  );
  for (const { first: c, n } of byFn.values()) {
    console.log(`           ${String(n).padStart(3)}×  ${c.fname}(${c.args})  ${C.d}${short(c.err, 70)}${C.x}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
head('D. Is every closed-set member still constructible after the new floors / NFC / UTF-8 rules?');
{
  const m = arms[1][1];
  let kinds = 0;
  for (const kind of m.MANAGED_SESSION_EVENT_KINDS) {
    if (verdict(m, () => m.parseManagedSessionEvent(event(kind))).v === 'ACCEPT') kinds++;
  }
  let domains = 0;
  for (const domain of m.MANAGED_SESSION_DOMAINS) {
    const r = verdict(m, () =>
      m.parseManagedSessionEvent(
        event('domain.committed', {
          domain,
          recordRef: { resourceId: 'r', kind: `managed-${domain}`, schemaVersion: 1, byteLength: 1, digest: 'a'.repeat(64) },
        }),
      ),
    );
    if (r.v === 'ACCEPT') domains++;
  }
  // every (kind) has at least one actor that is accepted; action.changed: every source × state
  let actorOk = 0;
  let actorTotal = 0;
  for (const kind of m.MANAGED_SESSION_EVENT_KINDS) {
    if (kind === 'action.changed') continue;
    actorTotal++;
    const e = m.parseManagedSessionEvent(event(kind));
    if (m.MANAGED_SESSION_ACTOR_CLASSES.some((a) => verdict(m, () => m.assertManagedSessionEventActor(e, a)).v === 'ACCEPT')) actorOk++;
  }
  let combos = 0;
  let combosOk = 0;
  for (const source of m.MANAGED_SESSION_ACTION_SOURCES) {
    for (const state of ['requested', 'decided', 'cancelled', 'expired']) {
      combos++;
      const e = m.parseManagedSessionEvent(
        event('action.changed', {
          source,
          state,
          decisionRef: state === 'decided' ? { resourceId: 'r', kind: 'k', schemaVersion: 1, byteLength: 1, digest: 'a'.repeat(64) } : null,
        }),
      );
      const ok = m.MANAGED_SESSION_ACTOR_CLASSES.filter((a) => verdict(m, () => m.assertManagedSessionEventActor(e, a)).v === 'ACCEPT');
      if (ok.length === 1) combosOk++;
    }
  }
  const hdr = verdict(m, () => m.parseManagedSessionHeader(header())).v;
  const cm = verdict(m, () => m.parseManagedSessionCommitMarker(commit())).v;
  console.log(
    `  bf1a6b1  event kinds ${C.g}${kinds}/${m.MANAGED_SESSION_EVENT_KINDS.length}${C.x}   domains ${C.g}${domains}/${m.MANAGED_SESSION_DOMAINS.length}${C.x}` +
      `   kinds with a requestable actor ${C.g}${actorOk}/${actorTotal}${C.x}   action.changed source×state with exactly one legal actor ${C.g}${combosOk}/${combos}${C.x}   header ${paint(hdr)} commit ${paint(cm)}`,
  );
}
