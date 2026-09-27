// node capture-e2e.mjs <repo> <trials> <sizeBytes>...
// Real ShellExecutionService + LocalShellResultCapture + O1b store, no mocks.
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

const [repo, trialsArg, ...sizes] = process.argv.slice(2);
const dist = (p) => import(pathToFileURL(path.join(repo, p)).href);
const { ShellExecutionService } = await dist('packages/core/dist/src/services/shellExecutionService.js');
const { SessionWriterLease } = await dist('packages/core/dist/src/services/session-writer-lease.js');
const { LocalToolResultSegmentStore } = await dist('packages/core/dist/src/managed-runtime/local-managed-tool-result-store.js');
const { LocalManagedSessionResourceStore } = await dist('packages/core/dist/src/managed-runtime/managed-session-resources.js');
const { LocalShellResultCapture } = await dist('packages/core/dist/src/managed-runtime/local-shell-result-capture.js');
const { parseToolResultManifestBytes } = await dist('packages/core/dist/src/managed-runtime/managed-tool-result.js');
const sessionKey = { tenantId: 'tenant-a', workspaceId: 'workspace-a', sessionId: 'session-a' };
const identity = { tenantId: 'tenant-a', sessionId: 'session-a', turnId: 'turn-a', executionCallId: 'execution-a', callId: 'call-a', invocationDigest: 'digest-a', bindingGeneration: '1', captureId: 'capture-a', revision: 1 };
for (const size of sizes.map(Number)) {
  const tally = {};
  for (let t = 0; t < Number(trialsArg); t++) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cap-'));
    const runtimeBaseDir = path.join(root, 'runtime');
    const transcriptPath = path.join(runtimeBaseDir, 'chats', 'session-a.jsonl');
    await fs.mkdir(path.dirname(transcriptPath), { recursive: true });
    const lease = await SessionWriterLease.acquire({ runtimeBaseDir, sessionId: 'session-a', transcriptPath });
    const store = await LocalToolResultSegmentStore.openWritable({ lease, sessionKey });
    const resources = LocalManagedSessionResourceStore.create({ runtimeBaseDir, sessionKey });
    const capture = new LocalShellResultCapture(store, resources, identity);
    const handle = await ShellExecutionService.executeLaunch(
      { executable: process.execPath, args: ['-e', `process.stdout.write(require('crypto').randomBytes(${size}))`], cwd: root, env: {} },
      () => {}, new AbortController().signal, false, { maxBufferedOutputBytes: 64 * 1024 }, { rawCapture: capture });
    capture.setStarted(handle.pid);
    capture.setProcessResult(await handle.result);
    const env = await capture.finalize('success', []);
    let key = env.capture.captureStatus;
    if (key === 'complete') {
      const m = parseToolResultManifestBytes(await resources.read(env.capture.manifest));
      const out = m.contents.find((c) => c.streamId === 'stdout');
      key += out.byteLength === size ? '' : `(len ${out.byteLength}!)`;
    }
    tally[key] = (tally[key] ?? 0) + 1;
    await store.close();
    await lease.release();
    await fs.rm(root, { recursive: true, force: true });
  }
  console.log(`node ${process.version} ${os.platform()} size=${size} (${(size / 1048576).toFixed(4)} MiB): ${JSON.stringify(tally)}`);
}
