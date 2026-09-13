# Assets for PR #11692 verification

Screenshots from a local verification of
[QwenLM/qwen-code#11692](https://github.com/QwenLM/qwen-code/pull/11692)
(`feat(core): make the web_search budget configurable and bound the extractor
fallback`).

Two independently built arms — `main` @ `d47fa02` and the PR head @ `d34bf8a` —
each run as the real bundled CLI (`dist/cli.js`) against a fake DashScope
Responses endpoint reached over real TLS at
`https://dashscope.aliyuncs.com/compatible-mode/v1` through a local MITM proxy
passed to the CLI with `--proxy`. Nothing in the product is stubbed: the gate,
the OpenAI SDK client, the abort signals and the SSE parsing are the shipped
code paths. The terminal frames are real TUI sessions driven through a pty by
the repo's own `integration-tests/terminal-capture` harness (xterm.js +
Playwright).

| File | What it shows |
| --- | --- |
| `pr11692/01-default-budget-tui.png` | Same hanging upstream, each tree's default budget: `60.0s` on `main`, `120.0s` on the PR. |
| `pr11692/02-model-payload-before-after.png` | The `web_search` tool result captured off the wire on the next model request: 13,197 unlabeled characters of page text before, 6,131 (130-char label + 6,000 characters) after. |
| `pr11692/03-outer-tool-cap-interaction.png` | With `QWEN_CODE_TOOL_EXECUTION_TIMEOUT_MS=90000`: `main` self-limits at 60s and returns a partial result; the PR hits the outer cap at 90s and the searched evidence is discarded. |
| `pr11692/04-cancellation-preempts-budget.png` | Esc during a search still ends the turn immediately under the doubled budget. |
