// node unknown-release.mjs <repo>
// Real boot v2 worker (startManagedRuntimeAttestationWorker) with an injected
// publisher whose receipt step fails once. Shows what the worker's workspace
// activation route does afterwards, next to a v2 control.
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

const [repo] = process.argv.slice(2);
const dist = (p) => import(pathToFileURL(path.join(repo, p)).href);
const { startManagedRuntimeAttestationWorker } = await dist('packages/cli/dist/src/serve/managed-runtime-attestation-worker.js');
const { computeManagedContextDigest } = await dist('packages/cli/dist/src/serve/managed-workspace-binding.js');
const { WORKSPACE_CAPABILITY_DIGEST, WORKSPACE_CONTEXT_CONFIG_REF, WORKSPACE_EXECUTION_PROFILE, WORKSPACE_ACTIVATION_ROUTE } = await dist('packages/cli/dist/src/serve/managed-workspace-activation.js');
const { SessionWriterLease } = await dist('packages/core/dist/src/services/session-writer-lease.js');
const { LocalToolResultSegmentStore } = await dist('packages/core/dist/src/managed-runtime/local-managed-tool-result-store.js');
const { LocalManagedSessionResourceStore } = await dist('packages/core/dist/src/managed-runtime/managed-session-resources.js');
const { LocalShellResultCapture } = await dist('packages/core/dist/src/managed-runtime/local-shell-result-capture.js');

const fixtures = JSON.parse(fs.readFileSync(path.join(repo, 'packages/cli/src/serve/contracts/managed-context-v1.fixtures.json'), 'utf8'));
const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'pr12821-unknown-'));
const mountRoot = path.join(root, 'mount');
await fsp.mkdir(path.join(mountRoot, 'services/api'), { recursive: true });
const boot = { ...fixtures.boot, mountRoot, capabilityDigest: WORKSPACE_CAPABILITY_DIGEST };

