## Real-stack verification: #13194 @ `2486d3dad7` on a Linux durable stack

**Recommendation: mergeable.** I ran a real Linux durable local-process stack with the packaged Hosted Harness, real worker processes and MySQL 8.4. Every API-observable claim in the Reviewer Test Plan held on both surfaces. That includes the part the PR lists as unverified: a real file Turn, then the #13135 physical worker stop, then archive/unarchive, then delete, while a neighbour Session on the same shared storage stays untouched. The base, `main` `b3dda468f2` (the PR's merge base), refuses the same calls with 409. One rollout hardening (F1) is non-blocking; a 2-line candidate fix for it worked on the same stack.

![L1/L2 on a real Linux durable stack](__FIG1__)

### Setup
- **Arms:** server jars built from `main` `b3dda468f2` and from the PR head `2486d3dad7`. The Hosted Harness is `qwen serve --profile hosted-harness` from the head CLI bundle.
- **Linux:** colima VM (kernel 6.8, aarch64), Temurin 21.0.12, Node 22.23.2.
  - Spring runs with `durable-local-process=true` and Workspace mounts.
  - A deterministic OpenAI-compatible model drives real `write_file → edit → read_file` Turns.
  - A recording proxy sits between Spring and the Harness.
  - MySQL 8.4.7 runs on the host.
- **Only non-production piece:** a 40-line filter that maps an `X-Rig-Actor` header to `AuthenticatedTenantActor`. It stands in for the trusted authentication adapter.
- **Spies over the whole L1+L2 window:**
  - the Spring→Harness proxy log and the model request log;
  - the Session's binding, runtime-session, lease and drain rows;
  - Broker registration files and worker PIDs;
  - the MySQL general log: any INSERT/UPDATE/DELETE on runtime, lease or drain tables that names the Session or its binding.

### Results on the PR head
| Area | Result |
| --- | --- |
| Lifecycle, public (delete from ARCHIVED) and WebShell (delete from CLOSED) | 39/39 and 40/40.<br>**Archive:** 202, and the operation is already `completed`.<br>**Unarchive:** 200 CLOSED with `X-Qwen-Idempotent-Replay: false`. Replays return `true` on both surfaces, add no events and leave one command row. An old unarchive key replayed after re-archive returns ARCHIVED and does not mutate.<br>**Delete:** 202, completed in 175 ms (public) and 171 ms (WebShell). Session and events then return 404 on both surfaces. Operations stay readable: 200 for a reader, 404 for an unreadable actor. Same-key replay returns the original operation; the old unarchive key returns 404. |
| Permanent close fence | Runtime `runtimes:warm` returns 409 `workspace_unavailable` after archive and again after unarchive. Positive control: the ACTIVE neighbour returns 200. The close receipt and the drain fence row are unchanged. |
| No Runtime/Harness work | Across L1+L2: 0 proxy requests, 0 model calls, 0 runtime-table writes for the Session. Registrations and worker PIDs are unchanged. |
| Neighbour and shared storage | The neighbour keeps the same worker and still warms (200) after the delete. A new Session on the same storage runs a file Turn. The deleted Session's Workspace files and 48 history-resource rows remain (no erasure, as documented). |
| Authorization | Reader: 403. Unreadable actor or other tenant: 404.<br>Creator whose read was revoked: replay, operation read, unarchive and delete all return 404. Restoring the read makes replay work again.<br>A reader reusing the creator's key: 403. |
| State and close proof | Each returned 409 and persisted nothing:<br>- ACTIVE;<br>- CLOSING (Harness close held 8 s by the proxy);<br>- DELETING (completion held on a row lock);<br>- CLOSED/ARCHIVED set by hand without a close receipt, worker still alive.<br>Malformed keys: 400. Case-distinct keys are distinct commands. |
| Concurrency (three runs: 16, 32 and 32 parallel requests over both surfaces) | 24/24.<br>- Distinct-key unarchive, archive or delete: exactly one winner.<br>- Same-key unarchive: all 200, one non-replay, one command row.<br>- Same-key delete: one operation.<br>- Archive racing delete: ends consistent. |
| Crash during deletion | I held completion on a row lock, then ran `kill -9` on Spring. Nothing was committed: the Session stayed DELETING with no retirement, tombstone or event.<br>Restart with the Harness stopped, `durable-local-process=false` and this storage's mount removed: takeover after 60.4 s (lease expiry) with claim generation 2, and exactly one retirement and one event. The same instance archives, unarchives and deletes other closed Sessions in about 200 ms. |
| Upgrade | Sessions closed under the main binary need no migration (V32). After swapping in the PR jar they can be archived, unarchived and deleted. A Session left ACTIVE under main is closed by the PR jar (its old worker stops) and then deleted. |
| Reads | **ARCHIVED:** Session, events (including the Turn result), items, turns, WebShell get/transcript and both lists are readable.<br>**DELETED:** all return 404, and the Session is absent from both lists. |

