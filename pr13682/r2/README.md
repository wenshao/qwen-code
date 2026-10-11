# PR #13682 — real-stack verification, round 2 (VERIFICATION RIG ONLY)

Heads: 7105fb1e (h3, most cells) and ab1af693 (h4, = merged 504e4a79 payload). Base: main 543f03e5 (m3).
Extra jars: main d35277c2 (m4), the PR merged into d35277c2 as-is (x4, two V66 files) and with the PR file renamed to V67 (x4r).

- figures/            the four report figures; figures/src has the HTML cards and the Playwright renderer
- logs/r2.log         h3 battery, R2-4 rollback (p10), workspace-files-off replica (p11), upgrades, mixed versions
- logs/arm4.log       h4 re-run and the main d35277c2 -> ab1af693 (V67) upgrade
- logs/b3.log         base battery on 543f03e5
- logs/up4.log        Flyway outcomes for m4 / h3 / x4 / x4r on fresh and main databases
- logs/flake-*.log    R2-23 (t3 = 23316dd7 vs h3) and the CLI child_acceptance test (h3 vs m3)
- logs/mut3*.nohup, mut/   Java survivors re-run, TS mutants T8/T9 on the #13332 resolution
- probes/, scripts/   new probes and orchestration for this round (round-1 probes are under ../r1/)

A first r2/up4 attempt ran while the rig's MySQL was down; every probe failed to connect, those results were discarded,
and both scripts were re-run from scratch with a MySQL reachability guard (the logs here are from the re-run).
