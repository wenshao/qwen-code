// usage: node perf.mjs <arm-root>  -> JSON on stdout. One process per arm so JIT state is not shared.
import { loadArm, event } from './fixtures.mjs';

const m = await loadArm(process.argv[2]);
const CAP = m.MANAGED_SESSION_LIMITS.maxEventBytes;

function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}
function bench(fn, { warm, runs, inner }) {
  for (let i = 0; i < warm; i++) fn();
  const samples = [];
  for (let r = 0; r < runs; r++) {
    const t0 = performance.now();
    for (let i = 0; i < inner; i++) fn();
    samples.push((performance.now() - t0) / inner);
  }
  return median(samples);
}

const out = {};

// 1. a typical small event, typed parser only
{
  const e = event('tool.receipt');
  out.typedSmall = {
    label: 'typed parse, typical tool.receipt event',
    bytes: Buffer.byteLength(JSON.stringify(e)),
    ms: bench(() => m.parseManagedSessionEvent(e), { warm: 20000, runs: 15, inner: 20000 }),
  };
}
// 2. documented reader path (raw -> typed) on the same event's wire line
{
  const line = JSON.stringify(event('tool.receipt'));
  out.fullSmall = {
    label: 'raw + typed parse, typical tool.receipt line',
    bytes: Buffer.byteLength(line),
    ms: bench(() => m.parseManagedSessionEvent(m.parseManagedSessionRecordJson(line, CAP)), {
      warm: 20000,
      runs: 15,
      inner: 20000,
    }),
  };
}
// 3. wide free-form json: 30,000 short keys
{
  const target = {};
  for (let i = 0; i < 30000; i++) target[`k${i}`] = i;
  const line = JSON.stringify(event('cancel.requested', { target }));
  out.fullWide = {
    label: 'raw + typed parse, cancel.requested with 30,000 keys',
    bytes: Buffer.byteLength(line),
    ms: bench(() => m.parseManagedSessionEvent(m.parseManagedSessionRecordJson(line, CAP)), {
      warm: 5,
      runs: 15,
      inner: 3,
    }),
  };
}
// 4. deep + wide: 55 levels, 300 keys per level (labels get long)
{
  let target = { leaf: 1 };
  for (let d = 0; d < 55; d++) {
    const level = { next: target };
    for (let i = 0; i < 300; i++) level[`field_${i}`] = i;
    target = level;
  }
  const line = JSON.stringify(event('cancel.requested', { target }));
  out.fullDeep = {
    label: 'raw + typed parse, 55 levels × 300 keys',
    bytes: Buffer.byteLength(line),
    ms: bench(() => m.parseManagedSessionEvent(m.parseManagedSessionRecordJson(line, CAP)), {
      warm: 5,
      runs: 15,
      inner: 3,
    }),
  };
}
// 5. a full 256-event transaction check
{
  const events = Array.from({ length: 256 }, (_, i) =>
    m.parseManagedSessionEvent(event('tool.receipt', {}, { sequence: i + 1, eventId: `ev-${i + 1}` })),
  );
  out.tx256 = {
    label: 'assertManagedSessionTransaction, 256 typical events',
    bytes: Buffer.byteLength(JSON.stringify(events)),
    ms: bench(() => m.assertManagedSessionTransaction(events, 200000), { warm: 200, runs: 15, inner: 200 }),
  };
  out.digest256 = {
    label: 'managedSessionEventsDigest, 256 typical events',
    bytes: Buffer.byteLength(JSON.stringify(events)),
    ms: bench(() => m.managedSessionEventsDigest(events), { warm: 200, runs: 15, inner: 200 }),
  };
}
process.stdout.write(JSON.stringify(out));
