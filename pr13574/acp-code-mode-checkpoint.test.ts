/**
 * @license
 * Copyright 2026 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * #13378: a completed ordinary ACP turn whose `exec` script calls a nested
 * tool must still commit a branch checkpoint. The unit suite pins the
 * recorder's subtype; this drives the built CLI so the ACP producer and the
 * checkpoint resolver run together.
 */

import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyContainerSandboxNoProxy,
  fakeServerHostOptions,
  TestRig,
} from '../test-helper.js';
import {
  fakeToolCall,
  startFakeOpenAIServer,
  type FakeOpenAIServer,
} from '../fake-openai-server.js';
import { fakeModelLaunchArgs } from '../helpers/gated-skill-fixture.js';
import { ACP_HOME_PREFIX, removeScratchDir } from '../scratch-dir.js';

type ToolMessage = { role: string; tool_call_id?: string; content?: unknown };
type PromptResult = { stopReason?: string; _meta?: Record<string, unknown> };

describe('ACP Code Mode branch checkpoints', () => {
  let rig: TestRig;
  let fakeServer: FakeOpenAIServer | undefined;
  let restoreNoProxy: (() => void) | undefined;

  afterEach(async () => {
    vi.unstubAllEnvs();
    restoreNoProxy?.();
    restoreNoProxy = undefined;
    await fakeServer?.close();
    fakeServer = undefined;
    await rig?.cleanup();
  });

  it('keeps the checkpoint of a completed turn whose exec ran a nested read', async () => {
    rig = new TestRig();
    await rig.setup('acp code mode checkpoint', {
      settings: { tools: { codeModeOnly: true } },
    });
    rig.createFile('note.txt', 'hello from note\n');
    const notePath = join(rig.testDir!, 'note.txt');

    const server = await startFakeOpenAIServer(({ body }) => {
      if (body['stream'] !== true) return { content: '{}' };
      const messages = (body['messages'] ?? []) as ToolMessage[];
      return messages.some((message) => message.role === 'tool')
        ? { content: 'The note says hello.' }
        : {
            toolCalls: [
              fakeToolCall(
                'exec',
                {
                  source: `const r = await tools.read_file({ file_path: ${JSON.stringify(notePath)} }); text(typeof r === 'string' ? r : String(r.output));`,
                },
                'call_exec',
              ),
            ],
          };
    }, fakeServerHostOptions());
    fakeServer = server;
    vi.stubEnv('OPENAI_API_KEY', 'fake-key');
    vi.stubEnv('OPENAI_BASE_URL', server.baseUrl);
    vi.stubEnv('OPENAI_MODEL', 'fake-model');
    restoreNoProxy = applyContainerSandboxNoProxy();

    // Chat recording stays on: the checkpoint is written to the transcript.
    const qwenHome = mkdtempSync(join(tmpdir(), ACP_HOME_PREFIX));
    const child = spawn(
      'node',
      [
        rig.bundlePath,
        '--acp',
        '--approval-mode',
        'yolo',
        ...fakeModelLaunchArgs(server),
      ],
      {
        cwd: rig.testDir!,
        env: {
          ...process.env,
          QWEN_HOME: qwenHome,
          QWEN_RUNTIME_DIR: qwenHome,
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );
    const closed = new Promise<void>((resolve) =>
      child.once('close', () => resolve()),
    );
    const pending = new Map<
      number,
      { resolve: (value: unknown) => void; reject: (error: Error) => void }
    >();
    let nextId = 0;
    let disposed = false;
    const stderr: string[] = [];
    child.stderr!.on('data', (chunk) => stderr.push(chunk.toString()));
    child.once('close', (code, signal) => {
      if (disposed) return;
      const tail = stderr.join('').trimEnd().slice(-500);
      for (const [id, { reject }] of pending) {
        reject(
          new Error(
            `ACP request ${id} failed: agent exited (code=${code} signal=${signal})` +
              (tail ? `\nlast agent stderr:\n${tail}` : ''),
          ),
        );
      }
      pending.clear();
    });
    createInterface({ input: child.stdout! }).on('line', (line) => {
      let message: { id?: number; method?: string; result?: unknown };
      try {
        message = JSON.parse(line);
      } catch {
        return;
      }
      if (message.id === undefined) return;
      if (message.method === undefined) {
        pending.get(message.id)?.resolve(message.result);
        pending.delete(message.id);
      } else {
        child.stdin!.write(
          JSON.stringify({ jsonrpc: '2.0', id: message.id, result: null }) +
            '\n',
        );
      }
    });
    const request = <T>(method: string, params: unknown) =>
      new Promise<T>((resolve, reject) => {
        const id = ++nextId;
        pending.set(id, { resolve: (value) => resolve(value as T), reject });
        child.stdin!.write(
          JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n',
        );
      });

    let result: PromptResult;
    try {
      await request('initialize', {
        protocolVersion: 1,
        clientCapabilities: {
          fs: { readTextFile: false, writeTextFile: false },
        },
      });
      const session = await request<{ sessionId: string }>('session/new', {
        cwd: rig.testDir!,
        mcpServers: [],
      });
      result = await request<PromptResult>('session/prompt', {
        sessionId: session.sessionId,
        prompt: [{ type: 'text', text: 'read the note through exec' }],
      });
    } finally {
      disposed = true;
      child.kill();
      await closed;
      await removeScratchDir(qwenHome);
    }

    // The nested read really ran and reached the model through exec.
    const followUp = server.requests.find(
      (request) =>
        request.body['stream'] === true &&
        (request.body['messages'] as ToolMessage[]).some(
          (message) => message.role === 'tool',
        ),
    );
    const toolMessage = (
      (followUp?.body['messages'] ?? []) as ToolMessage[]
    ).find((message) => message.tool_call_id === 'call_exec');
    expect(JSON.stringify(toolMessage?.content)).toContain('hello from note');

    expect(result.stopReason).toBe('end_turn');
    expect(result._meta?.['qwen.branchPoint']).toEqual({
      assistantRecordUuid: expect.any(String),
      checkpointUuid: expect.any(String),
    });
  });
});
