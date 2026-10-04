/**
 * PR #13380 verification instrumentation (not part of the PR).
 *
 * Holds one real Store request from a chosen writer inside the crash
 * driver's proxy and releases it at a chosen moment, so the real Spring
 * Store over MySQL answers it late — the same "stalled in transit"
 * shape as the #13370 incident. The proxy's own classification code
 * (the code under test) then decides whether the late answer is
 * tolerated or fails the gate. Identical in every arm.
 *
 * VERIFY13380_MODE:
 *   renew-after-acquire   hold the to-be-killed Harness's in-flight
 *                         /writers:renew; release after the cold load's
 *                         /writers:acquire returns 200 (CI #13370 order)
 *   renew-after-expiry    same renew; release once its lease has expired,
 *                         while the killed process is still `cli`
 *                         (before the restart)
 *   renew-before-expiry   same renew; release 1 s before its lease
 *                         expires, so the Store accepts it (200)
 *   commit-after-acquire  harness-result: forward the intercepted
 *                         tool_result commit after the cold acquire
 *                         instead of dropping it
 *   live-renew-expired    negative control: hold the LIVE Harness's
 *                         renew until its lease expires, classify, and
 *                         only then kill
 *   current-renew-expired negative control: after restart, hold the NEW
 *                         Harness's renew until its own lease expires
 */
import { appendFileSync } from 'node:fs';

export const mode = process.env['VERIFY13380_MODE'] ?? '';
const out = process.env['VERIFY13380_OUT'] ?? '';
const t0 = Date.now();

type Held = {
  path: string;
  writerId: string;
  writerGeneration: unknown;
  capturedAt: number;
  outcome?: string;
  settle: () => void;
  settled: Promise<void>;
};

let currentBoot: () => string = () => '';
const grants = new Map<string, number>();
const killed = new Set<string>();
let holdWriter = '';
let holdRoute = '';
let held: Held | undefined;
let onCaptured: (() => void) | undefined;
let acquiredAfterCapture = false;
let onAcquired: (() => void) | undefined;

function log(event: string, data: Record<string, unknown> = {}) {
  const line = JSON.stringify({ t: Date.now() - t0, mode, event, ...data });
  console.log(`VERIFY13380 ${line}`);
  if (out) appendFileSync(out, line + '\n');
}

export function init(boot: () => string) {
  currentBoot = boot;
  if (mode) log('init');
}

export function noteKill(bootId: string) {
  killed.add(bootId);
  if (mode) log('sigkill', { bootId });
}

async function waitAcquire() {
  if (!acquiredAfterCapture)
    await new Promise<void>((resolve) => (onAcquired = resolve));
}

async function waitLeaseExpiry(writerId: string) {
  const until = grants.get(writerId);
  if (until === undefined) throw new Error('no grant observed for writer');
  const delay = until + 300 - Date.now();
  log('wait-lease-expiry', { leaseUntil: until, delayMs: delay });
  if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
}

function capture(path: string, fields: Record<string, unknown>): Held {
  let settle!: () => void;
  const settled = new Promise<void>((resolve) => (settle = resolve));
  held = {
    path,
    writerId: String(fields['writerId']),
    writerGeneration: fields['writerGeneration'],
    capturedAt: Date.now(),
    settle,
    settled,
  };
  log('captured', {
    path,
    writerId: held.writerId,
    writerGeneration: held.writerGeneration,
    leaseUntil: grants.get(held.writerId),
  });
  onCaptured?.();
  return held;
}