**Before, on `main`:** on both surfaces, archive and delete return 409 `workspace_unavailable`. Public unarchive returns 409, and WebShell `/sessions/unarchive` returns 404. The capabilities have no archive, unarchive or delete fields.

### F1 (non-blocking, rollout): an older coordinator can leave a bound DELETE stuck permanently
The design says to deploy compatible binaries to every lifecycle worker before admitting L2, because an old coordinator "would attempt Runtime cleanup". I measured both outcomes. In each case the PR instance admitted DELETE on a CLOSED Session and was killed mid-completion, so a `main`-jar instance picked the DELETE up.

![older coordinator picks up a PR-admitted DELETE](__FIG2__)

- **`main` jar with Runtime close support:** it reruns the drain, one idempotent `INSERT … ON DUPLICATE KEY UPDATE` on `qwen_runtime_harness_drain`, and completes the DELETE. Harmless.
- **`main` jar without Runtime close support (`durable-local-process=false`):**
  - `settle()` throws `workspace_close_identity_unverified`. The operation becomes `RECOVERY_BLOCKED/BLOCKED` and the Session stays `DELETING`.
  - Once every instance runs the PR jar, the operation is still blocked 180 s later, because `findDeliverableOperations` and `claimOperation` re-deliver `BLOCKED` operations only for `CLOSE`.
  - Fresh delete, archive and unarchive return 409; close returns 409 `session_operation_active`. No API call recovers it.

Candidate fix: the same 2-line change in both queries in `ManagedAgentStore`:
```diff
- (delivery_state = 'BLOCKED' AND operation_kind = 'CLOSE')
+ (delivery_state = 'BLOCKED' AND (operation_kind = 'CLOSE'
+     OR (operation_kind = 'DELETE' AND session_status_before IN ('CLOSED', 'ARCHIVED'))))
```
With it, the same stuck row completed on the first scan: claim generation 3, one retirement and one tombstone. For exactly these rows the PR's own `settle()` returns before any Runtime call. The fix only lets the new binary finish work an old binary parked. With the candidate, the unit tests pass 447/447. In its full IT run, one `ManagedAgentMySqlIT` hook case errored at host load ~70; it passed 2/2 when rerun alone.

This is not a blocker if the rollout is coordinated as documented. I'd still take the fix, or at least add it to the rollout notes, because the failure is silent and does not heal on upgrade.

### Tests on this machine (macOS, JDK 21, MySQL 8.4.7)
- `managed-agent-server` unit tests: 447/447, the same as the author's result.
- Real-MySQL ITs:
  - `WorkspaceSessionRetentionMySqlIT` 14/14;
  - `WorkspaceSessionCloseMySqlIT` 5/5;
  - `ManagedAgentMySqlIT` 19/19;
  - `WorkspaceRecoveryMySqlIT` 3/3;
  - `ToolPublicationRecoveryMySqlIT` 8/8 with `TZ=UTC`. With the JVM in Asia/Shanghai against a UTC MySQL it fails 7/8 on both `main` and the head. That is an environment sensitivity unrelated to this PR.
- Mutation check of the new tests: 13 of 15 single-edit mutants are killed. Each mutant runs the focused unit tests plus the two retention/close MySQL ITs.
  - M1 removes the `FOR UPDATE` lease read. Only the real-database lock-wait IT kills it, and CI already runs that IT: the SDK Java MariaDB lane ran it 14/14 on this head.
  - The two survivors are not practical gaps. M11 drops the actor from the unarchive key; this cannot be observed while only the single recorded creator passes `requireWorkspaceCreator`. M13 removes a completion guard that admission already makes unreachable.

![suites and mutation](__FIG3__)

### Not covered / caveats
- **Not covered:** Windows; Shell/MCP profiles; real OSS publication collection (the files profile creates no Shell publications); physical erasure; L3/L4.
- **Input refusal is not fence evidence:** `main` refuses later input on every bound Session (`submitTurn` → `requireLegacyWorkspace`), so "input refused after archive" proves nothing about the close fence. The warm refusal, checked against its positive control, does.

Evidence: probes, harness, per-scenario JSON/logs and the mutation matrix are on [`wenshao/qwen-code@__SHORT__`](https://github.com/wenshao/qwen-code/tree/__SHA__/pr13194).
