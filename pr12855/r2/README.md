# Round 2: head 34e32da78c merged with main 233d49b5cc

Every run used the merge `8aa8c3b704` (local only) unless a file says `v4` (PR head alone).

- `results/s13-delete-race-*.log`: the deletion race A/B, 186 trials per jar. The pre-lock jar was 2331792cd8; the lock jar is the merge.
- `results/v4-mutants.*`: 22 targeted mutants (harness `mutate-v4.mjs`), with a fresh IT database per Java run.
- `results/new-*`: scenario logs (s1, s3, s3b, s4, s4c, s4d, s5, s6, s7, s9, s10, s11, s12), plus the restart compare and the apply bench.
- `results/*summary*`: runtime-broker, managed-agent-server (MariaDB IT), the Hosted IT profiles on MySQL 8.4, core managed-runtime, and the Hosted E2E tail.
- Round 1 stays under `../` (`pr12855/`).
