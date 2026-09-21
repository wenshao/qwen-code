// Throwaway probe used for PR #12421 verification. Place under
// packages/core/src/tools/__probe__/ next to a copy of the base
// read-file.ts saved as read-file.base.ts (imports rewritten one level up),
// then: cd packages/core && npx vitest run src/tools/__probe__ --coverage.enabled=false
// Invariant A: on the PR, any params with nulls behave exactly like the same
//              params with those keys deleted (validation, content, description,
//              locations, cache hit/miss).
// Invariant B: for null-free params, PR vs base differ only in notebook
//              guidance text (and the verdict for notebook pagination stays
//              "rejected").
import { describe, it, expect, vi } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { ReadFileTool } from '../read-file.js';
import { ReadFileTool as BaseReadFileTool } from './read-file.base.js';
import type { Config } from '../../config/config.js';
import { FileDiscoveryService } from '../../services/fileDiscoveryService.js';
import { FileReadCache } from '../../services/fileReadCache.js';
import { StandardFileSystemService } from '../../services/fileSystemService.js';
import { createMockWorkspaceContext } from '../../test-utils/mockWorkspaceContext.js';

vi.mock('../../telemetry/loggers.js', () => ({ logFileOperation: vi.fn() }));

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pr12421-probe-'));
const FIX = '/root/verify/pr12421-harness/ws';
for (const f of ['example.ipynb', 'notes.txt', 'report.pdf'])
  fs.copyFileSync(path.join(FIX, f), path.join(root, f));
fs.writeFileSync(path.join(root, 'long.txt'), Array.from({ length: 30 }, (_, i) => `line-${i}`).join('\n'));

function makeConfig(pdf: boolean, cache: FileReadCache): Config {
  const modalities = { image: true, pdf, audio: false, video: false };
  return {
    getFileService: () => new FileDiscoveryService(root),
    getFileSystemService: () => new StandardFileSystemService(),
    getTargetDir: () => root,
    getWorkspaceContext: () => createMockWorkspaceContext(root),
    storage: {
      getProjectTempDir: () => path.join(root, '.temp'),
      getProjectDir: () => path.join(root, '.project'),
      getWorkflowRunsDir: () => path.join(root, '.workflow-runs'),
      getUserSkillsDirs: () => [path.join(root, '.skills')],
    },
    getPlansDir: () => path.join(root, '.plans'),
    getTruncateToolOutputThreshold: () => 2500,
    getTruncateToolOutputLines: () => 500,
    getContentGeneratorConfig: () => ({ modalities }),
    getEffectiveInputModalities: () => modalities,
    getFileReadCache: () => cache,
    getFileReadCacheDisabled: () => false,
  } as unknown as Config;
}

const OMIT = Symbol('omit');
const FILES = ['example.ipynb', 'notes.txt', 'long.txt', 'report.pdf'];
const OFFSETS: unknown[] = [OMIT, null, 0, 1, 2, -1, '1', 1.5];
const LIMITS: unknown[] = [OMIT, null, 0, 1, 2, '2'];
const PAGES: unknown[] = [OMIT, null, '', '  ', '1', '2', '1-2', '0', '2-', 3];

function mk(file: string, o: unknown, l: unknown, p: unknown) {
  const params: Record<string, unknown> = { file_path: path.join(root, file) };
  if (o !== OMIT) params['offset'] = o;
  if (l !== OMIT) params['limit'] = l;
  if (p !== OMIT) params['pages'] = p;
  return params;
}
const stripNulls = (p: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(p).filter(([, v]) => v !== null));

type Outcome = { verdict: 'REJECT' | 'OK' | 'EXEC_ERROR' | 'CRASH'; msg?: string; content?: string; desc?: string; loc?: string };

async function run(Tool: typeof ReadFileTool, pdf: boolean, params: Record<string, unknown>, cache = new FileReadCache()): Promise<Outcome> {
  const tool = new Tool(makeConfig(pdf, cache));
  const copy = structuredClone(params);
  let inv;
  try {
    const err = tool.validateToolParams(copy as never);
    if (err) return { verdict: 'REJECT', msg: err };
    inv = tool.build(copy as never);
  } catch (e) {
    return { verdict: 'CRASH', msg: String(e) };
  }
  try {
    const r = await inv.execute(new AbortController().signal);
    const content = JSON.stringify(r.llmContent);
    return {
      verdict: r.error ? 'EXEC_ERROR' : 'OK',
      msg: r.error?.message,
      content,
      desc: inv.getDescription(),
      loc: JSON.stringify(inv.toolLocations()),
    };
  } catch (e) {
    return { verdict: 'CRASH', msg: String(e) };
  }
}

