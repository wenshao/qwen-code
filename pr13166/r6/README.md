# PR #13166 — real-stack verification, round 6 (head `0d6a6307`)

Same rig as rounds 1–5 (Hosted Harness → Spring jar with Session Store + embedded Runtime Broker → local-process
Runtime workers; MySQL 8.4; macOS arm64; `durable-local-process=false`, `trusted-local-reboot-recovery=false`).
Lockfile unchanged since round 5; bundle and jar (migrations to V45) rebuilt from `0d6a6307`. Host load 70–100.

| File | What |
| --- | --- |
| `r6-01-reach.png` | The round-6 fixes through the Harness for the spellings probed here (the Linux round-6 report, issuecomment-6016671130, found a read_file .ipynb + offset path that reaches R10-1): Spring refuses `isolation-class=workspace` with Workspace mounts (`logs/g17w`), one worker per Session (`logs/g17/worker-launches.log`), S25/S26 A/B 0ce55064 (`logs/g16`) vs 0d6a6307 (`logs/g17`) |
| `r6-02-hostpath.png` | Pre-existing: `read_file` not-found / directory errors keep the Runtime host path in `runtimeError.message` and the durable records (S25, S25b, S25c, S26) |
| `r6-03-regression.png` | Regression on 0d6a6307, round-5 deadline/brace checks (S22, S19), mutation ledger (`logs/mutation`), R10b mutant bundle on the stack (`logs/g18`) |
| `logs/r6-regression.log` | first regression pass (S5 with its original 3 s window, S6 with the pre-merge tool list) |
| `logs/unit-r6-*.log` | core 131/131, cli 1090/1090 |
| `probe/*` | S25 (build errors / R11-2 spellings), S25b/S25c (files/1 vs files/2), S26 (targets beyond the Session through a link), `s5-approval.mjs` now takes `APPROVAL_MS`, `mutate-r6.mjs`, `figures-r6.mjs` |

Host paths in the probe output are replaced by `<HOST>`; `<RIG>` stands for the rig directory.
