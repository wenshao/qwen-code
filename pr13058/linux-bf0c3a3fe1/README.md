# PR #13058 — Linux verification evidence (head bf0c3a3fe1)

Verifier: maintainer real-environment check on Linux (same box/rig family as #12894/#13071/#13098), 2026-09-30.

The PR widens two `vi.waitFor` polls in `packages/cli/src/serve/hosted-harness-session.test.ts`
(`settles a turn after one %s failure`) from vitest's default 1s to an explicit 10s.

## Files

- `01-baseline.png` — focused suite at PR head, 20/20 passing, 3 consecutive runs (`logs/baseline*.log`).
- `02-probe-prefix.png` — flake reproduction: merge-base (pre-fix) test + a one-shot 1.2s delay on the
  first durable journal append after prompt admission. All 3 `it.each` variants fail at ~1.1–1.3s with
  `AssertionError: expected […] to deeply equal ArrayContaining{…}` — the exact signature of issue #13034
  (`logs/probe-prefix.log`).
- `03-probe-postfix.png` — the PR version under the SAME delay: all 3 variants settle and pass in ~3s,
  7s of headroom under the new 10s window (`logs/probe-postfix.log`).
- `04-control-prefix-quiet.png` — control: pre-fix test with NO delay passes in ~0.5s per variant on a
  quiet box, confirming a timing race rather than a logic bug (`logs/probe-control.log`).
- `harness/` — the generated probe/control copies and `gen-probes.mjs` that produced them. The probe
  injects a one-shot 1.2s delay on `LocalJsonlManagedSessionJournalHandle.prototype.appendTransaction`
  after each prompt admission, inside the target test only. The probe copies were deleted from the
  worktree after the runs and are NOT part of the PR.

## Environment

- Linux 6.6 (x86_64), Node 24, pnpm worktree at PR head `bf0c3a3fe14b7a599a21bbd8ded807ba80ccc5cd`
- Command: `cd packages/cli && npx vitest run src/serve/hosted-harness-session.test.ts`
- Probe runs: `npx vitest run <probe-file> -t 'settles a turn after one'`
