# PR #12391 — round 3 verification assets (head 25a38c3)

| Arm | What it is | Patch (applies to 25a38c3) |
| --- | --- | --- |
| 9fcc065 | round-2 head, for reference | — |
| 25a38c3 | the fix commit as pushed | — |
| T | 25a38c3 + a test written from the author's 10:06 description ("owner A re-reads for a fresh version, withResult must fail"), 2-arg CAS as shipped → **fails** (`logs/arm-T-test.log`) | `patches/arm-T-authors-1006-test.patch` |
| F ("+actor") | agreed `compareAndSet(expected, replacement, owner, dispatchGeneration)`: the caller's owner and generation must match the stored claim (+8/−4 production). The 14 test call sites pass the caller's own identity as literals; adds the 10:06 test in 4-arg form (incl. right-generation/wrong-owner) and a same-owner stale-generation test. 20/20 (`logs/arm-F-test.log`) | `patches/arm-F.patch` |
| F2 ("+rule") | F + no move back to PREPARED and no move to DISPATCHING from any other state (+16/−4 production) + a no-backwards test. 21/21 (`logs/arm-F2-test.log`); re-verified from a fresh tree on Temurin 21.0.12 (`logs/mvn-F2fresh-*.log`); its four clauses 4/4 killed (`logs/f2-own-mutants.log`) | `patches/arm-F2.patch` |

- `scripts/PlanMatrixProbe3.java` — the matrix in `fig9`; module package; reaches 2-/4-arg CAS, `requestCancel`, `resolveUnknown` by reflection. Output `logs/matrix3-<arm>.tsv` (F2fresh = F2 patch on a fresh tree).
- `scripts/mutants3.py` — deletes each guard 25a38c3 adds, runs the PR's 18 tests, and re-runs the matrix per mutant (`logs/mutants3.log`).
- `scripts/module-gates.sh` — Temurin 21 container gates on 25a38c3 and on 25a38c3 merged into main 2800e9b (`logs/module-gates.summary`); CI results for the merge ref in `logs/ci-25a38c3.tsv`.
- JDKs: gates and the F2 fresh-tree check on Temurin 21.0.12 (container); arms T/F/F2 test runs, probes and mutants on Zulu 21.0.10.
