# PR #12855 verification assets

Figures `01`–`04` (head 2331792cd8) are referenced from the PR report. `figures-src/` holds their text and the PIL renderer.

## Results by head

- `results/`: head 2331792cd8, the current head. Every check in the report was re-run here. Files prefixed `new-` come from the rig's WT-mode log names.
- `results/head-4694587593/`: the rebase onto D3 plus audit round 1.
- `results/head-d6d8cff4a0/`: the first head, and the D3 trial merge (`s10-merge-events.log`, `naive-merge-startup.txt`).

## Harness

- `harness/lib.mjs`: rig library. It drives the PR's built `packages/core/dist` authority over HTTP against the packaged Spring jar on MariaDB 10.11.18 (docker, port 13855). Set `WT` to the worktree and `DB` to the database.
- Scenarios:
  - s1: fixture chains, restart, cold reopen
  - s3: TS/Java verdict differential
  - s3b: random walks
  - s4: pagination
  - s4b: lease after an unknown outcome
  - s4c: crash plus replay
  - s4d: SSE, surfaces, deleted Session
  - s5: rebuild cost
  - s6: OpenAPI (Ajv)
  - s7: upgrade and rollback
  - s8: cross-tenant announce
  - s9: corrupt chain
  - s10: D3 event page
  - s11: completed
  - s12: clock skew and blocked start
- `harness/mutate-new.mjs`: targeted mutants against the PR's own suites. It drops the IT database before each Java run.
- `harness/ApplyBench.java` (d6d8cff4a0 signature) and `harness/v3/ApplyBench.java` (2331792cd8 signature): time `ManagedExtensionRecordStore.apply` via reflection on the unpacked jar.
- `harness/trial-merge-conflicted-files-vs-main.diff`: the trial resolution of `ManagedAgentService` and the contract test, as a diff against `main`. It also renames the migration to `V16__` and sets spec 1.18.0.
