# PR #13265 round 7 (head 325cf02bfb)

The executor, registry, watcher, supervisor, cgroup and tool-turn sources are byte-identical to round 6, so the Linux evidence for those paths is in `../r6/linux-75/`. This round re-measured what the new code touches.

- `fixture-probes/` — probes inserted into local copies of the PR's own tests, then restored:
  - J1, the Broker drain, after the #13388 lock merge;
  - J3, the Monitor payload at the v3 gate;
  - J4, a `not_started` background start and its `:process` row;
  - the turn-rig `finish()` release.

  All result lines are in `results.txt`.
- `macos/` — the real stack: the Spring jar built at 6f6b227b1a (Java is unchanged at 325cf02bfb) on MySQL 8.4.7.
  - S9: forward replay and cross-capture, plus the task events routes.
  - S10: 600 state flips against the task journal.
  - S11: wake derivation past one page, including a cold reopen.
  - S12: `advanceOutput` before and after attach.
- `results/` — TS suites, Java builds (run 1 hit a load-induced claim expiry; `java-server-run2.txt` is the clean rerun), and the run-1 failure excerpt.
