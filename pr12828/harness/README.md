# PR #12828 verification harness

Node scripts used for the macOS verification of `qwen serve --experimental-paired-engines`.
Each daemon runs from a worktree's bundled `dist/cli.js` with an isolated `HOME`, a
trusted-folders file and the local fake model in `fake-model.mjs`.

| Script | What it does |
| --- | --- |
| `rig.mjs` | `PLAN=head` paired → unpaired → paired → fresh paired → Hosted; `PLAN=single`/`base` one unpaired run; `PLAN=p1` paired + replacement; `PLAN=extra` torn line, upper-case id, scratch |
| `dmut.mjs` | bundle mutants D1–D7 in an APFS clone of the head worktree, re-running `PLAN=p1` |
| `mut-unit.mjs` | source mutants against the PR's focused vitest files |
| `candidate-test.patch.ts` | `it.each` for `session-execution-engine-selector.test.ts` (cold restore block) that kills S16/S16b/S16c |
| `rig-quarantine.mjs` | overdue restore on a Legacy-only daemon (`PAIRED=1` or not) |
| `ui-shots.mjs`, `ui-probe2.mjs` | Web Shell screenshots with Playwright |
| `sigterm-race.mjs` | SIGTERM right after the first `/capabilities` 200 |
| `gen-cards.mjs` | renders the evidence cards |

Usage: `WT=<worktree> PLAN=head OUT=<dir> node rig.mjs`.
