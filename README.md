Verification screenshots for QwenLM/qwen-code PR #11557.

- 01-breakpoint-matrix.png — real Chromium render of `<WebShellSidebar>` at 260 / 343 / 344 / 360 px,
  showing the 344px compact-footer breakpoint that hides the version label.
- 02-three-arm-results.png — the two suites under review run on pre-fix main, the PR head, and current main.
- 03-noop-proof.png — `git merge-tree` showing that merging #11557 produces main's existing tree.