// Session-owned publisher stand-in: real capture sink + real O1b store; accept fails once.
const sessionKey = { tenantId: boot.tenantId, workspaceId: boot.workspaceId, sessionId: 'session-owner' };
const runtimeBaseDir = path.join(root, 'runtime');
const transcriptPath = path.join(runtimeBaseDir, 'chats', 'session-owner.jsonl');
await fsp.mkdir(path.dirname(transcriptPath), { recursive: true });
const lease = await SessionWriterLease.acquire({ runtimeBaseDir, sessionId: sessionKey.sessionId, transcriptPath });
const store = await LocalToolResultSegmentStore.openWritable({ lease, sessionKey });
const resources = LocalManagedSessionResourceStore.create({ runtimeBaseDir, sessionKey });
let acceptCalls = 0;
const publisher = {
  async prepare({ reference, capture }) {
    const identity = {
      tenantId: capture.tenantId, sessionId: capture.sessionId, turnId: capture.turnId,
      executionCallId: capture.executionCallId, callId: reference.callId, invocationDigest: reference.argsDigest,
      bindingGeneration: capture.bindingGeneration, captureId: createHash('sha256').update(capture.executionCallId).digest('hex').slice(0, 32), revision: 1,
    };
    return { identity, sink: new LocalShellResultCapture(store, resources, identity) };
  },
  async accept() {
    acceptCalls++;
    throw new Error('Managed Session activation is no longer writable.');
  },
};
const worker = await startManagedRuntimeAttestationWorker(boot, publisher);
const origin = worker.ready.url;
const HEADERS = {
  authorization: `Bearer ${boot.token}`, 'cache-control': 'no-store', 'content-type': 'application/json',
  'x-qwen-managed-lease-id': boot.leaseId, 'x-qwen-managed-lease-epoch': String(boot.epoch),
};
const post = async (route, body) => {
  const r = await fetch(`${origin}${route}`, { method: 'POST', headers: HEADERS, body: JSON.stringify(body) });
  const text = await r.text();
  let parsed = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = { nonJson: `${r.headers.get('content-type')} ${text.slice(0, 40).replace(/\s+/g, ' ')}` }; }
  return { status: r.status, body: parsed };
};
function install(sessionId) {
  const binding = {
    tenantId: boot.tenantId, workspaceId: boot.workspaceId, workspaceGeneration: boot.workspaceGeneration,
    storageId: boot.storageId, cwdRelative: 'services/api', contextConfigRef: WORKSPACE_CONTEXT_CONFIG_REF, contextRevision: '1',
  };
  return { protocolVersion: 3, managedContext: 'managed-context/1', operationId: `op-${sessionId}`, sessionId, binding, contextDigest: computeManagedContextDigest(binding) };
}
const activation = (req, operation) => ({
  protocolVersion: 1, operation, sessionId: req.sessionId, contextDigest: req.contextDigest,
  contextConfigRef: req.binding.contextConfigRef, profile: WORKSPACE_EXECUTION_PROFILE,
});
const lines = [];
const log = (s) => { lines.push(s); };
const command = 'echo captured > proof.txt; echo hi';
const argsDigest = createHash('sha256').update(JSON.stringify({ command })).digest('hex');
for (const [label, sessionId, version] of [['v3', 'session-v3', 3], ['v2 control', 'session-v2', 2]]) {
  const req = install(sessionId);
  log(`[${label}] install context            -> ${(await post('/internal/managed-runtime/v3/context', req)).status}`);
  log(`[${label}] activate workspace         -> ${(await post(WORKSPACE_ACTIVATION_ROUTE.path, activation(req, 'activate'))).status}`);
  const reference = { sessionId, promptId: 'prompt-1', callId: `call-${version}`, argsDigest };
  const exec = version === 3
    ? await post('/internal/managed-runtime/v3/execute', {
        protocolVersion: 3, toolResult: 'managed-tool-result/1', reference, toolName: 'run_shell_command', input: { command },
        capture: { tenantId: boot.tenantId, sessionId: 'session-owner', turnId: 'turn-1', executionCallId: 'execution-1', bindingGeneration: '1', capturePolicy: 'complete_required' },
      })
    : await post('/internal/managed-runtime/v2/execute', { protocolVersion: 2, reference, toolName: 'run_shell_command', input: { command } });
  log(`[${label}] execute                    -> ${exec.status} ${JSON.stringify({ state: exec.body?.state, executionStatus: exec.body?.result?.executionStatus })}`);
  log(`[${label}] side effect on disk        -> ${fs.existsSync(path.join(mountRoot, 'services/api/proof.txt'))}`);
  const statusRoute = version === 3 ? '/internal/managed-runtime/v3/status' : '/internal/managed-runtime/v2/status';
  const statusBody = version === 3 ? { protocolVersion: 3, toolResult: 'managed-tool-result/1', reference } : { protocolVersion: 2, reference };
  const st = await post(statusRoute, statusBody);
  log(`[${label}] status                     -> ${st.status} ${JSON.stringify({ state: st.body?.state, lastSequence: st.body?.lastSequence })}`);
  for (const wait of [0, 3000]) {
    if (wait) await new Promise((r) => setTimeout(r, wait));
    const rel = await post(WORKSPACE_ACTIVATION_ROUTE.path, activation(req, 'release'));
    log(`[${label}] release workspace (+${wait / 1000}s)   -> ${rel.status} ${rel.body?.code ?? (rel.body?.active === false ? 'released' : '')}`);
  }
  if (version === 3) {
    const again = await post('/internal/managed-runtime/v3/execute', {
      protocolVersion: 3, toolResult: 'managed-tool-result/1', reference, toolName: 'run_shell_command', input: { command },
      capture: { tenantId: boot.tenantId, sessionId: 'session-owner', turnId: 'turn-1', executionCallId: 'execution-1', bindingGeneration: '1', capturePolicy: 'complete_required' },
    });
    log(`[${label}] execute again (Broker retry) -> ${again.status} state=${again.body?.state}; accept() calls so far=${acceptCalls}`);
  }
  await fsp.rm(path.join(mountRoot, 'services/api/proof.txt'), { force: true });
}
// A v3 call that is still running must keep the workspace pinned; once it ends unknown, release may proceed.
{
  const req = install('session-v3run');
  log(`[v3 running] install context            -> ${(await post('/internal/managed-runtime/v3/context', req)).status}`);
  log(`[v3 running] activate workspace         -> ${(await post(WORKSPACE_ACTIVATION_ROUTE.path, activation(req, 'activate'))).status}`);
  const slow = 'perl -e "sleep 3"; echo slow';
  const reference = { sessionId: 'session-v3run', promptId: 'prompt-1', callId: 'call-run', argsDigest: createHash('sha256').update(JSON.stringify({ command: slow })).digest('hex') };
  const pending = post('/internal/managed-runtime/v3/execute', {
    protocolVersion: 3, toolResult: 'managed-tool-result/1', reference, toolName: 'run_shell_command', input: { command: slow },
    capture: { tenantId: boot.tenantId, sessionId: 'session-owner', turnId: 'turn-1', executionCallId: 'execution-run', bindingGeneration: '1', capturePolicy: 'complete_required' },
  });
  await new Promise((r) => setTimeout(r, 1000));
  const st = await post('/internal/managed-runtime/v3/status', { protocolVersion: 3, toolResult: 'managed-tool-result/1', reference });
  log(`[v3 running] status at +1 s              -> ${st.status} ${JSON.stringify({ state: st.body?.state })}`);
  const during = await post(WORKSPACE_ACTIVATION_ROUTE.path, activation(req, 'release'));
  log(`[v3 running] release while executing    -> ${during.status} ${during.body?.code ?? (during.body?.active === false ? 'released' : '')}`);
  const done = await pending;
  log(`[v3 running] execute                    -> ${done.status} ${JSON.stringify({ state: done.body?.state })}`);
  const after = await post(WORKSPACE_ACTIVATION_ROUTE.path, activation(req, 'release'));
  log(`[v3 running] release after it ended     -> ${after.status} ${after.body?.code ?? (after.body?.active === false ? 'released' : '')}`);
  const again = await post('/internal/managed-runtime/v3/execute', {
    protocolVersion: 3, toolResult: 'managed-tool-result/1', reference, toolName: 'run_shell_command', input: { command: slow },
    capture: { tenantId: boot.tenantId, sessionId: 'session-owner', turnId: 'turn-1', executionCallId: 'execution-run', bindingGeneration: '1', capturePolicy: 'complete_required' },
  });
  log(`[v3 running] execute again after release -> ${again.status} state=${again.body?.state ?? JSON.stringify(again.body)}`);
  const reactivate = await post(WORKSPACE_ACTIVATION_ROUTE.path, activation(req, 'activate'));
  log(`[v3 running] re-activate after release   -> ${reactivate.status} ${reactivate.body?.code ?? ''}`);
}
// v2 status / cancel naming the v3 call (a Broker must not do this; the worker should answer 409 JSON).
const v3ref = { sessionId: 'session-v3', promptId: 'prompt-1', callId: 'call-3', argsDigest };
for (const op of ['status', 'cancel']) {
  const r = await post(`/internal/managed-runtime/v2/${op}`, { protocolVersion: 2, reference: v3ref });
  log(`[v2 ${op} on the v3 call]           -> ${r.status} ${JSON.stringify(r.body)}`);
}
const r2 = await post('/internal/managed-runtime/v2/execute', { protocolVersion: 2, reference: v3ref, toolName: 'run_shell_command', input: { command } });
log(`[v2 execute on the v3 call]          -> ${r2.status} ${JSON.stringify(r2.body)}`);
console.log(lines.join('\n'));
await worker.close();
await store.close();
await lease.release();
await fsp.rm(root, { recursive: true, force: true });
