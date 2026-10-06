# PR #13166 — maintainer verification, round 6 (head `0d6a6307`, Linux x86_64)

Delta round after [round 5](https://github.com/QwenLM/qwen-code/pull/13166#issuecomment-5992523772) (`0ce55064`, macOS arm64).
New since then: `c1bb0b2f` (R9-1), `0d6a6307` (R10-1, R11-1, R11-2, R11-3), and four merges of main.

## Rig

- Linux 6.12 x86_64, 16 cores, Node 22.22.2, JDK 21, MySQL 8.4.11 (docker, tmpfs, no binlog).
- Spring server jar built from the head (`managed-agent-server`, migrations to V45): Session Store plus the embedded Runtime Broker,
  started with the repository's own `trusted-actor-header` (open mode, loopback) instead of the earlier rounds' private adapter.
  Broker production defaults are kept: `durable-local-process=true`, `trusted-local-reboot-recovery=true` (earlier rounds had to
  switch them off on macOS).
- Packaged Hosted Harness (`dist/cli.js serve --profile hosted-harness`), driven on `/session` with an explicit `toolProfile`;
  scripted OpenAI-compatible model.
- Real worker processes driven directly (`dist/cli.js managed-runtime-worker`, boot v2 over stdin, workspace-capability digest)
  for the worker-local sibling registry, which the Java Broker never reaches (it gives every Workspace Session its own worker).
- Arms: `head` = `0d6a6307`; `before` = `ee0a962d` (parent of the fix commit, same lockfile); `merged` = local merge of the head
  with main `9cdb0f38` (`01574e3c`, no conflicts).

## Figures

| File | What |
| --- | --- |
| `r6-01-fixes.png` | R10-1 / R11-1 / R11-2 / R11-3 before vs head on real worker processes (`data/w1/`) |
| `r6-02-r10-realstack.png` | R10-1 through Harness → Java Broker → worker; durable rows (`data/g1-head`, `data/g2-base`) |
| `r6-03-pattern-oracle.png` | Residual: per-pattern existence oracle through the pattern spelling (`data/w1/`) |
| `r6-04-regression.png` | Rounds 1–5 regression probes on Linux (`data/g3-head`), mutation ledger (`data/mutation`) |

## Data

- `data/w1/w1-{base,head}.{jsonl,log}` — every worker call, status, text (mount path replaced by `<MOUNT>`), `leaksMount` flag.
- `data/g1-head`, `data/g2-base` — S25 (R10-1 on the real stack), files/2 and files/1, with the per-table durable scan.
- `data/g3-head` — `run-r6-g3-head.log` plus every probe log (S1–S6, S9, S16, S18, S19, S22, S23*).
- `data/mutation` — `ledger.jsonl` (M1–M4, G1, E1, two baselines) and each run's output; sources restored byte for byte.
- `data/unit/unit-merged-summary.json` — merged tree: cli 1439/1440 (1 skipped, 10 suites), core 92/92 (3 suites).

## Harness

`harness/` holds the rig scripts (`spring.sh`, `node-wrap.sh`, `build-java.sh`, `rig.env` with the rig key redacted) and
`harness/probe/`: `lib.mjs` (Linux port of the round-1..5 library), `w1-worker.mjs` (direct worker), `s25-r10-realstack.mjs`,
`run-r6.sh` (regression runner), `mutate-r6.py`, `figures-r6.mjs`, and the reused probes of earlier rounds.

Not covered: Windows, macOS this round, `shell/2` publisher mode (`captureBytes`, no OSS backend), cross-worker sibling
confidentiality (documented out of scope), W2 cwd change (#13247) with a `/2` Session (the public connector pins `/1`).
