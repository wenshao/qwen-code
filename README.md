# PR #10119 — verification evidence

Local real-stack verification of `qwen review emit-workflow`
(feat/review-emit-workflow-v2, head 891b6ac3ee), built from source and run
against a real qwen session with real subagent dispatch.

| file | what it shows |
| --- | --- |
| 01-emit.png | the real CLI emitting the fan-out script |
| 02-parity.png | byte-parity vs `agent-prompt --roster` and the prompt records |
| 03-live.png | 14 real subagents dispatched through the live Workflow tool |
| 04-failclosed.png | one capped agent discards the whole fan-out |
| 05-guards.png | refusals, symlink containment, real loader behaviour |
| 06-budget.png | measured one-tool-result budget and what happens above it |
| 07-mutation.png | mutation matrix against the PR's new tests |
