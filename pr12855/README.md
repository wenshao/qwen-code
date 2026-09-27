# PR #12855 verification assets

Figures `01`–`04` are referenced from the PR report. `figures-src/` holds their text and the PIL renderer.

- `harness/lib.mjs`: rig library. It drives the PR's built `packages/core/dist` authority over HTTP against the packaged Spring jar on MariaDB 10.11.18 (docker, port 13855).
- `harness/s1`–`s11`: scenarios.
  - s1: fixture chains, restart, cold reopen
  - s3: TS/Java verdict differential
  - s3b: random walks
  - s4: pagination, lost response, SSE, deleted Session
  - s5: rebuild cost
  - s6: OpenAPI (Ajv)
  - s7: upgrade and rollback
  - s8: cross-tenant announce
  - s9: corrupt chain
  - s10: trial merge with D3
  - s11: completed
- `harness/mutate.mjs`: targeted mutants against the PR's own suites. Drop the IT database before each run.
- `harness/ApplyBench.java`: times `ManagedExtensionRecordStore.apply` via reflection on the unpacked jar.
- `harness/trial-merge-conflicted-files-vs-main.diff`: the resolved `ManagedAgentService` and contract test, as a diff against `main`. The trial merge also renames `V14__managed_extension_record.sql` to `V16__` and sets spec 1.18.0.
- `results/`: logs and JSON from each scenario, plus test suite summaries.
