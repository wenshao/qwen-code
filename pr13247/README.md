# PR #13247 verification evidence (W2 same-Workspace cwd change)

- `01-overview.png`, `02-f1-unreadable-dir-wedge.png`, `03-b1-flyway-v34-collision.png` — evidence cards rendered from `results/` by `harness/probe/figures.mjs`.
- `harness/` — the rig: Spring fat jar + embedded Runtime Broker, packaged Hosted Harness, fixture model (`probe/model.mjs`), recording tap, MySQL fault/hold triggers (`probe/traps.sql`), scenario probes `s1`–`s13`, mutation runner. Local throwaway credentials are redacted.
- `results/<db>/` — one directory per database/arm: `h1` head, `u1` base↔head upgrade, `m35` head⊕main fa795e0232 with V35, `x1`/`x2`/`x3` head⊕#13112 d20a1895, `xc1`/`xc2` the same + candidate, `lm` head⊕main 2b15eac862 (V35), `lmc` the same + candidate.
- `results/candidate.patch` — candidate fix (+7/−1 in `WorkspaceRuntimeResolver.requireDirectory`) and two tests.
- `results/mutation/` — ledger and per-mutant logs.
