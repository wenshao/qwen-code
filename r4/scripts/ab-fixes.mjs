// usage: node ab-fixes.mjs <arm-root>   -> JSON array on stdout
// One case per review thread the author marked Fixed / Partial / Declined.
// Every case drives the BUILT dist of the given arm.
import { loadArm, event, header, key, verdict } from './fixtures.mjs';

const root = process.argv[2];
const m = await loadArm(root);
const out = [];
const short = (s, n = 74) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

function record(id, title, res, note) {
  out.push({
    id,
    title,
    v: res.v,
    note:
      note ??
      (res.v === 'ACCEPT'
        ? ''
        : `${res.errorName}: ${short(res.message.replace(/\s+/g, ' '))}`),
  });
}

// ---- R1-1 Array subclass opts out of per-item id checks
{
  class Evil extends Array {
    forEach() {}
  }
  const ids = Evil.from([42]);
  const res = verdict(m, () =>
    m.parseManagedSessionEvent(
      event('context.compacted', { replacedMessageIds: ids }),
    ),
  );
  record('R1-1', 'Array subclass w/ no-op forEach, ids=[42]', res);
}

// ---- R1-2 transaction container overriding forEach
{
  class Evil extends Array {
    forEach() {}
  }
  const a = m.parseManagedSessionEvent(event('turn.settled'));
  const otherSession = m.parseManagedSessionEvent(
    event('turn.settled', {}, {
      sequence: 2,
      eventId: 'ev-2',
      sessionKey: { ...key(), sessionId: 'OTHER' },
    }),
  );
  const gap = m.parseManagedSessionEvent(
    event('turn.settled', {}, { sequence: 9, eventId: 'ev-9' }),
  );
  record(
    'R1-2a',
    'transaction spanning two sessions (subclass)',
    verdict(m, () =>
      m.assertManagedSessionTransaction(Evil.from([a, otherSession]), 100),
    ),
  );
  record(
    'R1-2b',
    'transaction with sequence gap 1 -> 9 (subclass)',
    verdict(m, () =>
      m.assertManagedSessionTransaction(Evil.from([a, gap]), 100),
    ),
  );
}

// ---- R1-3 null-prototype value in a version gate
record(
  'R1-3a',
  'header.formatVersion = Object.create(null)',
  verdict(m, () =>
    m.parseManagedSessionHeader(header({ formatVersion: Object.create(null) })),
  ),
);
record(
  'R1-3b',
  'header.minimumReader = Object.create(null)',
  verdict(m, () =>
    m.parseManagedSessionHeader(header({ minimumReader: Object.create(null) })),
  ),
);

// ---- R1-4 control characters in identifiers
record(
  'R1-4a',
  'sessionId with C1 CSI U+009B',
  verdict(m, () =>
    m.assertManagedSessionKey({ ...key(), sessionId: 'a\u009b31mb' }),
  ),
);
record(
  'R1-4b',
  'sessionId with bidi override U+202E  [author: partial]',
  verdict(m, () =>
    m.assertManagedSessionKey({ ...key(), sessionId: 'a‮b' }),
  ),
);

// ---- R1-5 identity merge / split
record(
  'R1-5a',
  'sessionId with lone surrogate \\ud800',
  verdict(m, () =>
    m.assertManagedSessionKey({ ...key(), sessionId: 'sess-\ud800' }),
  ),
);
record(
  'R1-5b',
  'sessionId in NFD form (e + U+0301)',
  verdict(m, () =>
    m.assertManagedSessionKey({ ...key(), sessionId: 'café' }),
  ),
);

// ---- R1-6 untrusted text in error messages
{
  const evilKey = '\u001b[31mRED\u001b[0m' + 'A'.repeat(200000);
  const res = verdict(m, () =>
    m.parseManagedSessionEvent({ ...event('turn.settled'), [evilKey]: 1 }),
  );
  record(
    'R1-6a',
    'unknown key = ESC[31m + 200 KB',
    res,
    `${res.errorName}: message ${res.message.length} chars, ESC byte ${
      res.message.includes('\u001b') ? 'PRESENT' : 'absent'
    }`,
  );
  const dup = verdict(m, () =>
    m.parseManagedSessionRecordJson(
      `{"\\u001b[2Jk":1,"\\u001b[2Jk":2}`,
      1024,
    ),
  );
  record(
    'R1-6b',
    'duplicate JSON key containing ESC[2J',
    dup,
    `${dup.errorName}: ESC byte ${
      dup.message.includes('\u001b') ? 'PRESENT' : 'absent'
    } in "${short(JSON.stringify(dup.message).slice(1, -1), 44)}"`,
  );
}

