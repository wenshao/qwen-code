# PR #13061 verification evidence (head c966a689)

- `01-gate-runs.png`, `02-mutants.png`, `03-probes.png`: figures used in the PR comment.
- `harness/`: rig scripts. `it.sh` runs one Maven IT against a chosen database; `mutants.cjs` holds the 14 exact-text mutants
  (J = runtime-broker, W = WorkspaceRuntimeTransport, T = provider worker); `mutate.sh` applies, rebuilds the artifact,
  runs the gate per scenario and restores; `probe-patch.cjs` adds the env-gated probes (seven fields, release request loss,
  closure count); `probe-lease.sh` delays the start retry past the 30 s dispatch lease; `unit-java.sh` runs the module unit
  suites per mutant.
- `results/`: raw result lines (`mutants.txt`, `probes.txt`, `repeats.txt`, `unit-cross.txt`), one-line failure reasons for
  every IT log (`why-all.txt`), the whole-family and CI-equivalent summaries, the probe diffs, and
  `candidate-release-retry-count.patch` (tested: head 3/3 pass, W5 killed).
