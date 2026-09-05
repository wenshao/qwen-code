# PR #10998 verification figures

Local verification of https://github.com/QwenLM/qwen-code/pull/10998
(`fix(cli): keep the tmux IME composition cell free of a fixed background`).

Environment: Linux 6.12.63, node v22.22.2, tmux 3.5a, real `qwen` CLI built from
the PR head (`f861a40db3`) and from the merge base (`60161cb64a`).

| figure | what it shows |
| --- | --- |
| `fig1-cursor-cell-ab.png` | cursor cell in a real tmux pane: block (main) → underline (PR) → block again with `QWEN_CODE_SYNCHRONIZED_OUTPUT=1` |
| `fig2-idle-prompt-ab.png` | idle prompt: the same change seen by every tmux user, IME or not |
| `fig3-env-matrix.png` | guard-vs-capability truth table + live PTY probe matrix (pyte replay) |
| `fig4-mutation.png` | mutation probes on the new tests + full `packages/cli/src/ui` sweep inside tmux |
| `fig5-fullscreen.png` | full pane, before and after |
