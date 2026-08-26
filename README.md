# Assets — qwen-code PR #9492 local verification

Screenshots and figures for the verification report posted on
https://github.com/QwenLM/qwen-code/pull/9492

- `imgs/01-main-changing-halted.png` — real TUI, main @ d4664fdc89, identical `task_list` polls with a CHANGING board → halted
- `imgs/02-pr-changing-survives.png` — real TUI, PR @ ccdb89d260, same run → all 8 polls execute, turn completes
- `imgs/03-pr-frozen-still-halts.png` — real TUI, PR @ ccdb89d260, FROZEN board → still halts at the same request count
- `imgs/04-wire-evidence-main.png` — model-facing wire capture of the teammate run on main
