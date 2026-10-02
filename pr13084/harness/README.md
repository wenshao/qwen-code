# PR #13084 (O4-1) real-stack verification rig

Verification-only scripts. Nothing here is part of the product.

- Stack: dedicated MySQL 8.4.7 (UTC) on 127.0.0.1:23084, Spring jar built from each arm
  (`build-java.sh`), packaged Hosted Harness + Broker worker from `dist/cli.js` built at the PR head
  (`build-ts.sh`), an Aliyun OSS double with TLS (`fake-oss.mjs`, faults: drop-reply / 500 / delay /
  corrupt / GET throttle), a deterministic OpenAI-compatible model (`model.mjs`), and `tap.mjs`
  between Spring and the Harness (swaps the files tool profile for the Shell profile, as in the
  #13037 rig, because public Shell admission is a later slice).
- Arms: head `90bd1190`, base = merge-base `a7deb01b`, trial merge with main `3f56f74a`
  (`362b9b38`, then `33adae4b` = the same merge with V27 renamed to V28).
- `op.sh` is the lifecycle seam: the public close/archive/delete refuse Workspace Sessions
  (409 workspace_unavailable), so it writes the operation row + pending status exactly as
  `ManagedAgentStore.beginOperation` does; the production `SessionLifecycleCoordinator` then runs
  `settle()` -> `completeOperation()` -> `retire()`.
- `sqltap.mjs` is a MySQL TCP relay that can hold one matching statement for N ms (used for the
  writer race in `s2-race.mjs`); `db-delay.mjs` adds 1 ms / 5 ms per client packet (cost runs).
- Scenarios: `s0` smoke, `s1` close/archive/delete, `s2` writer race, `s3` in-flight downloads
  (expiry, SIGSTOP, delete), `s5` evidence + observer classification, `s6`/`s7` read/write cost,
  `s8` one transient OSS 500, `s9` legacy public DELETE, `s10` truncated capture (pre-existing hang),
  `s11` blocked reader -> reader_active, `s12` admission PUT reply lost, `s13` real Aliyun OSS
  (temporary private bucket, deleted afterwards; name and keys are not in this tree),
  `s14` general_log statement breakdown. Batches: `b3.sh`, `b5.sh`, `b6.sh`, `b8.sh`.
- `mut.mjs`: 26-mutant matrix (exact-once replacement, `mvn -Pmysql-integration verify`, TZ=UTC).
- `candidate-test-accepted-complete.patch`: +2 lines, passes on head, kills M21.
