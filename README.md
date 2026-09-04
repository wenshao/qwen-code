# PR #10982 verification assets

Figures for the local verification of
[QwenLM/qwen-code#10982](https://github.com/QwenLM/qwen-code/pull/10982)
(*fix(core): demote balanced content-only thinking blocks to thought parts*, issue #10791).

| file | what it shows |
|---|---|
| `fig1-before-main-leak.png` | `main` (PR source reverse-applied, rebundled): the balanced `<thinking>…</thinking>` block reaches the user verbatim — issue #10791 reproduced in the real TUI |
| `fig2-after-pr-demoted.png` | PR #10982: the same stream, block demoted into the thought pane, only the answer is user-visible |
| `fig3-ab-matrix-36-cases.png` | 36-case base-vs-PR matrix driven through the real built `converter.js` |
| `fig4-finding-nested-mangled.png` | Finding 1 — nested blocks: `main` (top) keeps the literal verbatim, PR (bottom) leaves a dangling `</think>` as the whole visible answer |
| `fig5-fail-closed-preserved.png` | a thinking block opened after a demotion and never closed still fails closed with `PROTOCOL_TAG_LEAK` |

Environment: Linux 6.12.63, Node 22, worktree at PR head `5843559d86`,
mock OpenAI-compatible SSE endpoint, real bundled CLI (`dist/cli.js`).
