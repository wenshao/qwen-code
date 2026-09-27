# PR #12837 verification harness

Everything here runs against the built artifacts of a checkout of the PR head
(`18d8313904`), after the repository's normal build: `node scripts/setup-worktree.js`,
`npm run build`, `npm run bundle`, then `mvn package` for `packages/sdk-java/managed-agent-server`
on JDK 21 (install `qwencode` and `runtime-broker` first, as the module README says).

| File | What it does |
| --- | --- |
| `bundle-ab.py <base>/dist <pr>/dist` | Normalizes esbuild content-hash names and diffs the two shipped `dist/` trees token by token. |
| `jar-ab.py <base.jar> <pr.jar>` | Compares jar entries by CRC-32. |
| `probe-authority.mjs <packages/core/dist>` | Opens a real `LocalManagedSessionAuthority`, commits `session_metadata` (control) and `monitor_run`, then parses the committed `domain.committed` event with its domain swapped to `monitor_run`. Run it once per tree. |
| `gen.mjs <core-dist> <fixtures.json> <N> <seed>` | Emits JSONL cases: every fixture case, then structured random grants, pins, runs, monitors and near-neighbour revision pairs. Raw number spellings (`1.0`, `-0`, `1e400`) reach each parser unchanged. |
| `drive-ts.mjs <core-dist> <schema.json> <cases> <out>` | TS module verdict plus strict Ajv 2020 verdict per case. |
| `Drive.java <cases> <out>` | Java verdict per case with Jackson's default mapper. Compile with `target/classes` plus the module's test classpath. |
| `classify.py <seeds...>` | Joins TS and Java verdicts; classifies disagreements. |
| `schema-vs-ts.mjs <core-dist> <seeds...>` | Groups schema/module disagreements by the rule the module applied. |
| `mutants.json`, `apply.py` | The 9 targeted mutants (T1-T5 TypeScript, J1-J4 Java) and their one-anchor applier. |
| `t3.jsonl` | Directed pair that kills T3, with a same-binding control. |
| `lifecycle.mjs <fixtures.json>` | A Monitor's life (11 legal revisions) plus 9 forbidden shortcuts, as `monitorSucc` cases. |
| `eq-gen.mjs <fixtures.json>` | Revision pairs that differ only in JSON spelling (key order, `1000.0`, `1e3`, `-0`, duplicate keys). |
| `BrokerCancelProbe.java` | Cancels a `PREPARED` execution in the Broker's `InMemoryToolExecutionRepository` and prints how it settles. |

Results from the run on macOS 26 arm64, Node 24.18.1, JDK 21.0.12 are in `../results/`.