// ---- R1-8 raw parser and non-finite / unsafe numbers
record(
  'R1-8a',
  'raw {"a":1e999}  (parses to Infinity)',
  verdict(m, () => m.parseManagedSessionRecordJson('{"a":1e999}', 1024)),
  undefined,
);
{
  const res = verdict(m, () =>
    m.parseManagedSessionRecordJson('{"a":9007199254740993}', 1024),
  );
  record(
    'R1-8b',
    'raw {"a":9007199254740993}  [author: partial]',
    res,
    res.v === 'ACCEPT' ? `silently rounds to ${res.value.a}` : undefined,
  );
}

// ---- R1-11 digest input bounds
{
  const one = m.parseManagedSessionEvent(event('turn.settled'));
  const many = Array.from({ length: 100000 }, (_, i) => ({
    ...one,
    sequence: i + 1,
    eventId: `ev-${i + 1}`,
  }));
  const t0 = performance.now();
  const res = verdict(m, () => m.managedSessionEventsDigest(many));
  const ms = (performance.now() - t0).toFixed(0);
  record(
    'R1-11a',
    'digest over 100,000 events (cap is 256)',
    res,
    res.v === 'ACCEPT'
      ? `returned ${res.value.slice(0, 12)}… after ${ms} ms`
      : `${res.errorName} after ${ms} ms: ${short(res.message, 48)}`,
  );
  const empty = verdict(m, () => m.managedSessionEventsDigest([]));
  record(
    'R1-11b',
    'digest over an empty list',
    empty,
    empty.v === 'ACCEPT' ? `returned ${empty.value.slice(0, 12)}…` : undefined,
  );
}

// ---- R1-12 recovery_blocked self-transition
{
  const allowed = m.isManagedSessionLifecycleTransitionAllowed(
    'recovery_blocked',
    'recovery_blocked',
  );
  out.push({
    id: 'R1-12',
    title: 'recovery_blocked -> recovery_blocked',
    v: allowed ? 'ACCEPT' : 'REJECT',
    note: `predicate returned ${allowed}`,
  });
}

// ---- R1-13 minimumReader as a lower bound
for (const [id, token] of [
  ['R1-13a', 'managed-session/0'],
  ['R1-13b', 'managed-session/2'],
  ['R1-13c', 'managed-session/01'],
]) {
  const res = verdict(m, () =>
    m.parseManagedSessionHeader(header({ minimumReader: token })),
  );
  record(
    id,
    `header.minimumReader = "${token}"`,
    res,
    res.v === 'ACCEPT' ? `returned token "${res.value.minimumReader}"` : undefined,
  );
}

// ---- R1-19 scalar domains
record(
  'R1-19a',
  'occurredAt = 8640000000000001 (Date range + 1)',
  verdict(m, () =>
    m.parseManagedSessionEvent(
      event('turn.settled', {}, { occurredAt: 8640000000000001 }),
    ),
  ),
);
{
  const one = m.parseManagedSessionEvent(event('turn.settled'));
  record(
    'R1-19b',
    'non-empty transaction with encodedBytes = 0',
    verdict(m, () => m.assertManagedSessionTransaction([one], 0)),
  );
}
record(
  'R1-19c',
  'wake.requested.requiredSequence = 0',
  verdict(m, () =>
    m.parseManagedSessionEvent(event('wake.requested', { requiredSequence: 0 })),
  ),
);
record(
  'R1-19d',
  'checkpoint.committed.coveredSequence = 0',
  verdict(m, () =>
    m.parseManagedSessionEvent(
      event('checkpoint.committed', { coveredSequence: 0 }),
    ),
  ),
);
record(
  'R1-19e',
  'context.compacted.fromSequence = 0',
  verdict(m, () =>
    m.parseManagedSessionEvent(
      event('context.compacted', { fromSequence: 0, toSequence: 0 }),
    ),
  ),
);

// ---- R2-6 lifecycle predicate with an out-of-union `from`
{
  const res = verdict(m, () =>
    m.isManagedSessionLifecycleTransitionAllowed('bogus', 'idle'),
  );
  record(
    'R2-6',
    "isLifecycleTransitionAllowed('bogus','idle')",
    res.v === 'ACCEPT' ? { ...res, v: 'REJECT' } : res,
    res.v === 'ACCEPT' ? `predicate returned ${res.value}` : undefined,
  );
}

// ---- Declined: R1-7 own __proto__ key in the free-form json field
{
  const wire = JSON.stringify(event('cancel.requested')).replace(
    '"target":{',
    '"target":{"__proto__":{"polluted":true},',
  );
  const res = verdict(m, () =>
    m.parseManagedSessionEvent(m.parseManagedSessionRecordJson(wire, 65536)),
  );
  record(
    'R1-7',
    'own "__proto__" key in json target  [author: declined]',
    res,
    res.v === 'ACCEPT'
      ? `own key kept: ${Object.hasOwn(res.value.payload.target, '__proto__')}, ({}).polluted = ${{}.polluted}`
      : undefined,
  );
}

process.stdout.write(JSON.stringify(out));
