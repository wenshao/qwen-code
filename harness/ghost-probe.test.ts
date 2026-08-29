/**
 * @license
 * Copyright 2026 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * INDEPENDENT verification probe for PR #10223 / issue #10208.
 *
 * Deliberately avoids every piece of the PR's own scaffolding:
 *  - no vi.mock of ../../config/storage.js  (uses the real QWEN_HOME env knob)
 *  - no vi.spyOn(teamHelpers, 'writeTeamFile')
 *  - no monkeypatching of backend.spawnAgent
 *
 * The failed spawn is produced through the PRODUCTION failure path:
 * spawnAgent() resolves but the agent reaches a terminal status, which
 * TeamManager itself turns into `Teammate "X" failed to start: ...`.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { TeamManager } from './TeamManager.js';
import { FakeBackend } from './test-utils/fake-backend.js';
import type { FakeAgent } from './test-utils/fake-agent.js';
import { AgentStatus } from '../runtime/agent-types.js';
import { formatAgentId } from './teamHelpers.js';
import type { TeamFile } from './types.js';

const TEAM = 'probe-team';

let tmpDir: string;
let backend: FakeBackend;
let manager: TeamManager;
let liveTeamFile: TeamFile;
let prevQwenHome: string | undefined;

async function readConfigRaw(): Promise<string> {
  return fs.readFile(
    path.join(tmpDir, 'teams', TEAM, 'config.json'),
    'utf-8',
  );
}
async function readConfig(): Promise<TeamFile> {
  return JSON.parse(await readConfigRaw()) as TeamFile;
}
async function names(): Promise<string[]> {
  return (await readConfig()).members.map((m) => m.name);
}
function memNames(): string[] {
  return liveTeamFile.members.map((m) => m.name);
}

/** Script that hangs in start() until released, then optionally fails. */
function gatedScript(gate: Promise<'ok' | 'fail'>) {
  return {
    onStart: async (agent: FakeAgent) => {
      const outcome = await gate;
      if (outcome === 'fail') {
        agent.setError('backend refused to start the teammate');
        agent.setStatus(AgentStatus.FAILED);
      }
    },
  };
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

async function waitFor(fn: () => Promise<boolean>, ms = 3000): Promise<void> {
  const t0 = Date.now();
  for (;;) {
    if (await fn()) return;
    if (Date.now() - t0 > ms) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 5));
  }
}

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ghost-probe-'));
  prevQwenHome = process.env['QWEN_HOME'];
  process.env['QWEN_HOME'] = tmpDir;

  const teamDir = path.join(tmpDir, 'teams', TEAM);
  await fs.mkdir(path.join(teamDir, 'inboxes'), { recursive: true });
  await fs.mkdir(path.join(tmpDir, 'tasks', TEAM), { recursive: true });

  liveTeamFile = {
    name: TEAM,
    createdAt: Date.now(),
    leadAgentId: formatAgentId('leader', TEAM),
    members: [],
  };
  await fs.writeFile(
    path.join(teamDir, 'config.json'),
    JSON.stringify(liveTeamFile, null, 2) + '\n',
    'utf-8',
  );

  backend = new FakeBackend();
  await backend.init();
  manager = new TeamManager(backend, liveTeamFile);
});

