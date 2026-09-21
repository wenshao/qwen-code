# PR #12391 — round 3 verification assets (head 25a38c3)

| Arm | What it is | Patch (applies to 25a38c3) |
| --- | --- | --- |
| 9fcc065 | round-2 head, for reference | — |
| 25a38c3 | the fix commit as pushed | — |
| T | 25a38c3 + a test written from the author's 10:06 description ("owner A re-reads for a fresh version, withResult must fail"), 2-arg CAS as shipped → **fails** | `patches/arm-T-authors-1006-test.patch` |
| F ("+actor") | the agreed `compareAndSet(expected, replacement, owner, dispatchGeneration)`: caller's owner and generation must match the stored claim; 14 test call sites pass the caller's own claim; same test in 4-arg form | `patches/arm-F.patch` |
| F2 ("+rule") | F + no move back to PREPARED, and no move to DISPATCHING from any other state (the rule accepted at 12:54) | `patches/arm-F2.patch` |

- `scripts/PlanMatrixProbe3.java` — the matrix in `fig9`; module package; reaches 2-/4-arg CAS, `requestCancel`, `resolveUnknown` by reflection. Output `logs/matrix3-<arm>.tsv` (F2fresh = F2 patch re-applied to a fresh tree, Temurin 21).
- `scripts/mutants3.py` — deletes each guard 25a38c3 adds, runs the PR's 18 tests, and re-runs the matrix per mutant (`logs/mutants3.log`).
- `scripts/module-gates.sh` — Temurin 21 container gates on 25a38c3 and 25a38c3 merged into main (`logs/module-gates.summary`).
