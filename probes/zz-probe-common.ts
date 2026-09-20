/**
 * @license
 * Copyright 2026 Qwen
 * SPDX-License-Identifier: Apache-2.0
 */

// Shared helpers for the PR #11792 differential probes.

import { appendFileSync } from 'node:fs';
import {
  chmod,
  lstat,
  mkdir,
  readdir,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';

export type RootShape = 'dir' | 'file' | 'symlink-to-dir' | 'missing';
export type UidMode = 'real' | 'foreign' | 'absent';
export type PlatformMode = 'real' | 'win32';

export const MODES = [
  0o700, 0o500, 0o755, 0o777, 0o070, 0o007, 0o600, 0o710, 0o750,
];
export const ROOT_SHAPES: RootShape[] = [
  'dir',
  'file',
  'symlink-to-dir',
  'missing',
];
export const UID_MODES: UidMode[] = ['real', 'foreign', 'absent'];
export const PLATFORMS: PlatformMode[] = ['real', 'win32'];

export function withSpoof<T>(
  uid: UidMode,
  platform: PlatformMode,
  body: () => Promise<T>,
): Promise<T> {
  const uidDescriptor = Object.getOwnPropertyDescriptor(process, 'getuid');
  const platformDescriptor = Object.getOwnPropertyDescriptor(
    process,
    'platform',
  );
  const realGetuid = process.getuid?.bind(process);
  if (uid === 'foreign' && realGetuid) {
    Object.defineProperty(process, 'getuid', {
      configurable: true,
      value: () => realGetuid() + 1,
    });
  } else if (uid === 'absent') {
    Reflect.deleteProperty(process, 'getuid');
  }
  if (platform === 'win32') {
    Object.defineProperty(process, 'platform', {
      configurable: true,
      value: 'win32',
    });
  }
  const restore = () => {
    if (uidDescriptor) Object.defineProperty(process, 'getuid', uidDescriptor);
    else Reflect.deleteProperty(process, 'getuid');
    if (platformDescriptor) {
      Object.defineProperty(process, 'platform', platformDescriptor);
    }
  };
  return body().then(
    (value) => {
      restore();
      return value;
    },
    (error) => {
      restore();
      throw error;
    },
  );
}

export function classify(error: unknown, names: string[]): string {
  if (error instanceof Error) {
    for (const name of names) {
      if (error.constructor.name === name) return name;
    }
    const code = (error as NodeJS.ErrnoException).code;
    return code ? `${error.constructor.name}:${code}` : error.constructor.name;
  }
  return `non-error:${String(error)}`;
}

export async function buildRoot(
  parent: string,
  shape: RootShape,
  mode: number,
): Promise<string> {
  const root = join(parent, 'root');
  if (shape === 'missing') return root;
  if (shape === 'file') {
    await writeFile(root, 'x', { mode });
    return root;
  }
  if (shape === 'symlink-to-dir') {
    const target = join(parent, 'target');
    await mkdir(target, { mode: 0o700 });
    await chmod(target, mode);
    await symlink(target, root);
    return root;
  }
  await mkdir(root, { mode: 0o700 });
  await chmod(root, mode);
  return root;
}

export async function cleanup(parent: string): Promise<void> {
  // Restore owner rwx first: cases chmod directories to 0o070 / 0o007 / 0o500,
  // which would otherwise leave undeletable trees in tmpdir.
  const walk = async (target: string): Promise<void> => {
    let stat;
    try {
      stat = await lstat(target);
    } catch {
      return;
    }
    if (stat.isSymbolicLink() || !stat.isDirectory()) return;
    await chmod(target, 0o700).catch(() => undefined);
    const entries = await readdir(target).catch(() => [] as string[]);
    for (const entry of entries) await walk(join(target, entry));
  };
  await walk(parent);
  await rm(parent, { recursive: true, force: true }).catch(() => undefined);
}

export function emit(
  out: string,
  results: Array<Record<string, unknown>>,
): void {
  appendFileSync(
    out,
    results.map((entry) => JSON.stringify(entry)).join('\n') + '\n',
  );
}
