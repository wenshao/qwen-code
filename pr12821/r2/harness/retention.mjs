// node --expose-gc retention.mjs <repo> <calls> <v2|v3>
// Runs <calls> sequential tiny Shell calls (`echo hi`) through the real compiled
// ManagedToolExecutor and reports ArrayBuffer memory still held after full GC.
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

const [repo, callsArg = '50', mode = 'v3'] = process.argv.slice(2);
const dist = (p) => import(pathToFileURL(path.join(repo, p)).href);
const { SessionWriterLease } = await dist('packages/core/dist/src/services/session-writer-lease.js');
const { LocalToolResultSegmentStore } = await dist('packages/core/dist/src/managed-runtime/local-managed-tool-result-store.js');
const { LocalManagedSessionResourceStore } = await dist('packages/core/dist/src/managed-runtime/managed-session-resources.js');
const { LocalShellResultCapture } = await dist('packages/core/dist/src/managed-runtime/local-shell-result-capture.js');
const { ManagedToolExecutor, createManagedToolSet } = await dist('packages/cli/dist/src/serve/managed-runtime-tool-executor.js');

const sessionKey = { tenantId: 'tenant-a', workspaceId: 'workspace-a', sessionId: 'session-a' };
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pr12821-retention-'));
const runtimeBaseDir = path.join(root, 'runtime');
const transcriptPath = path.join(runtimeBaseDir, 'chats', 'session-a.jsonl');
await fs.mkdir(path.dirname(transcriptPath), { recursive: true });
await fs.mkdir(path.join(root, 'ws'), { recursive: true });
const lease = await SessionWriterLease.acquire({ runtimeBaseDir, sessionId: sessionKey.sessionId, transcriptPath });
const store = await LocalToolResultSegmentStore.openWritable({ lease, sessionKey });
const resources = LocalManagedSessionResourceStore.create({ runtimeBaseDir, sessionKey });
const toolSet = createManagedToolSet(path.join(root, 'ws'), 'runtime-session-a');
let seq = 0;
// Stand-in Session owner: real capture sinks over the real O1b store; accept records a committed receipt.
const publisher = {
  async prepare({ reference, capture }) {
    const identity = {
      tenantId: capture.tenantId, sessionId: capture.sessionId, turnId: capture.turnId,
      executionCallId: capture.executionCallId, callId: reference.callId,
      invocationDigest: reference.argsDigest, bindingGeneration: capture.bindingGeneration,
      captureId: createHash('sha256').update(capture.executionCallId).digest('hex').slice(0, 32), revision: 1,
    };
    return { identity, sink: new LocalShellResultCapture(store, resources, identity) };
  },
  async accept(identity, envelope) {
    return { executionCallId: identity.executionCallId, manifest: envelope.capture.manifest, deliveryStatus: 'committed', historyRevision: ++seq };
  },
};
const executor = new ManagedToolExecutor(async () => toolSet, publisher);
const gcBuffers = () => { globalThis.gc(); globalThis.gc(); return process.memoryUsage().arrayBuffers; };
const mib = (b) => (b / 1048576).toFixed(1);
const input = { command: 'echo hi' };
const argsDigest = createHash('sha256').update(JSON.stringify(input)).digest('hex');
const base = gcBuffers();
const rows = [];
const calls = Number(callsArg);
for (let i = 1; i <= calls; i++) {
  const reference = { sessionId: 'runtime-session-a', promptId: 'turn-a', callId: `call-${i}`, argsDigest };
  if (mode === 'v3') {
    const view = await executor.executeV3({
      reference, toolName: 'run_shell_command', input,
      capture: { tenantId: 'tenant-a', sessionId: 'session-a', turnId: 'turn-a', executionCallId: `execution-${i}`, bindingGeneration: '1', capturePolicy: 'complete_required' },
    });
    if (view.state !== 'settled' || view.result.capture.captureStatus !== 'complete') throw new Error(JSON.stringify(view));
    // Session owner ACKs the committed receipt: the point after which capture state may be released.
    executor.acknowledgeV3(reference, { executionCallId: `execution-${i}`, manifest: view.result.capture.manifest, deliveryStatus: 'committed', historyRevision: seq });
  } else {
    await executor.execute(reference, 'run_shell_command', input);
  }
  if ([1, 10, 25, 50, 100, 200].includes(i) || i === calls) rows.push(`${mode} after ${String(i).padStart(3)} calls: +${mib(gcBuffers() - base)} MiB ArrayBuffer held`);
}
await executor.close();
rows.push(`${mode} after executor.close() (journal still referenced): +${mib(gcBuffers() - base)} MiB`);
console.log(`node ${process.version}  repo=${path.basename(repo)}`);
console.log(rows.join('\n'));
await store.close();
await lease.release();
await fs.rm(root, { recursive: true, force: true });
