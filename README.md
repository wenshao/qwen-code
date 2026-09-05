# PR #11046 — local verification assets

Figures for the maintainer verification report on
https://github.com/QwenLM/qwen-code/pull/11046

* `fig1-startup-window-ab.png` — real CLI (bun + OpenTUI renderer), startup window
  widened with a slow stdio MCP server. Left: base drops the prompt with
  `Chat not initialized`. Right: PR head sends the turn and renders the reply.
* `fig2-e2e-1cpu-ab.png` — `integration-tests/interactive/mid-turn-submit-interactive.test.ts`
  under the CI leg's own command, pinned to a single CPU. Base needs vitest
  `retry x2`; the PR head passes on the first attempt.
