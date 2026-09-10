# PR #9541 — round-2 local verification artifacts

Head verified: `7820a426eec0ee6ed6c5d310560bd380bce7892e` (merge base `db8897d567`).

- `imgs/` — figures referenced from the PR comment.
- `harness/` — the probes:
  - `probe.mjs` drives the real compiled `ChatCompressionService.compress()` from each
    arm's `packages/core/dist` against a mock provider that counts every request with the
    real Qwen2.5 tokenizer (`@lenml/tokenizer-qwen2_5`) and enforces
    `prompt + max_tokens <= window`.
  - `calibrate.mjs` compares the admission estimate against that tokenizer per script.
  - `fake-openai.cjs` + `tui-run.mts` boot the built CLI (`dist/cli.js`) under
    xterm.js/node-pty (`integration-tests/terminal-capture`) against the same
    window-enforcing fake provider.
  - `render-figs.cjs` renders the figures.
- `results/` — raw JSONL output of every run, plus the TUI request logs and screen text.

Scenario files: `scenarios.json` (matrix), `ladder.json` (utilisation ladder),
`ctrl.json` (four-arm controls), `nc.json` / `m3.json` (estimator mutants).
