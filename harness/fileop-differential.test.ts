/**
 * File-operation extraction differential (#9417 rewired walkCompoundCommand
 * to the state-tracking projection). Ground truth: which files bash really
 * writes. The extractor must not lose a real parent-shell write, and must not
 * invent one from inert heredoc data.
 */
import { mkdirSync, mkdtempSync, existsSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { extractShellOperationsAcrossCommand } from './shell-semantics.js';

const root = mkdtempSync(path.join(os.tmpdir(), 'fileop-diff-'));
const repo = path.join(root, 'repo');
mkdirSync(path.join(repo, '.qwen'), { recursive: true });

const cases: Array<[string, string]> = [
  ['plain-write', 'echo x > .qwen/settings.json'],
  ['child-shell-cd-then-parent-write', 'bash <<EOF\ncd /tmp\nEOF\necho x > .qwen/settings.json'],
  ['compound-opener-parent-cd', 'cat <<EOF && cd .qwen\ncd /tmp\nEOF\necho x > settings.json'],
  ['inert-body-mentions-write', "cat <<'EOF'\necho x > .qwen/settings.json\nEOF"],
  ['shell-fed-body-writes', 'bash <<EOF\necho x > .qwen/settings.json\nEOF'],
  ['crlf-body-then-write', 'cat <<EOF\r\ndata\r\nEOF\r\necho x > .qwen/settings.json'],
  ['tab-body-then-write', 'cat <<-EOF\n\tdata\n\tEOF\necho x > .qwen/settings.json'],
];

function realWrites(command: string): string[] {
  rmSync(repo, { recursive: true, force: true });
  mkdirSync(path.join(repo, '.qwen'), { recursive: true });
  spawnSync('bash', ['-c', command], {
    cwd: repo, env: { PATH: '/usr/bin:/bin', HOME: root, LC_ALL: 'C' },
    stdio: ['ignore', 'ignore', 'ignore'], timeout: 5000,
  });
  const out: string[] = [];
  for (const rel of ['.qwen/settings.json', 'settings.json', '.qwen/.qwen/settings.json']) {
    if (existsSync(path.join(repo, rel))) out.push(rel);
  }
  return out;
}

describe('file-op extraction differential vs real bash', () => {
  it.each(cases)('%s', (id, command) => {
    const truth = realWrites(command);
    const ops = extractShellOperationsAcrossCommand(command, repo)
      .filter((o) => o.virtualTool === 'write_file')
      .map((o) => path.relative(repo, (o as { filePath: string }).filePath));
    // Every file bash really wrote in the parent shell must be seen.
    for (const t of truth) expect({ id, seen: ops.includes(t) }).toEqual({ id, seen: true });
    // eslint-disable-next-line no-console
    console.log(`FILEOP ${id} :: truth=${JSON.stringify(truth)} ops=${JSON.stringify(ops)}`);
  });
});
