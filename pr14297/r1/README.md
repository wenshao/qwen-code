# PR 14297 real-stack evidence (round 1)

Environment: macOS 10.15.7, Node 22.23.3, real `qwen serve` daemon from head
`5ed76b8158ab2f28506b7ea3f512801b24ca7a8e`, deterministic local
OpenAI-compatible model, real Chromium 128 (Playwright 1.46.1).

Base control: `720eff873a7fd32a0a94a1844f608a2696e26834` (merge-base).

- `ui-01-conversation.png` — three groups before deletion.
- `ui-02-overflow-menu.png` — message overflow menu with Delete messages.
- `ui-03-current-group-selected.png` — current group preselected; linked checkboxes.
- `ui-04-noncontiguous-selection.png` — first and third groups selected, middle left unselected.
- `ui-05-confirm.png` — irreversible-deletion confirmation for two groups.
- `ui-06-after-deletion.png` — after deletion; only the middle group remains.
- `ui-07-after-reload.png` — reload keeps the middle group and does not resurrect deleted groups.
- `base-01-message-actions.png` — base tree has no overflow trigger and no Delete messages action.

JSONL/model-context assertions and the clean-build result are in the PR comment.
