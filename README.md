# PR 10171 verification evidence

Local end-to-end verification of QwenLM/qwen-code#10171 (`feat(goal): let the model propose a Goal the user approves in a dialog`),
run on Linux / Node 22 against a scripted OpenAI-compatible mock model, driving the real interactive TUI in tmux (160x48).

| file | what it shows |
| --- | --- |
| `01-consent-gate-holds.png` | `permissions.allow=[propose_goal]` + YOLO still shows the dialog; no "Always allow" option |
| `02-propose-dialog-yolo.png` | the approval dialog in YOLO mode |
| `03-blocker-approved-but-no-goal.png` | **blocker**: at PR head the approved proposal is refused with "not attributable to a turn"; `/goal` reports "No Goal set." |
| `04-active-goal-refusal.png` | refusal over an active Goal, no dialog |
| `05-workspace-scope-warning.png` | workspace `.qwen/settings.json` cannot change `goals.modelProposed` |
| `06-parent-commit-works.png` | A/B baseline: the same flow works on the parent commit `ebcbb797` |
| `07-parent-goal-pill.png` | A/B baseline: Goal card + footer pill + the runtime driving the first Goal turn |
| `08-candidate-fix-works.png` | one-line candidate fix (`promptIdContext.getStore()`) on PR head restores the flow |
| `09-plan-mode-refusal.png` | plan mode: refused before any dialog |
