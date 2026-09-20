/**
 * @license
 * Copyright 2026 Qwen
 * SPDX-License-Identifier: Apache-2.0
 */

// Probe 2/3 — live discovery publish/remove over a real filesystem matrix.

import { chmod, mkdir, mkdtemp, symlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'vitest';
import {
  getLiveDiscoveryPath,
  removeLiveDiscoveryFile,
  writeLiveDiscoveryFile,
  type LiveDiscoveryRecord,
} from './host/discovery.js';
import { LIVE_HOST_PROTOCOL_VERSION } from './host/types.js';
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

const OUT = process.env['PROBE_OUT'] ?? join(tmpdir(), 'probe-discovery.jsonl');
const LOCK_SHAPES = ['none', 'stale-dir', 'file', 'symlink'] as const;
const LIVE_MODES = ['absent', 0o700, 0o500, 0o755, 0o777] as const;
const ERRORS = ['LiveDiscoveryStateError', 'LiveDiscoveryPublicationError'];

function record(): LiveDiscoveryRecord {
  return {
    url: 'http://127.0.0.1:3210',
    token: 'not-a-real-token',
    protocolVersion: LIVE_HOST_PROTOCOL_VERSION,
    pid: process.pid,
    instanceNonce: 'daemon_instance_nonce_probe_0001',
  };
}

describe('probe: live discovery', () => {
  it(
    'writeLiveDiscoveryFile/removeLiveDiscoveryFile over the matrix',
    async () => {
      const results: Array<Record<string, unknown>> = [];
      let index = 0;
      for (const shape of ROOT_SHAPES) {
        for (const mode of MODES) {
          if (shape === 'missing' && mode !== 0o700) continue;
          for (const liveMode of LIVE_MODES) {
            if (shape !== 'dir' && liveMode !== 'absent') continue;
            for (const lockShape of LOCK_SHAPES) {
              if (liveMode === 'absent' && lockShape !== 'none') continue;
              // A 0o500 `live/` directory is unwritable, so once the mode gate
              // is skipped (forced win32) proper-lockfile burns its 120 EACCES
              // retries (~12s per lock, 23s per case). Keep one representative
              // slice of that shape instead of 108 of them.
              if (liveMode === 0o500 && lockShape !== 'none') continue;
              for (const uid of UID_MODES) {
                if (liveMode === 0o500 && uid !== 'real') continue;
                for (const platform of PLATFORMS) {
                  const startedAt = Date.now();
                  const parent = await mkdtemp(join(tmpdir(), 'probe-disc-'));
                  try {
                    const runtime = await buildRoot(parent, shape, mode);
                    if (shape === 'dir' && liveMode !== 'absent') {
                      await chmod(runtime, 0o700);
                      const live = join(runtime, 'live');
                      await mkdir(live, { mode: 0o700 });
                      const lockPath = join(live, '.daemon.lock');
                      if (lockShape === 'stale-dir') {
                        await mkdir(lockPath, { mode: 0o700 });
                        // proper-lockfile treats a lock older than `stale`
                        // (10s) as abandoned; backdating keeps the probe fast
                        // instead of waiting out 120 retries per case.
                        const old = new Date(Date.now() - 3_600_000);
                        await utimes(lockPath, old, old);
                      } else if (lockShape === 'file') {
                        await writeFile(lockPath, 'x');
                      } else if (lockShape === 'symlink') {
                        const target = join(parent, 'lock-target');
                        await mkdir(target, { mode: 0o700 });
                        await symlink(target, lockPath);
                      }
                      await chmod(live, liveMode);
                      await chmod(runtime, mode);
                    }
                    const rec = record();
                    let wrote: unknown;
                    let writeFailure: string | undefined;
                    let removed: unknown;
                    let removeFailure: string | undefined;
                    await withSpoof(uid, platform, async () => {
                      try {
                        wrote =
                          (await writeLiveDiscoveryFile(runtime, rec)) ===
                          getLiveDiscoveryPath(runtime);
                      } catch (error) {
                        writeFailure = classify(error, ERRORS);
                      }
                      try {
                        removed = await removeLiveDiscoveryFile(runtime, rec);
                      } catch (error) {
                        removeFailure = classify(error, ERRORS);
                      }
                    });
                    const entry = {
                      probe: 'discovery.write-remove',
                      shape,
                      mode: mode.toString(8),
                      liveMode:
                        liveMode === 'absent' ? 'absent' : liveMode.toString(8),
                      lockShape,
                      uid,
                      platform,
                      wrote,
                      writeFailure,
                      removed,
                      removeFailure,
                    };
                    results.push(entry);
                    emit(OUT, [entry]);
                    index += 1;
                    const elapsed = Date.now() - startedAt;
                    if (elapsed > 500) {
                      console.log(
                        `SLOW #${index} ${elapsed}ms ${JSON.stringify(entry)}`,
                      );
                    }
                    if (index % 100 === 0) console.log(`PROGRESS ${index}`);
                  } finally {
                    await cleanup(parent);
                  }
                }
              }
            }
          }
        }
      }
      console.log(`PROBE_DISCOVERY_DONE cases=${results.length}`);
    },
    1_800_000,
  );
});
