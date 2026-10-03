# PR #11071 maintainer verification, round 4

Posted as a PR comment; this is the English text with relative image paths. Chinese: [REPORT.zh-CN.md](REPORT.zh-CN.md).

## Maintainer verification round 4 (delta only): real GitHub adapter, shutdown race, `$HOME` scope — head `32a1756193`

**Verdict: unchanged, merge-ready.** I found no new defect in the PR.

[Round 3](https://github.com/QwenLM/qwen-code/pull/11071#issuecomment-5963680532) already re-measured this exact head on real daemons. So this round covers three things:
- the gaps that rounds [1](https://github.com/QwenLM/qwen-code/pull/11071#issuecomment-5920864237), [2](https://github.com/QwenLM/qwen-code/pull/11071#issuecomment-5959798240) and [3](https://github.com/QwenLM/qwen-code/pull/11071#issuecomment-5963680532) listed as not covered;
- one cell that no earlier round measured: the user-scope guard through the real wiring, with a mutant;
- a re-run of the core cells at this head on Linux x86_64.

Rows 1–6 run on real `qwen serve` daemons, A/B against base `1abccdb26a`, which is the merge-base. **375 scripted assertions ran: base 190/190, head 185/185, 0 failures.** Expected base bugs are encoded as the base arm's pass conditions.

### What this round adds

| # | Cell | base `1abccdb26a` | head `32a1756193` |
|---|---|---|---|
| 1 | **A real messaging adapter.** The earlier maintainer rounds used the plugin-example adapter or drove the service layer directly. Here the built-in GitHub adapter (`type: "github"`) runs in real `channel daemon-worker` processes and polls a fake GitHub REST server through `baseUrl`. A scripted model answers `ANSWER <tag>`. Run 3× per arm. | After the config is removed, `DELETE` returns `404 channel_instance_not_found` in 4–5 ms. The channel keeps running: it **keeps polling GitHub (10 polls in the 8 s window, 3/3 runs)** and **still answers a new @mention**. The stale `serve.channels: ["ghA"]` stays on disk. | **200 in 22–25 ms.** The worker exits, ghA makes **0 polls in the 8 s window (3/3)**, and a new @mention gets no reply. `serve.channels` becomes `[]`, and a repeat `DELETE` returns 200. On both arms the bystander ghB keeps its PID and keeps answering. |
| 2 | **`DELETE` racing a daemon shutdown.** Round 3 listed this as: *"Daemon-shutdown delete path (`503 daemon_draining`) — traced in round 1, not measured."* Tested at 9 offsets: SIGTERM 0/1/3 ms before the `DELETE`, and 0/2/5/10/20/40 ms after it. Each run then restarts on the same files and retries. | Every run gets a 404 or a connection reset/close. The stale selection survives the restart, and the retry is still 404. | The daemon's own log shows SIGTERM arriving **while the `DELETE` handler was still running** at +2/+5/+10 ms (12–16 ms before it finished). All three returned **200 with the selection removed on disk**, as did +20/+40, where the handler finished at the same ms or earlier. In the 4 connection-reset/close runs the request never reached a handler (no `route=DELETE` log line), and the selection was left untouched. I never saw a half state. After restart the retry returns 200, and in the reset/close runs it is the retry that removes the selection. |
| 3 | **The workspace is `$HOME`**, so the settings scope collapses to the user file. Round 2 listed this as: *"User-scope collapse (workspace = home directory) — covered by the PR's own new store tests, not independently re-driven."* Tested with the default `QWEN_HOME` and with a redirected one. | 404, and the worker stays alive. The user file keeps `serve.channels: ["botH"]` across a restart. | 200 in 19–20 ms. The worker exits, and the user file's `serve.channels` becomes `[]` and stays that way across a restart. With `QWEN_HOME` redirected, nothing was written to `$HOME/.qwen/settings.json` (checked after the `DELETE`). |
| 4 | **The user-scope phantom-delete guard, through the real wiring** (no earlier round measured this). `botU` is configured in user settings and started by wsA's `serve.channels`; then `DELETE` it from wsA. | 404, and the worker is untouched. | 404 with the new "resolved from another scope" message. The worker, wsA's selection and the user config are all untouched. **Mutant:** in the head bundle, replace only the `opts.loadChannelsConfig(…)` read with `{}`. The same request then returns **200, stops the worker, and wipes wsA's `serve.channels`**. So the merged-view read injected in `run-qwen-serve.ts` is what prevents the phantom delete. |
| 5 | **An untrusted workspace** (rounds 2 and 3: not covered). It is registered at runtime without trust. | `403 untrusted_workspace`, and the file is byte-identical. | Identical. The routes are the only consumer of the service factory, and `resolveTarget` checks trust before it resolves the service (`routes/workspace-channel-management.ts:299`). So the untrusted (`true`) value of the new `skipWorkspaceSettings: !targetRuntime.trusted` argument can't be reached from HTTP. That argument is defensive only. |
| 6 | **Core cells re-run at this head on Linux x86_64**: loss, stale, normal, busy, busy-loss, poison, inflight, all-reload, samename. Round 1 ran these cells on this box at the pre-narrowing head `39f8072927`; round 3 measured this head on aarch64. | The same bugs round 3 recorded: inflight and all-reload orphan a worker, and poison stays permanent. | The same verdicts as round 3. busy queues and returns 200 in 29.5 s on **both** arms. The at-risk shapes return 409 `channel_service_conflict`, then converge on retry. |
| 7 | **Gates** (vitest, not daemons). | — | The 5 changed/related test files pass **2137/2137**. Round 3's only failure, the `[::1]` test, passes on this box, which fits its environmental attribution. `integration-tests/cli/qwen-serve-routes.test.ts` passes **42/42** on the head bundle; neither round 2 nor round 3 ran it. **Negative control:** head's copy of that test against the base bundle gets 41/42, and the only failure is the capabilities-envelope test, because the tag is absent. |

**Side observation, pre-existing on both arms and not caused by this PR.** When the workspace is `$HOME`, boot restore only reads the workspace-scope `serve.channels`. That scope is disabled for `$HOME` (`fast-path-settings.ts`, which this PR doesn't touch), so a selection in the user file is not restored at boot. The settings store, though, reads and writes that same user file for this workspace. Row 3 therefore started `botH` through `POST …/start` on both arms. This doesn't block the merge; it's only worth a follow-up if `$HOME` workspaces matter.

**Still not covered:**
- real github.com and other platforms (the GitHub side here is a fake REST server);
- macOS and Windows;
- the `503 daemon_draining` branch itself (at the offsets I tried, a late request got a connection reset/close instead);
- the `late-collateral` residual, which I did not re-run (round 3 measured it unchanged).

The mutant in row 4 is reported separately and is not part of the 375 assertions.

![01-github-transport-ab](01-github-transport-ab.png)

![02-scope-and-trust-cells](02-scope-and-trust-cells.png)

![03-shutdown-race-sweep](03-shutdown-race-sweep.png)

![04-x86-replication-mutant-gates](04-x86-replication-mutant-gates.png)

<details>
<summary>Method</summary>

- **Setup.** Linux x86_64, 16 cores, Node v22.22.2. Two detached worktrees:
  - `32a1756193`, the head, which I re-checked as the PR head right before posting;
  - `1abccdb26a`, the merge-base.

  Each worktree ran `pnpm install --frozen-lockfile`, `npm run build` and `npm run bundle`. The base bundle has 0 hits for `mergedHoldsConfig`; head has them.
- **`harness/probe4.mjs`** is new for this round.
  - Each cell boots a fresh daemon with its own `HOME`, `QWEN_HOME` and `QWEN_RUNTIME_DIR`, and strips inherited `QWEN_*`, `OPENAI_*` and proxy variables.
  - It runs one fake GitHub REST server per channel, so every poll can be attributed to a channel, plus an in-process scripted OpenAI-compatible model.
  - Worker liveness is read from `/proc`.
  - Orphan detection scans every `daemon-worker` whose environment points at the cell's runtime dir, not only the current daemon's children.
- **Other harness files.** `harness/probe1.mjs` is the round-1 harness with only its paths re-pointed. `harness/judge4.mjs` holds every assertion. `harness/render4.cjs` builds the figures from the raw JSON and the daemon logs; no number in them is typed in.
- **Shutdown race.** All 36 daemons in the shutdown-race cells exited 0: the 18 that got SIGTERM mid-race, plus the 18 restarted ones at teardown. No worker process outlived its daemon. Unrelated to this PR: in the `untrusted` cell, the daemon's teardown exits 1 on **both** arms, because an ACP child is SIGTERMed while still initializing (`daemon shutdown incomplete`).
- **Mutant arm.** A hard-linked copy of the head bundle with the one chunk file rewritten into a new inode, so the head bundle stayed byte-identical.
- **Negative control.** I copied head's integration test file into the base worktree as an untracked file, ran it, then deleted it. `git status` was clean before and after.
- **Independent audit.** A separate audit pass re-checked every number and sentence of this comment against the raw data before posting. Its corrections are applied here.

Evidence (harness, raw per-run JSON plus daemon logs, judge output, gate logs, figure sources): this directory

</details>
