## Real-environment verification, round 2 — PR #13135 @ `d7c5c5e50e`

**Verdict:**
- The R4-1 fix works on the real stack.
- Everything that passed in [round 1](https://github.com/QwenLM/qwen-code/pull/13135#issuecomment-5945097553) still passes after the two main merges.
- F1 (container restart → an accepted close strands the Session and its storage) is unchanged. The author says the admission policy is still open, so this remains the one decision before merge.

![round 2](IMG3)

### What changed since round 1 (`6c6e58441a`)

- **Main merges:** two merges of main (#13136, #13155, #13084, #13137). The close migration moved V28 → V30 → V31 with the SQL unchanged.
- **R4-1 fix:** when a binding never saved a handle, lease or attestation, `stopDrained` now creates the registration as INTENT and retires it under the permanent lock, then writes a receipt.
- **Merge conflict resolutions:** I read the hand-resolved hunks with `git show --remerge-diff`, and all three keep both sides:
  - `acquireWriter`: the retention tenant lock is kept, followed by the PR's Session-row check;
  - `completeOperation`: database time plus the DELETE retirement;
  - the prompt route: the closing guard plus the separate Hook-busy code.
- **Lock order:** `acquireWriter` and DELETE completion both lock tenant → Session row → journal head, and CLOSE takes no tenant lock. The merge introduced no inverted order.

Base arm: `49b6c90053` (`HEAD^2`, main with V30). Same rig as round 1: a Linux container on a dedicated colima VM, MySQL 8.4.7, the packaged Harness and real workers.

### R4-1 on the real stack

**Setup.** While Spring was running, I made the Broker state directory `0750`. `validate` then refused it, so creating the registration failed. That left a committed binding in `RECOVERY_BLOCKED` with a null handle. I then restored the directory to `0700` and closed the Session.

**Old head.** The close stayed `recovery_blocked / workspace_close_identity_unverified` (still blocked after 120 s), with the Session CLOSING and the binding DRAINING. A new Session on the same storage failed in 447 ms. So R4-1 is real, and it disables the storage the same way F1 does.

**New head.**
- The close completes in 1.1 s: CLOSED, binding RELEASED with a receipt.
- The registration is written as `RETIRED` / pid 0, so no worker was started.
- A new Session on the same storage completes.
- **Unit pin:** changing `createIntent` back to `false` makes `RuntimeHarnessDrainTest` report 2 errors out of 23 (the two new empty-store cases). This matches the author's mutation.

This path does not cover F1, because F1's bindings already have a saved handle.

### Round-1 matrix on the new head

All of these pass again on the new head. Counts are in the figure.

- Normal close on both surfaces.
- 403/404 refusals.
- `turn_active` for a running Turn or a pending approval.
- A neighbour Session mid-Turn on the same storage.
- Delayed warm: 13/13 clean, 8 of them caught `PROVISIONING`, no leaked worker.
- Worker SIGKILL; Spring SIGKILL mid-close (CLOSED 55 s after restart, original worker stopped); Spring SIGTERM restart.

### Upgrades

- **main V30 database and main-built workers → this head:** V31 applies, and both pre-existing bound Sessions close; their main-built workers are stopped. The first close waited 65 s for the previous Harness's writer lease.
- **A database that ran an earlier build of this PR** (round-1 head, with close recorded as V28): the new head refuses to start with `Migration checksum mismatch for migration version 28`.
  - This only affects environments that deployed a PR build, and the author already lists this upgrade as unexecuted.
  - Such a database has to be recreated or hand-repaired first. That deserves a line in the PR's migration note.

### F1 — unchanged

- **Container restart:** closing a Session created before the restart stays `recovery_blocked` (7 attempts in 121 s, binding DRAINING). A new Session on that storage fails in about 2 s.
- **Same-storage control:** if the pre-restart Session is not closed, its storage still works (4.0 s). Closing it makes the storage fail (451 ms).
- **New node (fresh state directory):** the close is correctly blocked; restoring the directory completes it in 30 s.
- **Status:** the author [agrees with option 1](https://github.com/QwenLM/qwen-code/pull/13135#issuecomment-5945443122) (refuse before writing the operation, CLOSING or fence when the original resources are already unverifiable) but has not pushed it.
- **Merge reference:** land that refusal before merging, or document the container limitation together with its same-storage availability cost.

### Focused suites on `d7c5c5e50e`

- Broker: 102 unit tests plus `JdbcRuntimeBrokerMySqlIT` 7/7.
- Managed Agent: 51 unit tests plus `WorkspaceSessionCloseMySqlIT` 5/5. Checkstyle is clean for both.
- `hosted-harness-session` + `hosted-hook-session`: 241/241 in one run.
- CI on this head: `HostedPublicWorkspaceIT` ran 3 cases with 0 skipped (Hosted process fault gates job).

**Not re-run:** the VM-reboot + `trusted-local-reboot-recovery` case. That branch of `stopDrained` is unchanged since round 1.

**Not covered:** Windows, physical power loss, and multiple Spring instances.

Evidence for this round is [here](TREE), under `r2/`; round-1 material is alongside it.
