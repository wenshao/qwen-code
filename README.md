# PR #10171 — local end-to-end verification, round 2

Screenshots from a real interactive Qwen Code TUI (`node dist/cli.js`) driven in tmux
(160x48) against a scripted OpenAI-compatible mock model, in an isolated
`HOME` / `QWEN_HOME` / workspace. Verified commit: `210baa4170e341be717e351fcc75fc454f710e6c`.

| file | what it shows |
| --- | --- |
| 01-propose-dialog-yolo.png | `propose_goal` approval dialog under `--yolo`; only *Yes, allow once* / *No, suggest changes* |
| 02-approved-goal-active.png | approve -> `Goal approved` -> one-sentence ack -> `Goal active` card + `/goal active` pill (the blocker reported last round is fixed) |
| 03-decline-no-goal.png | Esc on the dialog -> call cancelled, `/goal` reports none |
| 04-continuation-parked.png | approval parked through a tool-result continuation, applied only at the final boundary |
| 05-abort-drops-approval.png | Esc while the approval is parked -> `Request cancelled`, no Goal |
| 06-btw-head-goal-survives.png | concurrent `?btw` side query during the parked window -> Goal still set (PR head) |
| 07-btw-fix-removed-no-goal.png | same run with the `isConcurrentSideQuery` guard removed -> `No Goal set.` (A/B) |
| 08-workspace-scope-ignored.png | `goals.modelProposed` in workspace settings -> warning, value ignored |
| 09-active-goal-refusal.png | a running Goal turn proposing -> refused with the `/goal edit` / `/goal set` hand-off |
