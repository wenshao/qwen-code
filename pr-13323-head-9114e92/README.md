# PR #13323 re-check on head 9114e92

`9114e92` merges `main` at `aca4d03c7e` into the PR branch. Its tree is identical to
`git merge-tree --write-tree aca4d03c7e 118cc3b6a0`, and its diff against `aca4d03c7e`
is the single `{ timeout: 10_000 }` hunk.

Both runs use the throttle runner from `pr-13323/harness/throttle-run.sh` at 3 % CPU
(`WT` = a worktree at `9114e92`), in parallel:

- `base-q3.log.txt`: `hosted-harness-session.armbase.test.ts` = main's own file
  (blob `560eed7226`, same as `aca4d03c7e`). Both variants fail with `retry x2` at `:1662`.
- `head-q3.log.txt`: the PR's `hosted-harness-session.test.ts`. Both variants pass.

ANSI escapes were stripped from the logs; `*.meta.txt` holds the throttle/unthrottle times and exit code.
