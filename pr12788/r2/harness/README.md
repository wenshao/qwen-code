# PR #12788 verification, round 2 (head `369f6360`)

Two trees exported with `git archive`: head `369f6360` and main `8a170d7e`
(the merge's first parent). `diff -rq` shows they differ in exactly the PR's 8
files. JDK 21 (Zulu 21.0.12), Maven 3.9.16, MySQL 8.4.7 (tarball) on
127.0.0.1:23788, `mariadb:10.11.18` (the CI image) on 127.0.0.1:23789,
Connector/J 8.4.0. Each arm has its own local Maven repository.

Scripts expect `WORKDIR` to point at the scratch directory that holds
`head/`, `main/`, `logs/` and `probe/`.

- `run-mutant.sh <tag> <mutant|none> <module>` copies a module inside the head
  tree, applies one mutant from `mutants.py` (same 13 as round 1), and runs the
  full H2 suite + MySQL IT (`clean verify`), the IT with
  `sendFractionalSeconds=false`, and the IT on MariaDB, each on a fresh
  database. Modules: `runtime-broker` (head as-is), `rb-oldc` (head production
  + `JdbcRepositoryContract` from main, i.e. before f67f16e), `rb-bshim`
  (head tests + the two repository classes from main, so every claim/renew
  call site is back on the truncated clock). `run-matrix.sh` runs the set.
  Output: `results/mutation-results.txt`.
- `run-server.sh <tag> <module> <lane>` runs managed-agent-server against a
  broker installed from `runtime-broker` or `rb-bshim`: the Flyway H2 test,
  `ManagedAgentMySqlIT` on MySQL/MariaDB, or the full CI command.
  Output: `results/server-results.txt`, `results/server-bshim.txt`.
- `LeaseClockProbe.java` (round-1 probe plus a MariaDB label and a skew-tolerant
  clock check that also compares `UNIX_TIMESTAMP()` +
  `EXTRACT(MICROSECOND FROM CURRENT_TIMESTAMP(6))` with
  `UNIX_TIMESTAMP(CURRENT_TIMESTAMP(6))` in the same statement), run by
  `run-probe.sh <arm> <lane>`. Output: `results/probe-{main,head}.out`,
  summarised in `results/probe-summary.txt`.
- `FracProbe.java`: writes a fractional `Timestamp` through Connector/J and
  reads it back as text, per database. `SkewProbe.java`: database clock
  offset from the JVM clock over 20 s.
- `chart.py`, `card.py` render the PNGs in the parent directory from
  `results/probe-*.out` and `results/0*.txt`.
