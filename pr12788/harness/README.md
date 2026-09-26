# PR #12788 verification harness

Base `a480bc78` (merge-base) and head `60b1f8ae`, each exported with `git archive`
into its own tree. JDK 21 (Zulu 21.0.12), Maven 3.9.16 offline, MySQL 8.4.7 on
127.0.0.1:13788 with Connector/J 8.4.0.

- `LeaseClockProbe.java` — copied into a copy of `runtime-broker` on each arm and
  run by `run-probe.sh <arm>` on H2, MySQL, and MySQL with
  `sendFractionalSeconds=false`. Uses only APIs present on both arms.
  Output: `results/probe-{base,head}.out`, summarised by `summarize.py`.
- `mkvariant.sh <name> <base|head> <1|1.5>` — head test tree with the three JDBC
  production files taken from base or head and the recovery test lease set to
  1 s or 1.5 s; appends `inject.java.txt` (strict test x10 + issue #12782 boundary
  probe x20). Output: `results/boundary-probe.txt`.
- `mutants.py` / `run-mutant.sh <tag> <mutant|none> [cand]` — 13 single-site
  mutants of the head production code; each runs the full H2 suite, the MySQL IT
  and the MySQL IT with `sendFractionalSeconds=false` (fresh database per run),
  optionally with `candidate.patch` applied. Output: `results/mutation-results.txt`.
- `candidate.patch` — 55-line test-only candidate for `JdbcRepositoryContract`.
- `chart.py`, `card.py` — render the PNGs in the parent directory.
