/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from 'react';
import { isCommandAvailable, execCommand } from '@qwen-code/qwen-code-core';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';

export function useGitBranchName(cwd: string): string | undefined {
  const [branchName, setBranchName] = useState<string | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;

    const fetchWithGuard = async () => {
      try {
        if (!isCommandAvailable('git').available) {
          return;
        }

        const { stdout } = await execCommand(
          'git',
          ['rev-parse', '--abbrev-ref', 'HEAD'],
          { cwd },
        );
        if (cancelled) return;
        const branch = stdout.toString().trim();
        if (branch && branch !== 'HEAD') {
          setBranchName(branch);
        } else {
          const { stdout: hashStdout } = await execCommand(
            'git',
            ['rev-parse', '--short', 'HEAD'],
            { cwd },
          );
          if (!cancelled) {
            setBranchName(hashStdout.toString().trim());
          }
        }
      } catch {
        if (!cancelled) setBranchName(undefined);
      }
    };

    fetchWithGuard();

    const gitLogsHeadPath = path.join(cwd, '.git', 'logs', 'HEAD');
    let watcher: fs.FSWatcher | undefined;

    const setupWatcher = async () => {
      try {
        // Check if .git/logs/HEAD exists, as it might not in a new repo or orphaned head
        await fsPromises.access(gitLogsHeadPath, fs.constants.F_OK);
        if (cancelled) return;
        watcher = fs.watch(gitLogsHeadPath, (eventType: string) => {
          // Changes to .git/logs/HEAD (appends) indicate HEAD has likely changed
          if (eventType === 'change' || eventType === 'rename') {
            // Handle rename just in case
            if (!cancelled) fetchWithGuard();
          }
        });
      } catch (_watchError) {
        // Silently ignore watcher errors (e.g. permissions or file not existing),
        // similar to how exec errors are handled.
        // The branch name will simply not update automatically.
      }
    };

    setupWatcher();

    return () => {
      cancelled = true;
      watcher?.close();
    };
  }, [cwd]);

  return branchName;
}
