## Round 2: #13194 @ `a1c205021f` — F1 fixed, re-verified on the same Linux stack

**Recommendation: mergeable; nothing open from my side.** `a1c205021f` fixes F1 from [round 1](https://github.com/QwenLM/qwen-code/pull/13194#issuecomment-5955445033). The fix is the candidate from that round: the two SQL predicates in the compiled `ManagedAgentStore.class` have the same constant-pool strings as the candidate jar. I re-ran the F1 scenario and the round-1 probes on the same Linux durable stack (packaged Hosted Harness, durable local-process Broker, MySQL 8.4.7), each on a fresh database.

![round 2](__FIG4__)

### F1 recheck (both source states)
The setup was the same for both source states:
1. The fixed head admitted DELETE on a CLOSED or ARCHIVED Session.
2. I ran `kill -9` on it mid-completion.
3. A `main` jar without Runtime close support (`durable-local-process=false`) picked the DELETE up. It parked it as before: `RECOVERY_BLOCKED / BLOCKED`, claim generation 2, Session `DELETING`.

Then only the fixed head ran:
- **Both DELETEs complete on the first scan:**
  - the CLOSED one 0.20 s after Spring logged `Started`, the ARCHIVED one 0.16 s after;
  - claim generation 3;
  - one retirement row and one `session.deleted` event each;
  - Session `DELETED`, and fresh API calls return 404.
- **No Runtime call:** I turned the MySQL general log on before the fixed head started. It records each operation's `INSERT INTO qwen_output_session_retirement` and completion `UPDATE`, and 0 writes to runtime, lease or drain tables for either Session or its binding.
- **Before the fix:** in round 1 (`2486d3dad7`) the same scenario was still `BLOCKED` after 180 s.

### Regression on the fixed head (round-1 probes, unchanged)
| Probe | Result |
| --- | --- |
| Lifecycle, public (delete from ARCHIVED) / WebShell (delete from CLOSED) | 39/39 · 40/40 |
| Authorization, state and close-proof edges | 16/16 |
| Concurrency, 16 and 32 parallel requests | 8/8 · 8/8 |
| Reads through L1/L2 | 4/4 |
| `kill -9` during delete completion, restart without Harness, close support or mount | 7/7: takeover 59.8 s after the kill (lease), claim generation 2, exactly once |

### Tests
- **Suites:** `managed-agent-server` unit tests 450/450. Real-MySQL ITs with `TZ=UTC`:
  - `WorkspaceSessionRetentionMySqlIT` 16/16;
  - `WorkspaceSessionCloseMySqlIT` 5/5;
  - `ManagedAgentMySqlIT` 19/19;
  - `WorkspaceRecoveryMySqlIT` 3/3;
  - `ToolPublicationRecoveryMySqlIT` 8/8.
- **Mutation of the new predicate:** 6/6 mutants killed. The mutants were:
  - scan or claim without the DELETE branch;
  - scan or claim widened to ACTIVE;
  - scan or claim ignoring the backoff.

  They are killed by `recoversDeletionBlockedByAnOlderCoordinatorWithoutRuntime` (unit and MySQL IT) and by `blockedActiveDeletionRemainsUnavailable`.
- **CI on `a1c205021f`:** __CI__

The updated design documents attribute the round-1 Linux evidence to `2486d3dad` and list its limits; that description is accurate.

**Not covered:**
- An older coordinator and the fixed head running at the same time against one database. I tested them in sequence.
- Unchanged from round 1: Windows, Shell/MCP profiles, real OSS collection, physical erasure, L3/L4.

Evidence: [`wenshao/qwen-code@__SHORT__/pr13194/r2`](https://github.com/wenshao/qwen-code/tree/__SHA__/pr13194/r2).
