# PR #9040 runtime verification assets (round 2)

Screenshots produced while verifying https://github.com/QwenLM/qwen-code/pull/9040
at head `68ea6ff2b2` against `origin/main` (`1feb3804cf`).

Both arms were bundled from one worktree; the BEFORE arm reverts only
`StatusLineDialog.tsx`, `MultiSelect.tsx`, `SkillsManagerDialog.tsx`,
`statusLinePresets.ts` and `src/i18n/locales/*.js` to `origin/main`.

Captured with `tmux new-session -x <cols> -y <rows>` + `capture-pane -e`,
rendered to PNG with xterm.js under Playwright.

## Round 3

Screenshots produced while verifying the same PR at head `0cd51212af`
against upstream `main` (`b5c7635ff9`, the branch's merge base) and against
the branch's own pre-fix commit `e4cbcadddd`.

Three bundles were built from one worktree with one `node_modules`:
`dist-pr` (PR head), `dist-r2` (`SkillsManagerDialog.tsx` + locales reverted
to `e4cbcadddd`) and `dist-base` (all four production files + locales
reverted to `b5c7635ff9`). Files prefixed `r3-`.
