# PR #13654 real-stack verification assets (head 808759fa)

Cards: `01-matrix.png` (behaviour), `02-latency.png` (paired latency + candidate), `03-flyway.png` (merge blocker).
Candidate client patch: `candidate-async-scans-only.diff` (async header only for seal / prefix / finish).

## Rig (macOS arm64, this machine's paths)
- MySQL 8.4.7 own instance on 13654 (`harness/mysql.sh`, `sql.sh`).
- Server jars built with JDK 21 from base `fbde5cf0`, head `808759fa`, and a trial merge of head + main `669b2f0f`
  (`qwen-managed-agent-server-0.1.0-alpha.jar`, not the operator-recovery jar). `spring.sh` / `spring-l.sh`
  start Session Store + embedded Runtime Broker (local-process, non-durable on macOS) + tool publication with
  `journal-head-authorization=true` and `async-verification-enabled` per arm. `trusted-actor-header=X-Rig-Actor`.
- `fake-oss.mjs`: TLS double of Aliyun OSS used by the real `aliyun-sdk-oss` (hosts file + private CA from
  `tls/tls-gen.sh`). Added here: `POST /hold-gets {on}` holds every object GET (readback) until released.
- `fault-proxy.mjs`: in front of the publication ingress (`service-base-url`) and the Session Store; records every
  request (method, path, status, state, latency, async header). Lane 2 runs a second copy (`DATA_PORT/CTRL_PORT/TARGET`).
- `s654.ts`: one scenario. Creates a Hosted Workspace Session on the packaged Harness (`dist/cli.js serve --profile
  hosted-harness`), a fake model asks for one Shell command (`gen.mjs`, deterministic stdout/stderr), and the real
  worker publishes the capture. Reports turn outcome, request ledger, operation rows (mode/state/epoch), catalog,
  and an independent byte check of both streams. HOLD / HOLD_ACTION drive hold, corrupt, replay, restart, rollback.
- `matrix.sh` (arms A-D), `conc.sh` (K concurrent sessions), `paired.sh` / `paired2.sh` (two stacks at the same moment:
  lane 1 head or candidate, lane 2 base), `perop.mjs` (per-operation time-to-receipt from a ledger).

## Results
- `results/matrix-{A,B,C,D}.log`: arm matrix. In `matrix-A.log`, A4-A6 are void (driver crashed on the pre-V54 schema and
  left readback held); the arm was re-run from A11.
- `results/paired*.log`: paired runs (P1-P10 head vs base under load 30-85, P11-P17 candidate vs base, P21-P27 head vs
  base under load 9-16). `results/ledgers/*.json`: proxy ledgers per run.
- `results/conc.log`: six concurrent sessions, 2 rounds per arm. `results/big*.log`: sequential large-output attempts
  (noisy, superseded by the paired runs; `big.log` was also confounded by the rig's 256 MiB capture budget).
- `results/flyway-check.log`, `results/merge-startup-excerpt.log`: V54 collision on the trial merge.
- `results/restart-b10-b11-rows.txt`: operation rows for the two restart scenarios.
