/**
 * @license
 * Copyright 2026 Qwen
 * SPDX-License-Identifier: Apache-2.0
 */

// Probe 3/3 — does the retention sweep's *scope* widen on Windows?
// The PR's doc change claims cleanup covers only current-user-owned marked
// directories on POSIX, and any marked directory beneath the managed root on
// Windows. Ownership cannot be faked per-directory without root, so this uses
// the other conjunct the same win32 branch drops: a shared (0o755) mode.

import { chmod, mkdir, mkdtemp, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'vitest';
import { MonitorDebugStore } from './proactive/monitor-debug-store.js';
import { cleanup, emit, withSpoof } from './zz-probe-common.js';

const OUT = process.env['PROBE_OUT'] ?? join(tmpdir(), 'probe-prune.jsonl');
const UUID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeee';

describe('probe: retention scope', () => {
  it(
    'prune() scope on POSIX vs forced win32',
    async () => {
      const results: Array<Record<string, unknown>> = [];
      for (const platform of ['real', 'win32'] as const) {
        const parent = await mkdtemp(join(tmpdir(), 'probe-prune-'));
        try {
          const root = join(parent, 'root');
          await mkdir(root, { mode: 0o700 });
          const shared: string[] = [];
          for (let index = 0; index < 12; index += 1) {
            const createdAt = 1_700_000_000_000 + index;
            const name = `monitor-${createdAt}-${UUID}${String(index).padStart(2, '0')}`;
            const directory = join(root, name);
            await mkdir(directory, { mode: 0o700 });
            await writeFile(
              join(directory, 'monitor.json'),
              JSON.stringify({
                format: 'qwen-live-monitor-debug-v1',
                createdAt,
              }),
              { mode: 0o600 },
            );
            // The four oldest are group/other-readable: on POSIX the sweep
            // refuses to even consider them, so only 8 candidates remain and
            // nothing is evicted.
            if (index < 4) {
              await chmod(directory, 0o755);
              shared.push(name);
            }
          }
          const events: string[] = [];
          const store = new MonitorDebugStore(
            (event: string) => void events.push(event),
            root,
          );
          let initialized: unknown;
          await withSpoof('real', platform, async () => {
            initialized = await store.initialize();
          });
          const survivors = (await readdir(root)).sort();
          results.push({
            probe: 'prune.scope',
            platform,
            initialized,
            planted: 12,
            sharedPlanted: shared.length,
            survivors: survivors.length,
            sharedSurvivors: survivors.filter((name) => shared.includes(name))
              .length,
            pruned: events.filter((event) =>
              event.endsWith('monitor_debug_pruned'),
            ).length,
          });
        } finally {
          await cleanup(parent);
        }
      }
      emit(OUT, results);
      console.log(`PROBE_PRUNE_DONE cases=${results.length}`);
    },
    300_000,
  );
});
