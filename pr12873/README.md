# PR #12873 real-stack verification evidence (head 69fd6c2965)

Verification-only material; nothing here is part of the PR.

- `01..04-*.png` — figures used in the PR comment.
- `harness/probe-reply-loss-driver.ts` — six extra prepare faults (timeout, truncated body, lost request, late original, gateway 502/504) on the PR's own IT scaffolding.
- `harness/real-model-reply-loss-driver.ts` — same stack with a real model behind a local relay; loses the first reply of every prepare.
- `harness/HostedWorkspaceToolTurnIT.probe.diff` — test-only IT hook: `-Dqwen.fg6a.driver=<name>`, comma-separated `-Dqwen.fg6a.case`, probe-case aliases for the SQL-ledger assertions, per-case ledger print. Behaviour for the PR's own eight cases is unchanged.
- `harness/candidate-timeout-unit-test.patch` — candidate unit test for the `TimeoutError` branch of the prepare retry (passes on 69fd6c29, fails on mutant T2).
- `harness/mutants/` — T1..T7 (TypeScript, relative to 69fd6c29) and J1/J2 (Java).
- `harness/{it,rebundle,mutate}.sh` — runners (`$RIG` = scratch directory, MySQL 8.4.7 on 13873, MariaDB 10.11.18 on 13874, private `-Dmaven.repo.local`).
- `results/` — extracted result lines from the runs.
