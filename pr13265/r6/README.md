# PR #13265 round 6 (head 0485bd74e2)

The head already merges main up to 98b0255f9d. A trial merge with main aca4d03c7e (one more commit, a dev launcher) is clean.

## Linux (192.168.0.75, kernel 6.6.89, cgroup v2)

Built with `probes/build-bundles.mjs` as in round 5. There are three builds: `head`, `nulonly` (empty-string check fixed), and `cand` (`candidate-r3.patch`, which still applies). Logs are in `linux-75/`:

- `l19-*.log` — the real `ManagedToolExecutor` background and Monitor paths.
- `l19-cand-bpexit.log` — the writer-outlives-launcher case, with the unit read at completion and 3 s later. Its `completionMs` includes that 3 s wait; use `l19-cand.log` for timing.
- `l19-cand-monhold.log` — a running Monitor watch versus `hasActiveSession` and `stopBackgroundSession`. From `patch-l19-monhold.mjs`.
- `l20-*.log` — `ManagedMonitorWatcher`. `l20-cand-2.log` is a second run.

## Fixture probes (never committed; inserted into local copies, run, then restored)

| Probe | Where | Shows |
| --- | --- | --- |
| `insert-turn-probe.mjs` | the PR's `backgroundTurnRig` in `hosted-workspace-tool-turn.test.ts` | `finish()` releases the Runtime Session right after a background admission |
| `insert-monitor-turn-probe.mjs` | the PR's `monitorTurnRig` | the Broker payload of a Monitor call |
| `insert-broker-probe.mjs` (J1 only) | the PR's `RuntimeBrokerServiceTest` Fixture | release with a running Shell now calls the worker's release |
| `insert-broker-monitor-probe.mjs` (J3) | same | that Monitor payload at the real v3 start gate, with a Shell payload as control |
| `zz-r6-shell-schema.test.ts` | `packages/cli/src/serve` | the worker's tool set, and `ShellTool` on `is_monitor` |

Every result line is in `fixture-probes/results.txt`.

## Real stack (macOS)

The Spring jar from 0485bd74e2 runs on native MySQL 8.4.7, with a fresh database whose Flyway history ends at V40.

- `s9-task-events.mjs` drives the PR's hosted funnels with `child_run` and `monitor_run` enabled in-process. It checks:
  - the forward-only output rule;
  - the task events routes, paged and bounded, plus the Web Shell query.

  `s9-read-after-restart.json` is the same read after restarting Spring.
- S6 and S7 manifests now carry `revision`, because `36cbe1ca73` reads it.
- `s8-r6.log`: new Sessions stamp `managed-session/1`, and the previous head opens them.
- `results/ci-fault-gates-failure.txt` is the `HostedWorkspaceToolTurnIT` failure from CI at 0485bd74e2.
