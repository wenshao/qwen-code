# PR #13141 — local verification round 3

Head `2a702c316d3766a54b302267cbcbfd2e8bb9565c`, base `47463b79a7dcf1559d03fd06611e39c7a2dec7d5`,
trial-merged into `main` `fb843d6ce70b774c01b0be07b64b0687082785e4` (tree `25b5e8b89f78638c33ee7fb6a8dad6291d88d2ed`).

Verdict `merge-ready`, 139/139 scripted assertions, 0 unexpected failures.

- `report.md` — the report as posted to the PR.
- `verdict.txt`, `assertions.json` — the machine-readable contract; `assertions.json` is
  written by `harness/aggregate.mjs`, which sums each harness's own pass/fail rather than
  being hand-tallied.
- `*.png` — witness captures, named `NN-kebab-caption.png` and referenced by those names
  in the report.
- `harness/` — everything needed to re-run the round. See below.
- `results/` — raw per-cell output behind every number in the report.
- `ci-junit/` is **not** here: CI's three junit XMLs total 24 MB, so only
  `results/ci-junit-summary.txt` is published. The raw XMLs stayed in the local artifact
  dir, as did the two 682 KB `unit-related-*.log` vitest logs (their summary blocks are in
  `results/unit-related-*-summary.txt`).

## Harnesses

| File | What it proves | Output |
| --- | --- | --- |
| `ab-help.mjs` | the central A/B: base help carries the stale text, head carries the corrected text, and the 5 sibling `--experimental-managed-*` rows plus every other option row are byte-identical between arms | `results/ab-help.json` |
| `probe-runtime.mjs` | S1–S9 startup/admission matrix against the real CLI (reused unmodified from round 1, so its output is directly comparable to `../results/runtime-*.json`) | `results/runtime-{base,head}.{json,txt}` |
| `probe-hooks.mjs` | **new in round 3**: H1–H6, whether Hosted Hooks (H2) are a Broker consumer that escapes the "Workspace tool turns" scope. H4 is the decisive cell | `results/hooks-{base,head}.{json,txt}` |
| `compare-truth.mjs` | maps every claim in the new help text to the probe cell that decides it, and asserts base/head agree on all 15 cells | `results/truth.{json,txt}` |
| `mutate.mjs` | M0–M9 mutation matrix (reused unmodified from round 1) | `results/mutants-r3-head.{jsonl,txt}` |
| `normdist.mjs` | normalized bundle comparison (reused from round 1) | `results/normdist*.txt` |
| `gates.mjs` | isolation/realpath, effective diff, bundle control, trial merge, unit gates, lint liveness, re-measured flakes, issue acceptance criteria | `results/gates.{json,txt}` |
| `ci-junit.mjs` | independent corroboration from CI's own test-results artifact | `results/ci-junit.{json,txt}` |
| `aggregate.mjs` | derives `assertions.json` from the harness outputs above | `results/aggregate.txt` |
| `pty-run.py` | runs a command in a real pty with a forced width via `TIOCSWINSZ`, for the width-independence check | `results/unit-tty-*.summary` |
| `build-comment.mjs` | builds the PR comment body from `report.md`, embedding each witness at its first prose mention | `comment-body.md` |

**`tty-unit.sh` is dead — do not use it.** It was the first attempt at the width check,
driving tmux with `send-keys`; the pane never executed the command and both widths reported
`exit=timeout` with a blank capture. `pty-run.py` replaced it and is what produced the
40- and 250-column results. It is kept here only so the two `unit-tty-*.exit` files in
`results/` are explicable; it is not part of any published number.

## Reproducing

```sh
# arms: three worktrees outside the repo so @qwen-code/* symlinks resolve inward
git worktree add --detach /tmp/r3/wt-base 47463b79a7dcf1559d03fd06611e39c7a2dec7d5
git worktree add --detach /tmp/r3/wt-head 2a702c316d3766a54b302267cbcbfd2e8bb9565c
cd /tmp/r3/wt-head && corepack pnpm install --frozen-lockfile && corepack pnpm run bundle
cd /tmp/r3/wt-base && corepack pnpm install --frozen-lockfile && corepack pnpm run bundle

# head-minus-PR control: revert the two strings, re-bundle, restore
#   (the reverted serve.ts is then byte-identical to base's — assert that before bundling)

node harness/ab-help.mjs      /tmp/r3/wt-base /tmp/r3/wt-head logs/ab-help.json
node harness/probe-runtime.mjs /tmp/r3/wt-base logs/runtime-base.json
node harness/probe-runtime.mjs /tmp/r3/wt-head logs/runtime-head.json
node harness/probe-hooks.mjs   /tmp/r3/wt-base logs/hooks-base.json
node harness/probe-hooks.mjs   /tmp/r3/wt-head logs/hooks-head.json
node harness/compare-truth.mjs logs logs/truth.json
node harness/mutate.mjs        /tmp/r3/wt-head r3-head
node harness/normdist.mjs      /tmp/r3/wt-head/dist-minus-pr /tmp/r3/wt-head/dist <sha> <sha>
node harness/gates.mjs         <artifactDir> /tmp/r3 logs/gates.json
node harness/ci-junit.mjs      <artifactDir> logs/ci-junit.json
node harness/aggregate.mjs     <artifactDir>
```

Ran on macOS 26.6.2 arm64, Node v24.18.1 (`.nvmrc` pins 22 and CI runs Node 22.x — the
deviation is disclosed in the report), pnpm 11.24.0 via corepack.
