# PR #13098 verification evidence (Linux, head 52e02b300a)

Independent maintainer verification of "fix(managed-agent): guard queued
Hosted approval expiry" on a real Linux stack.

## Layout

- `01-probe-p1-p2.png` — independent queue-race probe at PR head (real
  Session authority + resource store + JSONL journal on disk; the answer's
  expiry/decision write is queued behind one genuinely delayed real journal
  append, and the Session's blocked predicate flips mid-queue, matching the
  production route's `() => session.blocked`). Both probes pass and assert on
  the journal bytes themselves.
- `02-mutation-guard-removed.png` — the same probe with the one-line guard
  reverted (pre-fix behavior): the queued late answer returns
  `409 action_expired` instead of `409 hosted_turn_recovery_required`. The
  PR's own queued-race regression test fails the same way; the decision
  variant still passes (that path was already guarded).
- `03-real-stack-e2e.png` — packaged Harness (`dist/cli.js` bundled at PR
  head) + Spring Session Store on MySQL 8.4 + embedded Runtime Broker + fake
  OpenAI model: 34/34 checks (startup smoke, allow/deny/expiry/cancel,
  decision encoding vs MySQL bytes, queued double-expiry race via a delaying
  Store proxy, restart recovery-blocking).
- `04-regression-guard-mutations.png` — the updated regression checks reject
  injected regressions the old assertions accepted: stopped journal writes in
  a successful denied-call test (new `expectWritesStopped` afterEach) and an
  extra public Action field in the published metadata (new `toEqual`).
- `logs/` — raw driver/vitest output for each screenshot plus the design-note
  consistency check.
- `harness/` — every driver used: `rig13098-probe.test.ts` (independent
  probe), `e2e.mjs` (real-stack E2E), `docs-check.mjs` (EN/ZH design-note
  check), `lib.mjs`/`up.sh` (stack plumbing), `shots.mjs` (screenshots).

The probe test file is not part of the PR; it was placed under
`packages/cli/src/serve/` only for the run and removed afterwards.
