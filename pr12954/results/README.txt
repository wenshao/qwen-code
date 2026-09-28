PR #12954 (FG6f Shell output gates) real-stack verification at 225c60089d.

mutants.txt       one line per mutant x case (MySQL 8.4.7). exit/ok = Maven exit and HOSTED_SHELL_OUTPUT_FAULTS_OK count.
                  hits = marker found in the rebuilt artifact (dist/ for TS, class file for S1). B1 shows hits=0 because the
                  jar grep ran on compressed bytes; B1 was live - every B1 database holds
                  SETTLED error {"message":"RIG_MUTANT_B1 worker lost"} (see mutant-kill-reasons.txt / report).
                  orphans = processes whose command line contains the mutant worktree path, 2 s after the run (always 0).
                  shells = any "shell.pid" producer on the host; non-zero values coincide with a concurrent probe/repeat
                  run in another worktree and were gone when rechecked.
mutant-kill-reasons.txt  first failing assertion per run (driver line or Java probe message), "survived" otherwise.
unit-mutants.txt  each mutant cross-run against cli src/serve Hosted/Shell tests (147), core src/managed-runtime (1719),
                  or the Java module tests (S1: managed-agent-server 178, B1: runtime-broker 394).
unit-baselines-and-flake.txt  runtime-broker baseline (0 failures), and the T3 re-check: the single T3 unit failure in
                  unit-mutants.txt was a load flake (baseline also flaked 1/3; T3 re-run 3/3 green).
repeats.txt       unmodified gate repeats on MariaDB 10.11.18 and MySQL 8.4.7.
