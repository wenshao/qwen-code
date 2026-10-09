/**
 * PR #13243 R4-3 probe (not a product test). Drives the real ManagedHookRuntime
 * — real manifest validation, real dispatch, real node:url — with function
 * Hook modulePaths that pass the platform's isAbsolute check, and reports the
 * receipt, hasHolds before and after the module-evaluation budget, and whether
 * close() resolves. Emits PROBE_JSON lines; asserts nothing about the outcome.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { HookEventName } from '@qwen-code/qwen-code-core/hooks/types.js';
import type {
  ManagedHookExecute,
  ManagedHookOperationView,
} from '@qwen-code/qwen-code-core/managed-runtime/managed-hook-protocol.js';
import {
  ManagedHookRuntime,
  type ManagedHookDefinition,
} from './managed-hook-runtime.js';

const ARM = process.env['PROBE_ARM'] ?? 'unknown';
const key = { tenantId: 'tenant', workspaceId: 'workspace', sessionId: 'session' };
const pin = { catalogId: 'hooks', catalogRevision: 1, definitionDigest: 'a'.repeat(64) };
let directory: string;

function emit(fields: Record<string, unknown>): void {
  console.log('PROBE_JSON ' + JSON.stringify({ probe: 'r43-runtime', arm: ARM, platform: process.platform, ...fields }));
}

function definition(modulePath: string): ManagedHookDefinition {
  return {
    hookId: 'one',
    eventName: HookEventName.PreToolUse,
    sequential: false,
    onceKey: null,
    failClosed: true,
    async: false,
    config: { type: 'function', timeout: 10 },
    handler: { handlerId: 'probe', handlerRevision: 1, modulePath, exportName: 'registered' },
  } as unknown as ManagedHookDefinition;
}

function request(id: string): ManagedHookExecute {
  return {
    kind: 'hook-execute',
    pin,
    sessionKey: key,
    operationId: id,
    hookId: 'one',
    input: {
      session_id: key.sessionId,
      cwd: '/not-the-workspace',
      transcript_path: '',
      hook_event_name: HookEventName.PreToolUse,
      timestamp: new Date().toISOString(),
    },
    grant: {
      sessionKey: key,
      operationId: id,
      domain: 'hook_execution',
      operationRevision: 1,
      ownerId: 'harness',
      workspaceGeneration: '1',
      resourceScope: {
        recordRef: {
          resourceId: 'record',
          kind: 'managed-hook_execution',
          schemaVersion: 1,
          byteLength: 1,
          digest: 'b'.repeat(64),
        },
        phases: ['execute'],
      },
      leaseDurationMs: 300_000,
      expiresAt: Date.now() + 300_000,
    },
  } as unknown as ManagedHookExecute;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitSettled(instance: ManagedHookRuntime, id: string) {
  const deadline = Date.now() + 8000;
  let view: ManagedHookOperationView | undefined;
  while (Date.now() < deadline) {
    view = await instance.control('runtime-session', {
      kind: 'hook-status',
      sessionKey: key,
      operationId: `lookup-${Date.now()}`,
      targetOperationId: id,
    });
    if (view.state !== 'running') return view;
    await sleep(20);
  }
  return view;
}

async function probe(name: string, modulePath: string): Promise<void> {
  let instance: ManagedHookRuntime;
  try {
    instance = new ManagedHookRuntime(
      { ...key, workspaceGeneration: '1' },
      async (id) => (id === 'runtime-session' ? directory : undefined),
      {
        version: 1,
        catalogs: [{ ...pin, tenantId: key.tenantId, workspaceId: key.workspaceId, hooks: [definition(modulePath)] }],
      } as never,
    );
  } catch (error) {
    emit({ name, modulePath, validation: 'rejected', code: (error as { code?: string }).code ?? String(error) });
    return;
  }
  const rejections: string[] = [];
  const onRejection = (reason: unknown) => rejections.push(String((reason as Error)?.message ?? reason).slice(0, 120));
  process.on('unhandledRejection', onRejection);
  try {
    const startedAt = Date.now();
    await instance.control('runtime-session', request(`execute-${name}`));
    const receipt = await waitSettled(instance, `execute-${name}`);
    const settledMs = Date.now() - startedAt;
    const holdsAtSettle = instance.hasHolds('runtime-session');
    // Past max(timeout, 500 ms) the evaluation timer has fired on every arm.
    await sleep(1500);
    const holdsAfterBudget = instance.hasHolds('runtime-session');
    await sleep(3000);
    const holdsAfter4500ms = instance.hasHolds('runtime-session');
    const closeStart = Date.now();
    const closed = await Promise.race([
      instance.close().then(() => 'resolved'),
      sleep(5000).then(() => 'hung-5s'),
    ]);
    emit({
      name,
      modulePath,
      validation: 'accepted',
      receiptState: receipt?.state,
      receiptError: receipt?.error?.code ?? null,
      receiptResult: receipt?.result ?? null,
      settledMs,
      holdsAtSettle,
      holdsAfterBudget,
      holdsAfter4500ms,
      close: closed,
      closeMs: Date.now() - closeStart,
      unhandledRejections: rejections,
    });
  } finally {
    process.removeListener('unhandledRejection', onRejection);
  }
}

describe(`R4-3 probe (${ARM})`, () => {
  beforeAll(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'r43-probe-'));
    await writeFile(
      path.join(directory, 'ok.mjs'),
      'export const registered = { handlerRevision: 1, callback: async () => ({ continue: true }) };\n',
    );
  });
  afterAll(async () => {
    await rm(directory, { recursive: true, force: true });
  });
  it('control: a real module file', async () => {
    await probe('control-real-module', path.join(directory, 'ok.mjs'));
  }, 30_000);
  for (const [name, modulePath] of [
    ['unc-host', '\\\\host'],
    ['unc-empty-server', '\\\\\\\\'],
    ['unc-long-empty', '\\\\?\\UNC\\'],
    ['unc-long-host', '\\\\?\\UNC\\host'],
    ['unc-host-trailing-sep', '\\\\host\\'],
    ['posix-missing-file', '/no/such/dir/h.mjs'],
  ] as const) {
    it(name, async () => {
      await probe(name, modulePath);
    }, 30_000);
  }
});
