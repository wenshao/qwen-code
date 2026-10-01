// Adds the candidate's regression test to hosted-runtime-recovery.test.ts. usage: node apply-cand-h7-test.mjs <tree>
import { readFileSync, writeFileSync } from 'node:fs';
const file = `${process.argv[2]}/packages/cli/src/serve/hosted-runtime-recovery.test.ts`;
let s = readFileSync(file, 'utf8');
const edit = (from, to) => {
  if (s.split(from).length !== 2) throw new Error(`anchor: ${from.slice(0, 60)}`);
  s = s.replace(from, to);
};
edit(
  `import { HostedWorkspaceBroker } from './hosted-workspace-broker.js';`,
  `import { HostedWorkspaceBroker } from './hosted-workspace-broker.js';
import {
  commitHostedFileHistory,
  readHostedFileHistory,
} from './hosted-file-history.js';`,
);
edit(
  `  it('drives each parked execution under its own id and arguments', async () => {`,
  `  it('clears the pending file history of the parked batch it drove', async () => {
    await parkAtAwaitRuntime();
    const backupTime = '2026-10-01T00:00:00.000Z';
    const before = {
      ownerSessionId: SESSION_ID,
      snapshots: [
        {
          promptId: PROMPT_ID,
          timestamp: backupTime,
          trackedFileBackups: {
            '0.txt': { backupFileName: null, version: 1, backupTime },
          },
        },
      ],
      files: { '0.txt': null },
    };
    // The dead owner prepared the batch's history before dispatching it.
    const owner = await open('boot-1b', false);
    await commitHostedFileHistory(owner, {
      schemaVersion: 1,
      state: before,
      pendingTurn: PROMPT_ID,
      pendingMessageId: 'message-1',
      pendingUndo: null,
    });
    await owner.close();
    resetManagedRuntimeDispatchGatesForTest();
    vi.spyOn(HostedWorkspaceBroker.prototype, 'acquire').mockResolvedValue();
    vi.spyOn(HostedWorkspaceBroker.prototype, 'execute').mockResolvedValue({
      executionStatus: 'success',
      responseParts: [{ text: 'done' }],
    } as never);
    const after = {
      ...before,
      files: { '0.txt': { digest: \`sha256:\${'b'.repeat(64)}\`, mode: 0o644 } },
    };
    const fileHistory = vi
      .spyOn(HostedWorkspaceBroker.prototype, 'fileHistory')
      .mockResolvedValue(after as never);
    const replacement = await open('boot-2', false);
    try {
      const recovered = await recoverHostedRuntimeTurn({
        session: replacement,
        sessionId: SESSION_ID,
        cwd: root,
        promptId: PROMPT_ID,
        brokerOptions,
        passive: false,
      });
      expect(recovered?.report.phase).toBe('results_ready');
      expect(fileHistory).toHaveBeenCalledWith({
        kind: 'raw-file-history',
        action: 'snapshot',
      });
      const saved = await readHostedFileHistory(replacement);
      expect(saved?.pendingTurn).toBeNull();
      expect(saved?.state.files['0.txt']).toEqual(after.files['0.txt']);
    } finally {
      await replacement.close();
    }
  });

  it('drives each parked execution under its own id and arguments', async () => {`,
);
writeFileSync(file, s);
console.log('candidate test added to', process.argv[2]);
