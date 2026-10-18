# PR 13579 — maintainer verification evidence

Head `c8b2e8991f0f` ("scope XML recovery declines to genuinely ambiguous regions").
Base `7a2ce9b99a` (merge-base of the PR branch with `main`).

Rig: `/Users/wenshao/pr13579-rig`

- `src-head` / `src-base`: independent worktrees, `corepack pnpm install` + `npm run build` + `npm run bundle`.
- `harness/e2e.ts`: starts a scripted OpenAI-compatible server on loopback and drives the real
  compiled `dist/cli.js` in `--output-format stream-json` mode with a fresh `HOME`/`QWEN_HOME`
  and workspace per scenario.
- `harness/fuzz.ts`: 600 generated turns in which a `write_file` parameter value documents a
  complete `run_shell_command`; compares base and head extraction.
- `harness/bench.ts`: growth check on large turns.

## Figures

- `fig1-before-after.png` — real terminal (tmux, captured pane): the #13492 turn run through
  `dist/cli.js` on base and on the PR head. Base loses the outer write; head writes the exact
  111 bytes once, runs the independent read, and never runs the quoted shell call.
- `fig2-matrix.png` — measured scenario matrix, fuzz totals, and suite results.

## Commands

```bash
cd /Users/wenshao/pr13579-rig/src-head
./node_modules/.bin/tsx ../harness/e2e.ts /Users/wenshao/pr13579-rig/src-head head results-head.json
./node_modules/.bin/tsx ../harness/fuzz.ts
./node_modules/.bin/tsx /tmp/bench2.mts

cd packages/core && npx vitest run          # full core suite
npx vitest run src/core/xml-tool-call-fallback.test.ts
npx eslint src/core/xml-tool-call-fallback.ts src/core/xml-tool-call-fallback.test.ts
npm run typecheck
```

## Raw notes

- Full core suite: 37,365 passed, 2 failed, 54 skipped. The two failures
  (`memory/recall-scan-latency.test.ts` cold-scan budget and `tools/exit-worktree.test.ts`
  timeout) are unrelated to the changed file; the latency case also fails on base, the
  worktree case passes on re-run.
- `xml-tool-call-fallback.test.ts`: 127 passed.
- Typecheck: no `error TS` across packages. ESLint on both changed files: clean.
- Performance signal (module-level, wall clock, idle machine):
  quoted blocks x100 / 22 KB -> head 82 ms, base 0.5 ms;
  x200 / 44 KB -> head 585 ms, base 1.8 ms;
  x400 / 89 KB -> head 4.3 s, base 6.8 ms.
  Plain blocks x400 (57 KB) -> head 1.4 s, base 0.8 s, so some superlinearity predates this PR,
  but the quoted-value path adds a new cost. Tracking issue: #13787.
