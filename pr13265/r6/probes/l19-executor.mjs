// PR #13265 round 5 — L19: the real ManagedToolExecutor background path on
// real cgroup v2. Built per arm with esbuild (aliases @armcli and
// @qwen-code/qwen-code-core point at that arm's dist), so the executor's own
// onOutput backpressure, the registry, the retained receipts and the shell
// route all run as shipped. Only the publisher/store are local: a
// LocalShellStreamCapture over a store throttled to STORE_MIB_PER_S.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import net from 'node:net';
import { ManagedToolExecutor } from '@armcli/serve/managed-runtime-tool-executor.js';
import { ManagedBackgroundShellRegistry } from '@armcli/serve/managed-background-shell-registry.js';
import { ManagedShellRuntime } from '@armcli/serve/managed-shell-runtime.js';
import { ManagedMonitorRuntime } from '@armcli/serve/managed-monitor-runtime.js';
import { ManagedChildRunSupervisor } from '@qwen-code/qwen-code-core/managed-runtime/managed-child-run-supervisor.js';
import { LocalShellStreamCapture } from '@qwen-code/qwen-code-core/managed-runtime/local-shell-stream-capture.js';
import { parseToolResultManifestBytes } from '@qwen-code/qwen-code-core/managed-runtime/managed-tool-result.js';
import { managedToolDigest } from '@qwen-code/qwen-code-core/tools/managed-tool-protocol.js';

