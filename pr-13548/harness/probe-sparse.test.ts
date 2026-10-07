/**
 * @license
 * Copyright 2026 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SessionWriterLease } from '../services/session-writer-lease.js';
import { LocalManagedSessionAuthority } from './managed-session-authority.js';
import { LocalManagedSessionResourceStore } from './managed-session-resources.js';
import {
  ManagedSessionRecordError,
  type ManagedSessionDurableRef,
} from './managed-session-records.js';

// channel_route and channel_delivery stay disabled for submission until the
// slices that ship their producers (H5b/H5c); this suite runs the
// commit/rebuild path ahead of enablement, like the child_run suite does
// for the H3 enablement slice.
const enablement = vi.hoisted(() => ({ route: true, delivery: true }));

vi.mock('./managed-session-records.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('./managed-session-records.js')>();
  return {
    ...actual,
    assertManagedSessionDomainEnabled: (
      domain: Parameters<typeof actual.assertManagedSessionDomainEnabled>[0],
    ) => {
      if (domain === 'channel_route' && enablement.route) return;
      if (domain === 'channel_delivery' && enablement.delivery) return;
      actual.assertManagedSessionDomainEnabled(domain);
    },
  };
});

const temporaryDirectories = new Set<string>();

afterEach(async () => {
  enablement.route = true;
  enablement.delivery = true;
  for (const directory of temporaryDirectories) {
    await fs.rm(directory, { recursive: true, force: true });
  }
  temporaryDirectories.clear();
});

const sessionId = '550e8400-e29b-41d4-a716-446655440000';
const sessionKey = {
  tenantId: 'tenant-1',
  workspaceId: 'workspace-1',
  sessionId,
};

interface Harness {
  readonly runtimeBaseDir: string;
  readonly transcriptPath: string;
  readonly store: LocalManagedSessionResourceStore;
  now: number;
}

async function createHarness(): Promise<Harness> {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), 'qwen-managed-channel-'),
  );
  temporaryDirectories.add(root);
  const runtimeBaseDir = path.join(root, 'runtime');
  const transcriptPath = path.join(root, 'chats', `${sessionId}.jsonl`);
  await fs.mkdir(runtimeBaseDir, { recursive: true });
  await fs.mkdir(path.dirname(transcriptPath), { recursive: true });
  return {
    runtimeBaseDir,
    transcriptPath,
    store: LocalManagedSessionResourceStore.create({
      runtimeBaseDir,
      sessionKey,
    }),
    now: 1_000,
  };
}

async function withAuthority<T>(
  harness: Harness,
  run: (authority: LocalManagedSessionAuthority) => Promise<T>,
  options: { create?: boolean } = {},
): Promise<T> {
  const lease = await SessionWriterLease.acquire({
    runtimeBaseDir: harness.runtimeBaseDir,
    sessionId,
    transcriptPath: harness.transcriptPath,
  });
  try {
    const create =
      options.create === false
        ? undefined
        : {
            definitionRef: await harness.store.publish(
              'managed-definition',
              Buffer.from('{}', 'utf8'),
            ),
            rootSnapshotRef: await harness.store.publish(
              'managed-root',
              Buffer.from('{}', 'utf8'),
            ),
            createdBy: 'daemon',
          };
    const authority = await LocalManagedSessionAuthority.open({
      lease,
      sessionKey,
      now: () => harness.now,
      resources: harness.store,
      cwd: '/workspace',
      version: 'test',
      ...(create === undefined ? {} : { create }),
    });
    return await run(authority);
  } finally {
    await lease.release().catch(() => undefined);
  }
}

interface ChannelRefs {
  readonly policy: ManagedSessionDurableRef;
  readonly result: ManagedSessionDurableRef;
  readonly seg1: ManagedSessionDurableRef;
  readonly seg2: ManagedSessionDurableRef;
  readonly proof: ManagedSessionDurableRef;
}

// The writer-side closure reads every reference a body names, so the test
// publishes real content and builds records from the returned refs.
async function publishRefs(harness: Harness): Promise<ChannelRefs> {
  return {
    policy: await harness.store.publish(
      'channel-policy',
      Buffer.from('{"allowed":["sender-1"]}', 'utf8'),
    ),
    result: await harness.store.publish(
      'managed-tool-result',
      Buffer.from('{"text":"ok"}', 'utf8'),
    ),
    seg1: await harness.store.publish(
      'channel-delivery-segment',
      Buffer.from('part one', 'utf8'),
    ),
    seg2: await harness.store.publish(
      'channel-delivery-segment',
      Buffer.from('part two', 'utf8'),
    ),
    proof: await harness.store.publish(
      'channel-delivery-receipt',
      Buffer.from('{"250":"ok"}', 'utf8'),
    ),
  };
}

const RECEIPT_1 = {
  providerMessageId: 'provider-msg-1',
  acceptedAt: 1_750_000_000_000,
  proofRef: null,
};

function route(
  refs: ChannelRefs,
  overrides: Record<string, unknown> = {},
  runOverrides: Record<string, unknown> = {},
) {
  return {
    routeId: 'route-1',
    channelInstanceId: 'instance-1',
    accountId: 'account-1',
    accountGeneration: 7,
    routeRevision: 3,
    rootSessionId: sessionId,
    sessionId,
    scope: {
      kind: 'user',
      senderId: 'sender-1',
      chatId: 'chat-1',
      threadId: null,
    },
    policyRef: refs.policy,
    run: {
      state: 'admitted',
      reason: null,
      definition: null,
      executionCallId: null,
      effectId: 'route-1',
      dispatchId: null,
      deliveryId: null,
      execution: null,
      runtime: null,
      delivery: null,
      ...runOverrides,
    },
    ...overrides,
  };
}

function delivery(
  refs: ChannelRefs,
  receipts: ReadonlyArray<object | null>,
  runState: string,
  lineState: string,
  overrides: Record<string, unknown> = {},
  runOverrides: Record<string, unknown> = {},
) {
  return {
    deliveryId: 'delivery-1',
    routeId: 'route-1',
    routeRevision: 3,
    sourceTurnId: 'turn-1',
    contentRef: refs.result,
    segments: [refs.seg1, refs.seg2].map((contentRef, index) => ({
      segmentId: `seg-${index + 1}`,
      ordinal: index,
      contentRef,
      receipt: receipts[index] ?? null,
    })),
    cancelRequested: false,
    run: {
      state: runState,
      reason: null,
      definition: null,
      executionCallId: null,
      effectId: 'delivery-1',
      dispatchId: null,
      deliveryId: 'delivery-1',
      execution: null,
      runtime: null,
      delivery: { target: 'channel', state: lineState },
      ...runOverrides,
    },
    ...overrides,
  };
}

function command(
  domain: 'channel_route' | 'channel_delivery',
  commandId: string,
) {
  return {
    operation:
      domain === 'channel_route'
        ? 'commitChannelRoute'
        : 'commitChannelDelivery',
    commandId,
    sessionKey,
    contentDigest: 'd'.repeat(64),
  };
}

const TRUSTED = { class: 'trusted_entry' } as const;

// Maintainer probe (PR #13548, review R1-2): a sparse segment plan through
// the real Session authority, then a reopen of the journal it wrote.
describe('probe: sparse segments through the authority', () => {
  it('commits a holey plan and reopens', async () => {
    const harness = await createHarness();
    const refs = await publishRefs(harness);
    const log: string[] = [];
    const record = delivery(refs, [null, null], 'admitted', 'planned');
    const holey = [record.segments[0]];
    holey.length = 2; // index 1 is a hole, not undefined
    (record as { segments: unknown[] }).segments = holey;
    log.push(`in-memory plan: length=${holey.length}, 1 in holey=${1 in holey}, JSON=${JSON.stringify(holey.map((s) => (s as { segmentId: string }).segmentId))}`);
    await withAuthority(harness, async (authority) => {
      try {
        const r = await authority.commitExtensionRecord(command('channel_delivery', 'sparse-1'), { domain: 'channel_delivery', record }, TRUSTED);
        log.push(`commit: ACCEPTED revision ${r.revision}, committedSequence ${authority.committedSequence}`);
      } catch (e) {
        log.push(`commit: REFUSED ${(e as Error).constructor.name}: ${(e as Error).message}`);
      }
    });
    const journal = await fs.readFile(harness.transcriptPath, 'utf8').catch(() => '');
    const resources = await fs.readdir(harness.runtimeBaseDir, { recursive: true }).catch(() => [] as string[]);
    log.push(`journal bytes=${journal.length}; resource files=${resources.length}`);
    try {
      await withAuthority(harness, async (authority) => {
        const rebuilt = authority.extensionRecord('channel_delivery', 'delivery-1');
        log.push(`reopen: OK, revision ${rebuilt?.revision}`);
      }, { create: false });
    } catch (e) {
      log.push(`reopen: FAILED ${(e as Error).constructor.name}: ${(e as Error).message.slice(0, 200)}`);
    }
    console.log(log.join('\n'));
  });
});
