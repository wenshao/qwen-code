# Notes on the logs

- `race-66d1aedb-mysql84-attempt1-too-many-connections.log`: the analyzer counts every logged error as a violation,
  so it prints `VERDICT: FAIL (346 violations)`. The invariants themselves (I1-I5) are all 0. The 346 errors are
  `SQLNonTransientConnectionException: ... "Too many connections"` (the analyzer truncates the text); the server
  confirms `Connection_errors_max_connections 346`, `Max_used_connections 152` at 2026-09-22 09:47:56 UTC
  (`mysql-error-counters.log`). The harness (`RaceNode` + `DriverManagerDataSource`) opens one unpooled
  connection per repository operation; MySQL 8.0 peaked at 94 for the same 48 threads. The node logs of attempt 1
  were overwritten by the re-run; `race-66d1aedb-mysql84.log` is the re-run.
- `codec-arms-*.log`: the arm named `PR codec` is the codec exactly as in the tree on the classpath
  (plain `JSON.parseObject`, `WriteNulls`); `-fix` logs run the same arms against the patched `BrokerValues`.
- `mutation/M57.txt` shows fuzz divergences, but the fuzz oracle (`DiffFuzz.samePayloads`) calls the mutated
  `BrokerValues.sameJsonMap`, so they come from the oracle, not from the repository; M57 is not counted as a fuzz kill.
- `it-head-mysql84-rerun.log` is from b1938eb; `it-66d1aedb-mysql84-rerun-same-db.log` repeats it at 66d1aedb.