export async function maybeHold(
  store: boolean,
  path: string,
  fields: Record<string, unknown>,
): Promise<Held | undefined> {
  if (
    !mode ||
    !store ||
    held ||
    !holdWriter ||
    !path.endsWith(holdRoute) ||
    fields['writerId'] !== holdWriter
  )
    return undefined;
  const h = capture(path, fields);
  if (mode === 'renew-after-acquire') {
    await waitAcquire();
    log('release', { reason: 'cold-load acquire returned 200' });
  } else if (mode === 'renew-before-expiry') {
    const until = grants.get(h.writerId)!;
    const delay = until - 1_000 - Date.now();
    log('wait-before-expiry', { leaseUntil: until, delayMs: delay });
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
    log('release', { reason: '1 s before the lease expires' });
  } else {
    await waitLeaseExpiry(h.writerId);
    log('release', { reason: 'lease expired' });
  }
  return h;
}

export async function holdCommit(
  fields: Record<string, unknown>,
): Promise<Held | undefined> {
  if (mode !== 'commit-after-acquire') return undefined;
  const h = capture('/transactions:commit', fields);
  await waitAcquire();
  log('release', { reason: 'cold-load acquire returned 200' });
  return h;
}

export function observe(
  store: boolean,
  path: string,
  fields: Record<string, unknown>,
  status: number,
  json: { leaseUntil?: number; writerGeneration?: number } | undefined,
) {
  if (!mode || !store) return;
  const writerId = String(fields['writerId']);
  if (status !== 200) {
    if (path.includes('/writers:'))
      log('writer-response', {
        route: path.slice(path.lastIndexOf('/') + 1),
        writerId,
        status,
        code: (json as { error?: { code?: string } } | undefined)?.error?.code,
        writerKilledByDriver: killed.has(writerId),
        writerIsCurrentCli: writerId === currentBoot(),
      });
    return;
  }
  if (
    (path.endsWith('/writers:acquire') || path.endsWith('/writers:renew')) &&
    typeof json?.leaseUntil === 'number'
  )
    grants.set(writerId, json.leaseUntil);
  if (path.endsWith('/writers:acquire')) {
    log('acquire-200', {
      writerId,
      writerGeneration: json?.writerGeneration,
      leaseUntil: json?.leaseUntil,
    });
    if (held && writerId !== held.writerId) {
      acquiredAfterCapture = true;
      onAcquired?.();
    }
  }
}

export function upstream(
  h: Held,
  status: number,
  body: string,
  writerId: unknown,
) {
  log('upstream', {
    path: h.path,
    status,
    body: body.slice(0, 300),
    heldMs: Date.now() - h.capturedAt,
    writerKilledByDriver: killed.has(String(writerId)),
    writerIsCurrentCli: writerId === currentBoot(),
  });
}

export function classified(h: Held, outcome: string) {
  if (h.outcome !== undefined) return;
  h.outcome = outcome;
  log('classified', { path: h.path, outcome });
  h.settle();
}

async function armRenewHold(writerId: string) {
  holdWriter = writerId;
  holdRoute = '/writers:renew';
  const captured = new Promise<void>((resolve) => (onCaptured = resolve));
  log('armed', { writerId, isCurrentCli: writerId === currentBoot() });
  await Promise.race([
    captured,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('VERIFY13380: no renew captured')), 8_000),
    ),
  ]);
}

async function drain() {
  if (!held) return;
  await Promise.race([
    held.settled,
    new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error('VERIFY13380: held request never settled')),
        30_000,
      ),
    ),
  ]);
}

export async function beforeWorkerKill(bootId: string) {
  if (
    mode === 'renew-after-acquire' ||
    mode === 'renew-after-expiry' ||
    mode === 'renew-before-expiry'
  )
    await armRenewHold(bootId);
  if (mode === 'live-renew-expired') {
    await armRenewHold(bootId);
    await drain();
  }
}

export async function beforeFinish(
  bootId: string,
  report: Record<string, unknown>,
) {
  if (mode === 'current-renew-expired') await armRenewHold(bootId);
  await drain();
  if (mode)
    log('finish', {
      heldOutcome: held?.outcome,
      fencedWriterRenewals: report['fencedWriterRenewals'],
      staleWriterConflicts: report['staleWriterConflicts'],
    });
}
