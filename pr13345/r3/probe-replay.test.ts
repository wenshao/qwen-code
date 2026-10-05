import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { openManagedSession } from './managed-session-assembly.js';
import { LocalManagedSessionResourceStore } from './managed-session-resources.js';

describe('probe: domain record retry with expectedSequence', () => {
  it('replays a committed command that carried expectedSequence', async () => {
    const runtimeBaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'r3-probe-'));
    const sessionId = 'probe-session';
    const sessionKey = { tenantId: 't', workspaceId: 'w', sessionId };
    const resourceStore = LocalManagedSessionResourceStore.create({ runtimeBaseDir, sessionKey });
    const session = await openManagedSession({
      runtimeBaseDir,
      sessionId,
      transcriptPath: path.join(runtimeBaseDir, 'session.jsonl'),
      sessionKey,
      cwd: '/w',
      version: 'probe',
      workerId: 'probe',
      activationLeaseDurationMs: 60_000,
      resourceStore,
      create: {
        definitionRef: await resourceStore.publish('managed-session-definition', Buffer.from('{}')),
        rootSnapshotRef: await resourceStore.publish('managed-session-root-snapshot', Buffer.from('{}')),
        createdBy: 'probe',
      },
    });
    const authority = session.authority;
    const command = {
      operation: 'setGoal',
      commandId: 'goal:once',
      sessionKey,
      contentDigest: 'd'.repeat(64),
      expectedSequence: authority.committedSequence,
    };
    const request = { domain: 'goal_state' as const, content: { goalId: 'g', title: 't' } };
    const first = await authority.commitDomainRecord(command, request, { class: 'trusted_entry' });
    expect(first.receipt.replayed).toBeFalsy();
    const retry = await authority.commitDomainRecord(command, request, { class: 'trusted_entry' });
    expect(retry.receipt.replayed).toBe(true);
    await session.close();
  });
});
