export default {
  R3_ISO: {
    cli: {
      'cli/src/commands/review/lib/manifest-repository-context.test.ts': 'alone: pass',
      'cli/src/commands/review/revert-hunk.test.ts': 'alone: pass',
      'cli/src/serve/routes/workspace-file-write.test.ts': 'alone: pass',
      'cli/src/serve/routes/workspace-git-worktrees.test.ts': 'alone: pass (main failed 2 others alone)',
      'cli/src/serve/run-qwen-serve.test.ts': 'alone: 1 other timeout, then 573/573 (main also 1 alone)',
    },
  },
  R3_NOTE2: 'No merge damage found. Each of the 5 cli files that failed only on the merge tree passes when re-run alone (run-qwen-serve on its second solo run), and main, re-run the same way, fails other tests in two of those files. The failures both trees share are environmental: Unix socket paths under the long per-run TMPDIR exceed macOS\'s limit (path_too_long / ENAMETOOLONG / EADDRINUSE), plus load timeouts. Round 2\'s 16 broken fixture tests pass on the merge tree (http-managed-session-store 75/75, hosted-channel-session 20/20), as do main\'s new team-record and session-message suites. The deflake holds: the pre-fix test reproduces the gate\'s signature 5/30 here, the fixed one passed 70/70, and with the guard reverted it fails every time. The CLI keeps its round-2 behaviour on current main.',
  R3_NOTE3: 'All 36 deterministic runs pass on every arm, including the two Linux-only full failover modes (durable local-Worker reclaim), which the earlier rounds could not run on macOS; base passes too — the runner does not exercise the malformed bodies the fence refuses, so this is a no-regression check. Real model: 6/6 on macOS, each run completing a turn with a tool side effect, an idempotent replay and a 404 for the cross-tenant read.',
};
