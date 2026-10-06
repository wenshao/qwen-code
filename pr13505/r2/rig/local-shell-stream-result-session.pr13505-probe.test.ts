/**
 * @license
 * Copyright 2026 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { LocalManagedSessionAuthority } from './managed-session-authority.js';
import { LocalManagedSessionResourceStore } from './managed-session-resources.js';
import { LocalToolResultSegmentStore } from './local-managed-tool-result-store.js';
import { LocalShellStreamResultSession } from './local-shell-stream-result-session.js';

// Both domains stay disabled for submission on main; this suite admits
// captures ahead of the H3 enablement flip, like the sibling suites do.
const enablement = vi.hoisted(() => ({ childRun: true, monitorRun: true }));

vi.mock('./managed-session-records.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('./managed-session-records.js')>();
  return {
    ...actual,
    assertManagedSessionDomainEnabled: (
      domain: Parameters<typeof actual.assertManagedSessionDomainEnabled>[0],
    ) => {
      if (domain === 'child_run' && enablement.childRun) return;
      if (domain === 'monitor_run' && enablement.monitorRun) return;
      actual.assertManagedSessionDomainEnabled(domain);
    },
  };
});

const roots = new Set<string>();

afterAll(async () => {
  for (const root of roots) await fs.rm(root, { recursive: true, force: true });
  roots.clear();
});

const sessionKey = {
  tenantId: 'tenant-1',
  workspaceId: 'workspace-1',
  sessionId: '550e8400-e29b-41d4-a716-446655440000',
};

function publish(
  store: LocalManagedSessionResourceStore,
  kind: string,
  body: string,
) {
  return store.publish(kind, Buffer.from(body, 'utf8'));
}

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'qwen-stream-session-'));
  roots.add(root);
  const runtimeBaseDir = path.join(root, 'runtime');
  const transcriptPath = path.join(root, 'chats', 'session.jsonl');
  await fs.mkdir(path.dirname(transcriptPath), { recursive: true });
  const lease = await LocalManagedSessionAuthority.acquireWriter({
    runtimeBaseDir,
    sessionId: sessionKey.sessionId,
    transcriptPath,
  });
  const store = LocalManagedSessionResourceStore.create({
    runtimeBaseDir,
    sessionKey,
  });
  const { openManagedSession } = await import('./managed-session-assembly.js');
  const session = await openManagedSession({
    runtimeBaseDir,
    sessionId: sessionKey.sessionId,
    transcriptPath,
    sessionKey,
    cwd: root,
    version: 'test',
    workerId: 'worker-a',
    activationLeaseDurationMs: 60_000,
    lease,
    create: {
      definitionRef: await publish(store, 'managed-definition', '{}'),
      rootSnapshotRef: await publish(store, 'managed-root', '{}'),
      createdBy: 'test',
    },
  });
  const segments = await LocalToolResultSegmentStore.openWritable({
    lease,
    sessionKey,
  });
  const { createManagedHarnessHandle } = await import(
    './managed-harness-factory.js'
  );
  await createManagedHarnessHandle(session).ensureRunnable();
  return { session, sessionResources: store, segments, lease };
}

const TRUSTED = { class: 'trusted_entry' } as const;

function command(commandId: string, digest = 'd') {
  return {
    operation: 'commitExtensionRecord',
    commandId,
    sessionKey,
    contentDigest: digest.repeat(64),
  };
}

async function admitChildRun(
  fix: Awaited<ReturnType<typeof fixture>>,
  executionCallId: string,
): Promise<void> {
  const argsRef = await publish(
    fix.sessionResources,
    'managed-tool-args',
    '{"command":"yes"}',
  );
  const authority = fix.session.authority;
  await authority.commitExtensionRecord(
    command(`${executionCallId}:admit`),
    {
      domain: 'child_run',
      record: {
        kind: 'shell',
        shellId: executionCallId,
        ownerScopeId: sessionKey.sessionId,
        commandRef: argsRef,
        startReceiptRef: null,
        stopRequested: false,
        outputRef: null,
        stopReason: null,
        exitCode: null,
        exitSignal: null,
        run: {
          state: 'admitted',
          reason: null,
          definition: null,
          executionCallId,
          effectId: null,
          dispatchId: null,
          deliveryId: null,
          execution: 'intent',
          runtime: null,
          delivery: null,
        },
      },
    },
    TRUSTED,
  );
  await authority.commitExtensionRecord(
    command(`${executionCallId}:admit:2`),
    {
      domain: 'child_run',
      record: {
        kind: 'shell',
        shellId: executionCallId,
        ownerScopeId: sessionKey.sessionId,
        commandRef: argsRef,
        startReceiptRef: null,
        stopRequested: false,
        outputRef: null,
        stopReason: null,
        exitCode: null,
        exitSignal: null,
        run: {
          state: 'running',
          reason: null,
          definition: null,
          executionCallId,
          effectId: null,
          dispatchId: null,
          deliveryId: null,
          execution: 'dispatch_started',
          runtime: { runtimeBindingId: 'binding-1', generation: '1' },
          delivery: null,
        },
      },
    },
    TRUSTED,
  );
}

function captureBody(executionCallId: string) {
  return {
    tenantId: sessionKey.tenantId,
    sessionId: sessionKey.sessionId,
    turnId: 'turn',
    executionCallId,
    bindingGeneration: '1',
    capturePolicy: 'complete_required' as const,
    background: true,
  };
}

function requestFor(executionCallId: string) {
  return {
    reference: {
      sessionId: 'runtime-a',
      promptId: 'prompt',
      callId: 'worker-call',
      argsDigest: `sha256:${'a'.repeat(64)}`,
    },
    capture: captureBody(executionCallId),
  };
}


// VERIFICATION RIG ONLY (PR #13505 round 2): a child_agent record must not be
// admitted as a Background Shell's proven start.
describe('PR13505 probe: Background Shell capture vs a child_agent record', () => {
  it('refuses a child_agent child_run as a Background Shell start', async () => {
    const fix = await fixture();
    const inputRef = await publish(fix.sessionResources, 'managed-input', '{"prompt":"x"}');
    const authority = fix.session.authority;
    const body = (run: Record<string, unknown>) => ({
      kind: 'child_agent', childRunId: 'agent-1', ownerScopeId: sessionKey.sessionId,
      rootSessionId: sessionKey.sessionId, depth: 1, completion: 'sent', inputRef,
      workspaceMode: 'shared', workingDirectory: '.', childSessionId: null,
      predecessorChildRunId: null, resultVersion: 1, resultRef: null, terminalReceiptRef: null,
      stopReason: null, stopRequested: false,
      run: { state: 'admitted', reason: null, definition: null, executionCallId: 'agent-1',
        effectId: null, dispatchId: null, deliveryId: null, execution: 'intent', runtime: null,
        delivery: { target: 'session', state: 'planned' }, ...run },
    });
    await authority.commitExtensionRecord(command('agent-1:1'), { domain: 'child_run', record: body({}) }, TRUSTED);
    await authority.commitExtensionRecord(command('agent-1:2'), { domain: 'child_run', record: body({
      state: 'running', execution: 'dispatch_started', dispatchId: 'dispatch-1',
      runtime: { runtimeBindingId: 'binding-1', generation: '1' } }) }, TRUSTED);
    const admission = new LocalShellStreamResultSession(fix.session, fix.segments, '1', async () => {}, 'runtime-a');
    let outcome: string;
    try {
      const prepared = await admission.prepare(requestFor('agent-1'));
      outcome = `ADMITTED identity.executionCallId=${prepared.identity.executionCallId} captureId=${prepared.identity.captureId}`;
    } catch (error) {
      outcome = `REFUSED ${(error as Error).message}`;
    }
    (await import('node:fs')).appendFileSync('/Users/wenshao/git/pr13505-rig/results/f3-probe.tsv', `${process.env.PROBE_ARM ?? '?'}\t${outcome}\n`);
    await fix.segments.close();
    await fix.session.close();
    expect(outcome.startsWith('REFUSED')).toBe(true);
  });
});
