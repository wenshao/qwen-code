# PR 12839 round 4 (head 752bff4906)

- `01..02-*.png`: evidence cards rendered from `harness/0N.txt` (../harness/render.py).
- `harness/mutate.sh`: mutation table (M1..M13) and runner; each mutant is one guard edit, applied in a
  clean worktree, then `mvn test` (unit) or `-Pfault-gates` (gates); the source is restored after each run.
- `harness/mutate-probe.sh`: applies one mutant and runs selected probe methods (round-2/3 probe files).
- `results/mutants/*.diff`: exact mutant diffs; `summary-unit.txt`, `summary-gates.txt`: verdicts.
- `results/mutant-probes/{M11,M5}`: probe logs on those mutants; `results/head-run1`: probes on the head.
