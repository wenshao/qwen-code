# PR 13109 round 2: real model, cross-host recovery, multi-instance, R2-1

Same head `cb322eedc3` as round 1 (`../README.md`). `results/summary-r2.txt` has every run in compact form; the cards `05`–`07` are generated from the same `RESULT` lines by `harness/gen-figs-r2.mjs`.

- `results/real-model/`: macOS rig (MySQL 8.4.11), Harness with a real model (qwen3.8-flash via the local settings; the key is never written to disk by the rig). `head-*` = PR, `base-*` = merge base.
- `results/cross-host/`: server on 192.168.0.54 (Linux arm64 container, JDK 21, MariaDB 10.11.18, durable local workers). Phase A logs from 192.168.0.98 (macOS arm64), phase B logs from 192.168.0.87 (macOS x86_64); `*-restart.log` = Broker JVM restarted between the phases; `server/ledger.jsonl` = MCP fixture ledger on the server.
- `results/multi-instance/`: two Spring instances on .54 sharing the database, Workspace roots and durable state. `m1-*` store round robin; `m2-*` owner release always sent to instance 2; `mf-rr-head` alternating Broker instances; `mf2-failover-*` instance 1 killed after the drain receipt.
- `results/r2-1/`: base writer loses the owner-release acknowledgement, then the Broker restarts (macOS, default provisioner) and a new Harness detaches; `direct-acquire-replay.txt` is the Broker's final answer to that acquire when the client waits long enough.
- `harness/`: new scenarios (`rm-real.ts`, `x-phase.ts`, `m-failover.ts`, `r9-legacy-restart.ts`), orchestration (`xcase.sh`, `mrun.sh`), updated `lib.ts` (real model, instance routing), `java/RigMain.java` (bind address, store-only, durable options) and the container scripts in `lx/`.

Local paths in logs are rewritten to `/rig-host` and `$HOME`.
