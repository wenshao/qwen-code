# PR #13265 round 5 (head ce04b2112f)

The head moved twice during the round (aaaa8a25d2 → 1a594573ef → ce04b2112f). `linux-75/` keeps all three runs; the report quotes `ce04b2112f`.

## Linux (192.168.0.75, kernel 6.6.89, cgroup v2)

`probes/build-bundles.mjs` bundles each probe once per build with esbuild:

- `@armcli` points at that build's `packages/cli/dist/src`;
- `@qwen-code/qwen-code-core` points at its `packages/core/dist/src`;
- npm dependencies come from the PR worktree.

The host needs nothing but node. Three builds are compared:

| Build | What it is |
| --- | --- |
| `head` | `ce04b2112f` as built. Every background start is refused (H1). |
| `nulonly` | `head` with only the empty-string check replaced by `'\0'` (`probes/fix-cand3.mjs`). |
| `cand` | `head` with `candidate-r3.patch`, which applies unchanged at ce04b2112f. |

- **`l19-executor.mjs`** drives the real `ManagedToolExecutor.executeV3` → supervisor → `ManagedBackgroundShellRegistry` → `ManagedShellRuntime` / `ManagedMonitorRuntime`. Only the result store is local: a `LocalShellStreamCapture` over a store throttled to 20 MiB/s.
  - `TRACE=1` counts who resumes a paused pipe by patching `net.Socket.prototype.resume`.
  - The Monitor scenarios were added by `patch-l19-monitor.mjs` for ce04b2112f.
- **`l20-monitor.mjs`** covers `ManagedMonitorWatcher`. Its registry section targets the 1a594573ef registry and is off by default.
- **`run-75.sh`** is the runner. Each probe runs inside a 3 GiB memory cgroup, and units go under a private root that is removed afterwards. The ce04b2112f logs were produced by the previous version of this script, which writes to `out-v7/`; they are filed here under `ce04b2112f/`.

## Broker (macOS)

`insert-broker-probe.mjs` adds two tests to a local copy of `RuntimeBrokerServiceTest` that is never committed. `results/broker-probe-J1.txt` holds both lines:

- **J1**, live Shell, then release: it supports H8.
- **J2**, Broker restart: it never reached the sweep. The new Broker instance refuses re-acquire with `runtime_reconciliation_required`, and lost-binding recovery abandons PREPARED rows. That concern was withdrawn and does not appear in the report.

## Real stack (macOS)

The Spring jar from aaaa8a25d2 (Java unchanged since) runs on native MySQL 8.4.7, driven by the PR's dist over the HTTP session store.

- **`s7-hosted-monitor-runs.mjs`** enables `monitor_run` only in its own process, as the PR's tests do.
  - The `v1Gate` section bypasses only the TS header gate, to see what the server does.
  - `s7-hosted-monitor-runs.log` is the first run, on aaaa8a25d2's dist. `s7-hosted-monitor-runs-v8.log` is ce04b2112f, using a freshly created v1 Session.
- **`s8-reader-compat.mjs`** creates and opens Sessions across versions. `WT=wt-pr5` is the previous head, whose Session reader is identical to main 6136786c0c and v0.24.7.

## Results

- `ts-*-v8.txt` are the suites at ce04b2112f.
- `merge-*.txt` and `java-build-merge-main.txt` are from the trial merge with main 6136786c0c.
- `ci-test-ubuntu-failures.txt` is the failure excerpt from CI's Test (ubuntu) job at ce04b2112f.
- `h6-mutant.txt` is the tool-turn suite with b21e5f469b reverted.
