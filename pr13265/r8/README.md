# PR #13265 round 8 (head 12916c3b85)

## Linux (192.168.0.75)

The executor, registry, watcher, supervisor and cgroup sources are identical at a1e9730b8b and 12916c3b85. Two builds, bundled with `probes/build-bundles.mjs` (`ARMS=head,rest`):

| Build | What it is |
| --- | --- |
| `head` | The exact-head dist. |
| `rest` | `head` plus the two `candidate-r3.patch` edits the head still lacks (`probes/fix-rest8.mjs`): the launcher re-raises its command's signal (H4), and terminate waits for the unit to empty after `cgroup.kill` (H3). |

Probes:
- `b-l1-supervisor`, `b-l13-fast-start` and `b-l14-terminate-race` are the round-2/3 supervisor probes made bundleable by `probes/make-bundleable.mjs`.
- `l19-executor` covers the real executor background and Monitor paths.
- `l20-monitor` covers the watcher.
- `linux-75/run-75-r8.sh` is the runner.

## macOS real stack

Spring jar built at a1e9730b8b (its Java differs from 12916c3b85 only in whitespace) on native MySQL 8.4.7, driven by the 12916c3b85 dist.

| Scenario | What it covers |
| --- | --- |
| S1 | Domain gate |
| S6 | `child_run` funnel |
| S7 | `monitor_run` funnel |
| S8 | Reader header |
| S9 | Forward rule and task events |
| S10/S11 | Task journal and wake derivation |
| S12 | `outputRef` before attach |

## Fixture probes

Inserted into local copies of the PR's own tests and restored afterwards. `results.txt` holds every result line:

| Probe | What it covers |
| --- | --- |
| J1 | Release with a running row; the sweep's final status read is the last control |
| J3 | Monitor payload at the v3 gate |
| J4 | `not_started` dispatch |
| Turn rig | `finish()` release |

## Results

- TS suites: `ts-cli.txt` was run at a1e9730b8b; `ts-cli-head.txt` at 12916c3b85.
- Java build logs.
- Broker checkstyle at 12916c3b85.
- Trial merge with main 2007925ce5: core build, tsc, and record suites.
