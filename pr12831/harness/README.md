# PR #12831 verification rig (sanitized)

Head verified: `0cc5395415972510343891ffde830feac1e82ee3` (base `daaac2223`). macOS, Node 22.23.2, Java 21 (Zulu).

- `rig/mysql.sh` - native MySQL 8.4.7, fresh datadir.
- `rig/spring.sh` - PR `qwen-managed-agent-server` jar via PropertiesLauncher + `adapter/RigActorConfig.java`
  (verification-only `X-Rig-Actor` principal). Session Store on, Harness connector off, embedded Runtime Broker
  on with one mount per `STORAGES` letter, local-process workers from the PR bundle (`node22.sh` logs launches).
- `rig/lib.mjs` - Workspace Session creation through the public API, the packaged Hosted Harness
  (`dist/cli.js serve --profile hosted-harness ... --managed-runtime-broker-url/token`), private `/session` driver,
  Harness->Broker proxy with a request ledger. Real-model mode reads the provider key from the operator's
  settings at launch; nothing secret is stored here.
- Scenarios: `s0` smoke (real model), `s1` the PR's own driver against MySQL, `s2` probes P1-P6 (fixture),
  `s3` PR vs candidate A/B, `s4` Broker prepare/start contract, `s5` gates, `s6` real model (two Workspaces,
  reload, two threads of one Workspace).
- `candidate/*.patch` - candidate fixes (apply on the PR head in this order: fastpath-leaf + embedded-broker-test,
  then acquire-refusal).
- `mutate.py` - mutation sample; `import-path.mjs` - static import chain from the esbuild metafile.
- `logs/` - scenario outputs; `cards/` - figure sources rendered with `render.py`.
