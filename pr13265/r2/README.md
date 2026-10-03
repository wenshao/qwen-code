# PR #13265 round 2 (head 9c1437ddd6)

macOS: the head's Spring jar on MariaDB 10.11.18 (docker) driven by the head's
built `packages/core/dist` over the HTTP session store, as in round 1.
Linux: a privileged container (kernel 6.8, cgroup v2, cgroupns private,
delegated root `/sys/fs/cgroup/h3`), node 22.23.2, running the head's
core/cli dist directly.

| Image | Logs |
| --- | --- |
| r2-01-round1-fixes.png | results/macos/s2-chain.log, s3-closure-*.log, s4-bypass.log, differential-compare.txt, projection-differential.txt |
| r2-02-ci-red.png | results/ci/*.txt, results/linux/l11-attach-root.log |
| r2-03-supervisor-linux.png | results/linux/l1-head.log (head), l1-cand.log (JS-level edits), l1-cand2.log (candidate patch compiled from source) |
| r2-04-stream-capture.png | results/linux/l9-head*.log, l10-head.log |
| r2-05-mutation.png | results/mutation/* |

`candidate-hook-command-cgroup.patch` is against 9c1437ddd6
(`git apply` from the repo root). It applies four edits to
`packages/core/src/hooks/hook-command-cgroup.ts`: the attach NUL check,
mapping attach root errors to the isolation error, a wait after
`cgroup.kill`, and re-raising a signal in the launcher. With it, the hooks
and supervisor suites pass 1165 tests on macOS and `tsc` is clean. The
Linux results are in `l1-cand2.log`.

Notes
- `s3-closure-ABCDE.log` is the default run. In it, D is refused by the
  authority's local read before Java sees anything. `s3-closure-D2.log`
  turns the local checks off so only Java judges; `s3-closure-G.log` sends
  one ghost reference at a time.
- In `l1-cand2.log`, L2c's `emptyAfterMs: 5000` is a probe artifact: the
  first terminate already removed the unit, so the poll for "populated 0"
  ran to its timeout.
- S5 (deployment order) was not rerun; the reader-gating rules did not
  change.
