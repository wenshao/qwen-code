# PR #13107 — round 2 real-stack evidence (`e572cd72fc`)

- `r2-0*.png` — figures used in the round-2 comment; image regions are unmodified crops of page screenshots.
- `results/scenarios/*.log` — one log per scenario (PASS / FAIL / NOTE lines).
- `results/static/` — eslint, prettier, tsc, build and vitest results, the isolated rerun of the two unrelated failures, and the BranchPickerPopover A/B.
- `results/mutation/` — 42 source mutants of the new client code against the PR's tests.
- `harness/` — launch scripts and probes. `probe/tap.mjs` has the `sse-tool-call` rule used by `s9-tool-item-probe.mjs`; `s10-accepted-then-failed.mjs` uses the tap's `respond` rule on the Harness resolve call.
