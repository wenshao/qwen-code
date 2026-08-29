/**
 * Ground truth: execute a command through the SAME shell qwen-code uses on
 * Linux — `bash -c <command>`, see getShellConfiguration() in
 * packages/core/src/utils/shell-utils.ts — inside a sandbox, and record
 * whether the marker binary really ran.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { PAYLOAD } from './corpus.mjs';

export function createSandbox(root) {
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(path.join(root, 'bin'), { recursive: true });
  fs.mkdirSync(path.join(root, 'work'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'bin', PAYLOAD),
    `#!/bin/sh\nprintf 'EXEC %s\\n' "$*" >> "$QWEN_WITNESS"\nexit 0\n`,
    { mode: 0o755 },
  );
  // Records the cwd it was invoked from — the cwd-laundering oracle.
  fs.writeFileSync(
    path.join(root, 'bin', 'git'),
    `#!/bin/sh\nprintf 'GIT %s :: %s\\n' "$PWD" "$*" >> "$QWEN_WITNESS"\nexit 0\n`,
    { mode: 0o755 },
  );
  if (!fs.existsSync(path.join(root, 'bin', 'python'))) {
    fs.symlinkSync('/usr/bin/python3', path.join(root, 'bin', 'python'));
  }
  fs.writeFileSync(path.join(root, 'work', 'README.md'), 'hi\n');
  return root;
}

export function runOne(root, command) {
  const witness = path.join(root, 'witness.txt');
  fs.writeFileSync(witness, '');
  const r = spawnSync('bash', ['-c', command], {
    cwd: path.join(root, 'work'),
    env: {
      PATH: `${path.join(root, 'bin')}:/usr/bin:/bin`,
      HOME: root,
      QWEN_WITNESS: witness,
      LC_ALL: 'C',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 5000,
    encoding: 'utf8',
  });
  const log = fs.readFileSync(witness, 'utf8').split('\n');
  return {
    executesPayload: log.some((l) => l.startsWith('EXEC ')),
    payloadExecutions: log.filter((l) => l.startsWith('EXEC ')),
    gitInvocations: log.filter((l) => l.startsWith('GIT ')),
    exitCode: r.status,
    parseError: /syntax error|unexpected/.test(r.stderr ?? ''),
    stderr: (r.stderr ?? '').slice(0, 300),
  };
}
