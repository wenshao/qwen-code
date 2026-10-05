# Real-environment re-verification (round 5) — PR #13289 @ `374a523c66`

**Verdict: R3-30 reproduces end-to-end on real MySQL 8.4 and MariaDB 11.4 with the Broker's default settings. The two-line fix resolves it on both engines, with no regressions.** The head has not changed since [round 4](https://github.com/QwenLM/qwen-code/pull/13289#issuecomment-5988780326), so this round covers only what is new: [R3-30](https://github.com/QwenLM/qwen-code/pull/13289#discussion_r4183943611) and the merge conflict with current main.

- **R3-30 is reachable with the default config. No hand-written database rows are needed.**
  - Every Hosted turn calls `runtimes:warm`. Only a turn that actually runs a tool calls `tool-sessions:acquire`, and only that call (via `claim`) writes the LOCAL lease row.
  - So in a Workspace whose Sessions have only had text answers so far, the LOCAL binding is READY but there are **0** lease rows. In that state, the trusted entry point `WorkspaceCsiRegistrationMain register` accepts a CSI alias for the same tenant and storage.
  - Once a tool turn has run, the same registration is refused with "Workspace CSI admission is unavailable."
- **The binding gets stuck at the next host reboot.**
  - With durable workers (the default), a worker that dies within the same boot leaves the binding `LOST` with loss evidence only (`registered-process-exit`). That is existing behaviour, identical on every arm.
  - Proof that the writers have stopped comes from only two places: trusted reboot recovery and operator attestation. Operator recovery does not apply to a binding that never held the mount: `WorkspaceRecoveryCommand inspect` reports "Exact Hosted Shell operator recovery is unavailable."
  - So trusted reboot recovery is the path that retires such a binding. That is exactly the path that `requireLocalAlias` in `releaseLost` refuses.
- **What happens after a simulated reboot:**
  - **Controls:** both control bindings are `RELEASED` by the first sample (under 1 s).
  - **Registered binding:** it stays `LOST` even though `stop=trusted-host-reboot` is recorded.
  - **New placements:** any new placement for the same tenant and storage is refused with 409 `runtime_placement_recovery_required`. This applies to `kubernetes-workspace`, the kind the operator just registered, as well as `local-process`.
  - **Silent retries:** the Broker keeps re-claiming the binding (record_version 61 → 321 in 212 s) without logging a single WARN or ERROR line.
  - **No undo:** the registration cannot be removed. No production path deletes `managed_workspace_csi_registration` rows, and `WorkspaceCsiRegistrationMain` supports only `register` and `inspect`.
- **The fix works on both engines.** I removed only the two `requireLocalAlias` lines from `WorkspaceExecutionStore.releaseLost`. This is the same production change the author describes for the unpublished `271ddbd80`.
  - The stuck binding is `RELEASED` at 0.77 s (MySQL) and 0.88 s (MariaDB), and both placement probes are admitted.
  - New work on that Workspace is still refused (`warm` 409 `workspace_unavailable`), so the acquisition fence is unchanged.
  - The full managed-agent-server suite passes with the fix: 931 tests, 0 failures.
  - This adds real MySQL/MariaDB, Broker, worker and `qwen serve` coverage to the author's H2 checks. I will re-run the same A/B once the fix is pushed.
- **The merge conflict is mechanical.** Against main `dd82140bcd`, the only file both sides changed is `http-managed-session-store.test.ts`: 9 identical `baseUrl` hunks, against #13434. With main's side taken:
  - That file passes 51/51.
  - Build and typecheck both exit 0.
  - managed-agent-server: 943 tests, 0 failures. runtime-broker: 715 tests, 0 failures (4 skipped).
  - No migration collision: main has added no migration after V40.

**Still open before merge:** push the R3-30 fix, resolve the conflict, and the maintainer decision on F2, which is unchanged.

## How R3-30 was exercised

A scratch `HostedVerify13289IT` (not part of the PR) runs the real topology:

- Spring Session Store with the embedded Runtime Broker.
- Bundled durable local-process workers.
- A packaged `qwen serve --profile hosted-harness`, driven through a recording proxy, with a fake OpenAI model that either answers in text or calls the Shell tool.

Broker settings are the `application.yml` defaults: durable workers on, trusted reboot recovery on, verified Workspace recovery off. Operator steps run the PR's own `WorkspaceCsiRegistrationMain` and `WorkspaceRecoveryCommand` as separate JVMs against the same database.

There are three Workspaces, each on its own LOCAL storage:

| Case | Boot A | Purpose |
| :-- | :-- | :-- |
| `warmreg` | text-only turn → operator CSI registration → a Shell turn | the R3-30 chain |
| `warmnoreg` | text-only turn, no registration | control: same state, no alias |
| `toolfirst` | Shell turn (lease row written) → operator CSI registration | control: guard refusal |

Run sequence:

1. **Boot A:** at the end, every worker of the run is SIGKILLed, which is what a reboot does to them. Then 30 s of observation.
2. **Boot B:** the same database and the same state directory. The Spring JVM and its workers start in a private mount namespace where `/proc/sys/kernel/random/boot_id` is bind-mounted to a fresh UUID. `LocalRuntimeStore.rebooted()` compares exactly that file with the registration's `bootId`; `machine-id`, the pid namespace and the time namespace are unchanged. **The host itself was not rebooted.**
3. **Boot B checks:** 120 s of observation, then a new Session per Workspace, then a placement probe. The probe calls `JdbcRuntimeBindingRepository.findOrCreate` with a fresh isolation key, the original scope and storage, and kind `kubernetes-workspace` or `local-process`.

Arms and runs:

- **head** = `374a523c66`.
- **fix** = head with the two lines removed ([patch](harness/r3-30-suggested-fix.patch)).
- Four full runs: head×MySQL 8.4.11, head×MariaDB 11.4.13, fix×MySQL, fix×MariaDB. Results are identical across engines.

The verified-Workspace-recovery mode was not run. From the code, `WorkspaceStorageGuard.register` writes the LOCAL lease row up front, so in that mode the CSI registration would be refused. The window is specific to the default `false`.

## Evidence

**R5-01 — head vs fix, three cases, both engines:**

![R3-30 A/B](r5-01-r3-30-ab.png)

**R5-02 — head arm on MySQL, the `warmreg` chain end to end:**

![head timeline](r5-02-head-timeline.png)

**R5-03 — trial merge with main `dd82140bcd` and the Java suites:**

![trial merge](r5-03-trial-merge.png)

Optional hardening, not blocking (could go to #13395):

- `register` could also refuse while a non-`RELEASED` LOCAL binding exists for the alias.
- Repeated `LOST` recovery refusals could be logged once.

Rig: Linux x86_64, Node 22.22.2, Temurin JDK 21.0.12, Maven 3.9.9, pnpm 11.24.0, MySQL 8.4.11 and MariaDB 11.4.13 in Docker, runs 2026-10-05 13:27–13:58 UTC. CI at the head: 25 pass, 9 skipping, 0 failing; GitHub reports `CONFLICTING`.
