## Real-environment verification — PR #13135 @ `6c6e58441a`

**Verdict: the close path works as designed on a real Linux durable stack, with one finding to decide before merge.**

- Normal close works on both the public and the WebShell routes. Refusals, races, crash takeover, restarts and upgrade also behave as designed (table 1).
- **F1:** a container restart (same host, same boot, new PID/time namespaces) leaves the Session stuck in CLOSING. The close is accepted but never completes, even though the original worker is provably gone. While it is stuck, every new Session on that Workspace storage fails.
  - Before this PR the same close was refused and the Workspace stayed usable.
  - This is a concrete, reproducible form of the declined bot finding [R2-2](https://github.com/QwenLM/qwen-code/pull/13135#discussion_r4161801652).

Head `6c6e58441a7ead652db311e185e0f8e7836fd2ed`. Base arm: `3f56f74a6a`, the PR's merge-base and `HEAD^2`. `main` has one unrelated commit since then.

### Environment

- **Linux:** Spring fat jar with the embedded durable local-process Broker (`durable-local-process=true`). It runs inside a Linux container on a dedicated colima VM: arm64, kernel 6.8, `eclipse-temurin:21-jre`, Node 22.23.2, and a stable bind-mounted `/etc/machine-id`.
- **Other components:** the packaged Hosted Harness (`dist/cli.js serve --profile hosted-harness`) and real `managed-runtime-worker` processes.
- **Database and model:** MySQL 8.4.7 on the host. The OpenAI-compatible model is scripted.
- **Actors:** the auth adapter provides `alice` (creator), `bob` (read-only) and `mallory` (no access).
- **macOS:** the default (non-durable) deployment was checked separately.
- **Checks:** every check reads the database rows, the Broker registration file in the state directory and `/proc/<pid>` inside the container.

### 1 — What works

![close works](IMG1)

Highlights:

**Normal close.**
- `202` → `completed` in about 160–220 ms, and the Session becomes `CLOSED`.
- The exact original worker PID exits, its registration becomes `RETIRED`, and the binding is `RELEASED` with a drain receipt.
- History is kept: 47 resources and readable events. The Workspace file is kept too.
- Repeating the close key on the *other* surface returns the same operation.
- A new Session on the same storage runs.

**Delayed warm.**
- When a text-only Turn was followed by an immediate close, **9 of 18** closes caught the binding still `PROVISIONING`.
- Close waited for that worker, then stopped it. No worker leaked.

**Crash takeover.**
- I sent SIGKILL to Spring 3 s into a close; the Harness `DELETE` had been delayed by a tap.
- The worker survived as an orphan.
- The restarted Spring took over after the lease expired (47 s), stopped the original PID and completed the operation. The same key then returns the completed operation.

**Upgrade.**
- A base-built database (V27) and base-built workers were taken over by the head jar, which applied V28.
- Both pre-existing bound Sessions then closed, and the workers started by the base build were stopped.

### 2 — F1: an accepted close can strand the Session and the storage

![blocked close](IMG2)

- **Trigger:** `docker restart` of the container that runs Spring, the Broker and the workers. The host and boot id are unchanged; the time namespace is new.
  - All workers died with the container.
  - Closing any Session created before the restart returns `202`, then stays `recovery_blocked / workspace_close_identity_unverified`. The binding stays `DRAINING` (8 attempts in 150 s).
- **Blast radius:** a new Session on the same storage fails within about 1.3 s (`hosted_turn_failed`, Spring: `An earlier runtime placement still requires physical recovery`). Other storages work.
- **A/B on one storage:** after the same restart, a Session that was *not* closed leaves its storage fully usable (new file Turn COMPLETED in 3.3 s). Closing that Session flips the storage to failing (465 ms).
  - So the user action this PR enables is what makes the Workspace unusable.
- **No exit:**
  - The namespaces cannot be restored after a container restart.
  - `WorkspaceRecoveryCommand inspect` refuses with "Exact Hosted Shell operator recovery is unavailable."; files/1 closes have no holder for it to recover.
  - There is no API to cancel the close.
- **What unblocked it:**
  - A real VM reboot, plus restarting Spring with `trusted-local-reboot-recovery=true`. All five stuck closes then completed, with receipts naming the original boot.
  - Without the flag, a reboot keeps them blocked, as designed.
- **Comparison with a new node:** with a fresh state directory (the "new node" case), the close is correctly blocked because the original worker really is still running. Restoring the directory lets it finish by itself in about 33 s.

The fail-closed rule itself is sound, because it cannot tell the container case from the new-node case. The question for the maintainer is what admitting the close should cost.

Options, cheapest first:
1. Refuse admission (409, no fence) when the saved registration is already unverifiable from the current boot and namespaces. This can be the same read-only check that `verifyOperatorRegistration` does. The Workspace then stays as usable as before this PR.
2. Give files/1 close an operator-attested stop, like the Shell recovery command.
3. If neither is in scope, document that durable local-process needs PID and time namespaces that survive Spring restarts (VM or host PID namespace, not a restartable container), and recommend trusted reboot recovery.

One related observation: after the restart the kernel reused the PID-namespace inode number (`pid:[4026532380]` before and after). Only the time namespace differed.
- A runtime that does not create a time namespace (for example containerd/Kubernetes defaults) could therefore make this case pass or fail depending on inode reuse.
- The PID start-tick check still prevents signalling a wrong process.

### Other observations (not blockers)

- **Pre-existing:** a bound Session whose first Turn hangs cannot be cancelled, because `agent.session.cancel` returns `409 workspace_unavailable` on this base. It therefore cannot be closed either (`409 turn_active`).
  - The Harness retried the model request every 120 s (four attempts observed before I made the model answer); the Turn stayed RUNNING for about 7 minutes.
  - Close correctly refuses; this only means close is not an escape hatch for a stuck bound Turn.
- **Error code:** new input on a CLOSED bound Session returns `409 workspace_unavailable` rather than a lifecycle code. A fresh close key returns `409 session_state_conflict`.
- **Bot [R3-1](https://github.com/QwenLM/qwen-code/pull/13135#discussion_r4161801646) (declined):** not reproduced here, and it is outside the files/1 close path.
  - For files/1 `session.mcp` is unset, so the MCP routes return `hosted_mcp_unavailable` before `mcpBusy` can be set.
  - The new post-authorization `session.active` refusal mirrors the pre-existing pre-authorization refusal, which also does not release.
  - Whether the MCP-profile variant can pin a lease depends on the coordinator retrying after a 409. I did not test that.

### Focused suites on head

- **Runtime Broker:** 98 unit tests (drain, durable provisioner, recovery, stop executor) plus `JdbcRuntimeBrokerMySqlIT` 7/7 on MySQL 8.4.7. Checkstyle is clean.
- **Managed Agent:** 50 unit tests (close, lifecycle, coordinator, contract, artifact) plus `WorkspaceSessionCloseMySqlIT` 5/5. Checkstyle is clean.
- **`hosted-harness-session.test.ts`:** 165/165 in 2 of 4 full runs at host load 34–44.
  - The other 2 runs failed one takeover case, "reports a parked execution passively…" (404 on load). Its body is byte-identical to base.
  - It passes 5/5 when run alone on head, and fails 1 of 5 runs alone on base. Base full runs also failed a different takeover case in 1 of 2.
  - This is load-related flakiness that predates the PR; the CI Test job is green.

### Not covered

- Windows.
- Physical power loss: the VM reboot was a real kernel reboot, but a graceful one.
- More than one Spring instance at a time; the author's MySQL ITs cover that.
- `HostedPublicWorkspaceIT.durableClose…` was not re-run locally. CI ran it green on Linux for this head (Hosted process fault gates job).

### Reproduce

The rig scripts and probe ledgers are with the images on `wenshao/qwen-code@assets-pr13135` under `pr13135/harness/` and `pr13135/results/`.
- **Probes:** `s1-close.mjs` (normal close), `s2*/s5` (Turn and approval refusals), `s3` (shared storage), `s4` (warm race), `prep` + `closeall` + `s6-ws-after-block` + `watch-blocked` (fault matrix).
- **Linux control scripts:** `lx/spring.sh`, `lx/harness.sh`, `lx/operator.sh`.