describe('PR #12421 null invariance probe', () => {
  it('matrix', async () => {
    const stats = { combos: 0, withNull: 0, invA_fail: 0, invB_diff: 0, crashes: 0, baseRejectPrOkNull: 0 };
    const invAFails: string[] = [];
    const invBBuckets = new Map<string, number>();
    for (const pdf of [false, true])
      for (const file of FILES)
        for (const o of OFFSETS)
          for (const l of LIMITS)
            for (const p of PAGES) {
              stats.combos++;
              const params = mk(file, o, l, p);
              const hasNull = Object.values(params).some((v) => v === null);
              const pr = await run(ReadFileTool, pdf, params);
              if (pr.verdict === 'CRASH') stats.crashes++;
              if (hasNull) {
                stats.withNull++;
                const prStripped = await run(ReadFileTool, pdf, stripNulls(params));
                const base = await run(BaseReadFileTool as unknown as typeof ReadFileTool, pdf, params);
                if (base.verdict === 'REJECT' && pr.verdict !== 'REJECT') stats.baseRejectPrOkNull++;
                if (JSON.stringify(pr) !== JSON.stringify(prStripped)) {
                  stats.invA_fail++;
                  if (invAFails.length < 10) invAFails.push(`${pdf ? 'pdf-native' : 'pdf-text'} ${JSON.stringify(params)}\n  null: ${JSON.stringify(pr).slice(0, 200)}\n  omit: ${JSON.stringify(prStripped).slice(0, 200)}`);
                }
              } else {
                const base = await run(BaseReadFileTool as unknown as typeof ReadFileTool, pdf, params);
                if (JSON.stringify(pr) !== JSON.stringify(base)) {
                  stats.invB_diff++;
                  const norm = (m?: string) => (m ?? '').replace(/\/tmp\/[^"\s,}]+/g, '<path>').slice(0, 90);
                  const key = `${file} | base=${base.verdict}:${norm(base.msg)} | pr=${pr.verdict}:${norm(pr.msg)}`;
                  invBBuckets.set(key, (invBBuckets.get(key) ?? 0) + 1);
                }
              }
            }

    // Cache semantics: first read form X, second read form Y (both "full").
    const FULL_FORMS: Array<Record<string, unknown>> = [
      {}, { offset: null }, { limit: null }, { pages: null },
      { offset: null, limit: null, pages: null }, { pages: '  ' }, { pages: '' },
    ];
    let cachePairs = 0, cacheMismatch = 0, cacheHitsPr = 0;
    for (const a of FULL_FORMS) for (const b of FULL_FORMS) {
      cachePairs++;
      const file = path.join(root, 'notes.txt');
      const c1 = new FileReadCache();
      await run(ReadFileTool, false, { file_path: file, ...a }, c1);
      const pr2 = await run(ReadFileTool, false, { file_path: file, ...b }, c1);
      const c2 = new FileReadCache();
      await run(BaseReadFileTool as unknown as typeof ReadFileTool, false, { file_path: file, ...stripNulls(a) }, c2);
      const base2 = await run(BaseReadFileTool as unknown as typeof ReadFileTool, false, { file_path: file, ...stripNulls(b) }, c2);
      const hit = (x: Outcome) => (x.content ?? '').includes('unchanged since last read');
      if (hit(pr2)) cacheHitsPr++;
      if (hit(pr2) !== hit(base2)) cacheMismatch++;
    }

    const report = { stats, invAFails, invB: [...invBBuckets.entries()], cache: { cachePairs, cacheMismatch, cacheHitsPr } };
    fs.writeFileSync('/root/verify/pr12421-harness/out/probe-report.json', JSON.stringify(report, null, 1));
    console.log(JSON.stringify(report, null, 1));
    expect(stats.invA_fail).toBe(0);
  }, 600000);
});
