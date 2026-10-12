# PR #13654 round 6: heads `296b1be5` and `876b00ef`

`296b1be5` adds four commits on top of the round-5 head `fe0ae13e`:

- `426248142d` is the R8-1 fix. It separates verified corruption from authority failures.
- `70a2ba2f38` merges `main` `01d3e6d8`.
- `9fbe335487` makes a blocked Session recovery fail accepted work permanently.
- `296b1be5da` merges `main` `e17ad4ca`, which brings #13894 (publication lock order).

Earlier rounds are in `../`, `../r2/` … `../r5/`.

While this round ran, the author pushed `876b00ef`, which merges `main` `b1b2b2c6` and edits a `main` test that is red on `main`. Its publication code is byte-identical to `296b1be5`, so the probes and mutants were not re-run. The full suite and the stack were re-run on it, and those results are named `*-876*`.

## Files

- `01-r8-fix.png`: R8-1 entrance A on H2, MySQL 8.4.7 and the packaged stack, compared with round 5. It also covers:
  - recovery blocked before the claim;
  - real corruption;
  - read failures that are neither corruption nor an authority failure.
- `02-tests-and-merges.png`: everything else. It covers:
  - mutants of the fix against the PR's tests;
  - the two merge commits;
  - CI's `managed-agent-server` command on MySQL 8.4.7;
  - the stack compared with round 5;
  - the new conflict with `main` `b1b2b2c6` and a local trial merge.
- `harness/01-r8-fix.txt` and `harness/02-tests-and-merges.txt` are the card sources. Round 5's `render.mjs` renders them.

## Harness

- `harness/cmp-merges.sh <merge>...` lists the following for each merge commit:
  - its parents;
  - the conflicted paths;
  - the paths that differ from the automatic merge.
- `harness/build-head.sh`, `harness/verify-head.sh` and `summ-total.py` cover the build and the full suite.
  - `verify-head.sh` runs CI's command against MySQL 8.4.7 with `-Dmaven.test.failure.ignore=true`.
- `harness/trial-merge.sh` verifies the module on the local trial merge with current `main`. The merge is local only and was not pushed.
- `harness/rerun-it.sh` reruns one IT alone. Each tag gets its own schema.
- `harness/probe/` holds the probes.
  - `install.sh` copies the PR's `ToolPublicationAsyncVerificationTest` and its MySQL IT into `RigR6ProbeTest` and `RigR6ProbeMySqlIT`. It then adds the round-3 to round-6 probe methods.
  - It also extends the bucket double with three things:
    - an injectable DELETE failure;
    - delete counters;
    - a first-read hook that may throw `IOException`.
  - `probes-csi.java.txt` and `probes-r4.java.txt` are the round-3 and round-4 probes plus their shared helpers.
  - `probes-r5.java.txt` is round 5's file with its `blockRecovery` helper renamed to `rigBlockRecovery`, because the PR's test now has its own `blockRecovery`.
  - `run.sh` deletes the probe sources again after the run.
  - The probes in `probes-r6.java.txt` are:
    - `OT`: a fence during a terminal-object read;
    - `C`: real corruption;
    - `U`: unclassified read failures, including a mid-stream `IOException`;
    - `U7`: a failure that lasts until the deadline.
- `harness/mutation/` holds the mutation runs.
  - `mutate.py` applies one of the seven mutants M1–M7. Each mutant must match its anchor exactly once.
  - `run.sh` runs the PR's async and store tests plus the H2 probes for each mutant, then restores the file.
  - `run-all.sh` runs every publication unit test.
  - `probediff.py` compares probe outcomes with head.
- `harness/rig/` holds the packaged-stack scripts.
  - `r9.sh` runs these groups:
    - `F1`: round-4 scenarios R1–R7;
    - `A1`: R8, R6-1;
    - `Q`: R8-1 control, A and A';
    - `QC`: a byte flipped during the 12 s hold;
    - `QS`: async off.
  - `flyway-r9.sh` runs the migration checks.
  - `stackcmp.py` compares outcomes with the round-5 logs.

## Results

- `results/merge-commit-check.txt`:
  - the commits since `fe0ae13e`;
  - `cmp-merges.sh` for both merges;
  - the `ToolPublicationStore` hand resolution compared with the automatic merge;
  - `storedBinding`;
  - the controller-test method union;
  - the migration diff;
  - the conflict with current `main`.
- `results/probe-r6.txt`: every probe line on H2 and MySQL.
- `results/mutation-check.txt` and `results/mutation-m5-m6-all-publication-tests.txt`: the mutation runs.
- `results/full-suite-296b1be5.txt`: totals, the publication classes and the InnoDB counters.
- `results/hook-it-reruns.txt` and `results/workspace-migration-it.txt` explain the two IT errors.
- `results/flyway.log`: G2 and G3.
- `results/stack-r1-r13.log`, `results/stack-objcheck.txt`, `results/stack-vs-round5.txt` and `results/r6-1-terminal-check.txt`: the packaged stack.
- `results/trial-merge-current-main.txt`: the conflict hunk, the resolution and module verify on the trial merge.
- `results/stack-876-r1-r13.log`, `results/stack-876-objcheck.txt` and `results/stack-876-vs-296b-and-round5.txt`: the same 13 stack scenarios on `876b00ef`, starting from a fresh schema.
- `results/full-suite-876b00ef.txt`: CI's command on `876b00ef`.
