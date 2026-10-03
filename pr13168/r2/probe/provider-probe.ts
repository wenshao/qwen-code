/**
 * Harness B for PR 13168 verification: drives the REAL managed runtime
 * provider worker (startManagedRuntimeAttestationWorker from the tree under
 * test) over real loopback HTTP. No mocks of the code under test.
 *
 * Usage: tsx provider-probe.ts <worktreeRoot> <arm: head|base> <outJson>
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [root, arm, outJson] = process.argv.slice(2);
if (!root || !arm || !outJson) throw new Error('args: root arm outJson');

const { startManagedRuntimeAttestationWorker } = (await import(
  pathToFileURL(
    path.join(root, 'packages/cli/src/serve/managed-runtime-attestation-worker.ts'),
  ).href
)) as {
  startManagedRuntimeAttestationWorker: (
    boot: Record<string, unknown>,
  ) => Promise<{ ready: { url: string }; close: () => Promise<void> }>;
};

const results: Array<{ id: string; pass: boolean; detail: string }> = [];
function check(id: string, pass: boolean, detail: unknown) {
  results.push({
    id,
    pass,
    detail: typeof detail === 'string' ? detail : JSON.stringify(detail),
  });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${id}: ${results.at(-1)!.detail}`);
}

const workspace = fs.realpathSync(
  fs.mkdtempSync(path.join(os.tmpdir(), 'pr13168-worker-')),
);
fs.writeFileSync(path.join(workspace, 'QWEN.md'), 'VERIFY-QWEN-MARKER rules');
fs.writeFileSync(path.join(workspace, 'AGENTS.md'), 'VERIFY-AGENTS-MARKER notes');
fs.mkdirSync(path.join(workspace, 'src'));
fs.writeFileSync(path.join(workspace, 'src', 'alpha.md'), 'alpha');
fs.writeFileSync(path.join(workspace, 'proof.txt'), 'proof-content-marker');

const boot = {
  capabilityDigest: `sha256:${'b'.repeat(64)}`,
  epoch: 1,
  isolationClass: 'workspace',
  leaseId: 'lease-1',
  provisionRequestId: 'prov-1',
  runtimeIncarnation: 'boot-1',
  runtimeInstanceId: 'rt-1',
  tenantId: 'tenant-a',
  token: 'worker-token',
  type: 'boot',
  version: 1,
  workspaceCwd: workspace,
  workspaceGeneration: '1',
  workspaceId: 'ws-1',
};

const worker = await startManagedRuntimeAttestationWorker(boot);
const url = (worker.ready as { url: string }).url;

async function control(runtimeSessionId: string, operation: Record<string, unknown>) {
  const response = await fetch(`${url}/internal/managed-runtime/provider/v1/control`, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer worker-token',
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json',
      'X-Qwen-Managed-Lease-Id': 'lease-1',
      'X-Qwen-Managed-Lease-Epoch': '1',
    },
    body: JSON.stringify({
      protocolVersion: 1,
      providerProtocol: 'managed-runtime-provider/1',
      session: {
        harnessSessionId: 'harness-1',
        runtimeSessionId,
        turnKind: 'bootstrap',
      },
      operation,
    }),
  });
  const text = await response.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: response.status, body };
}

const identity = (sessionId: string, callId: string) => ({
  sessionId,
  promptId: sessionId,
  callId,
});

try {
  // B1: plain read of both instruction files, in prompt order.
  const b1 = await control('rs-plain', { kind: 'workspace-context' });
  if (arm === 'head') {
    const files = (b1.body as { result?: { files?: Array<{ name: string; text: string }> } })
      ?.result?.files;
    check(
      'B1-workspace-context-read',
      b1.status === 200 &&
        JSON.stringify(files?.map((f) => f.name)) === '["QWEN.md","AGENTS.md"]' &&
        files?.[0]?.text.includes('VERIFY-QWEN-MARKER') === true &&
        files?.[1]?.text.includes('VERIFY-AGENTS-MARKER') === true,
      { status: b1.status, names: files?.map((f) => f.name) },
    );
  } else {
    check(
      'B1-base-rejects-unknown-op',
      b1.status === 501,
      { status: b1.status, body: b1.body },
    );
  }

  // B6: closed shape — an extra key is a protocol error (head only; at base
  // the whole op is unknown and 501s before shape is examined).
  if (arm === 'head') {
    const b6 = await control('rs-shape', {
      kind: 'workspace-context',
      path: '/etc/passwd',
    });
    check('B6-closed-shape', b6.status === 400, { status: b6.status });
  }

  // B2: planted symlink escaping the workspace is skipped.
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'pr13168-outside-'));
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'host-secret-marker');
  fs.rmSync(path.join(workspace, 'AGENTS.md'));
  fs.symlinkSync(
    path.join(outside, 'secret.txt'),
    path.join(workspace, 'AGENTS.md'),
  );
  const b2 = await control('rs-link', { kind: 'workspace-context' });
  if (arm === 'head') {
    const files = (
      b2.body as { result?: { files?: Array<{ name: string; text: string }> } }
    )?.result?.files;
    check(
      'B2-symlink-confined',
      b2.status === 200 &&
        JSON.stringify(files) ===
          JSON.stringify([{ name: 'QWEN.md', text: 'VERIFY-QWEN-MARKER rules' }]),
      { status: b2.status, files },
    );
  }
  fs.rmSync(path.join(workspace, 'AGENTS.md'));

  // B3: per-file cap at 64 Ki characters with a truncation note.
  const CAP = 64 * 1024;
  fs.writeFileSync(path.join(workspace, 'AGENTS.md'), 'x'.repeat(CAP + 10));
  const b3 = await control('rs-cap', { kind: 'workspace-context' });
  if (arm === 'head') {
    const files = (
      b3.body as { result?: { files?: Array<{ name: string; text: string }> } }
    )?.result?.files;
    const capped = files?.find((f) => f.name === 'AGENTS.md');
    check(
      'B3-file-cap',
      b3.status === 200 &&
        capped !== undefined &&
        capped.text.length === CAP &&
        capped.text.includes('[Truncated'),
      { status: b3.status, length: capped?.text.length },
    );
  }
  fs.writeFileSync(path.join(workspace, 'AGENTS.md'), 'VERIFY-AGENTS-MARKER notes');

  // B4: the read is only admitted BEFORE the provider Session is acquired
  // (assertLegacySession) — the hosted flow relies on the Java broker never
  // provider-acquiring first (its transport.acquire is a no-op; executions
  // for file tools ride the legacy v2 route). Pin that contract here.
  const b4a = await control('rs-order', { kind: 'acquire' });
  const b4b = await control('rs-order', { kind: 'workspace-context' });
  check(
    'B4-read-after-acquire-refused',
    arm === 'head'
      ? b4a.status === 200 &&
          b4b.status === 409 &&
          JSON.stringify(b4b.body).includes('protocol conflicts')
      : b4a.status === 200 && b4b.status === 501,
    { acquire: b4a.status, read: b4b.status, body: b4b.body },
  );

  // B5: glob through the worker's legacy v2 execute route — the path the
  // hosted Workspace dispatch and this PR's own context-worker tests use.
  const exec = async (
    toolName: string,
    input: Record<string, unknown>,
    callId: string,
  ) => {
    const response = await fetch(`${url}/internal/managed-runtime/v2/execute`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer worker-token',
        'Cache-Control': 'no-store',
        'Content-Type': 'application/json',
        'X-Qwen-Managed-Lease-Id': 'lease-1',
        'X-Qwen-Managed-Lease-Epoch': '1',
      },
      body: JSON.stringify({
        protocolVersion: 2,
        reference: {
          sessionId: 'rs-glob',
          promptId: 'rs-glob',
          callId,
          argsDigest: `sha256:${'0'.repeat(64)}`,
        },
        toolName,
        input,
      }),
    });
    const text = await response.text();
    return { status: response.status, body: text };
  };
  const glob = await exec('glob', { pattern: '**/*.md' }, 'g1');
  const read = await exec(
    'read_file',
    { file_path: path.join(workspace, 'proof.txt') },
    'r1',
  );
  if (arm === 'head') {
    check(
      'B5-glob-executes-relative',
      glob.status === 200 &&
        glob.body.includes('src/alpha.md') &&
        glob.body.includes('AGENTS.md') &&
        !glob.body.includes(workspace),
      { status: glob.status, body: glob.body.slice(0, 400) },
    );
    check(
      'B5c-read-file-control',
      read.status === 200 && read.body.includes('proof-content-marker'),
      { status: read.status, body: read.body.slice(0, 300) },
    );
    // The hosted tool turn validates glob args before dispatch; the worker is
    // the second gate: a traversal path must not execute.
    const traversal = await exec(
      'glob',
      { pattern: '**/*', path: '..' },
      'g2',
    );
    check(
      'B5b-glob-traversal-refused',
      !(
        traversal.status === 200 &&
        traversal.body.includes('"executionStatus":"success"')
      ),
      { status: traversal.status, body: traversal.body.slice(0, 300) },
    );
  } else {
    check(
      'B5-base-glob-absent',
      !(
        glob.status === 200 &&
        glob.body.includes('"executionStatus":"success"')
      ),
      { status: glob.status, body: glob.body.slice(0, 200) },
    );
    check(
      'B5c-base-read-file-control',
      read.status === 200 && read.body.includes('proof-content-marker'),
      { status: read.status, body: read.body.slice(0, 200) },
    );
  }
  // B7: symlinked workspace root (every macOS /var tmpdir). The boot v1
  // workspaceCwd stays unresolved, as a mount would hand it over.
  const linkView = path.join(os.tmpdir(), `pr13168-link-${process.pid}`);
  fs.rmSync(linkView, { force: true });
  fs.symlinkSync(workspace, linkView);
  const worker2 = await startManagedRuntimeAttestationWorker({
    ...boot,
    workspaceCwd: linkView,
  });
  const url2 = (worker2.ready as { url: string }).url;
  const exec2 = async (toolName: string, input: Record<string, unknown>) => {
    const response = await fetch(`${url2}/internal/managed-runtime/v2/execute`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer worker-token',
        'Cache-Control': 'no-store',
        'Content-Type': 'application/json',
        'X-Qwen-Managed-Lease-Id': 'lease-1',
        'X-Qwen-Managed-Lease-Epoch': '1',
      },
      body: JSON.stringify({
        protocolVersion: 2,
        reference: {
          sessionId: 'rs-linkroot',
          promptId: 'rs-linkroot',
          callId: 'c1',
          argsDigest: `sha256:${'0'.repeat(64)}`,
        },
        toolName,
        input,
      }),
    });
    return { status: response.status, body: await response.text() };
  };
  const linkRead = await exec2('read_file', {
    file_path: path.join(workspace, 'proof.txt'),
  });
  check(
    'B7-read-under-symlinked-root',
    linkRead.body.includes('proof-content-marker'),
    { status: linkRead.status, body: linkRead.body.slice(0, 300) },
  );
  // The context read on the same root: symlinked workspaceCwd.
  const ctx2 = await fetch(`${url2}/internal/managed-runtime/provider/v1/control`, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer worker-token',
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json',
      'X-Qwen-Managed-Lease-Id': 'lease-1',
      'X-Qwen-Managed-Lease-Epoch': '1',
    },
    body: JSON.stringify({
      protocolVersion: 1,
      providerProtocol: 'managed-runtime-provider/1',
      session: {
        harnessSessionId: 'harness-1',
        runtimeSessionId: 'rs-linkroot',
        turnKind: 'bootstrap',
      },
      operation: { kind: 'workspace-context' },
    }),
  });
  const ctx2Body = await ctx2.text();
  if (arm === 'head') {
    check(
      'B7b-context-under-symlinked-root',
      ctx2Body.includes('VERIFY-QWEN-MARKER'),
      { status: ctx2.status, body: ctx2Body.slice(0, 300) },
    );
  } else {
    check('B7b-base-op-unknown', ctx2.status === 501, { status: ctx2.status });
  }
  await worker2.close();
  fs.rmSync(linkView, { force: true });
} finally {
  await worker.close();
  fs.rmSync(workspace, { recursive: true, force: true });
}

const passed = results.filter((r) => r.pass).length;
const failed = results.filter((r) => !r.pass).length;
fs.writeFileSync(
  outJson,
  JSON.stringify({ arm, pass: passed, fail: failed, results }, null, 2),
);
console.log(`TOTAL arm=${arm} pass=${passed} fail=${failed}`);
process.exitCode = failed === 0 ? 0 : 1;
