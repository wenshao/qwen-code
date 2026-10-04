# PR #13265 round 4 (head 151d765a81)

- **Linux, real hosts:**
  - `192.168.0.75` is an Orange Pi on kernel 6.6.89 with cgroup v2 and node 24.14. Its delegated root is `/sys/fs/cgroup/qwen-h3-pr13265`, made for this run and removed afterwards.
  - `192.168.0.54` is an rk3588 on kernel 5.10.110. It has no `cgroup.kill`, which arrived in 5.14.
  - Both run the head's built `packages/core` and `packages/cli` dist directly.
- **macOS:** the head's Spring jar on native MySQL 8.4.7, driven by the head's dist over the HTTP session store.

Linux builds compared on .75 (`linux-75/run-75.sh`):

| Arm | What it is |
| --- | --- |
| `head` | The dist of `151d765a81` as built. Every named unit is refused (`l12-head.log`). |
| `nulonly` | `head` with only the empty-string check replaced by `'\0'` at both sites (`probes/fix-cand3.mjs`). This exposes the next layer of bugs. |
| `cand` | `head` with `candidate-r3.patch` applied. `hook-command-cgroup.ts` and `managed-child-run-supervisor.ts` are byte-identical to 210847dd0e, so the round-3 patch applies unchanged (`git apply --check` passes at 151d765a81). |

Files

- `linux-75/l16-*.log`: the new probe `probes/l16-shell-route.mjs`. It drives the worker's shell route (`ManagedShellRuntime.control`) over the real supervisor and registry.
- `linux-75/l4b-l5b.log`: signal evidence and `attach()` for `nulonly` and `cand`. The full `l1` probe aborts under `nulonly` at its L3 case (`l1-nulonly.log`) because of the membership race.
- `linux-54/l17-old-kernel-54.log`: the candidate dist on kernel 5.10. It refuses before any effect: no marker is written and no unit is left.
- `results/`:
  - TS suites on the head;
  - Java build logs, with the runtime-broker MySQL ITs;
  - trial merge with main `1fb5a71522`.

  One `hosted-harness-session` timing case failed in the first trial-merge run, before the merge tree was rebuilt. It passed 3/3 when rerun alone and 338/338 after the rebuild.
- `cards/`: the HTML sources of the four PNGs.