afterEach(async () => {
  await backend.cleanup();
  if (prevQwenHome === undefined) delete process.env['QWEN_HOME'];
  else process.env['QWEN_HOME'] = prevQwenHome;
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('PROBE #10208 (independent, production failure path)', () => {
  it('P1: disk roster matches memory after A succeeds and B fails', async () => {
    const gateB = deferred<'ok' | 'fail'>();
    backend.setScript(formatAgentId('beta', TEAM), gatedScript(gateB.promise));

    const spawnA = manager.spawnTeammate({ name: 'alpha', cwd: tmpDir });
    const spawnB = manager.spawnTeammate({ name: 'beta', cwd: tmpDir });

    await spawnA;
    // Alpha's success write has landed and, per #10208, already
    // serialized still-pending beta.
    expect(await names()).toEqual(['alpha', 'beta']);

    gateB.resolve('fail');
    await expect(spawnB).rejects.toThrow(/failed to start/);

    expect(memNames()).toEqual(['alpha']);
    expect(await names()).toEqual(['alpha']); // <-- the fix
  });

  it('P2: a later reader of config.json sees no member without a backend handle', async () => {
    const gateB = deferred<'ok' | 'fail'>();
    backend.setScript(formatAgentId('beta', TEAM), gatedScript(gateB.promise));

    const spawnA = manager.spawnTeammate({ name: 'alpha', cwd: tmpDir });
    const spawnB = manager.spawnTeammate({ name: 'beta', cwd: tmpDir });
    await spawnA;
    gateB.resolve('fail');
    await expect(spawnB).rejects.toThrow(/failed to start/);

    // Simulate a fresh session / peer-discovery reader.
    const persisted = await readConfig();
    const live = backend.getAgent(formatAgentId('beta', TEAM));
    const liveStatus = live?.getStatus();
    const discoverable = persisted.members.map((m) => m.name);

    // Every persisted member must have a usable backend handle.
    for (const m of persisted.members) {
      const a = backend.getAgent(m.agentId);
      expect(
        a && a.getStatus() !== AgentStatus.FAILED,
        `persisted member ${m.name} has no usable agent (status=${a?.getStatus()})`,
      ).toBeTruthy();
    }
    expect(discoverable).not.toContain('beta');
    // capacity accounting
    expect(persisted.members.length).toBe(1);
    expect(liveStatus === undefined || liveStatus === AgentStatus.FAILED).toBe(
      true,
    );
  });

  it('P3: the success-path file content is unchanged (cross-arm byte oracle)', async () => {
    await manager.spawnTeammate({ name: 'solo', cwd: '/fixed/cwd' });
    const raw = await readConfigRaw();
    const normalized = raw
      .replace(/"createdAt": \d+/g, '"createdAt": <T>')
      .replace(/"joinedAt": \d+/g, '"joinedAt": <T>');
    await fs.writeFile(
      path.join(os.tmpdir(), `ghost-probe-p3-${process.env['ARM'] ?? 'x'}.json`),
      normalized,
      'utf-8',
    );
    expect(normalized).toContain('"solo"');
  });

  it('P4: residual — a third still-pending sibling during the compensating write', async () => {
    const gateB = deferred<'ok' | 'fail'>();
    const gateC = deferred<'ok' | 'fail'>();
    backend.setScript(formatAgentId('beta', TEAM), gatedScript(gateB.promise));
    backend.setScript(formatAgentId('gamma', TEAM), gatedScript(gateC.promise));

    const spawnA = manager.spawnTeammate({ name: 'alpha', cwd: tmpDir });
    const spawnB = manager.spawnTeammate({ name: 'beta', cwd: tmpDir });
    const spawnC = manager.spawnTeammate({ name: 'gamma', cwd: tmpDir });
    await spawnA;

    gateB.resolve('fail');
    await expect(spawnB).rejects.toThrow(/failed to start/);

    // gamma is STILL pending here. What did the compensating write persist?
    const afterCompensate = await names();
    // eslint-disable-next-line no-console
    console.log('P4 disk after compensating write:', afterCompensate);

    gateC.resolve('fail');
    await expect(spawnC).rejects.toThrow(/failed to start/);
    const afterGamma = await names();
    // eslint-disable-next-line no-console
    console.log('P4 disk after gamma also fails:', afterGamma);

    expect(memNames()).toEqual(['alpha']);
    expect(afterGamma).toEqual(['alpha']);
  });

  it('P5: write queue stays healthy across many spawns incl. a failure', async () => {
    const gateX = deferred<'ok' | 'fail'>();
    backend.setScript(formatAgentId('bad', TEAM), gatedScript(gateX.promise));

    await manager.spawnTeammate({ name: 'm1', cwd: tmpDir });
    const bad = manager.spawnTeammate({ name: 'bad', cwd: tmpDir });
    await waitFor(async () => (await names()).length >= 1);
    gateX.resolve('fail');
    await expect(bad).rejects.toThrow(/failed to start/);
    await manager.spawnTeammate({ name: 'm2', cwd: tmpDir });
    await manager.spawnTeammate({ name: 'm3', cwd: tmpDir });

    expect(memNames()).toEqual(['m1', 'm2', 'm3']);
    expect(await names()).toEqual(['m1', 'm2', 'm3']);
  });

  it('P6: the original spawn error is the rejection reason', async () => {
    const gateB = deferred<'ok' | 'fail'>();
    backend.setScript(formatAgentId('beta', TEAM), gatedScript(gateB.promise));
    const spawnA = manager.spawnTeammate({ name: 'alpha', cwd: tmpDir });
    const spawnB = manager.spawnTeammate({ name: 'beta', cwd: tmpDir });
    await spawnA;
    gateB.resolve('fail');
    await expect(spawnB).rejects.toThrow(
      /backend refused to start the teammate/,
    );
  });
});
