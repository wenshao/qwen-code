// PR #13265 round 2 — L10: while a chatty background Shell runs, what does a
// reader of the capture's current manifest see? Polls currentManifest every
// 250 ms and decodes it, until exit, then prints the timeline.
import { createHash } from 'node:crypto';

const DIST = process.env.DIST;
const ROOT = process.env.CGROUP_ROOT;
const { ManagedChildRunSupervisor } = await import(`${DIST}/core/managed-runtime/managed-child-run-supervisor.js`);
const { LocalShellStreamCapture } = await import(`${DIST}/core/managed-runtime/local-shell-stream-capture.js`);
const { parseToolResultManifestBytes } = await import(`${DIST}/core/managed-runtime/managed-tool-result.js`);
const blobs = new Map();
let n = 0;
const resources = {
  publish: async (kind, bytes) => {
    const id = `r-${++n}`;
    blobs.set(id, Buffer.from(bytes));
    return { resourceId: id, kind, schemaVersion: 1, byteLength: bytes.byteLength, digest: createHash('sha256').update(bytes).digest('hex') };
  },
  read: async (ref) => blobs.get(ref.resourceId),
};
const store = {
  async publish(r) { return { status: 'ok', result: { byteLength: r.bytes.byteLength, digest: createHash('sha256').update(r.bytes).digest('hex') } }; },
  async seal() { return { status: 'ok', result: { sealed: true } }; },
  async prefix() { return { status: 'ok', result: { byteLength: 0 } }; },
  async readRange() { return { status: 'ok', result: Buffer.alloc(0) }; },
  async close() {},
};
const identity = { tenantId: 't', sessionId: 's', turnId: 'turn', executionCallId: 'call', callId: 'b', invocationDigest: 'd'.repeat(64), bindingGeneration: '1', captureId: 'cap', revision: 1 };
const capture = new LocalShellStreamCapture(store, resources, identity);
await capture.open();
const sup = ManagedChildRunSupervisor.create({ cgroupRoot: ROOT });
let pipeBytes = 0;
const proc = await sup.start({
  unitName: 'qwen-bg-l10',
  executable: '/bin/sh',
  args: ['-c', 'i=0; while [ $i -lt 20 ]; do echo "server log line $i"; i=$((i+1)); sleep 0.1; done'],
  env: { PATH: process.env.PATH },
  cwd: '/tmp',
  onOutput: (stream, chunk) => { pipeBytes += chunk.byteLength; capture.write(stream, chunk); },
});
capture.setStarted(proc.child.pid);
const seen = (ref) => {
  const m = parseToolResultManifestBytes(blobs.get(ref.resourceId));
  const out = m.contents.find((c) => c.streamId === 'stdout');
  return `rev ${m.revision} ${m.captureStatus} stdout=${out.byteLength}B/${out.state}`;
};
const timeline = [];
const t0 = Date.now();
let exited = false;
proc.child.on('exit', () => { exited = true; });
while (!exited) {
  timeline.push(`${String(Date.now() - t0).padStart(5)} ms  pipe=${pipeBytes}B  reader sees: ${seen(capture.currentManifest)}`);
  await new Promise((r) => setTimeout(r, 250));
}
await new Promise((r) => (proc.child.stdout.readableEnded ? r() : proc.child.stdout.once('end', r)));
capture.setProcessResult({ exitCode: proc.evidence?.exitCode ?? null, signal: null });
await capture.finish('stdout', true);
await capture.finish('stderr', true);
const env = await capture.finalize('success', [], undefined);
timeline.push(`${String(Date.now() - t0).padStart(5)} ms  exited; reader sees: ${seen(env.capture.manifest)}`);
console.log(timeline.join('\n'));
await proc.terminate(200).catch(() => {});
process.exit(0);
