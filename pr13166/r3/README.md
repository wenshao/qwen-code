# PR #13166 real-stack verification, round 3 (head 62a1f9d3)

Same rig as rounds 1–2 (`../README.md`, `../r2/README.md`). Dependencies reinstalled in the rig worktree from the
new lockfile (`corepack pnpm install --frozen-lockfile`; cli now declares minimatch 9.0.9), Harness and Runtime
worker rebuilt from `62a1f9d3` (`dist/head3`); server jar reused (no Java change). `cand3` = head +
`candidate-brace-budget.patch`.

| DB | Runtime worker | Scenarios |
| --- | --- | --- |
| g10 | head3 | regression `run-r3.sh` (S1–S6, S9), S16 sibling boundary (/2, /1), S17 budget edges + range and nested bypass, S14 R1-1 collected set |
| g11 | cand3 | S17 all shapes on the candidate; head3 Harness + candidate worker (worker gate alone); S18 Sessions pinned at the Workspace root / the sibling directory |

- `mutation/` — E1–E7, one revert per round-6 fix (R1-1 slice, R3-1 deepest ancestor, R4-2 sibling check, R4-1 list,
  both budgets, R1-1 expanded gate) with per-file baselines; E2/E4 rerun after their anchors were fixed (first run
  skipped them: anchor matched 0 times).
- S2 at head3 reports 18/20: the two brace cases are now refused before acquisition instead of by the output check.
- S6's two failures are the `captureBytes` publisher case (no OSS backend on this rig).
