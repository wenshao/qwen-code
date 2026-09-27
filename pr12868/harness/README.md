# Verification rig for PR #12868 (generic Broker provider controls)

Everything here was written for one verification round. Paths are absolute to
the machine it ran on; adjust `SCRATCH` and the install locations before reuse.

## What is real

- The built TypeScript `BrokerManagedRuntimeProvider` (`packages/cli/dist`).
- The Spring `managed-agent-server` jar with its embedded Runtime Broker,
  `HttpRuntimeTransport` and `WorkspaceRuntimeTransport`.
- MySQL 8.4.7, migrated by Flyway on first start (`mysql.sh`).
- Bundled workers (`dist/cli.js managed-runtime-worker`) started by the
  production local-process provisioner.
- For `s6`: a live model through the packaged Hosted Harness.

## What is rig-only

- `adapter/RigActorConfig.java`: names the authenticated actor for the public
  API (`X-Rig-Actor`). Loaded with `-Dloader.path`.
- `proxy.mjs`: HTTP forward proxy between Broker and worker. The JVM is started
  with `-Dhttp.proxyHost/-Dhttp.proxyPort` and an empty `http.nonProxyHosts`,
  so loopback worker traffic passes through it. It writes a JSONL ledger and
  injects faults (`/__rig/hook`). Authorization headers are redacted.

## Files

| File | Purpose |
| --- | --- |
| `spring.sh`, `restart-spring.sh`, `mysql.sh`, `node22.sh` | start the stack |
| `lib.mjs`, `hosted.mjs` | shared helpers |
| `s4-ab.mjs` | provider walk, run on the merge-base arm and the PR arm |
| `s1-contract.mjs` | reviewer test plan: sections A, B, C, D |
| `s2-faults.mjs` | sections E (definite refusal), F (lost reply), G (worker death), H (races), I (invalid arguments) |
| `s5-raw.mjs` | raw four-field path on both arms |
| `s6-hosted-real-model.mjs` | Hosted Workspace loop with a live model |
| `s9-author-driver-mysql.mjs` | the PR's own Hosted driver, unchanged, on MySQL |
| `s3-retention.mjs`, `s3b-retention-raw.mjs` | worker memory over 1,500 released Sessions, and its control |
| `s7-evidence-rows.mjs` | stored row and wire body of one invocation |
| `s8-limits.mjs` | argument size boundary |
| `mutants.mjs`, `mutate.mjs`, `mutation-detail.mjs`, `jmut-build.mjs` | mutation matrix |
| `figures.mjs` | renders the figures from the logs in `../results` |
| `suites.sh`, `mvnw.sh`, `java-build.sh`, `build-base.sh` | repository suites and builds with an isolated Maven repository |

## Pitfalls met while building it

- A record left `UNKNOWN` pins its Runtime Session and, for a Workspace, the
  storage. Give every section its own storage.
- The worker refuses `execute` before `preflight`; call `preflight` even when
  the Session is preapproved.
- The shell tool refuses `sleep N; ...`. Use `perl -e "sleep N"; ...` for a
  long-running foreground command.
- `HostedWorkspaceToolTurnIT` pins an in-memory H2 database, also under
  `-Phosted-harness-mysql`.
