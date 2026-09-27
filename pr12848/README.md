# PR #12848 verification evidence

Tested head: 782c17749f (production code identical to 7a41a5d42e; that commit only edits HostedWorkspaceToolTurnIT).
Stack: MySQL 8.4.7, Spring managed-agent-server jar built from the PR (Session Store + embedded Runtime Broker,
local-process workers from the PR bundle), packaged dist/cli.js Hosted Harness, Node 22.23.2, JDK 21.

- `harness/lib.mjs` rig helpers; `spring.sh` / `mysql.sh` / `node22.sh` launchers.
- `s1` runs the PR's integration driver unchanged against MySQL-backed Spring (ARM=pr|m13|m11).
- `s2` real model (qwen3.8-max) R1/R2/R4; `s4` the same R2 prompt through the ordinary (non-Hosted) Shell tool.
- `s3` fixture-model probes P1..P8 (the P2 in the combined log used a literal marker also present in the
  command text; `s3-probes-pr-P2.log` is the corrected run with a computed marker).
- `s5` Store request counts for 64 MiB; `s6` cancel during a 1 GiB stream; `s7` idle RSS; `s8` publisher auth/listener probe.
- `mutate.py` / `mutate-java.py` one-line mutants; `results/mutation-*.json`.
- `cand-preview-and-auth.patch` candidate head+tail preview + two tests, relative to 782c17749f.
- `cards/*.txt` + `render.py` produce the PNGs.
