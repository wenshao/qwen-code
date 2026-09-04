# PR #10988 — maintainer verification assets

Figures for the verification of
[QwenLM/qwen-code#10988](https://github.com/QwenLM/qwen-code/pull/10988)
(`refactor(cli): route every per-request runtime-root pin through
runWithPinnedRuntimeBaseDir`) at head `2c4d313eca`, merge-base `d4e3e4fc87`.

| file | what it shows |
|---|---|
| `fig1-ab-base-vs-pr.png` | Live ACP E2E, base vs PR: all six per-request handlers read the request workspace's runtime root, identically on both sides |
| `fig2-nonvacuity-mutant.png` | The same probe against a build whose per-request seam reads `this.settings`: all six flip to the boot workspace's root, including a cross-workspace `deleteSession` |
| `fig3-grep-suites-mutation-matrix.png` | Grep counts (6 direct calls → 1), suite results, and the 13-row mutation matrix |
| `fig4-source-pin-observations.png` | Two non-blocking observations about the new source pin |

Harness: two workspaces with different `advanced.runtimeOutputDir`, every
session id seeded under both runtime roots with distinguishable content, a raw
newline-delimited JSON-RPC ACP client over `qwen --acp` stdio, and `strace`
on the child so the runtime root each handler opened is read off the
`openat()` lines rather than inferred.
