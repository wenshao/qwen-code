# PR #13163 round 6 evidence (head 13df2a65, Linux aarch64 rig)

Verification rig only. Same rig as `../r5-linux` (managed-agent-server fat jar with the embedded Runtime Broker and the
durable local process, packaged Hosted Harness, MySQL 8.0.45, Session Store on a second replica, taps in front of the
Harness and the Broker). Shared probe library and the round-5 probes are in `../r5-linux/probe`.

- `r6-linux-01-results.png`, `r6-linux-02-webshell.png`: figures in the PR comment; `raw/`: unmodified screenshots.
- `logs/h63/batch6h3.log`: regression set, `r62` (R6-2) and `r63` (older in-flight attempt) at 13df2a65.
- `logs/b6/batch6b.log`: `r63` at 25eb9ae2; `logs/b6/proto6.log`: `r62` + `r63` on the per-attempt prototype jar.
- `logs/b6/mig48d.log`: V47+V48 rolling upgrade on MySQL (Harness + replica A upgraded, old writer lease waited out).
  `mig48b.log` / `mig48c.log` are the two earlier attempts that hit the rig's reattach timing (409
  `hosted_session_already_attached` with the old Harness kept; "writer grant is stale" without the lease wait); the
  first attempt is in `batch6b.log`.
- `logs/to3`, `logs/to3b`: overlapping passive loads vs teardown (2 runs).
- `logs/u63`: WebShell en / zh cancel.
- `ledgers/harness-mutants-13df2a65.txt`, `ledgers/java-mutants-13df2a65.txt`: mutation runs (`probe/tsmut14.mjs`,
  `probe/javamut14.mjs`). `RuntimeBrokerDefaultOnTest` failures in some Java mutant runs come from those runs overlapping
  the live rig's own durable-local-process Broker on the same host; the control and J3 runs do not show it.
- `ledgers/prototype-per-attempt-boundary.txt` + `patch/per-attempt-boundary.patch`: the per-attempt boundary prototype
  (no V48). The full-suite line predates moving one mock stub to the 8-argument completion; `lifecycle2` is after.
