# PR #11412 verification assets

Local verification harness, logs and screenshots for
[QwenLM/qwen-code#11412](https://github.com/QwenLM/qwen-code/pull/11412)
(`fix(web-shell): use renamed session-activity mock in split-view rerender test`).

Run against a real worktree at the PR head (`34e6ea308b`) with its own `npm ci` and
a full `npm run build`, on Linux / Node v22.22.2.

* `harness/` — the mutation matrix, the call-count census, the screenshot driver.
* `logs/` — raw vitest output for every arm, the three full-suite runs, the gate probes.
* `shots/` — the PNGs embedded in the PR comment.

Key result: `git merge-tree --write-tree origin/main pr11412-head` yields
`35a388f06e528fc920ea89394f01e71683f8531b`, which **is** `origin/main^{tree}` —
merging this PR changes nothing, because #11406 already landed the same fix.