const ROOT = process.env.CGROUP_ROOT;
const RATE = Number(process.env.STORE_MIB_PER_S ?? 20);
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;
const WORKDIR = '/tmp/l19-work';
// TRACE=1: who resumes a paused pipe? Counted by caller frame.
const resumeCallers = {};
if (process.env.TRACE) {
  const original = net.Socket.prototype.resume;
  net.Socket.prototype.resume = function (...args) {
    if (this.isPaused()) {
      const frame = (new Error().stack.split('\n').slice(2).find((l) => /flushStdio|applyPause|onOutput|resume/.test(l)) ?? 'other').trim().replace(/\(.*\)/, '').slice(0, 60);
      resumeCallers[frame] = (resumeCallers[frame] ?? 0) + 1;
    }
    return original.apply(this, args);
  };
}
fs.mkdirSync(WORKDIR, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const events = (unit) => { try { return fs.readFileSync(path.join(ROOT, unit, 'cgroup.events'), 'utf8').match(/populated (\d)/)[1] === '1' ? 'populated' : 'empty'; } catch { return 'no unit'; } };
const members = (unit) => { try { return fs.readFileSync(path.join(ROOT, unit, 'cgroup.procs'), 'utf8').trim().split('\n').filter(Boolean).length; } catch { return -1; } };

// ---- local resource + stream store (the only non-shipped part) ----
const blobs = new Map();
const manifestTimes = [];
let rid = 0;
const resources = {
  publish: async (kind, bytes) => {
    const id = `r-${++rid}`;
    if (kind === 'managed-tool-result-manifest') manifestTimes.push(Date.now());
    blobs.set(id, Buffer.from(bytes));
    return { resourceId: id, kind, schemaVersion: 1, byteLength: bytes.byteLength, digest: createHash('sha256').update(bytes).digest('hex') };
  },
  read: async (ref) => blobs.get(ref.resourceId),
};
const captures = new Map();
const finished = new Map();
function storeFor(state) {
  return {
    async publish(request) {
      await sleep((request.bytes.byteLength / (RATE * 1024 * 1024)) * 1000);
      state.hash[request.streamId].update(request.bytes);
      if (request.streamId === 'stdout' && state.stdoutBytes < 64 * 1024 * 1024) { state.stdout.push(Buffer.from(request.bytes)); state.stdoutBytes += request.bytes.byteLength; }
      state.stored += request.bytes.byteLength;
      return { status: 'ok', result: { byteLength: request.bytes.byteLength, digest: createHash('sha256').update(request.bytes).digest('hex') } };
    },
    async seal() { return { status: 'ok', result: { sealed: true } }; },
    async prefix() { return { status: 'ok', result: { byteLength: 0 } }; },
    async readRange() { return { status: 'ok', result: Buffer.alloc(0) }; },
    async close() {},
  };
}
const publisher = {
  async prepare(request) {
    const callId = request.reference.callId;
    const state = { hash: { stdout: createHash('sha256'), stderr: createHash('sha256') }, stored: 0, inflight: 0, maxInflight: 0, writes: 0, stdout: [], stdoutBytes: 0 };
    const identity = { tenantId: 't', sessionId: 's', turnId: 'turn', executionCallId: `exec-${callId}`, callId, invocationDigest: 'd'.repeat(64), bindingGeneration: '1', captureId: `cap-${callId}`.toLowerCase(), revision: 1 };
    const capture = new LocalShellStreamCapture(storeFor(state), resources, identity);
    await capture.open();
    // Transparent meter: the executor counts its in-flight bytes by the
    // same write promise, so this mirrors its bufferedBytes.
    const write = capture.write.bind(capture);
    capture.write = (stream, chunk) => {
      state.inflight += chunk.byteLength;
      state.writes++;
      state.maxInflight = Math.max(state.maxInflight, state.inflight);
      const p = write(stream, chunk);
      p.then(() => { state.inflight -= chunk.byteLength; }, () => { state.inflight -= chunk.byteLength; });
      return p;
    };
    captures.set(callId, state);
    return { identity, sink: capture, publisher: undefined };
  },
  async finish(identity, envelope) {
    finished.set(identity.callId, { envelope, at: Date.now() });
  },
};

const supervisor = ManagedChildRunSupervisor.create({ cgroupRoot: ROOT });
const registry = new ManagedBackgroundShellRegistry();
const tools = {
  sessionId: 'l19',
  directory: WORKDIR,
  tools: new Map([['run_shell_command', { validateToolParams: () => null }]]),
  admitsDirectory: (each) => each.startsWith(WORKDIR),
};
const executor = new ManagedToolExecutor(async () => tools, publisher, undefined, undefined, supervisor, registry);
const route = new ManagedShellRuntime(registry);
const ask = async (session, kind, callId) => {
  try {
    return await route.control(session, { kind, operationId: `op-${kind}-${callId}`, sessionKey: { tenantId: 't', sessionId: 's' }, targetOperationId: callId });
  } catch (e) { return { error: `${e.name}: ${e.message}` }; }
};

async function start(sessionId, callId, command, kind = 'background') {
  const input = kind === 'monitor' ? { command, is_monitor: true } : { command, is_background: true };
  const t0 = Date.now();
  const view = await executor.executeV3({
    reference: { sessionId, promptId: 'p', callId, argsDigest: `sha256:${managedToolDigest(input)}` },
    capture: { tenantId: 't', sessionId: 's', turnId: 'turn', executionCallId: `exec-${callId}`, bindingGeneration: '1', capturePolicy: 'complete_required' },
    toolName: 'run_shell_command',
    input,
  });
  const unitName = `${kind === 'monitor' ? 'qwen-mon' : 'qwen-bg'}-${callId}`;
  const result = view.result ?? view;
  const started = result.executionStatus === 'success';
  const physical = kind === 'monitor' ? executor.monitorRegistry.physical : registry;
  const entry = physical.entries.get(unitName);
  let launcherExitMs = null;
  entry?.process.child.once('exit', () => { launcherExitMs = Date.now() - t0; });
  return {
    callId, unitName, t0, started,
    startError: started ? null : result.error?.message ?? JSON.stringify(view),
    completion: physical.receipt(unitName),
    launcherExitMs: () => launcherExitMs,
  };
}

async function finishedManifest(callId) {
  const done = finished.get(callId);
  if (!done?.envelope?.capture?.manifest) return null;
  const m = parseToolResultManifestBytes(blobs.get(done.envelope.capture.manifest.resourceId));
  const out = m.contents.find((c) => c.streamId === 'stdout');
  return { captureStatus: m.captureStatus, executionStatus: m.executionStatus, stdoutBytes: out?.byteLength ?? null, stdoutDigest: out?.digest ?? null };
}

let peak = 0;
setInterval(() => { peak = Math.max(peak, process.memoryUsage().rss); }, 25).unref();
const want = (name) => !ONLY || ONLY.includes(name);
const out = { arm: process.env.ARM };

// a/b. backpressure: the launcher's own child writes, then a background
//      writer that outlives the launcher (Node resumes paused pipes on exit).
for (const [name, command] of [
  ['bpForeground', 'head -c 256M /dev/zero'],
  ['bpAfterLauncherExit', 'head -c 256M /dev/zero & sleep 1; exit 0'],
]) {
  if (!want(name)) continue;
  global.gc?.();
  await sleep(500);
  for (const k of Object.keys(resumeCallers)) delete resumeCallers[k];
  const base = process.memoryUsage().rss;
  peak = base;
  const s = await start(`s-${name}`, `l19-${name.toLowerCase()}`, command);
  if (!s.started) { out[name] = { startError: s.startError }; continue; }
  const receipt = await s.completion;
  const unitAtCompletion = { unit: events(s.unitName), live: members(s.unitName) };
  await sleep(3000);
  const unitAfter3s = { unit: events(s.unitName), live: members(s.unitName) };
  const st = captures.get(s.callId);
  const m = await finishedManifest(s.callId);
  out[name] = {
    baseRssMiB: Math.round(base / 1048576), peakRssMiB: Math.round(peak / 1048576),
    maxInflightMiB: +(st.maxInflight / 1048576).toFixed(1),
    unitAtCompletion, unitAfter3s,
    launcherExitMs: s.launcherExitMs(), completionMs: Date.now() - s.t0,
    manifestsBeforeLauncherExit: manifestTimes.filter((t) => t >= s.t0 && s.launcherExitMs() !== null && t - s.t0 < s.launcherExitMs()).length,
    manifestsTotal: manifestTimes.filter((t) => t >= s.t0).length,
    resumeOfPausedPipeBy: { ...resumeCallers },
    evidence: receipt.evidence, manifest: m,
    digestOk: m?.stdoutDigest === createHash('sha256').update(Buffer.alloc(256 * 1024 * 1024)).digest('hex'),
  };
}

// c/d. receipts retained after the end — what the Broker will be told
for (const [name, command] of [
  ['exit3', 'sleep 0.3; exit 3'],
  ['setsidDaemon', 'setsid sleep 3191 </dev/null >/dev/null 2>&1 & exit 0'],
  ['childHoldsPipes', '(sleep 3192 &) ; exit 0'],
]) {
  if (!want(name)) continue;
  const s = await start(`s-${name}`, `l19-${name.toLowerCase()}`, command);
  if (!s.started) { out[name] = { startError: s.startError }; continue; }
  const receipt = await s.completion;
  out[name] = {
    completionMs: Date.now() - s.t0,
    receipt: receipt.evidence,
    holdAfter: executor.hasActiveSession(`s-${name}`),
    status: await ask(`s-${name}`, 'shell-status', s.callId),
    terminate: await ask(`s-${name}`, 'shell-terminate', s.callId),
    otherSession: (await ask('s-other', 'shell-status', s.callId)).state,
    unit: events(s.unitName), liveMembers: members(s.unitName),
    manifest: await finishedManifest(s.callId),
  };
}

// e. ordered close: drain one Session with three Shells, leave another alone
if (want('drain')) {
  const d = [];
  d.push(await start('s-drain', 'l19-d-obeys', 'sleep 3193'));
  d.push(await start('s-drain', 'l19-d-ignores', "(trap '' TERM; sleep 3194) & sleep 3195"));
  d.push(await start('s-drain', 'l19-d-holds', 'sleep 3196 & wait'));
  const other = await start('s-keep', 'l19-keep', 'sleep 3197');
  await sleep(300);
  const t0 = Date.now();
  await executor.stopBackgroundSession('s-drain');
  const ms = Date.now() - t0;
  await sleep(1500);
  out.drain = {
    started: d.map((x) => x.started).concat(other.started),
    drainMs: ms,
    holdAfterDrain: executor.hasActiveSession('s-drain'),
    otherHold: executor.hasActiveSession('s-keep'),
    perShell: Object.fromEntries(await Promise.all(d.map(async (x) => [x.callId.replace('l19-d-', ''), {
      status: (await ask('s-drain', 'shell-status', x.callId)).state,
      unit: events(x.unitName), liveMembers: members(x.unitName),
    }]))),
    other: { status: (await ask('s-keep', 'shell-status', other.callId)).state, unit: events(other.unitName) },
  };
  await registry.terminate(other.unitName, 1000);
}

// f. Monitor watches through the executor (ce04b2112f): is the captured
//    output the command's stdout, byte for byte?
const monitorRoute = new ManagedMonitorRuntime(executor.monitorRegistry);
const CJK = '中文测试行，用于验证多字节字符在管道块边界被切开时的行为。';
for (const [name, command, expected] of [
  ['monUtf8', `yes '${CJK}' | head -n 30000`, null],
  ['monShape', "printf 'first\\n\\nthird\\nlast-without-newline'", 'first\n\nthird\nlast-without-newline'],
  ['monSlowShape', "printf 'first\\n\\nthird\\n'; sleep 3; printf 'last-without-newline'", 'first\n\nthird\nlast-without-newline'],
]) {
  if (!want(name)) continue;
  const s = await start(`s-${name}`, `l19-${name.toLowerCase()}`, command, 'monitor');
  if (!s.started) { out[name] = { startError: s.startError }; continue; }
  const receipt = await s.completion;
  const text = Buffer.concat(captures.get(s.callId).stdout).toString('utf8');
  const lines = text.split('\n');
  out[name] = {
    receipt: receipt?.evidence ?? null,
    capturedBytes: Buffer.byteLength(text),
    ...(expected === null
      ? { lines: lines.filter(Boolean).length, linesWithReplacementChar: lines.filter((l) => l.includes('�')).length }
      : { captured: JSON.stringify(text), expected: JSON.stringify(expected), identical: text === expected }),
    status: (await monitorRoute.control(`s-${name}`, { kind: 'monitor-status', operationId: 'op', sessionKey: { tenantId: 't', sessionId: 's' }, targetOperationId: s.callId }).catch((e) => ({ state: e.message }))).state,
    holdAfter: executor.hasActiveSession(`s-${name}`),
  };
}
if (want('monHold')) {
  const s = await start('s-monhold', 'l19-monhold', 'while true; do echo tick; sleep 0.5; done', 'monitor');
  if (!s.started) out.monHold = { startError: s.startError };
  else {
    await sleep(1000);
    const during = { hasActiveSession: executor.hasActiveSession('s-monhold'), monitorRegistryHolds: executor.monitorRegistry.hasHolds('s-monhold'), unit: events(s.unitName) };
    await executor.stopBackgroundSession('s-monhold');
    await sleep(1500);
    out.monHold = { during, afterStopBackgroundSession: { monitorRegistryHolds: executor.monitorRegistry.hasHolds('s-monhold'), unit: events(s.unitName), live: members(s.unitName) } };
    await executor.monitorRegistry.terminate(s.unitName, 1000).catch(() => {});
  }
}
console.log(`[RESULT] ${JSON.stringify(out)}`);
for (const dname of fs.readdirSync(ROOT).filter((n) => n.startsWith('qwen-bg-l19'))) {
  try { fs.writeFileSync(path.join(ROOT, dname, 'cgroup.kill'), '1'); } catch {}
}
await sleep(500);
for (const dname of fs.readdirSync(ROOT).filter((n) => n.startsWith('qwen-bg-l19'))) {
  try { fs.rmdirSync(path.join(ROOT, dname)); } catch {}
}
process.exit(0);
