// PR #13265 round 2 — L9: does output reach the stream capture with
// pipe-level backpressure? The supervisor's onOutput feeds
// LocalShellStreamCapture.write; the segment store persists at a fixed rate.
// ARM=as-wired: onOutput calls write and ignores its promise (the PR's
//               supervisor/registry shape).
// ARM=paused:   the same, but stdout is paused until that write resolves.
// Prints peak RSS, wall time, and checks byte length + digest of the stream.
import { createHash } from 'node:crypto';

const DIST = process.env.DIST;
const ROOT = process.env.CGROUP_ROOT;
const ARM = process.env.ARM ?? 'as-wired';
const MIB = Number(process.env.MIB ?? 256);
const RATE = Number(process.env.STORE_MIB_PER_S ?? 20);
const { ManagedChildRunSupervisor } = await import(`${DIST}/core/managed-runtime/managed-child-run-supervisor.js`);
const { LocalShellStreamCapture } = await import(`${DIST}/core/managed-runtime/local-shell-stream-capture.js`);
const { parseToolResultManifestBytes } = await import(`${DIST}/core/managed-runtime/managed-tool-result.js`);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const blobs = new Map();
let n = 0;
let manifestPublishes = 0;
const resources = {
  publish: async (kind, bytes) => {
    const id = `r-${++n}`;
    if (kind === 'managed-tool-result-manifest') manifestPublishes++;
    blobs.set(id, Buffer.from(bytes));
    return { resourceId: id, kind, schemaVersion: 1, byteLength: bytes.byteLength, digest: createHash('sha256').update(bytes).digest('hex') };
  },
  read: async (ref) => blobs.get(ref.resourceId),
};
const hashes = { stdout: createHash('sha256'), stderr: createHash('sha256') };
let stored = 0;
const store = {
  async publish(request) {
    await sleep((request.bytes.byteLength / (RATE * 1024 * 1024)) * 1000);
    hashes[request.streamId].update(request.bytes);
    stored += request.bytes.byteLength;
    return { status: 'ok', result: { byteLength: request.bytes.byteLength, digest: createHash('sha256').update(request.bytes).digest('hex') } };
  },
  async seal() { return { status: 'ok', result: { sealed: true } }; },
  async prefix() { return { status: 'ok', result: { byteLength: 0 } }; },
  async readRange() { return { status: 'ok', result: Buffer.alloc(0) }; },
  async close() {},
};
const identity = { tenantId: 't', sessionId: 's', turnId: 'turn', executionCallId: 'call', callId: 'b', invocationDigest: 'd'.repeat(64), bindingGeneration: '1', captureId: 'cap', revision: 1 };
const capture = new LocalShellStreamCapture(store, resources, identity);
await capture.open();

let peak = 0, received = 0;
const sampler = setInterval(() => { peak = Math.max(peak, process.memoryUsage().rss); }, 50);
const sup = ManagedChildRunSupervisor.create({ cgroupRoot: ROOT });
let proc = null;
const t0 = Date.now();
proc = sup.start({
  unitName: `qwen-bg-l9-${ARM}`,
  executable: '/bin/sh',
  args: ['-c', `head -c ${MIB}M /dev/zero`],
  env: { PATH: process.env.PATH },
  cwd: '/tmp',
  onOutput: (stream, chunk) => {
    received += chunk.byteLength;
    const p = capture.write(stream, chunk);
    if (ARM === 'paused' && proc) {
      proc.child.stdout.pause();
      p.then(() => proc.child.stdout.resume());
    }
  },
});
capture.setStarted(proc.child.pid);
await new Promise((r) => proc.child.on('exit', r));
const exitMs = Date.now() - t0;
await new Promise((r) => (proc.child.stdout.readableEnded ? r() : proc.child.stdout.once('end', r)));
capture.setProcessResult({ exitCode: proc.evidence?.exitCode ?? null, signal: null });
await capture.finish('stdout', true);
await capture.finish('stderr', true);
const envelope = await capture.finalize('success', [], undefined);
const doneMs = Date.now() - t0;
clearInterval(sampler);
peak = Math.max(peak, process.memoryUsage().rss);
const manifest = parseToolResultManifestBytes(blobs.get(envelope.capture.manifest.resourceId));
const out = manifest.contents.find((c) => c.streamId === 'stdout') ?? manifest.contents[0];
const expected = createHash('sha256').update(Buffer.alloc(MIB * 1024 * 1024)).digest('hex');
console.log(`[RESULT] ${JSON.stringify({
  arm: ARM, mib: MIB, storeMiBps: RATE,
  peakRssMiB: Math.round(peak / 1048576),
  processExitMs: exitMs, captureDoneMs: doneMs,
  received, stored,
  captureStatus: envelope.capture.captureStatus,
  streamByteLength: out?.byteLength, streamDigestOk: out?.digest === expected,
  manifestRevisions: manifestPublishes,
})}`);
await proc.terminate(500).catch(() => {});
process.exit(0);
