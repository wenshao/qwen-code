# PR #13344 verification evidence (head ced83583f4)

- `01..04-*.png`: figures used in the PR comment.
- `results.tsv`: every driver run (macOS = local stack, linux = container on an independent aarch64 host).
  Void runs, kept for completeness: `head-session-failover` (rig check on JDK 26),
  `c2-*`/`c3-*` (login file carried only `user=`, which the runner's explicit `--user=root` overrides),
  `X1-*`/`X2-*` (Spring killed before the held start, so neither arm reached the hold).
- `rig/`: the process-group driver (`abdrive.mjs`), run matrices, image scenario script, host least-privilege check, figure generator.
