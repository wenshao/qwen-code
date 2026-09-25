/**
 * @license
 * Copyright 2025 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

// Regression pins for the R3-7 / R3-3 / R3-10 fixes (PR #12492 verification).
import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { freezeRequest } from './batch-docs.js';
import { batchHomeDir } from './batch-task.js';
import { runPlan, collectTask, type WorkflowApi } from './batch-workflow.js';
import type { BatchJob } from './batch.js';

describe('R3-7: reasoning:false beats a preset extra_body.enable_thinking:true', () => {
  it('disables thinking the way realtime does', () => {
    const cfg = { extra_body: { enable_thinking: true }, reasoning: false as const };
    expect(freezeRequest(cfg, 'qwen3.6-plus').params['enable_thinking']).toBe(false);
    const tiered = freezeRequest(cfg, 'qwen3.8-max').params;
    expect(tiered['reasoning_effort']).toBe('none');
    expect(tiered).not.toHaveProperty('enable_thinking');
  });
});

describe('R3-3: empty QWEN_BATCH_HOME', () => {
  it('falls back to the default home instead of the current directory', () => {
    const dflt = batchHomeDir({});
    expect(batchHomeDir({ QWEN_BATCH_HOME: '' })).toBe(dflt);
    expect(batchHomeDir({ QWEN_BATCH_HOME: '   ' })).toBe(dflt);
    expect(path.isAbsolute(batchHomeDir({ QWEN_BATCH_HOME: '' }))).toBe(true);
  });
});

describe('R3-10: collect --wait survives a transient poll failure', () => {
  const dirs: string[] = [];
  afterEach(() => dirs.splice(0).forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

  const setup = () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'r3-10-project-'));
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'r3-10-home-'));
    dirs.push(root, home);
    fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(root, 'docs', 'a.md'), '# A\n');
    fs.writeFileSync(
      path.join(root, 'plan.json'),
      JSON.stringify({
        version: 1,
        name: 'r3-10',
        kind: 'document-transform',
        shared: { instructions: 'x' },
        items: [{ id: 'a', source: 'docs/a.md', target: 'out/a.md' }],
      }),
    );
    let polls = 0;
    const job: BatchJob = { id: 'batch-1', status: 'in_progress', created_at: 1 };
    const out = JSON.stringify({
      custom_id: 'a#1',
      response: { status_code: 200, body: { choices: [{ finish_reason: 'stop', message: { content: 'A!' } }] } },
    });
    const transient = (status: number) =>
      Object.assign(new Error(`GET /batches/batch-1 -> HTTP ${status}`), { status });
    const api = (failWith: number): WorkflowApi => ({
      uploadJsonl: async () => ({ id: 'file-in' }),
      createBatch: async () => job,
      getBatch: async () => {
        polls += 1;
        if (polls === 2) throw transient(failWith);
        if (polls >= 3) {
          Object.assign(job, {
            status: 'completed',
            output_file_id: 'file-out',
            request_counts: { total: 1, completed: 1, failed: 0 },
          });
        }
        return { ...job };
      },
      listBatches: async () => [job],
      downloadFile: async (_ep, _id, target) => fs.writeFileSync(target, out + '\n'),
      deleteFile: async () => undefined,
      cancelBatch: async () => job,
      probe: async () => undefined,
    });
    const deps = (failWith: number) => ({
      ep: { apiKey: 'k', baseUrl: 'http://127.0.0.1:9/v1', model: 'qwen-plus' },
      cwd: root,
      env: { QWEN_BATCH_HOME: home },
      out: () => {},
      err: () => {},
      api: api(failWith),
      sleep: async () => {},
    });
    return { root, deps };
  };

  for (const status of [503, 429]) {
    it(`keeps polling after one HTTP ${status}`, async () => {
      const { root, deps } = setup();
      const lines: string[] = [];
      const d = { ...deps(status), out: (l: string) => lines.push(l) };
      await runPlan(d, 'plan.json');
      const id = /task (\S+):/.exec(lines.join('\n'))![1];
      await expect(collectTask(d, id, { wait: true })).resolves.toMatchObject({ settled: 1 });
      expect(fs.readFileSync(path.join(root, 'out', 'a.md'), 'utf8')).toBe('A!');
    });
  }

  it('still stops on a definite client error', async () => {
    const { deps } = setup();
    const lines: string[] = [];
    const d = { ...deps(401), out: (l: string) => lines.push(l) };
    await runPlan(d, 'plan.json');
    const id = /task (\S+):/.exec(lines.join('\n'))![1];
    await expect(collectTask(d, id, { wait: true })).rejects.toThrow(/HTTP 401/);
  });
});
