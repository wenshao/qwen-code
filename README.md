# Evidence — local real-stack verification of QwenLM/qwen-code#10083

`fix(core): disambiguate send_message destinations` (fixes #10073)

- Tree under test: `origin/main` **bfda0822** + PR head **99e47d53**, merged locally (clean, `ort`; effective diff 97+/4-).
- Host: macOS 26.6.2 (arm64), Node v24.18.1, npm 11.16.0 — the platform the PR reports as untested.
- Everything below runs through the **bundled CLI** (`npm run build && npm run bundle` → `dist/cli.js`),
  an isolated `QWEN_HOME`, `QWEN_CODE_ENABLE_AGENT_TEAM=1`, and a scripted fake OpenAI provider.

## Arms

| arm | bundle |
| --- | --- |
| `base` | merged tree with `packages/core/src/tools/send-message.ts` reverted to `origin/main` (production hunk only) |
| `head` | merged tree as-is |
| `witness` | `head` + one line: the teammate hint also appended to `error.message` |

## Layout

```
images/01-tui-base.png   real TUI, base — ambiguous call succeeds and goes to the background task
images/02-tui-head.png   real TUI, head — ambiguous call rejected before dispatch
images/03-wire-ab.png    model-visible tool results, base vs head vs witness

harness/fake-openai.mjs      scripted fake provider (drives team_create → teammate → background task → 10 probes)
harness/run-scenario.sh      headless arm runner
harness/run-tui.sh           tmux TUI runner + pane capture
harness/mutate.sh            6-mutant matrix over the fix
harness/analyze.mjs          replays the wire ledger into a readable transcript
harness/render-ansi.mjs      ANSI → PNG (xterm.js + Playwright)

evidence/wire-base-full.txt      10-probe wire transcript, base
evidence/wire-head-full.txt      10-probe wire transcript, head
evidence/wire-witness-full.txt   8-probe wire transcript, witness
evidence/wire-{base,head}-noteam.txt   no-active-team variant
evidence/tui-{base,head}.pane.txt      raw tmux pane captures
evidence/team-state.txt          where each message actually landed
evidence/mutation-matrix.txt     6/6 mutants killed + the validateBuildAndExecute note
evidence/core-suite.tail.txt     packages/core full suite on macOS
```
