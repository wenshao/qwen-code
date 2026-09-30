# PR #10916 verification harness

Arms: `main` = origin/main 51b80dadbc; `pr` = 965900af merged with 51b80dadbc (cd4c24b129);
`fix` = pr + `fix-r6-1-steer-accept.patch` (patch B, recommended); `fix2` = pr + `fix2-r6-1-toolresults-only.patch` (patch A).
Each arm: `build-arm.sh <dir>` (pnpm install --frozen-lockfile, npm run build, npm run bundle).

- `fake-model.mjs <scenario.mjs> <requests.jsonl>` — scripted OpenAI-compatible server; the step is the number of
  assistant tool-call rounds already in the conversation; every request (messages + declared tool names) is logged.
- `run-headless.sh <arm> <scenario> <outdir> [cli args]` — real `qwen -p` against the fake model in a throwaway
  HOME/workspace; optional `<scenario>.setup.sh` / `<scenario>.settings.json`.
  NOTE: runs S1–S8 (dirs without `v2-`) used `GIT_CEILING_DIRECTORIES=/` and, for S8, none; the `v2-*` runs use
  the parent of the workspace (current script). No enclosing git repository existed on the box either way.
- `acp-run.mjs <armdir> <scenario> <outdir>` — one real `qwen --acp` stdio session (initialize → authenticate → session/new → session/prompt).
- `pr10916-tui.ts` — real TUI under node-pty + xterm.js (the repo's integration-tests/terminal-capture harness, copied with
  node-pty loaded via createRequire); `steer` mode types a mid-turn message while the halting round's command runs.
- `mutate.py` — M1–M10 mutation matrix on the `pr` arm (each mutation reverted with `git checkout -- <file>`).
- `evidence.py` / `pr10916-render.ts` — build and render Fig. 2 / Fig. 3.

Scenarios: s1 (issue shape), s1x (S1 + disabled list_directory), s2 (alternating dead ends), s3b (user deny rule),
s4 (edit → re-run), s5 (TUI steer), s5b (S1 + refused `sleep N; …`), s6 (subagent), s7 (quoted digest), s8 (silent exit-1 probes).
`s3-headless-denial` is the first S3 attempt (`-p` default approval mode): discarded, because there the shell tool is not
declared to the model at all.

Intermittent `Output: (empty)` from fast-failing commands (12 of 211 across all runs, 6 of 104 on main; root cause not
determined, not introduced by this PR) affected these runs, which are therefore not used as evidence of detector behaviour:
fixarm-s1-git-deadend and fixarm-s7-quoted-digest (exit 0 — the patch does not touch detection; fix arm S1 halted at 5 in
3/3 later repeats), rep-s1-pr-2 / rep-s1-pr-3 (halt at 8 / none), v2-s1x-list-directory-pr (clean repeats -2/-3 halt at 8),
and on main rep-s1-main-2, s6-main, s7-main, v2-s1x-list-directory-main, v2-s2-alternating-main (no effect: main has no guard).
