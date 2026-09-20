/**
 * @license
 * Copyright 2026 Qwen
 * SPDX-License-Identifier: Apache-2.0
 */

// Probe 1/3 — MonitorDebugStore.initialize() over a real filesystem matrix.

import { lstat, mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'vitest';
import { MonitorDebugStore } from './proactive/monitor-debug-store.js';
import {
  buildRoot,
  classify,
  cleanup,
  emit,
  MODES,
  PLATFORMS,
  ROOT_SHAPES,
  UID_MODES,
  withSpoof,
} from './zz-probe-common.js';

const OUT = process.env['PROBE_OUT'] ?? join(tmpdir(), 'probe-store.jsonl');

describe('probe: monitor debug store', () => {
  it(
    'initialize() over the matrix',
    async () => {
      const results: Array<Record<string, unknown>> = [];
      for (const shape of ROOT_SHAPES) {
        for (const mode of MODES) {
          if (shape === 'missing' && mode !== 0o700) continue;
          for (const uid of UID_MODES) {
            for (const platform of PLATFORMS) {
              const parent = await mkdtemp(join(tmpdir(), 'probe-mds-'));
              try {
                const root = await buildRoot(parent, shape, mode);
                // Two retained-candidate children so prune() runs over real
                // entries rather than an empty directory.
                if (shape === 'dir') {
                  await chmodSafe(root);
                  for (const name of [
                    'monitor-1000000000000-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
                    'monitor-1000000000001-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeef',
                  ]) {
                    const child = join(root, name);
                    await mkdir(child, { mode: 0o700 });
                    await writeFile(
                      join(child, 'monitor.json'),
                      '{"format":"qwen-live-monitor-debug-v1","createdAt":1}\n',
                      { mode: 0o600 },
                    );
                  }
                  const { chmod } = await import('node:fs/promises');
                  await chmod(root, mode);
                }
                const events: string[] = [];
                const store = new MonitorDebugStore(
                  (event: string) => void events.push(event),
                  root,
                );
                let initialized: unknown;
                let failure: string | undefined;
                await withSpoof(uid, platform, async () => {
                  try {
                    initialized = await store.initialize();
                  } catch (error) {
                    failure = classify(error, []);
                  }
                });
                let survivors = 'ENOENT';
                try {
                  const { readdir, chmod } = await import('node:fs/promises');
                  await chmod(root, 0o700).catch(() => undefined);
                  survivors = (await readdir(root)).sort().join('|');
                } catch {
                  /* keep ENOENT */
                }
                let finalMode = 'ENOENT';
                try {
                  finalMode = ((await lstat(root)).mode & 0o7777).toString(8);
                } catch {
                  /* keep ENOENT */
                }
                results.push({
                  probe: 'store.initialize',
                  shape,
                  mode: mode.toString(8),
                  uid,
                  platform,
                  initialized,
                  failure,
                  events: events.join(','),
                  finalMode,
                  survivors,
                });
              } finally {
                await cleanup(parent);
              }
            }
          }
        }
      }
      emit(OUT, results);
      console.log(`PROBE_STORE_DONE cases=${results.length}`);
    },
    900_000,
  );
});

async function chmodSafe(target: string): Promise<void> {
  const { chmod } = await import('node:fs/promises');
  await chmod(target, 0o700).catch(() => undefined);
}
