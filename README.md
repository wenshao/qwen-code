# PR #11046 — local verification assets

Figures for the maintainer verification report on
https://github.com/QwenLM/qwen-code/pull/11046

* `fig1-startup-window-ab.png` — real CLI (bun + OpenTUI renderer), startup window
  widened with a slow stdio MCP server. Left: base drops the prompt with
  `Chat not initialized`. Right: PR head sends the turn and renders the reply.
* `fig2-e2e-1cpu-ab.png` — `integration-tests/interactive/mid-turn-submit-interactive.test.ts`
  under the CI leg's own command, pinned to a single CPU. Base needs vitest
  `retry x2`; the PR head passes on the first attempt.

## Round 2 (head `d6c81109d2`)

* `r2-fig1-startup-window-ab.png` — same slow-MCP startup window, base vs the new head.
* `r2-fig2-e2e-1cpu-ab.png` — `mid-turn-submit-interactive.test.ts` under the leg's own command, one CPU.
* `r2-fig3-expiry-fails-loudly.png` — startup slower than the 15s budget: the turn now fails with
  `Timed out after 15000ms waiting for the startup chat to become ready` and sends nothing,
  where round 1 sent a silent tool-less request.
