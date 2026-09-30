# PR #13107 — real-stack verification evidence

Head verified: `b784842050` (Java server and Hosted Harness built from `cd7d6c61ab`; the two heads differ only in two files under `packages/web-shell/client`).

- `01..06-*.png` — figures used in the PR comment. Every image region is an unmodified crop of a page screenshot.
- `results/scenarios/*.log` — one log per scenario, written by the probes (PASS / FAIL / NOTE lines).
- `results/static/` — eslint, prettier, tsc, vitest and build results.
- `results/mutation/` — 31 source mutants against the PR's tests, and against the tests plus `candidate-tests.patch`.
- `candidate-tests.patch` — five unit tests (+127 lines, tests only) for behaviour the PR's tests do not pin.
- `harness/` — the rig: launch scripts, the scripted model, the Spring→Harness tap, the host page fixture and the Playwright probes. Local throwaway values only.
