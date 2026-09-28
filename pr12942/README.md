# PR #12942 (FG6e) independent verification evidence

Head verified: cc0e2e3aa262465e52d5c1f1d41b9453449307ce (base 92f4d4f6).

- 01-gate-matrix.png, 02-mutants.png, 03-probes.png: the figures in the PR comment.
- harness/: rig scripts. it.sh runs one Maven IT selection against native MySQL 8.4.7 (port 13942) or
  MariaDB 10.11.18 (container, port 13943); mutants.cjs holds every production mutant as an exact
  text replacement; mutate.sh runs FG6e against one mutant; unit-mut.sh runs the 170 unit tests against one;
  patch-probe.cjs builds the probe copy (FG6E_PROBE=race|late, hub dump, defaultIntervals, keepExecutor).
- results/: raw one-line outcomes (mutants.txt = FG6e gate, unit-mutants.txt = unit suite,
  probes.txt = probe variants with hub dumps, repeats.txt = unmodified repeats).
