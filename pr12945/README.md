# PR #12945 verification bundle

Real-stack verification of the Hosted latency baseline gate at heads `f412baa5` and `0c878352`.

- `01..04-*.png`: figures used in the PR comment.
- `candidate-visible-text.patch`: optional validator change for suggestion S1 (applies to both heads).
- `harness/`: scripts used (`$SP` = scratch directory, `$HOME` = home directory).
  - `it.sh`, `lat.sh`: Maven IT runners.
  - `mutants*.cjs`, `apply-mutant.cjs`, `mutate*.sh`: bundle mutants.
  - `validator-mutants.cjs`: validator assertion mutants.
  - `unit-mutants.cjs`: source mutants against the Hosted unit tests.
  - `render.cjs`, `figures-spec.cjs`: figure rendering.
- `results/<head>/report-*.json`: `target/hosted-latency-baseline.json` from each run.
  - `report-ci-linux-mysql846.json` is the GitHub CI artifact.
  - `report-probe-*` and `report-c(and)-*` come from instrumented or candidate runs.
- `results/<head>/*.txt`: raw runner outputs.
