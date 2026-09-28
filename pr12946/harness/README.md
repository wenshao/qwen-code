# PR 12946 real-stack rig (H1 Hosted MCP)

Reproduces the verification report on the PR. All servers, credentials and
records are synthetic.

- `java/RigMain.java` — long-running Spring + session store + embedded Broker on
  fixed ports (18946 / 19946), N Workspaces (`storage-<i>`), an admin endpoint
  (17946) for Session creation and SQL, and a test-only actor filter for the
  public catalog. Compile against `managed-agent-server/target/classes` plus
  its test classpath (`mvn dependency:build-classpath -Dmdep.includeScope=test`).
- `mcp-server.mjs` — deterministic MCP server (stdio / Streamable HTTP / SSE)
  built on the repo's `@modelcontextprotocol/sdk` 1.30.0; every physical request
  is appended to a JSONL ledger.
- `up.sh <tree> <jdbc-url> <run-dir>` — starts the HTTP and SSE servers, writes
  the deployment manifest (`QWEN_MANAGED_MCP_CONFIG`), wraps the worker to keep
  its stderr, starts `RigMain`.
- `run.sh <tree> <run-dir> <scenario.ts>` — copies `lib.ts` and the scenario into
  `integration-tests/helpers/` and runs it with Node 22 + tsx.
- Scenarios: `s1` happy path, `s2` shared Workspace (F1), `s3` list_changed (F2),
  `s4`/`s5`/`s6` cancel / prompt cancel / 32 s tool (F3/F4; `S4_MODE`),
  `s7` HTTP down at close + SSE restart (F5/F2), `s8` reconfigure churn and
  limits (F6), `s9` author's recovery claims, `s10` Broker-down replay + F7,
  `s11` replacement during an in-flight call.
- `mutants.cjs` / `mutate.cjs` / `run-mutants.sh` — 16 TS + 8 Java mutants,
  run in an APFS clone of the tree (Java tests read repo-relative fixtures, so
  mutate inside a full tree).
- `render.mjs` + `cards.json` — the evidence figures (Playwright).
