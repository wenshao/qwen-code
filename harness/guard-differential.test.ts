/**
 * Independent differential for the state-tracking heredoc projection (#9417).
 * Ground truth is real bash: a `git` shim records the cwd it actually ran in.
 * Security property: whenever bash really runs git OUTSIDE the workspace, the
 * daemon guard must deny.
 */
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ExternalToolGuardPrepareRequest } from '@qwen-code/acp-bridge/bridgeOptions';
import { createDaemonToolGuard } from './daemon-git-worktree-guard.js';

const root = mkdtempSync(path.join(os.tmpdir(), 'guard-diff-'));
const effectiveCwd = path.join(root, 'workspace', 'worktree');
const outside = path.join(root, 'elsewhere', 'checkout');
const bin = path.join(root, 'bin');
mkdirSync(path.join(effectiveCwd, '.git'), { recursive: true });
mkdirSync(path.join(outside, '.git'), { recursive: true });
mkdirSync(bin, { recursive: true });
const witness = path.join(root, 'witness.txt');
writeFileSync(
  path.join(bin, 'git'),
  `#!/bin/sh\nprintf 'GIT %s\\n' "$PWD" >> "${witness}"\nexit 0\n`,
  { mode: 0o755 },
);

const OUT = outside;
const IN = effectiveCwd;
const cases: Array<[string, string]> = [
  ['plain-relocation', `cd ${OUT}; git reset --hard`],
  ['cat-body-launder', `cd ${OUT}; cat <<EOF\ncd ${IN}\nEOF\ngit reset --hard`],
  ['bash-body-launder', `cd ${OUT}; bash <<EOF\ncd ${IN}\nEOF\ngit reset --hard`],
  ['bash-body-fn', `cd ${OUT}; bash <<EOF\ngit() { true; }\nEOF\ngit reset --hard`],
  ['quoted-delim-launder', `cd ${OUT}; cat <<'EOF'\ncd ${IN}\nEOF\ngit reset --hard`],
  ['tab-delim-launder', `cd ${OUT}; cat <<-EOF\n\tcd ${IN}\n\tEOF\ngit reset --hard`],
  ['crlf-launder', `cd ${OUT}; cat <<EOF\r\ncd ${IN}\r\nEOF\r\ngit reset --hard`],
  ['midword-hash-launder', `cd ${OUT}; cat foo#bar <<EOF\ncd ${IN}\nEOF\ngit reset --hard`],
  ['compound-opener-cd-out', `cat <<EOF && cd ${OUT}\nbody\nEOF\ngit reset --hard`],
  ['compound-opener-inert-body', `cat <<EOF && echo hi\ncd ${OUT}\nEOF\ngit reset --hard`],
  ['phantom-arith-cd-out', `echo $[1 << 5]\ncd ${OUT}\ngit reset --hard`],
  ['phantom-arith-paren-cd-out', `echo $((1 << 5))\ncd ${OUT}\ngit reset --hard`],
  ['numeric-delim-inert', `cat <<123\ncd ${OUT}\n123\ngit reset --hard`],
  ['punct-delim-inert', `cat <<A,B\ncd ${OUT}\nA,B\ngit reset --hard`],
  ['python-chdir-child', `python3 - <<'PY'\nimport os\nos.chdir(${JSON.stringify(OUT)})\nPY\ngit reset --hard`],
  ['pipe-into-bash-cd', `cat <<EOF | bash\ncd ${OUT}\nEOF\ngit reset --hard`],
  ['even-backslash-opener', `cd ${OUT}; cat <<EOF \\\\\ncd ${IN}\nEOF\ngit reset --hard`],
  ['odd-backslash-opener', `cd ${OUT}; cat <<EOF \\\ncd ${IN}\nEOF\ngit reset --hard`],
  ['inert-inside-only', `cat <<EOF\ncd ${OUT}\nEOF\ngit reset --hard`],
  ['plain-inside', `git reset --hard`],
];

function request(command: string): ExternalToolGuardPrepareRequest {
  return {
    sessionId: 's', promptId: 'p', toolCallId: 'c',
    toolName: 'run_shell_command',
    arguments: { command },
    effectiveCwd,
  } as ExternalToolGuardPrepareRequest;
}

function groundTruth(command: string) {
  writeFileSync(witness, '');
  spawnSync('bash', ['-c', command], {
    cwd: effectiveCwd,
    env: { PATH: `${bin}:/usr/bin:/bin`, HOME: root, LC_ALL: 'C' },
    stdio: ['ignore', 'ignore', 'ignore'],
    timeout: 5000,
  });
  const lines = readFileSync(witness, 'utf8').split('\n').filter((l) => l.startsWith('GIT '));
  const cwds = lines.map((l) => l.slice(4));
  return { ran: cwds.length > 0, cwds, outsideRun: cwds.some((c) => !c.startsWith(IN)) };
}

describe('heredoc state-tracking differential vs real bash', () => {
  const report: Array<Record<string, unknown>> = [];
  it.each(cases)('%s', async (id, command) => {
    const gt = groundTruth(command);
    const guard = createDaemonToolGuard();
    const verdict = await guard(request(command));
    report.push({ id, command, gt, allowed: (verdict as { allowed: boolean }).allowed });
    writeFileSync(process.env['GUARD_DIFF_OUT'] ?? '/tmp/guard-diff.json', JSON.stringify(report, null, 2));
    if (gt.outsideRun) {
      // Security: git really ran outside the workspace → the guard must deny.
      expect({ id, allowed: (verdict as { allowed: boolean }).allowed }).toEqual({ id, allowed: false });
    }
  });
});
