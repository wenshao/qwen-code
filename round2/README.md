# Round 2 — Linux re-verification of QwenLM/qwen-code#10083

Follow-up to the round-1 macOS run in the parent directory. Round 1 was taken at PR head
**99e47d53** and reported that the teammate hint was inert in production. The author then
pushed **d5f1106c23** (`fix(core): surface teammate hints in task errors`), a one-line
change that puts the hint into `error.message`.

This round re-verifies at head **d5f1106c23** on the platform the PR still lists as
untested.

- Tree under test: PR head `d5f1106c23` (also merged onto `origin/main`, clean).
- Host: Debian 13 (kernel 6.12.63), Node v22.22.2, npm 10.9.7.
- Everything runs through the bundled CLI (`npm run build && npm run bundle` → `dist/cli.js`),
  an isolated `HOME`, `QWEN_CODE_ENABLE_AGENT_TEAM=1`, `--approval-mode yolo`,
  and a scripted fake OpenAI provider driving a real Agent Team inside tmux.

## Arms

| arm | bundle |
| --- | --- |
| `main` | PR head with `packages/core/src/tools/send-message.ts` reverted to merge-base `0756be0ce7` |
| `pr`   | PR head as-is |

Only `packages/core` is rebuilt between arms (`npm run build -w packages/core && npm run bundle`).

## Layout

```
images/01-before-scenarios.png       base  — no hint, ambiguous call takes the task_id branch
images/02-after-scenarios.png        head  — hint present, ambiguous call rejected, hint is actionable
images/03-before-silent-misroute.png base  — both destinations + a LIVE task: silent success, teammate never notified
images/04-after-silent-misroute.png  head  — same call rejected before dispatch
images/05-leader-gap.png             head  — residual: task_id "leader" gets no hint, to: "leader" works
images/06-reverse-gap.png            head  — residual: a live task id passed as `to` gets no reverse hint

harness/mock-model.cjs   scriptable OpenAI-compatible mock (SSE); logs every request/response
harness/run-e2e.sh       tmux + isolated-HOME arm runner
harness/plan-pr.json     scenarios A/B/C
harness/plan-d.json      scenario D (both destinations, live task_id)
harness/plan-e.json      scenario E (leader destination)
harness/plan-f.json      scenario F (reverse direction)
harness/ansi2png.py      tmux ANSI capture -> PNG

evidence/tui-*.txt              raw pane captures per arm/scenario
evidence/wire-pr.jsonl          model-visible wire ledger, head arm
evidence/wire-main.jsonl        model-visible wire ledger, base arm
evidence/mutation-matrix.txt    A/B + 5-mutant matrix
evidence/core-suite-linux.txt   packages/core full suite + pre-existing-failure proof
evidence/ci-stale-base.txt      diagnosis of the red "Test (ubuntu-latest)" check
```

## Reproduce

```bash
git fetch origin pull/10083/head:pr10083 && git worktree add ../pr10083 pr10083
cd ../pr10083 && npm ci && npm run build && npm run bundle
bash harness/run-e2e.sh pr "$PWD"                       # head arm
PLAN=plan-d.json KEEP_ALIVE=1 bash harness/run-e2e.sh pr-d "$PWD"
```
