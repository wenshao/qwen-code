# PR #12391 — round 2 verification assets

Head verified: `9fcc065` (unchanged since round 1). All arms are built from that head.

| Arm | What it is | Patch |
| --- | --- | --- |
| head | the PR as pushed | — |
| L1 | the 10:52 plan comment alone, implemented literally (measured first) | `patches/arm-L1.patch` |
| C | L1 + claim preservation, lastSequence, ctor coherence, Number allowlist, repository `resolveUnknown` | `patches/arm-C.patch` |
| **L2 ("plan")** | 10:52 comment + inline replies of 12:53–12:56, literally: fenced 4-arg CAS only, `requestCancel`, EXECUTING takeover → UNKNOWN, three transition rules, preserve-or-advance claim, lastSequence monotonic, Number allowlist, package-private 20-arg ctor, round-1 notes | `patches/arm-L2.patch` |
| **C2 ("plan +3")** | L2 + UNKNOWN move exempt from preserve-or-advance + repository `resolveUnknown(id, generation, result, time)` + `CANCEL_REQUESTED ⇒ cancelRequested` | `patches/arm-C2.patch` |
| B | R1-7 measurement instrument (copy() skips re-freezing its own fields) | `patches/arm-B-trusted-copy.patch` |

Every patch applies with `git apply` on `9fcc065`; the PR's 12 tests need three call sites moved to the 4-arg CAS (included in the L1/C/L2/C2 patches).

- `scripts/PlanMatrixProbe2.java` — the matrix in `fig7-plan-matrix.png`; lives in package `com.alibaba.qwen.code.runtimebroker` (clause-level); reaches the fenced CAS / `requestCancel` / `resolveUnknown` by reflection. Output: `logs/matrix2-<arm>.tsv`.
- `scripts/PlanMatrixProbe.java` — earlier public-API variant (`logs/matrix-<arm>.tsv`).
- `scripts/UnknownSideDoorProbe.java` — on L2, `withUnknown()` is refused but `withState(UNKNOWN, false)` (claim kept) gets in; `renewDispatch` refuses UNKNOWN, so only `withResult` before the lease ends gets out (`logs/unknown-side-door-L2.log`).
- `scripts/BotWitnessProbe.java` — the bot review's R1-1..R1-9 witnesses through the public API (`logs/bot-witness-head.log`).
- `scripts/AllocProbe.java` — R1-7 allocation (`logs/alloc.log`).
- `scripts/mutants.py` — 17 mutants on the sites R1-6 names + 6 controls (`logs/mutants.log`).
- `scripts/module-gates.sh`, `scripts/root-gates.sh` — gates (`logs/*.summary`).
